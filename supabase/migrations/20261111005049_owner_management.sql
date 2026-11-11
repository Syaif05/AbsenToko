begin;

create table attendance_private.owner_employee_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  employee_id uuid not null,
  operation text not null check (operation in ('create', 'rename', 'activate', 'deactivate', 'reset_pin')),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table attendance_private.owner_employee_audit enable row level security;
revoke all on attendance_private.owner_employee_audit from public, anon, authenticated, service_role;

create function public.owner_manage_employee(
  p_owner uuid, p_employee uuid, p_operation text,
  p_name text default null, p_pin_hash text default null,
  p_previous_hash text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.owner_profiles where user_id = p_owner and role = 'owner' for share;
  if not found then raise exception 'owner required'; end if;

  case p_operation
    when 'create' then
      insert into public.employees (id, name, pin_hash) values (p_employee, p_name, p_pin_hash);
    when 'rename' then
      update public.employees set name = p_name where id = p_employee;
    when 'activate', 'deactivate' then
      update public.employees set is_active = (p_operation = 'activate') where id = p_employee;
      if found and p_operation = 'deactivate' then
        update attendance_private.sessions set consumed_at = clock_timestamp()
        where employee_id = p_employee and consumed_at is null;
        -- Revoke even if the account is subsequently reactivated.
        update attendance_private.sessions set expires_at = least(expires_at, clock_timestamp())
        where employee_id = p_employee and expires_at > clock_timestamp();
        perform 1;
      end if;
    when 'reset_pin' then
      update public.employees set pin_hash = p_pin_hash
      where id = p_employee and pin_hash = p_previous_hash;
    else
      raise exception 'invalid operation';
  end case;
  if not found then raise exception 'employee unavailable or changed'; end if;

  insert into attendance_private.owner_employee_audit (owner_id, employee_id, operation)
  values (p_owner, p_employee, p_operation);
end;
$$;

revoke all on function public.owner_manage_employee(uuid,uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.owner_manage_employee(uuid,uuid,text,text,text,text) to service_role;

commit;
