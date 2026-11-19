begin;
do $$
declare shop uuid:=gen_random_uuid(); employee uuid:=gen_random_uuid(); token text:=repeat('c',64); req uuid:=gen_random_uuid(); manager uuid; d date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date-2; t timestamptz; payload jsonb; target uuid;
begin
 select user_id into manager from public.owner_profiles limit 1;
 insert into public.stores(id,name) values(shop,'Request fixture');
 insert into public.employees(id,name,store_id) values(employee,'Request fixture',shop);
 perform public.attendance_select_employee(shop,employee,token);
 t:=(d+time '08:00') at time zone 'Asia/Jakarta';
 payload:=public.employee_attendance_requests(token,req,d,'SHIFT',t,t+interval '8 hours','Lupa absen masuk dan pulang');
 perform public.employee_attendance_requests(token,req,d,'SHIFT',t,t+interval '8 hours','Lupa absen masuk dan pulang');
 if jsonb_array_length(payload)<>1 or exists(select 1 from public.attendance where employee_id=employee) then raise exception 'premature attendance or duplicate'; end if;
 begin
 perform public.employee_attendance_requests(token,gen_random_uuid(),d,'SHIFT',t,t+interval '8 hours','Duplikat pengajuan');
 raise exception 'duplicate pending allowed';
 exception when raise_exception then if sqlerrm<>'pending request' then raise; end if; end;
 begin
 perform public.owner_review_attendance_request(gen_random_uuid(),req,true,'Sudah diperiksa');
 raise exception 'nonowner approved';
 exception when raise_exception then if sqlerrm<>'owner required' then raise; end if; end;
 perform public.owner_review_attendance_request(manager,req,false,'Waktu perlu diperiksa');
 if exists(select 1 from public.attendance where employee_id=employee) then raise exception 'rejection wrote attendance'; end if;
 req:=gen_random_uuid();
 perform public.employee_attendance_requests(token,req,d,'SHIFT',t,t+interval '8 hours','Waktu telah diperiksa');
 perform public.owner_review_attendance_request(manager,req,true,'Sesuai konfirmasi tim');
 perform public.owner_review_attendance_request(manager,req,true,'Sesuai konfirmasi tim');
 select id into target from public.attendance where employee_id=employee and work_date=d;
 if target is null or (select count(*) from public.attendance where employee_id=employee)<>1 then raise exception 'approval missing or duplicate'; end if;
 if exists(select 1 from public.attendance_evidence where attendance_id=target) then raise exception 'fake evidence'; end if;
 if not exists(select 1 from public.attendance where id=target and owner_confirmed_by=manager) then raise exception 'missing audit'; end if;
 -- OUT-only request preserves the original entry and evidence.
 d:=d+1; t:=(d+time '08:00') at time zone 'Asia/Jakarta';
 insert into public.attendance(employee_id,check_in_at) values(employee,t);
 req:=gen_random_uuid();
 perform public.employee_attendance_requests(token,req,d,'OUT',null,t+interval '8 hours','Lupa pulang kemarin');
 perform public.owner_review_attendance_request(manager,req,true,'Waktu telah diperiksa');
 if not exists(select 1 from public.attendance where employee_id=employee and work_date=d and check_in_at=t and check_out_at=t+interval '8 hours') then raise exception 'OUT approval failed'; end if;
 begin
 perform public.employee_attendance_requests(repeat('f',64));
 raise exception 'invalid session allowed';
 exception when raise_exception then if sqlerrm<>'invalid session' then raise; end if; end;
 if has_function_privilege('anon','public.employee_attendance_requests(text,uuid,date,text,timestamptz,timestamptz,text)','execute') then raise exception 'public RPC'; end if;
end $$;
rollback;
