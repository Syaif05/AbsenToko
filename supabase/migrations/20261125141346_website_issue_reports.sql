begin;

create table public.website_issues (
  id uuid primary key,
  reporter_id uuid not null,
  reporter_role text not null check (reporter_role in ('employee', 'owner')),
  reporter_name text not null,
  page text not null check (page in (
    '/', '/owner', '/owner/karyawan', '/owner/toko', '/owner/jadwal', '/owner/stock-opname', '/owner/pengaturan'
  )),
  message text not null check (char_length(btrim(message)) between 10 and 12000),
  media jsonb not null check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 6),
  attachment_count integer generated always as (jsonb_array_length(media)) stored,
  status text not null default 'receiving' check (status in ('receiving','new','reviewing','resolved')),
  upload_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index website_issues_recent on public.website_issues (created_at desc, id) where status <> 'receiving';
create index website_issues_status_recent on public.website_issues (status, created_at desc, id) where status <> 'receiving';
create index website_issues_stale_upload on public.website_issues (updated_at, id) where status = 'receiving';
alter table public.website_issues enable row level security;
revoke all on public.website_issues from public, anon, authenticated, service_role;
grant select (id, reporter_role, reporter_name, page, message, attachment_count, status, created_at)
  on public.website_issues to authenticated;
grant select, insert, update, delete on public.website_issues to service_role;
create policy website_issue_owner_read on public.website_issues for select to authenticated
  using (status <> 'receiving' and exists (
    select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('website-issue-media','website-issue-media',false,4194304,
  array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4']);
create policy issue_media_deny_direct_access on storage.objects
  as restrictive for all to anon,authenticated
  using (bucket_id is distinct from 'website-issue-media')
  with check (bucket_id is distinct from 'website-issue-media');

create function public.website_issue_employee(p_hash text)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('id', e.id, 'name', e.name)
  from attendance_private.sessions s
  join public.employees e on e.id=s.employee_id
  join public.stores st on st.id=e.store_id
  where s.token_hash=p_hash and s.expires_at>statement_timestamp() and s.consumed_at is null
    and e.is_active and e.archived_at is null and st.archived_at is null
$$;
revoke all on function public.website_issue_employee(text) from public,anon,authenticated,service_role;
grant execute on function public.website_issue_employee(text) to service_role;

commit;
