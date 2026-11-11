begin;
create table attendance_private.settings (
  singleton boolean primary key default true check(singleton),
  session_seconds integer not null default 600 check(session_seconds between 60 and 1800),
  work_window_seconds integer not null default 86400 check(work_window_seconds between 3600 and 172800)
);
insert into attendance_private.settings default values;
create table attendance_private.sessions (
  token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
  employee_id uuid not null references public.employees(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  verified_pin_hash text not null
);
create index sessions_expiry on attendance_private.sessions(expires_at);
create table attendance_private.upload_intents (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null references attendance_private.sessions(token_hash),
  action text not null check(action in ('IN','OUT')),
  photo_path text not null unique default (gen_random_uuid()::text || '.jpg'),
  expires_at timestamptz not null,
  result jsonb,
  unique(session_hash,id)
);
create index upload_intents_expiry on attendance_private.upload_intents(expires_at) where result is null;
create table attendance_private.rate_limits (
  key text primary key,
  attempts integer not null,
  resets_at timestamptz not null
);
alter table attendance_private.settings enable row level security;
alter table attendance_private.sessions enable row level security;
alter table attendance_private.upload_intents enable row level security;
alter table attendance_private.rate_limits enable row level security;
revoke all on all tables in schema attendance_private from public,anon,authenticated,service_role;

-- RPC khusus backend. Increment rate limit harus di-commit sebelum verifikasi PIN.
create function public.attendance_take_limit(p_key text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_key is null or length(p_key)>160 or p_limit not between 1 and 1000 or p_seconds not between 1 and 3600 then
    raise exception 'invalid limit';
  end if;
  insert into attendance_private.rate_limits as r values(p_key,1,clock_timestamp()+make_interval(secs=>p_seconds))
  on conflict(key) do update set
    attempts=case when r.resets_at<=clock_timestamp() then 1 else least(r.attempts+1,p_limit+1) end,
    resets_at=case when r.resets_at<=clock_timestamp() then clock_timestamp()+make_interval(secs=>p_seconds) else r.resets_at end
  returning attempts into n;
  return n<=p_limit;
end $$;

create function public.attendance_issue_session(p_employee uuid,p_hash text,p_pin_hash text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare expiry timestamptz;
begin
  perform 1 from public.employees where id=p_employee and is_active and pin_hash=p_pin_hash for update;
  if not found then raise exception 'invalid employee'; end if;
  select clock_timestamp()+make_interval(secs=>session_seconds) into expiry from attendance_private.settings;
  insert into attendance_private.sessions values(p_hash,p_employee,expiry,null,p_pin_hash);
  return expiry;
end $$;

create function public.attendance_status(p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee uuid; entry public.attendance; seconds integer;
begin
  select s.employee_id into employee from attendance_private.sessions s join public.employees e on e.id=s.employee_id
    where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null and e.is_active and e.pin_hash=s.verified_pin_hash;
  if employee is null then raise exception 'invalid session'; end if;
  select work_window_seconds into seconds from attendance_private.settings;
  select * into entry from public.attendance where employee_id=employee and check_out_at is null;
  if found then
    return jsonb_build_object('status',case when entry.check_in_at+make_interval(secs=>seconds)<=clock_timestamp() then 'EXPIRED' else 'CHECKED_IN' end,'attendance',to_jsonb(entry));
  end if;
  select * into entry from public.attendance where employee_id=employee and work_date=(clock_timestamp() at time zone 'Asia/Jakarta')::date;
  return jsonb_build_object('status',case when found then 'COMPLETED' else 'NOT_CHECKED_IN' end,'attendance',to_jsonb(entry));
end $$;

create function public.attendance_prepare(p_hash text,p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state jsonb; intent attendance_private.upload_intents;
begin
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
  insert into attendance_private.upload_intents(id,session_hash,action,expires_at)
  select p_id,p_hash,p_action,least(expires_at,clock_timestamp()+interval '3 minutes') from attendance_private.sessions where token_hash=p_hash
  returning * into intent;
  return to_jsonb(intent)-'session_hash';
end $$;

create function public.attendance_commit(p_hash text,p_id uuid,p_lat double precision,p_lng double precision,p_accuracy double precision)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent attendance_private.upload_intents; employee uuid; state jsonb; attendance_id uuid; stamp timestamptz; reply jsonb;
begin
  select employee_id into employee from attendance_private.sessions where token_hash=p_hash and expires_at>clock_timestamp();
  if employee is null then raise exception 'invalid session'; end if;
  perform 1 from public.employees where id=employee and is_active for update;
  if not found then raise exception 'inactive employee'; end if;
  select * into intent from attendance_private.upload_intents where id=p_id and session_hash=p_hash for update;
  if not found then raise exception 'invalid intent'; end if;
  if intent.result is not null then return intent.result; end if;
  if intent.expires_at<=clock_timestamp() then raise exception 'expired intent'; end if;
  state:=public.attendance_status(p_hash);
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
  update attendance_private.sessions set consumed_at=stamp where token_hash=p_hash;
  return reply;
end $$;

-- Semua fungsi privileged hanya dapat dipanggil service_role dari Edge Function.
revoke all on function public.attendance_take_limit(text,integer,integer),public.attendance_issue_session(uuid,text,text),public.attendance_status(text),public.attendance_prepare(text,uuid,text),public.attendance_commit(text,uuid,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.attendance_take_limit(text,integer,integer),public.attendance_issue_session(uuid,text,text),public.attendance_status(text),public.attendance_prepare(text,uuid,text),public.attendance_commit(text,uuid,double precision,double precision,double precision) to service_role;
create function public.attendance_get_intent(p_hash text,p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent attendance_private.upload_intents;
begin
  perform 1 from attendance_private.sessions s join public.employees e on e.id=s.employee_id
  where s.token_hash=p_hash and s.expires_at>clock_timestamp() and e.is_active and e.pin_hash=s.verified_pin_hash;
  if not found then raise exception 'invalid session'; end if;
  select * into intent from attendance_private.upload_intents where id=p_id and session_hash=p_hash;
  if not found or (intent.result is null and intent.expires_at<=clock_timestamp()) then raise exception 'invalid intent'; end if;
  return to_jsonb(intent)-'session_hash';
end $$;
create function public.attendance_cleanup_candidates()
returns table(id uuid,photo_path text) language sql security definer set search_path = '' as $$
  select id,photo_path from attendance_private.upload_intents
  where result is null and expires_at<clock_timestamp()-interval '1 hour' order by expires_at limit 100
$$;
create function public.attendance_cleanup_done(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from attendance_private.upload_intents where id=p_id and result is null and expires_at<clock_timestamp()-interval '1 hour';
  delete from attendance_private.rate_limits where resets_at<clock_timestamp()-interval '1 day';
  delete from attendance_private.sessions s where expires_at<clock_timestamp()-interval '1 day'
    and not exists(select 1 from attendance_private.upload_intents i where i.session_hash=s.token_hash);
end $$;
revoke all on function public.attendance_get_intent(text,uuid),public.attendance_cleanup_candidates(),public.attendance_cleanup_done(uuid) from public,anon,authenticated;
grant execute on function public.attendance_get_intent(text,uuid),public.attendance_cleanup_candidates(),public.attendance_cleanup_done(uuid) to service_role;
commit;
