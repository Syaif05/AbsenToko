begin;
do $$
declare
  manager uuid;
  staff uuid := gen_random_uuid();
  store uuid := gen_random_uuid();
  invitation text := repeat('a',64);
  session text := repeat('b',64);
  payload jsonb;
begin
  select user_id into manager from public.owner_profiles where role='owner' limit 1;
  if manager is null then raise exception 'Owner harus diprovisikan'; end if;
  perform public.owner_manage_staff(manager,store,'create_store','Fixture ' || store,null,null);
  perform public.owner_manage_staff(manager,staff,'create','Fixture Karyawan',store,null);
  perform public.owner_manage_staff(manager,staff,'invite',null,null,invitation);
  payload:=public.employee_activate(invitation,session);
  if payload->'employee'->>'id' is distinct from staff::text then raise exception 'salah identitas'; end if;
  begin
    perform public.employee_activate(invitation,repeat('c',64));
    raise exception 'tautan digunakan ulang';
  exception when raise_exception then
    if sqlerrm <> 'invalid invitation' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', manager::text, true);
  if public.owner_import_shifts(store,'2026-11-01',jsonb_build_array(jsonb_build_object(
    'employee_id',staff,'work_date','2026-11-12','code','P'))) <> 1 then raise exception 'impor gagal'; end if;
  begin
    perform public.owner_import_shifts(store,'2026-11-01',jsonb_build_array(
      jsonb_build_object('employee_id',staff,'work_date','2026-11-12','code','O'),
      jsonb_build_object('employee_id',staff,'work_date','2026-12-01','code','S')
    ));
    raise exception 'impor lintas bulan diterima';
  exception when raise_exception then
    if sqlerrm <> 'employee or date outside schedule' then raise; end if;
  end;
  if (select code from public.shift_schedule where employee_id=staff) <> 'P' then raise exception 'impor parsial'; end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.owner_import_shifts(store,'2026-11-01','[]');
    raise exception 'non-Owner dapat mengimpor';
  exception when raise_exception then
    if sqlerrm <> 'owner required' then raise; end if;
  end;
  perform public.owner_manage_staff(manager,staff,'deactivate',null,null,null);
  begin
    perform public.attendance_status(session);
    raise exception 'sesi belum dicabut';
  exception when raise_exception then
    if sqlerrm <> 'invalid session' then raise; end if;
  end;
  if has_table_privilege('anon','public.shift_schedule','SELECT')
    or has_function_privilege('authenticated','public.employee_activate(text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.owner_manage_staff(uuid,uuid,text,text,uuid,text)','EXECUTE') then
    raise exception 'izin akses terlalu luas';
  end if;
end $$;
rollback;
select 'LULUS — aktivasi satu kali, pencabutan sesi, dan impor jadwal atomik' as hasil;
