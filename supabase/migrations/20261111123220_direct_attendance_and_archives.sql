begin;
alter table public.employees add column archived_at timestamptz;
alter table public.stores add column archived_at timestamptz;
grant select (archived_at) on public.employees to authenticated, service_role;
drop index public.stores_name_unique;
create unique index stores_name_unique on public.stores(lower(name)) where archived_at is null;

alter table attendance_private.owner_employee_audit drop constraint owner_employee_audit_operation_check;
alter table attendance_private.owner_employee_audit add constraint owner_employee_audit_operation_check
  check (operation in ('create','rename','activate','deactivate','reset_pin','view_pin','invite','archive_employee'));

create or replace function public.owner_manage_staff(p_owner uuid,p_id uuid,p_operation text,p_name text,p_store uuid,p_invite text)
returns void language plpgsql security definer set search_path='' as $$
declare person public.employees; revoke_access boolean:=false;
begin
  perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
  if not found then raise exception 'owner required'; end if;
  if p_operation in ('create','rename') and p_store is not null then
    perform 1 from public.stores where id=p_store and archived_at is null for share;
    if not found then raise exception 'store unavailable'; end if;
  end if;
  if p_operation='archive_store' then
    perform 1 from public.stores where id=p_id and archived_at is null for update;
    if not found then raise exception 'store unavailable'; end if;
    if exists(select 1 from public.employees where store_id=p_id and archived_at is null) then
      raise exception 'store has employees';
    end if;
    update public.stores set archived_at=clock_timestamp() where id=p_id;
    return;
  elsif p_operation='create_store' then
    insert into public.stores(id,name) values(p_id,btrim(p_name)); return;
  elsif p_operation='rename_store' then
    update public.stores set name=btrim(p_name) where id=p_id and archived_at is null;
    if not found then raise exception 'store unavailable'; end if;
    return;
  elsif p_operation='create' then
    insert into public.employees(id,name,store_id) values(p_id,p_name,p_store);
  else
    select * into person from public.employees where id=p_id and archived_at is null for update;
    if not found then raise exception 'employee unavailable'; end if;
    if p_operation='rename' then
      update public.employees set name=p_name,store_id=p_store where id=p_id;
      revoke_access:=person.store_id is distinct from p_store;
    elsif p_operation='archive_employee' then
      update public.employees set is_active=false, archived_at=clock_timestamp() where id=p_id;
      revoke_access:=true;
    elsif p_operation in ('activate','deactivate') then
      update public.employees set is_active=(p_operation='activate') where id=p_id;
      revoke_access:=p_operation='deactivate';
    elsif p_operation='invite' and person.is_active and person.store_id is not null then
      revoke_access:=true;
    else raise exception 'invalid operation'; end if;
    if revoke_access then
      delete from attendance_private.employee_invitations where employee_id=p_id;
      update attendance_private.sessions set consumed_at=clock_timestamp() where employee_id=p_id and consumed_at is null;
    end if;
    if p_operation='invite' then
      insert into attendance_private.employee_invitations values(p_id,p_invite,clock_timestamp()+interval '24 hours');
    end if;
  end if;
  insert into attendance_private.owner_employee_audit(owner_id,employee_id,operation) values(p_owner,p_id,p_operation);
end $$;

create function public.attendance_select_employee(p_store uuid,p_employee uuid,p_session text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.employees; expiry timestamptz;
begin
  select e.* into person from public.employees e join public.stores s on s.id=e.store_id
    where e.id=p_employee and e.store_id=p_store and e.is_active
      and e.archived_at is null and s.archived_at is null for update of e;
  if not found then raise exception 'employee unavailable'; end if;
  expiry:=clock_timestamp()+interval '12 hours';
  insert into attendance_private.sessions(token_hash,employee_id,expires_at) values(p_session,person.id,expiry);
  return public.attendance_status(p_session) || jsonb_build_object(
    'employee',jsonb_build_object('id',person.id,'name',person.name,'active',true,'storeId',person.store_id),
    'expires_at',expiry);
end $$;
revoke all on function public.attendance_select_employee(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.attendance_select_employee(uuid,uuid,text) to service_role;
commit;
