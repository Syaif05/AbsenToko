begin;
alter table attendance_private.upload_intents add column target_attendance_id uuid;
-- Unbound legacy OUT attempts must restart; completed receipts remain replayable.
create or replace function public.attendance_prepare(p_hash text,p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state jsonb; intent attendance_private.upload_intents; target uuid;
begin
  select employee_id into target from attendance_private.sessions where token_hash=p_hash;
  perform 1 from public.employees where id=target for update;
  perform 1 from attendance_private.sessions where token_hash=p_hash for update;
  state:=public.attendance_status(p_hash);
  select * into intent from attendance_private.upload_intents where id=p_id;
  if found then
    if intent.session_hash<>p_hash or intent.action<>p_action or intent.expires_at<=clock_timestamp() then raise exception 'invalid intent'; end if;
    return to_jsonb(intent)-'session_hash';
  end if;
  if not ((p_action='IN' and state->>'status'='NOT_CHECKED_IN') or (p_action='OUT' and state->>'status'='CHECKED_IN')) then
    raise exception 'invalid state';
  end if;
  if (select count(*) from attendance_private.upload_intents where session_hash=p_hash and expires_at>clock_timestamp())>=3 then raise exception 'too many intents'; end if;
  insert into attendance_private.upload_intents(id,session_hash,action,expires_at,target_attendance_id)
  select p_id,p_hash,p_action,least(expires_at,clock_timestamp()+interval '3 minutes'),case when p_action='OUT' then (state->'attendance'->>'id')::uuid else null end from attendance_private.sessions where token_hash=p_hash
  returning * into intent;
  return to_jsonb(intent)-'session_hash';
end $$;

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
  if intent.action='OUT' and intent.target_attendance_id is distinct from (state->'attendance'->>'id')::uuid then raise exception 'invalid state'; end if;
  if intent.action='OUT' and intent.target_attendance_id is null then raise exception 'invalid state'; end if;
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
