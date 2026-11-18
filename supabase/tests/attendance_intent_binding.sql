begin;
do $$
declare shop uuid:=gen_random_uuid(); person uuid:=gen_random_uuid(); old uuid:=gen_random_uuid(); token text:=repeat('b',64); stale uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); entry uuid:=gen_random_uuid(); manager uuid; receipt jsonb; yesterday timestamptz;
begin
 select user_id into manager from public.owner_profiles limit 1;
 update attendance_private.settings set work_window_seconds=172800;
 yesterday:=(((clock_timestamp() at time zone 'Asia/Jakarta')::date-1)+time '12:00') at time zone 'Asia/Jakarta';
 insert into public.stores(id,name) values(shop,'Intent fixture');
 insert into public.employees(id,name,store_id) values(person,'Intent fixture',shop);
 insert into public.attendance(id,employee_id,check_in_at) values(old,person,yesterday);
 perform public.attendance_select_employee(shop,person,token);
 perform public.attendance_prepare(token,stale,'OUT');
 if (select target_attendance_id from attendance_private.upload_intents where id=stale)<>old then raise exception 'missing binding'; end if;
 perform public.owner_confirm_checkout(manager,gen_random_uuid(),old,yesterday+interval '1 hour','Lupa absen pulang');
 perform public.attendance_prepare(token,entry,'IN');
 receipt:=public.attendance_commit(token,entry,-6,106,20);
 begin
  perform public.attendance_commit(token,stale,-6,106,20);
  raise exception 'stale OUT closed new session';
 exception when raise_exception then if sqlerrm<>'invalid state' then raise; end if; end;
 if public.attendance_status(token)->>'status'<>'CHECKED_IN' then raise exception 'new session was closed'; end if;
 perform public.attendance_prepare(token,fresh,'OUT');
 receipt:=public.attendance_commit(token,fresh,-6,106,20);
 if public.attendance_commit(token,fresh,-6,106,20)<>receipt then raise exception 'replay mismatch'; end if;
 if (select count(*) from public.attendance_evidence where attendance_id=(receipt->>'attendance_id')::uuid and type='OUT')<>1 then raise exception 'duplicate evidence'; end if;
end $$;
rollback;
