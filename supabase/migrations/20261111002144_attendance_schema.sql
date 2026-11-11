-- Absen Toko, Fase 2. Jalankan utuh di SQL Editor proyek Supabase.
begin;

create schema attendance_private;
revoke all on schema attendance_private from public, anon, authenticated, service_role;

create table public.owner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role = 'owner')
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_name_valid check (
    char_length(name) between 1 and 80
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
    and name !~ '^[[:space:]]|[[:space:]]$'
  ),
  -- Pemeriksaan format PHC. Parameter dan salt unik ditangani backend.
  constraint employees_pin_hash_argon2id check (
    char_length(pin_hash) <= 512
    and pin_hash ~ '^[$]argon2id[$]v=19[$]m=[0-9]+,t=[0-9]+,p=[0-9]+[$][A-Za-z0-9+/]{11,}[$][A-Za-z0-9+/]{22,}$'
  )
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  check_in_at timestamptz not null default now(),
  work_date date generated always as ((check_in_at at time zone 'Asia/Jakarta')::date) stored not null,
  check_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_employee_day_unique unique (employee_id, work_date),
  constraint attendance_valid_times check (
    isfinite(check_in_at)
    and (check_out_at is null or (isfinite(check_out_at) and check_out_at >= check_in_at))
  )
);

create unique index attendance_one_open_per_employee
  on public.attendance (employee_id) where check_out_at is null;

create index attendance_work_date_idx on public.attendance (work_date);

create table public.attendance_evidence (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance(id) on delete restrict,
  type text not null check (type in ('IN', 'OUT')),
  photo_path text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m >= 0 and accuracy_m < 'Infinity'::double precision),
  recorded_at timestamptz not null default now() check (isfinite(recorded_at)),
  constraint attendance_evidence_once_per_type unique (attendance_id, type),
  constraint attendance_evidence_photo_unique unique (photo_path),
  constraint attendance_evidence_photo_path_valid check (
    photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
  )
);

create function attendance_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;

revoke all on function attendance_private.set_updated_at() from public, anon, authenticated, service_role;

create trigger employees_set_updated_at before update on public.employees
for each row execute function attendance_private.set_updated_at();

create trigger attendance_set_updated_at before update on public.attendance
for each row execute function attendance_private.set_updated_at();

alter table public.owner_profiles enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.attendance_evidence enable row level security;

-- Netral terhadap pengaturan default grant proyek lama maupun baru.
revoke all on public.owner_profiles, public.employees, public.attendance, public.attendance_evidence
  from public, anon, authenticated, service_role;

grant select (user_id, role) on public.owner_profiles to authenticated;
grant select (id, name, is_active, created_at, updated_at) on public.employees to authenticated;
grant select on public.attendance, public.attendance_evidence to authenticated;

-- Dipakai oleh backend tepercaya. Klien tidak memperoleh role ini.
grant select on public.owner_profiles to service_role;
grant select, insert on public.employees, public.attendance, public.attendance_evidence to service_role;
grant update (name, pin_hash, is_active) on public.employees to service_role;
grant update (check_out_at) on public.attendance to service_role;

create policy owner_profiles_read_self on public.owner_profiles
for select to authenticated using ((select auth.uid()) = user_id);

create policy employees_read_owner on public.employees
for select to authenticated
using ((select exists (
  select 1 from public.owner_profiles
  where user_id = (select auth.uid()) and role = 'owner'
)));

create policy attendance_read_owner on public.attendance
for select to authenticated
using ((select exists (
  select 1 from public.owner_profiles
  where user_id = (select auth.uid()) and role = 'owner'
)));

create policy attendance_evidence_read_owner on public.attendance_evidence
for select to authenticated
using ((select exists (
  select 1 from public.owner_profiles
  where user_id = (select auth.uid()) and role = 'owner'
)));

-- Supabase mengelola schema Storage. Gagalkan migrasi jika RLS dasarnya tidak aktif.
do $$
begin
  if (
    select count(*) from pg_catalog.pg_class
    where oid in ('storage.buckets'::regclass, 'storage.objects'::regclass)
      and relrowsecurity
  ) <> 2 then
    raise exception 'RLS Storage Supabase harus aktif pada storage.buckets dan storage.objects.';
  end if;
end;
$$;

-- Guard khusus bucket ini, termasuk bila proyek memiliki policy permisif yang luas.
-- Akses file Owner kelak melalui signed URL singkat dari backend.
create policy attendance_photos_deny_direct_bucket_access on storage.buckets
as restrictive for all to anon, authenticated
using (id is distinct from 'attendance-photos')
with check (id is distinct from 'attendance-photos');

create policy attendance_photos_deny_direct_object_access on storage.objects
as restrictive for all to anon, authenticated
using (bucket_id is distinct from 'attendance-photos')
with check (bucket_id is distinct from 'attendance-photos');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-photos', 'attendance-photos', false, 1000000, array['image/jpeg'])
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'attendance-photos' and name = 'attendance-photos'
      and public is false and file_size_limit = 1000000 and allowed_mime_types = array['image/jpeg']
  ) then
    raise exception 'Bucket attendance-photos yang sudah ada harus privat, JPEG saja, dan maksimal 1000000 byte.';
  end if;
end;
$$;

commit;
