begin;

create table attendance_private.attendance_resets (
  owner_id uuid not null,
  request_id uuid not null,
  deleted_count integer not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, request_id)
);
create table attendance_private.attendance_reset_photos (
  photo_path text primary key
);
alter table attendance_private.attendance_resets enable row level security;
alter table attendance_private.attendance_reset_photos enable row level security;
revoke all on attendance_private.attendance_resets, attendance_private.attendance_reset_photos
  from public, anon, authenticated;

create function public.owner_reset_attendance(p_owner uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  deleted integer;
  paths jsonb;
begin
  perform 1 from public.owner_profiles where user_id = p_owner and role = 'owner' for share;
  if not found then raise exception 'owner required'; end if;
  if p_request is null then raise exception 'request required'; end if;

  perform pg_advisory_xact_lock(24051, 1);
  select deleted_count into deleted from attendance_private.attendance_resets
    where owner_id = p_owner and request_id = p_request;
  if not found then
    -- Attendance commits acquire an employee row lock before reading or writing attendance.
    lock table public.employees in exclusive mode;
    insert into attendance_private.attendance_reset_photos(photo_path)
      select photo_path from public.attendance_evidence
      union select photo_path from attendance_private.upload_intents where result is not null
      on conflict do nothing;

    delete from attendance_private.upload_intents where result is not null;
    delete from public.attendance_evidence;
    delete from public.attendance;
    get diagnostics deleted = row_count;
    insert into attendance_private.attendance_resets(owner_id, request_id, deleted_count)
      values (p_owner, p_request, deleted);
  end if;

  select coalesce(jsonb_agg(photo_path), '[]'::jsonb) into paths
    from (select photo_path from attendance_private.attendance_reset_photos order by photo_path limit 100) batch;
  return jsonb_build_object('deleted', deleted, 'paths', paths);
end $$;

create function public.owner_finish_attendance_reset_photos(p_paths text[])
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from attendance_private.attendance_reset_photos where photo_path = any(p_paths);
  return not exists (select 1 from attendance_private.attendance_reset_photos);
end $$;

revoke all on function public.owner_reset_attendance(uuid,uuid),
  public.owner_finish_attendance_reset_photos(text[]) from public, anon, authenticated;
grant execute on function public.owner_reset_attendance(uuid,uuid),
  public.owner_finish_attendance_reset_photos(text[]) to service_role;

commit;
