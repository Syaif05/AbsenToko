begin;
do $$
declare
  manager uuid;
  person uuid := gen_random_uuid();
  shop uuid := gen_random_uuid();
  work_id uuid;
  request_id uuid := gen_random_uuid();
  path text := gen_random_uuid()::text || '.jpg';
  result jsonb;
begin
  select user_id into manager from public.owner_profiles where role='owner' limit 1;
  perform public.owner_manage_staff(manager,shop,'create_store','Reset fixture',null,null);
  perform public.owner_manage_staff(manager,person,'create','Reset fixture',shop,null);
  insert into public.shift_schedule(store_id,employee_id,work_date,code)
    values(shop,person,'2026-11-12','P');
  insert into public.attendance(employee_id,check_in_at) values(person,now()) returning id into work_id;
  insert into public.attendance_evidence(attendance_id,type,photo_path,latitude,longitude,accuracy_m,recorded_at)
    values(work_id,'IN',path,0,0,1,now());
  begin
    perform public.owner_reset_attendance(gen_random_uuid(), request_id);
    raise exception 'non-owner reset allowed';
  exception when raise_exception then
    if sqlerrm <> 'owner required' then raise; end if;
  end;
  result := public.owner_reset_attendance(manager, request_id);
  if (result->>'deleted')::integer < 1
    or not (result->'paths' @> jsonb_build_array(path))
    or exists(select 1 from public.attendance)
    or exists(select 1 from public.attendance_evidence)
    or not exists(select 1 from public.shift_schedule where employee_id=person)
    or not exists(select 1 from public.employees where id=person)
    or not exists(select 1 from public.stores where id=shop) then
    raise exception 'incorrect reset scope';
  end if;
  insert into public.attendance(employee_id,check_in_at) values(person,now()) returning id into work_id;
  if public.owner_reset_attendance(manager, request_id) is distinct from result
    or not exists(select 1 from public.attendance where id=work_id) then
    raise exception 'retry deleted new attendance';
  end if;
  perform public.owner_finish_attendance_reset_photos(array[path]);
  if exists(select 1 from attendance_private.attendance_reset_photos where photo_path=path)
    or has_function_privilege('authenticated','public.owner_reset_attendance(uuid,uuid)','EXECUTE') then
    raise exception 'invalid cleanup or permissions';
  end if;
end $$;
rollback;
select 'LULUS — reset, pembersihan foto, batas akses, dan retry' as hasil;
