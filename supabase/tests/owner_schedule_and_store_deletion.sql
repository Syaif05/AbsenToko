begin;
do $$
declare
  manager uuid;
  shop uuid := gen_random_uuid();
  person uuid := gen_random_uuid();
  request_key uuid := gen_random_uuid();
  record_id uuid;
  evidence_id uuid;
begin
  select user_id into manager from public.owner_profiles where role='owner' limit 1;
  perform public.owner_manage_staff(manager,shop,'create_store','Schedule fixture',null,null);
  perform public.owner_manage_staff(manager,person,'create','Fixture Employee',shop,null);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.owner_set_shift(shop,person,'2026-11-12','P');
    raise exception 'non-owner edited schedule';
  exception when raise_exception then
    if sqlerrm <> 'owner required' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',manager::text,true);
  perform public.owner_set_shift(shop,person,'2026-11-12','P');
  perform public.owner_set_shift(shop,person,'2026-11-12','O');
  if (select code from public.shift_schedule where employee_id=person) is distinct from 'O' then
    raise exception 'shift not updated';
  end if;
  perform public.owner_set_shift(shop,person,'2026-11-12',null);
  if exists(select 1 from public.shift_schedule where employee_id=person) then raise exception 'shift not cleared'; end if;
  perform public.owner_set_shift(shop,person,'2026-11-12','M');

  begin
    perform public.owner_apply_change(manager,request_key,shop,'delete_store',null,null);
    raise exception 'store with assigned employee deleted';
  exception when raise_exception then
    if sqlerrm <> 'store has employees' then raise; end if;
  end;
  insert into public.attendance(employee_id,check_in_at,check_out_at)
    values(person,now(),now()) returning id into record_id;
  insert into public.attendance_evidence(attendance_id,type,photo_path,latitude,longitude,accuracy_m,recorded_at)
    values(record_id,'IN',gen_random_uuid()::text||'.jpg',0,0,1,now()) returning id into evidence_id;
  perform public.owner_manage_staff(manager,person,'archive_employee',null,null,null);
  perform public.owner_apply_change(manager,request_key,shop,'delete_store',null,null);
  if (public.owner_apply_change(manager,request_key,shop,'delete_store',null,null)->>'replayed') is distinct from 'true' then
    raise exception 'delete receipt not replayed';
  end if;
  if exists(select 1 from public.stores where id=shop)
    or exists(select 1 from public.shift_schedule where store_id=shop)
    or not exists(select 1 from public.attendance where id=record_id and store_id is null)
    or not exists(select 1 from public.attendance_evidence where id=evidence_id) then
    raise exception 'store deletion lost attendance or retained store data';
  end if;
end $$;
rollback;
select 'LULUS — edit jadwal, otorisasi, dan hapus toko dengan riwayat absensi' as hasil;
