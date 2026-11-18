begin;
do $$
declare shop uuid:=gen_random_uuid(); person uuid:=gen_random_uuid(); old uuid:=gen_random_uuid(); token text:=repeat('a',64); attempt uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); manager uuid; reply jsonb; actual timestamptz:=clock_timestamp()-interval '40 hours';
begin
 select user_id into manager from public.owner_profiles limit 1;
 insert into public.stores(id,name) values(shop,'Resolution fixture');
 insert into public.employees(id,name,store_id) values(person,'Resolution fixture',shop);
 insert into public.attendance(id,employee_id,check_in_at) values(old,person,clock_timestamp()-interval '48 hours');
 perform public.attendance_select_employee(shop,person,token);
 if public.attendance_status(token)->>'status'<>'NOT_CHECKED_IN' then raise exception 'expired session blocks new day'; end if;
 perform public.attendance_prepare(token,attempt,'IN');
 reply:=public.attendance_commit(token,attempt,-6,106,20);
 if not exists(select 1 from public.attendance where id=old and closed_at is not null and check_out_at is null) then raise exception 'old session not closed honestly'; end if;
 if public.attendance_status(token)->>'status'<>'CHECKED_IN' then raise exception 'new session unavailable'; end if;
 if public.attendance_commit(token,attempt,-6,106,20)<>reply then raise exception 'retry duplicated'; end if;
 begin
 perform public.owner_confirm_checkout(gen_random_uuid(),request,old,actual,'Lupa pulang');
 raise exception 'nonowner allowed';
 exception when raise_exception then if sqlerrm<>'owner required' then raise; end if; end;
 begin
 perform public.owner_confirm_checkout(manager,request,old,clock_timestamp()+interval '1 hour','Lupa pulang');
 raise exception 'future allowed';
 exception when raise_exception then if sqlerrm<>'invalid checkout' then raise; end if; end;
 begin
 perform public.owner_confirm_checkout(manager,gen_random_uuid(),old,clock_timestamp()-interval '60 hours','Lupa pulang');
 raise exception 'checkout before entry allowed';
 exception when raise_exception then if sqlerrm<>'invalid checkout' then raise; end if; end;
 insert into public.attendance(employee_id,check_in_at,check_out_at) values(person,clock_timestamp()-interval '24 hours',clock_timestamp()-interval '23 hours');
 begin
 perform public.owner_confirm_checkout(manager,gen_random_uuid(),old,clock_timestamp()-interval '20 hours','Lupa pulang');
 raise exception 'overlap allowed';
 exception when raise_exception then if sqlerrm<>'overlapping checkout' then raise; end if; end;
 perform public.owner_confirm_checkout(manager,request,old,actual,'Lupa pulang');
 perform public.owner_confirm_checkout(manager,request,old,actual,'Lupa pulang');
 if (select count(*) from attendance_private.attendance_corrections where request_id=request)<>1 then raise exception 'audit replay'; end if;
 if exists(select 1 from public.attendance_evidence where attendance_id=old and type='OUT') then raise exception 'fabricated evidence'; end if;
 if not exists(select 1 from public.attendance where id=old and check_out_at=actual and owner_confirmed_by=manager) then raise exception 'missing confirmation'; end if;
 begin
 perform public.owner_confirm_checkout(manager,gen_random_uuid(),old,actual,'Changed reason');
 raise exception 'completed overwritten';
 exception when raise_exception then if sqlerrm<>'already completed' then raise; end if; end;
 -- A normal open session still requires checkout (including across midnight within the configured window).
 if public.attendance_status(token)->>'status'<>'CHECKED_IN' then raise exception 'active session lost'; end if;
 begin
 perform public.attendance_prepare(token,gen_random_uuid(),'IN');
 raise exception 'second active check-in allowed';
 exception when raise_exception then if sqlerrm<>'invalid state' then raise; end if; end;
 if has_function_privilege('anon','public.owner_confirm_checkout(uuid,uuid,uuid,timestamptz,text)','execute') or has_function_privilege('authenticated','public.owner_confirm_checkout(uuid,uuid,uuid,timestamptz,text)','execute') then raise exception 'public correction'; end if;
end $$;
rollback;
