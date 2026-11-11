begin;

create or replace function public.attendance_status(p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee uuid; entry public.attendance; seconds integer;
begin
  select s.employee_id into employee from attendance_private.sessions s join public.employees e on e.id=s.employee_id
    where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null and e.is_active;
  if employee is null then raise exception 'invalid session'; end if;
  select work_window_seconds into seconds from attendance_private.settings;
  select * into entry from public.attendance where employee_id=employee and check_out_at is null;
  if found then
    return jsonb_build_object('status',case when entry.check_in_at+make_interval(secs=>seconds)<=clock_timestamp() then 'EXPIRED' else 'CHECKED_IN' end,'attendance',to_jsonb(entry));
  end if;
  select * into entry from public.attendance where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Jakarta')::date;
  return jsonb_build_object('status',case when found then 'COMPLETED' else 'NOT_CHECKED_IN' end,'attendance',to_jsonb(entry));
end $$;

create or replace function public.attendance_get_intent(p_hash text,p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent attendance_private.upload_intents;
begin
  perform 1 from attendance_private.sessions s join public.employees e on e.id=s.employee_id
  where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null and e.is_active;
  if not found then raise exception 'invalid session'; end if;
  select * into intent from attendance_private.upload_intents where id=p_id and session_hash=p_hash;
  if not found or (intent.result is null and intent.expires_at<=clock_timestamp()) then raise exception 'invalid intent'; end if;
  return to_jsonb(intent)-'session_hash';
end $$;


-- Invalidate existing PIN sessions before dropping their credential columns.
update attendance_private.sessions set consumed_at=clock_timestamp() where consumed_at is null;
drop trigger if exists clear_previous_pin_envelope on public.employees;
drop function if exists attendance_private.clear_previous_pin_envelope();
drop function if exists public.owner_set_recoverable_employee_pin(uuid,uuid,text,text,uuid,text,text,text);
drop function if exists public.owner_read_employee_pin(uuid,uuid);
drop table if exists attendance_private.employee_pin_envelopes;
drop function public.attendance_issue_store_session(uuid,text,text,uuid);
drop function public.attendance_issue_session(uuid,text,text);
drop function public.owner_manage_store_assignment(uuid,uuid,text,text,uuid,text,text);
drop function public.owner_manage_employee(uuid,uuid,text,text,text,text);
alter table attendance_private.sessions drop column verified_pin_hash;
alter table public.employees drop column pin_hash;

create table attendance_private.employee_invitations (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
alter table attendance_private.employee_invitations enable row level security;
revoke all on attendance_private.employee_invitations from public,anon,authenticated,service_role;

create function public.employee_activate(p_invitation text,p_session text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.employees; target uuid; expiry timestamptz;
begin
  select employee_id into target from attendance_private.employee_invitations where token_hash=p_invitation;
  if target is null then raise exception 'invalid invitation'; end if;
  select * into person from public.employees where id=target and is_active and store_id is not null for update;
  if not found then raise exception 'invalid invitation'; end if;
  delete from attendance_private.employee_invitations
    where employee_id=target and token_hash=p_invitation and expires_at>clock_timestamp();
  if not found then raise exception 'invalid invitation'; end if;
  expiry:=clock_timestamp()+interval '14 days';
  insert into attendance_private.sessions(token_hash,employee_id,expires_at) values(p_session,target,expiry);
  return public.attendance_status(p_session) || jsonb_build_object(
    'employee',jsonb_build_object('id',person.id,'name',person.name,'active',true,'storeId',person.store_id),
    'expires_at',expiry);
end $$;

alter table attendance_private.owner_employee_audit drop constraint owner_employee_audit_operation_check;
alter table attendance_private.owner_employee_audit add constraint owner_employee_audit_operation_check
  check (operation in ('create','rename','activate','deactivate','reset_pin','view_pin','invite'));

create function public.owner_manage_staff(p_owner uuid,p_id uuid,p_operation text,p_name text,p_store uuid,p_invite text)
returns void language plpgsql security definer set search_path='' as $$
declare person public.employees; revoke_access boolean:=false;
begin
  perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
  if not found then raise exception 'owner required'; end if;
  if p_operation='create_store' then
    insert into public.stores(id,name) values(p_id,btrim(p_name)); return;
  elsif p_operation='rename_store' then
    update public.stores set name=btrim(p_name) where id=p_id;
    if not found then raise exception 'store unavailable'; end if;
    return;
  elsif p_operation='create' then
    insert into public.employees(id,name,store_id) values(p_id,p_name,p_store);
  else
    select * into person from public.employees where id=p_id for update;
    if not found then raise exception 'employee unavailable'; end if;
    if p_operation='rename' then
      update public.employees set name=p_name,store_id=p_store where id=p_id;
      revoke_access:=person.store_id is distinct from p_store;
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
revoke all on function public.employee_activate(text,text),public.owner_manage_staff(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.employee_activate(text,text),public.owner_manage_staff(uuid,uuid,text,text,uuid,text) to service_role;

create table public.app_brand (
  singleton boolean primary key default true check(singleton),
  name text not null check (length(btrim(name)) between 1 and 60 and name !~ '[[:cntrl:]]')
);
insert into public.app_brand(name) values ('Teh Idaman');
alter table public.app_brand enable row level security;
revoke all on public.app_brand from public,anon,authenticated;
grant select on public.app_brand to anon,authenticated;
grant update(name) on public.app_brand to authenticated;
create policy read_brand on public.app_brand for select using (true);
create policy owner_edit_brand on public.app_brand for update to authenticated
  using (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'))
  with check (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'));

create table public.shift_schedule (
  store_id uuid not null references public.stores(id),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  code text not null check(code in ('P','M','S','O')),
  primary key(store_id,work_date,employee_id)
);
alter table public.shift_schedule enable row level security;
revoke all on public.shift_schedule from public,anon,authenticated;
grant select on public.shift_schedule to authenticated;
create policy owner_read_schedule on public.shift_schedule for select to authenticated
using (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'));

-- Validate the whole import before committing any cells. Empty cells are omitted.
create function public.owner_import_shifts(p_store uuid,p_month date,p_cells jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare saved integer; expected integer;
begin
  if not exists(select 1 from public.owner_profiles where user_id=auth.uid() and role='owner') then
    raise exception 'owner required';
  end if;
  if p_store is null or p_month is null or extract(day from p_month)<>1 or jsonb_typeof(p_cells) is distinct from 'array' then
    raise exception 'invalid schedule';
  end if;
  expected:=jsonb_array_length(p_cells);
  if expected not between 1 and 15500 then raise exception 'invalid size'; end if;
  perform 1 from public.employees
    where id in (select employee_id from jsonb_to_recordset(p_cells) as c(employee_id uuid))
    order by id for share;
  insert into public.shift_schedule(store_id,employee_id,work_date,code)
  select p_store,c.employee_id,c.work_date,c.code
  from jsonb_to_recordset(p_cells) as c(employee_id uuid,work_date date,code text)
  join public.employees e on e.id=c.employee_id and e.is_active and e.store_id=p_store
  where c.work_date>=p_month and c.work_date<p_month+interval '1 month'
  on conflict(store_id,work_date,employee_id) do update set code=excluded.code;
  get diagnostics saved=row_count;
  if saved<>expected then raise exception 'employee or date outside schedule'; end if;
  return saved;
end $$;
revoke all on function public.owner_import_shifts(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.owner_import_shifts(uuid,date,jsonb) to authenticated;
commit;
