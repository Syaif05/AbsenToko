begin;
do $$
declare
  employee uuid := gen_random_uuid();
  finished text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  failed text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  test_hash text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
begin
  insert into public.employees(id,name,pin_hash) values(employee,'Fixture Retensi',test_hash);
  insert into attendance_private.sessions(token_hash,employee_id,expires_at,verified_pin_hash)
  values (finished,employee,now()-interval '2 days',test_hash),
         (failed,employee,now()-interval '2 days',test_hash);
  insert into attendance_private.upload_intents(session_hash,action,expires_at,result)
  values (finished,'IN',now()-interval '2 days','{}'),
         (failed,'IN',now()-interval '2 days',null);
  if has_function_privilege('anon','public.attendance_prune_technical_data()','execute')
    or has_function_privilege('authenticated','public.attendance_prune_technical_data()','execute') then
    raise exception 'RPC cleanup terekspos.';
  end if;

  perform public.attendance_prune_technical_data();
  if exists (select 1 from attendance_private.sessions where token_hash=finished)
    or not exists (select 1 from attendance_private.upload_intents where session_hash=failed and result is null) then
    raise exception 'Retensi intent tidak sesuai.';
  end if;
end
$$;
rollback;
select 'LULUS — retensi teknis dan izin cleanup' as hasil;
