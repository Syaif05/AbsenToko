begin;
do $$
declare employee uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  pin_hash text:='$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  first_result jsonb; second_result jsonb;
begin
  insert into public.employees(id,name,pin_hash) values(employee,'Fixture Backend',pin_hash);
  perform public.attendance_issue_session(employee,token,pin_hash);
  perform public.attendance_prepare(token,attempt,'IN');
  begin
    perform public.attendance_commit(token,attempt,91,106,20);
    raise exception 'Koordinat invalid diterima';
  exception when check_violation then null; end;
  if exists(select 1 from public.attendance where employee_id=employee) then raise exception 'Rollback bukti tidak atomik'; end if;
  first_result:=public.attendance_commit(token,attempt,-6,106,20);
  second_result:=public.attendance_commit(token,attempt,-6,106,20);
  if first_result<>second_result then raise exception 'Retry tidak idempoten'; end if;
  if (select count(*) from public.attendance where employee_id=employee)<>1 then raise exception 'Duplikasi absensi'; end if;
  if (select count(*) from public.attendance_evidence where attendance_id=(first_result->>'attendance_id')::uuid)<>1 then raise exception 'Bukti tidak lengkap'; end if;
  if has_function_privilege('anon','public.attendance_commit(text,uuid,double precision,double precision,double precision)','EXECUTE')
    or has_function_privilege('authenticated','public.attendance_issue_session(uuid,text,text)','EXECUTE') then raise exception 'RPC terekspos'; end if;
end $$;
rollback;
select 'LULUS — transaksi dan retry backend' as hasil;
