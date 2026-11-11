begin;
do $$
<<owner_current_pin>>
declare
  owner_id uuid;
  employee_id uuid := gen_random_uuid();
  initial_hash text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  next_hash text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  envelope text := 'v1.' || repeat('A', 46) || '==';
begin
  select user_id into owner_id from public.owner_profiles where role = 'owner' limit 1;
  if owner_id is null then raise exception 'Provisioning Owner diperlukan.'; end if;

  perform public.owner_manage_store_assignment(owner_id, employee_id, 'create', 'Fixture PIN aktif', null, initial_hash, null);
  if public.owner_read_employee_pin(owner_id, employee_id) is not null then
    raise exception 'PIN historis harus tidak tersedia';
  end if;
  perform public.owner_set_recoverable_employee_pin(owner_id, employee_id, 'reset_pin', null, null, next_hash, initial_hash, envelope);
  if public.owner_read_employee_pin(owner_id, employee_id) is distinct from envelope then
    raise exception 'PIN aktif tidak tersedia';
  end if;
  if not exists(select 1 from attendance_private.owner_employee_audit a
    where a.employee_id = owner_current_pin.employee_id and a.operation = 'view_pin') then
    raise exception 'Akses PIN tidak diaudit';
  end if;

  begin
    perform public.owner_read_employee_pin(gen_random_uuid(), employee_id);
    raise exception 'Non-Owner mendapat akses';
  exception when raise_exception then
    if sqlerrm <> 'owner required' then raise; end if;
  end;
  perform public.owner_manage_employee(owner_id, employee_id, 'reset_pin', null, initial_hash, next_hash);
  if public.owner_read_employee_pin(owner_id, employee_id) is not null then
    raise exception 'Salinan PIN lama masih tersedia setelah PIN diubah';
  end if;
  if has_function_privilege('authenticated', 'public.owner_read_employee_pin(uuid,uuid)', 'EXECUTE')
    or has_table_privilege('service_role', 'attendance_private.employee_pin_envelopes', 'SELECT') then
    raise exception 'Akses salinan PIN terlalu luas';
  end if;
end $$;
rollback;
select 'LULUS — penyimpanan PIN aktif dan audit' as hasil;
