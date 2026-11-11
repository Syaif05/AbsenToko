begin;
do $$
declare
  owner_uid uuid;
  employee_uid uuid := gen_random_uuid();
  first_hash text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  second_hash text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  session_hash text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
begin
  select user_id into owner_uid from public.owner_profiles limit 1;
  if owner_uid is null then raise exception 'Provisioning Owner diperlukan.'; end if;
  if has_function_privilege('anon', 'public.owner_manage_employee(uuid,uuid,text,text,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.owner_manage_employee(uuid,uuid,text,text,text,text)', 'execute')
    or not has_function_privilege('service_role', 'public.owner_manage_employee(uuid,uuid,text,text,text,text)', 'execute') then
    raise exception 'Grant RPC tidak sesuai.';
  end if;

  begin
    perform public.owner_manage_employee(gen_random_uuid(), employee_uid, 'create', 'Fixture Owner', first_hash);
    raise exception 'Non-Owner diterima.';
  exception when raise_exception then
    if sqlerrm <> 'owner required' then raise; end if;
  end;

  perform public.owner_manage_employee(owner_uid, employee_uid, 'create', 'Fixture Owner', first_hash);
  perform public.attendance_issue_session(employee_uid, session_hash, first_hash);
  perform public.owner_manage_employee(owner_uid, employee_uid, 'rename', 'Fixture Owner Baru');
  perform public.owner_manage_employee(owner_uid, employee_uid, 'deactivate');
  perform public.owner_manage_employee(owner_uid, employee_uid, 'activate');
  if exists(select 1 from attendance_private.sessions where token_hash = session_hash and expires_at > clock_timestamp()) then
    raise exception 'Sesi lama masih aktif setelah reaktivasi.';
  end if;
  perform public.owner_manage_employee(owner_uid, employee_uid, 'reset_pin', null, second_hash, first_hash);
  begin
    perform public.owner_manage_employee(owner_uid, employee_uid, 'reset_pin', null, first_hash, first_hash);
    raise exception 'Reset usang menimpa PIN baru.';
  exception when raise_exception then
    if sqlerrm <> 'employee unavailable or changed' then raise; end if;
  end;
  if (select count(*) from attendance_private.owner_employee_audit where employee_id = employee_uid) <> 5
    or not exists(select 1 from public.employees where id = employee_uid and name = 'Fixture Owner Baru'
      and is_active and pin_hash = second_hash) then
    raise exception 'Hasil perubahan atau audit tidak sesuai.';
  end if;
end $$;
rollback;
select 'LULUS — izin Owner, audit, dan reset PIN' as hasil;
