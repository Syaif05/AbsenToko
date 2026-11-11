begin;
-- Keep attendance and its evidence when the store record is removed.
alter table public.attendance
  drop constraint attendance_store_id_fkey,
  add constraint attendance_store_id_fkey foreign key (store_id)
    references public.stores(id) on delete set null;

create or replace function public.owner_apply_change(
  p_owner uuid, p_request uuid, p_id uuid, p_operation text, p_name text, p_store uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt attendance_private.owner_change_requests;
  fingerprint text;
begin
  perform 1 from public.owner_profiles where user_id = p_owner and role = 'owner' for share;
  if not found then raise exception 'owner required'; end if;
  if p_request is null or p_id is null or p_operation is null or p_operation not in (
    'create', 'rename', 'activate', 'deactivate', 'archive_employee',
    'create_store', 'rename_store', 'archive_store', 'delete_store'
  ) then raise exception 'invalid operation'; end if;
  if p_operation in ('create','rename','create_store','rename_store') and
    (p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]')
    then raise exception 'invalid name'; end if;
  fingerprint := md5(jsonb_build_array(p_id,p_operation,p_name,p_store)::text);
  insert into attendance_private.owner_change_requests(owner_id,request_id,target_id,operation,payload_hash)
    values(p_owner,p_request,p_id,p_operation,fingerprint) on conflict do nothing;
  select * into receipt from attendance_private.owner_change_requests
    where owner_id=p_owner and request_id=p_request for update;
  if receipt.payload_hash <> fingerprint then raise exception 'request conflict'; end if;
  if receipt.completed_at is not null then return jsonb_build_object('ok',true,'replayed',true); end if;
  if p_operation = 'delete_store' then
    perform 1 from public.stores where id = p_id for update;
    if not found then raise exception 'store unavailable'; end if;
    if exists (select 1 from public.employees where store_id = p_id and archived_at is null) then
      raise exception 'store has employees';
    end if;
    update public.employees set store_id = null where store_id = p_id;
    delete from public.shift_schedule where store_id = p_id;
    delete from public.stores where id = p_id;
  else
    perform public.owner_manage_staff(p_owner,p_id,p_operation,p_name,p_store,null);
  end if;
  update attendance_private.owner_change_requests set completed_at=clock_timestamp()
    where owner_id=p_owner and request_id=p_request;
  return jsonb_build_object('ok',true,'replayed',false);
end $$;

create function public.owner_set_shift(p_store uuid, p_employee uuid, p_date date, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.owner_profiles where user_id = auth.uid() and role = 'owner' for share;
  if not found then raise exception 'owner required'; end if;
  if p_date is null or p_date not between date '2000-01-01' and date '2099-12-31'
    or (p_code is not null and p_code not in ('P','M','S','O')) then
    raise exception 'invalid schedule';
  end if;
  perform 1 from public.stores where id = p_store and archived_at is null for share;
  if not found then raise exception 'store unavailable'; end if;
  perform 1 from public.employees
    where id = p_employee and store_id = p_store and is_active and archived_at is null for share;
  if not found then raise exception 'employee unavailable'; end if;
  if p_code is null then
    delete from public.shift_schedule
      where store_id = p_store and employee_id = p_employee and work_date = p_date;
  else
    insert into public.shift_schedule(store_id, employee_id, work_date, code)
      values(p_store, p_employee, p_date, p_code)
      on conflict (store_id, work_date, employee_id) do update set code = excluded.code;
  end if;
end $$;
revoke all on function public.owner_set_shift(uuid,uuid,date,text) from public, anon, authenticated;
grant execute on function public.owner_set_shift(uuid,uuid,date,text) to authenticated;

create or replace function public.owner_import_shifts(p_store uuid,p_month date,p_cells jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare saved integer; expected integer;
begin
  perform 1 from public.owner_profiles where user_id=auth.uid() and role='owner' for share;
  if not found then
    raise exception 'owner required';
  end if;
  if p_store is null or p_month is null or extract(day from p_month)<>1 or jsonb_typeof(p_cells) is distinct from 'array' then
    raise exception 'invalid schedule';
  end if;
  expected:=jsonb_array_length(p_cells);
  if expected not between 1 and 15500 then raise exception 'invalid size'; end if;
  perform 1 from public.stores where id=p_store and archived_at is null for share;
  if not found then raise exception 'store unavailable'; end if;
  perform 1 from public.employees
    where id in (select employee_id from jsonb_to_recordset(p_cells) as c(employee_id uuid))
    order by id for share;
  insert into public.shift_schedule(store_id,employee_id,work_date,code)
  select p_store,c.employee_id,c.work_date,c.code
  from jsonb_to_recordset(p_cells) as c(employee_id uuid,work_date date,code text)
  join public.employees e on e.id=c.employee_id and e.is_active and e.archived_at is null and e.store_id=p_store
  where c.work_date>=p_month and c.work_date<p_month+interval '1 month'
  on conflict(store_id,work_date,employee_id) do update set code=excluded.code;
  get diagnostics saved=row_count;
  if saved<>expected then raise exception 'employee or date outside schedule'; end if;
  return saved;
end $$;
commit;
