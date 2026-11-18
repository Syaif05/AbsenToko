begin;
alter table public.attendance add column closed_at timestamptz;
alter table public.attendance add column owner_confirmation_reason text;
alter table public.attendance add column owner_confirmed_at timestamptz;
alter table public.attendance add column owner_confirmed_by uuid references auth.users(id);
grant select(closed_at,owner_confirmation_reason,owner_confirmed_at,owner_confirmed_by) on public.attendance to authenticated;
drop index public.attendance_one_open_per_employee;
create unique index attendance_one_open_per_employee on public.attendance(employee_id) where check_out_at is null and closed_at is null;
create table attendance_private.attendance_corrections (
 request_id uuid primary key, attendance_id uuid not null, owner_id uuid not null,
 check_out_at timestamptz not null, reason text not null, created_at timestamptz not null default clock_timestamp()
);
alter table attendance_private.attendance_corrections enable row level security;
revoke all on attendance_private.attendance_corrections from public,anon,authenticated,service_role;

create or replace function public.attendance_status(p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare employee uuid; entry public.attendance; seconds integer;
begin
 select s.employee_id into employee from attendance_private.sessions s join public.employees e on e.id=s.employee_id
 where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null and e.is_active and e.archived_at is null;
 if employee is null then raise exception 'invalid session'; end if;
 select work_window_seconds into seconds from attendance_private.settings;
 select * into entry from public.attendance where employee_id=employee and check_out_at is null and closed_at is null
   and check_in_at+make_interval(secs=>seconds)>clock_timestamp();
 if found then return jsonb_build_object('status','CHECKED_IN','attendance',to_jsonb(entry)); end if;
 select * into entry from public.attendance where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Jakarta')::date;
 return jsonb_build_object('status',case when not found then 'NOT_CHECKED_IN' when entry.check_out_at is null then 'EXPIRED' else 'COMPLETED' end,'attendance',to_jsonb(entry));
end $$;

create function public.owner_confirm_checkout(p_owner uuid,p_request uuid,p_attendance uuid,p_checkout timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry public.attendance; previous attendance_private.attendance_corrections; employee uuid;
begin
 perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
 if not found then raise exception 'owner required'; end if;
 if p_request is null or p_checkout is null or not isfinite(p_checkout) or length(btrim(p_reason)) not between 5 and 500 or p_reason is null then raise exception 'invalid correction'; end if;
 select employee_id into employee from public.attendance where id=p_attendance;
 perform 1 from public.employees where id=employee for update;
 if not found then raise exception 'attendance unavailable'; end if;
 select * into previous from attendance_private.attendance_corrections where request_id=p_request;
 if found then
   if previous.owner_id<>p_owner or previous.attendance_id<>p_attendance or previous.check_out_at<>p_checkout or previous.reason<>btrim(p_reason) then raise exception 'request conflict'; end if;
   return jsonb_build_object('ok',true);
 end if;
 select * into entry from public.attendance where id=p_attendance for update;
 if entry.check_out_at is not null then raise exception 'already completed'; end if;
 if p_checkout<entry.check_in_at or p_checkout>clock_timestamp() or p_checkout>entry.check_in_at+interval '48 hours' then raise exception 'invalid checkout'; end if;
 if exists(select 1 from public.attendance where employee_id=employee and check_in_at>entry.check_in_at and check_in_at<p_checkout) then raise exception 'overlapping checkout'; end if;
 update public.attendance set check_out_at=p_checkout,closed_at=coalesce(closed_at,clock_timestamp()),owner_confirmed_at=clock_timestamp(),owner_confirmed_by=p_owner,owner_confirmation_reason=btrim(p_reason) where id=p_attendance;
 insert into attendance_private.attendance_corrections(request_id,attendance_id,owner_id,check_out_at,reason) values(p_request,p_attendance,p_owner,p_checkout,btrim(p_reason));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.owner_confirm_checkout(uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.owner_confirm_checkout(uuid,uuid,uuid,timestamptz,text) to service_role;
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
    update public.attendance set closed_at=stamp where employee_id=employee and check_out_at is null and closed_at is null
      and check_in_at+make_interval(secs=>(select work_window_seconds from attendance_private.settings))<=stamp;
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

commit;
