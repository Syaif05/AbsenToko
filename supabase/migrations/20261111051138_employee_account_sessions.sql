begin;

-- New logins last up to 24 hours. Existing sessions keep their original expiry.
alter table attendance_private.settings
  drop constraint settings_session_seconds_check,
  add constraint settings_session_seconds_check check (session_seconds between 60 and 86400),
  alter column session_seconds set default 86400;
update attendance_private.settings set session_seconds=86400 where session_seconds=600;

-- Attendance still locks the employee and writes each result once per intent.
-- Only revocation consumes a session.
create or replace function public.attendance_commit(p_hash text,p_id uuid,p_lat double precision,p_lng double precision,p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent attendance_private.upload_intents; employee uuid; state jsonb; attendance_id uuid; stamp timestamptz; reply jsonb;
begin
  select employee_id into employee from attendance_private.sessions where token_hash=p_hash and expires_at>clock_timestamp();
  if employee is null then raise exception 'invalid session'; end if;
  perform 1 from public.employees where id=employee and is_active for update;
  if not found then raise exception 'inactive employee'; end if;
  state:=public.attendance_status(p_hash);
  select * into intent from attendance_private.upload_intents where id=p_id and session_hash=p_hash for update;
  if not found then raise exception 'invalid intent'; end if;
  if intent.result is not null then return intent.result; end if;
  if intent.expires_at<=clock_timestamp() then raise exception 'expired intent'; end if;
  stamp:=clock_timestamp();
  if intent.action='IN' and state->>'status'='NOT_CHECKED_IN' then
    insert into public.attendance(employee_id,check_in_at) values(employee,stamp) returning id into attendance_id;
  elsif intent.action='OUT' and state->>'status'='CHECKED_IN' then
    update public.attendance set check_out_at=stamp where id=(state->'attendance'->>'id')::uuid returning id into attendance_id;
  else raise exception 'invalid state'; end if;
  insert into public.attendance_evidence(attendance_id,type,photo_path,latitude,longitude,accuracy_m,recorded_at)
  values(attendance_id,intent.action,intent.photo_path,p_lat,p_lng,p_accuracy,stamp);
  reply:=jsonb_build_object('attendance_id',attendance_id,'action',intent.action,'recorded_at',stamp);
  update attendance_private.upload_intents set result=reply where id=p_id;
  return reply;
end $$;

create or replace function public.attendance_get_intent(p_hash text,p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent attendance_private.upload_intents;
begin
  perform 1 from attendance_private.sessions s join public.employees e on e.id=s.employee_id
  where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null and e.is_active and e.pin_hash=s.verified_pin_hash;
  if not found then raise exception 'invalid session'; end if;
  select * into intent from attendance_private.upload_intents where id=p_id and session_hash=p_hash;
  if not found or (intent.result is null and intent.expires_at<=clock_timestamp()) then raise exception 'invalid intent'; end if;
  return to_jsonb(intent)-'session_hash';
end $$;

create function public.attendance_end_session(p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.employees e
  join attendance_private.sessions s on s.employee_id=e.id
  where s.token_hash=p_hash for update of e;
  update attendance_private.sessions set consumed_at=clock_timestamp()
  where token_hash=p_hash and consumed_at is null;
end $$;
revoke all on function public.attendance_end_session(text) from public,anon,authenticated;
grant execute on function public.attendance_end_session(text) to service_role;

commit;
