begin;
do $$
declare
  employee uuid := gen_random_uuid();
  in_id uuid := gen_random_uuid();
  out_id uuid := gen_random_uuid();
  token text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  pin_hash text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  receipt jsonb;
begin
  insert into public.employees(id,name,pin_hash) values(employee,'Fixture Sesi Akun',pin_hash);
  perform public.attendance_issue_session(employee,token,pin_hash);
  perform public.attendance_prepare(token,in_id,'IN');
  receipt := public.attendance_commit(token,in_id,-6,106,20);
  if public.attendance_status(token)->>'status' <> 'CHECKED_IN'
    or public.attendance_get_intent(token,in_id)->'result' is distinct from receipt then
    raise exception 'Sesi atau tanda terima hilang setelah absen masuk';
  end if;
  perform public.attendance_prepare(token,out_id,'OUT');
  perform public.attendance_commit(token,out_id,-6,106,20);
  if public.attendance_status(token)->>'status' <> 'COMPLETED' then
    raise exception 'Sesi yang sama gagal menyelesaikan absen pulang';
  end if;
  perform public.attendance_end_session(token);
  begin
    perform public.attendance_status(token);
    raise exception 'Sesi masih aktif setelah keluar';
  exception when raise_exception then
    if sqlerrm <> 'invalid session' then raise; end if;
  end;
  begin
    perform public.attendance_get_intent(token,in_id);
    raise exception 'Tanda terima masih tersedia setelah keluar';
  exception when raise_exception then
    if sqlerrm <> 'invalid session' then raise; end if;
  end;
  if has_function_privilege('anon','public.attendance_end_session(text)','EXECUTE')
    or has_function_privilege('authenticated','public.attendance_end_session(text)','EXECUTE')
    or not has_function_privilege('service_role','public.attendance_end_session(text)','EXECUTE') then
    raise exception 'Izin RPC keluar akun tidak tepat';
  end if;
end $$;
rollback;
select 'LULUS — sesi akun karyawan' as hasil;
