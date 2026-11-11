begin;
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80)
);
create unique index stores_name_unique on public.stores(lower(name));
alter table public.stores enable row level security;
revoke all on public.stores from public,anon,authenticated,service_role;
grant select on public.stores to authenticated,service_role;
create policy owner_reads_stores on public.stores for select to authenticated
using (exists(select 1 from public.owner_profiles where user_id = (select auth.uid()) and role = 'owner'));

alter table public.employees add column store_id uuid references public.stores(id);
alter table public.attendance add column store_id uuid references public.stores(id);
grant select (store_id) on public.employees, public.attendance to authenticated;
create index employees_store_id_idx on public.employees(store_id);
create index attendance_store_date_idx on public.attendance(store_id, work_date);

-- Preserve access for existing employees. Historical store was not recorded.
with initial_store as (insert into public.stores(name) values ('Toko Utama') returning id)
update public.employees set store_id = (select id from initial_store);

create function attendance_private.snapshot_attendance_store()
returns trigger language plpgsql set search_path = '' as $$
begin
  select store_id into new.store_id from public.employees where id=new.employee_id;
  return new;
end $$;
create trigger snapshot_attendance_store before insert on public.attendance
for each row execute function attendance_private.snapshot_attendance_store();

create function public.attendance_issue_store_session(p_employee uuid,p_hash text,p_pin_hash text,p_store uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.employees where id=p_employee and store_id=p_store for update;
  if not found then raise exception 'invalid employee'; end if;
  return public.attendance_issue_session(p_employee,p_hash,p_pin_hash);
end $$;

create function public.owner_manage_store_assignment(
  p_owner uuid,p_id uuid,p_operation text,p_name text,p_store uuid,
  p_pin_hash text,p_previous_hash text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
  if not found then raise exception 'owner required'; end if;
  if p_operation='create_store' then
    insert into public.stores(id,name) values(p_id,btrim(p_name));
  elsif p_operation='rename_store' then
    update public.stores set name=btrim(p_name) where id=p_id;
    if not found then raise exception 'store unavailable'; end if;
  else
    perform public.owner_manage_employee(p_owner,p_id,p_operation,p_name,p_pin_hash,p_previous_hash);
    if p_operation in ('create','rename') then
      update public.employees set store_id=p_store where id=p_id and store_id is distinct from p_store;
      if found then
        update attendance_private.sessions set consumed_at=clock_timestamp()
        where employee_id=p_id and consumed_at is null;
      end if;
    end if;
  end if;
end $$;
revoke all on function public.attendance_issue_store_session(uuid,text,text,uuid),
  public.owner_manage_store_assignment(uuid,uuid,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.attendance_issue_store_session(uuid,text,text,uuid),
  public.owner_manage_store_assignment(uuid,uuid,text,text,uuid,text,text) to service_role;
commit;
