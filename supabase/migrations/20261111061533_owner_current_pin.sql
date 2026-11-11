begin;

create table attendance_private.employee_pin_envelopes (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  envelope text not null check (envelope ~ '^v1\.[A-Za-z0-9+/]{46,54}={0,2}$')
);
alter table attendance_private.employee_pin_envelopes enable row level security;
revoke all on attendance_private.employee_pin_envelopes from public, anon, authenticated, service_role;

alter table attendance_private.owner_employee_audit
  drop constraint owner_employee_audit_operation_check,
  add constraint owner_employee_audit_operation_check
    check (operation in ('create', 'rename', 'activate', 'deactivate', 'reset_pin', 'view_pin'));

-- Discard the old envelope even when the PIN is changed by an older API.
create function attendance_private.clear_previous_pin_envelope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from attendance_private.employee_pin_envelopes where employee_id = new.id;
  return new;
end;
$$;
revoke all on function attendance_private.clear_previous_pin_envelope() from public, anon, authenticated, service_role;

create trigger clear_previous_pin_envelope
after update of pin_hash on public.employees
for each row when (old.pin_hash is distinct from new.pin_hash)
execute function attendance_private.clear_previous_pin_envelope();

create function public.owner_set_recoverable_employee_pin(
  p_owner uuid, p_id uuid, p_operation text, p_name text, p_store uuid,
  p_pin_hash text, p_previous_hash text, p_envelope text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_operation is null or p_operation not in ('create', 'reset_pin') then
    raise exception 'invalid operation';
  end if;
  perform public.owner_manage_store_assignment(
    p_owner, p_id, p_operation, p_name, p_store, p_pin_hash, p_previous_hash
  );
  insert into attendance_private.employee_pin_envelopes(employee_id, envelope)
  values (p_id, p_envelope);
end;
$$;

create function public.owner_read_employee_pin(p_owner uuid, p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  current_envelope text;
begin
  perform 1 from public.owner_profiles where user_id = p_owner and role = 'owner' for share;
  if not found then raise exception 'owner required'; end if;

  select envelope into current_envelope
  from attendance_private.employee_pin_envelopes where employee_id = p_id;
  if current_envelope is not null then
    insert into attendance_private.owner_employee_audit(owner_id, employee_id, operation)
    values (p_owner, p_id, 'view_pin');
  end if;
  return current_envelope;
end;
$$;

revoke all on function
  public.owner_set_recoverable_employee_pin(uuid,uuid,text,text,uuid,text,text,text),
  public.owner_read_employee_pin(uuid,uuid)
from public, anon, authenticated;
grant execute on function
  public.owner_set_recoverable_employee_pin(uuid,uuid,text,text,uuid,text,text,text),
  public.owner_read_employee_pin(uuid,uuid)
to service_role;
commit;
