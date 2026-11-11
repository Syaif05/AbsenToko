begin;
do $$
declare
  manager uuid;
  staff uuid := gen_random_uuid();
  shop uuid := gen_random_uuid();
  other_shop uuid := gen_random_uuid();
  token text := repeat('d',64);
  payload jsonb;
begin
  select user_id into manager from public.owner_profiles where role='owner' limit 1;
  if manager is null then raise exception 'Owner harus diprovisikan'; end if;
  perform public.owner_manage_staff(manager,shop,'create_store','Fixture ' || shop,null,null);
  perform public.owner_manage_staff(manager,other_shop,'create_store','Fixture ' || other_shop,null,null);
  perform public.owner_manage_staff(manager,staff,'create','Fixture Karyawan',shop,null);
  begin
    perform public.attendance_select_employee(other_shop,staff,token);
    raise exception 'toko yang salah diterima';
  exception when raise_exception then
    if sqlerrm <> 'employee unavailable' then raise; end if;
  end;
  payload:=public.attendance_select_employee(shop,staff,token);
  if payload->'employee'->>'id' is distinct from staff::text then raise exception 'salah identitas'; end if;
  insert into public.attendance(employee_id,check_in_at,check_out_at) values(staff,now(),now());
  begin
    perform public.owner_manage_staff(manager,shop,'archive_store',null,null,null);
    raise exception 'toko berisi karyawan terhapus';
  exception when raise_exception then
    if sqlerrm <> 'store has employees' then raise; end if;
  end;
  perform public.owner_manage_staff(manager,staff,'archive_employee',null,null,null);
  perform public.owner_manage_staff(manager,shop,'archive_store',null,null,null);
  if not exists(select 1 from public.attendance where employee_id=staff and store_id=shop) then
    raise exception 'riwayat hilang';
  end if;
  begin
    perform public.attendance_status(token);
    raise exception 'sesi belum dicabut';
  exception when raise_exception then
    if sqlerrm <> 'invalid session' then raise; end if;
  end;
  begin
    perform public.owner_manage_staff(manager,gen_random_uuid(),'create','Fixture Baru',shop,null);
    raise exception 'penempatan ke toko arsip diterima';
  exception when raise_exception then
    if sqlerrm <> 'store unavailable' then raise; end if;
  end;
  if has_function_privilege('anon','public.attendance_select_employee(uuid,uuid,text)','EXECUTE') then
    raise exception 'RPC langsung tersedia untuk anon';
  end if;
end $$;
rollback;
select 'LULUS — absensi per toko, arsip, dan riwayat' as hasil;
