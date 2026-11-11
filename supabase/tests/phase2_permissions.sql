-- Jalankan utuh di SQL Editor setelah provision_owner.sql.
-- Fixture database bersifat fiktif dan seluruh perubahan di-rollback.
begin;

do $$
declare
  owner_uid uuid;
begin
  select user_id into owner_uid from public.owner_profiles order by user_id limit 1;
  if owner_uid is null then
    raise exception 'Jalankan provision_owner.sql terlebih dahulu.';
  end if;
  if (
    select count(*) from pg_catalog.pg_class
    where oid in ('public.owner_profiles'::regclass, 'public.employees'::regclass,
                  'public.attendance'::regclass, 'public.attendance_evidence'::regclass,
                  'storage.buckets'::regclass, 'storage.objects'::regclass)
      and relrowsecurity
  ) <> 6 then
    raise exception 'Ada tabel Fase 2 dengan RLS nonaktif.';
  end if;
  if not exists (
    select 1 from storage.buckets where id = 'attendance-photos' and name = 'attendance-photos'
      and public is false and file_size_limit = 1000000 and allowed_mime_types = array['image/jpeg']
  ) then
    raise exception 'Konfigurasi bucket privat, ukuran, atau MIME tidak sesuai.';
  end if;
  if (
    select count(*) from pg_catalog.pg_policy
    where (polrelid, polname) in (
      ('storage.buckets'::regclass, 'attendance_photos_deny_direct_bucket_access'),
      ('storage.objects'::regclass, 'attendance_photos_deny_direct_object_access')
    ) and not polpermissive and polcmd = '*'
      and polroles @> array['anon'::regrole::oid, 'authenticated'::regrole::oid]
  ) <> 2 then
    raise exception 'Kedua policy Storage restriktif harus aktif.';
  end if;

  perform set_config('absentoko.qa_owner', owner_uid::text, true);
  perform set_config('absentoko.qa_employee', gen_random_uuid()::text, true);
  perform set_config('absentoko.qa_attendance', gen_random_uuid()::text, true);
end;
$$;

set local role service_role;

do $$
declare
  employee_id_test constant uuid := current_setting('absentoko.qa_employee')::uuid;
  attendance_id_test constant uuid := current_setting('absentoko.qa_attendance')::uuid;
  photo_test constant text := gen_random_uuid()::text || '.jpg';
  fixture_hash constant text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
begin
  insert into public.employees (id, name, pin_hash)
  values (employee_id_test, 'Fixture Uji Fase 2', fixture_hash);

  begin
    update public.employees set pin_hash = '123456' where id = employee_id_test;
    raise exception 'PIN plaintext diterima.';
  exception when check_violation then null;
  end;

  insert into public.attendance (id, employee_id, check_in_at)
  values (attendance_id_test, employee_id_test, '2026-11-10 16:55:00+00');

  begin
    insert into public.attendance (employee_id, check_in_at, check_out_at)
    values (employee_id_test, '2026-11-10 15:00:00+00', '2026-11-10 15:30:00+00');
    raise exception 'Absensi kedua pada tanggal WIB yang sama diterima.';
  exception when unique_violation then null;
  end;
  begin
    insert into public.attendance (employee_id, check_in_at)
    values (employee_id_test, '2026-11-10 17:00:00+00');
    raise exception 'Dua sesi terbuka diterima.';
  exception when unique_violation then null;
  end;
  begin
    update public.attendance set check_out_at = '2026-11-10 16:00:00+00' where id = attendance_id_test;
    raise exception 'Jam pulang sebelum masuk diterima.';
  exception when check_violation then null;
  end;
  begin
    insert into public.attendance_evidence (attendance_id, type, photo_path, latitude, longitude, accuracy_m)
    values (attendance_id_test, 'IN', photo_test, 91, 106.8, 15);
    raise exception 'Koordinat di luar rentang diterima.';
  exception when check_violation then null;
  end;
  begin
    insert into public.attendance_evidence (attendance_id, type, photo_path, latitude, longitude, accuracy_m)
    values (attendance_id_test, 'IN', '../foto.jpg', -6.17, 106.8, 15);
    raise exception 'Path foto di luar format diterima.';
  exception when check_violation then null;
  end;

  insert into public.attendance_evidence (attendance_id, type, photo_path, latitude, longitude, accuracy_m, recorded_at)
  values (attendance_id_test, 'IN', photo_test, -6.17, 106.8, 15, '2026-11-10 16:55:00+00');

  begin
    insert into public.attendance_evidence (attendance_id, type, photo_path, latitude, longitude, accuracy_m)
    values (attendance_id_test, 'OUT', photo_test, -6.17, 106.8, 15);
    raise exception 'Path foto yang sudah digunakan diterima.';
  exception when unique_violation then null;
  end;

  update public.attendance set check_out_at = '2026-11-10 17:05:00+00' where id = attendance_id_test;
  insert into public.attendance_evidence (attendance_id, type, photo_path, latitude, longitude, accuracy_m, recorded_at)
  values (attendance_id_test, 'OUT', gen_random_uuid()::text || '.jpg', -6.17, 106.8, 15, '2026-11-10 17:05:00+00');
  update public.employees set is_active = false where id = employee_id_test;
  if not exists (
    select 1 from public.attendance where id = attendance_id_test
      and work_date = '2026-11-10' and check_out_at at time zone 'Asia/Jakarta' >= timestamp '2026-11-11 00:00'
  ) then
    raise exception 'Tanggal bisnis lintas tengah malam atau histori karyawan nonaktif salah.';
  end if;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['owner_profiles', 'employees', 'attendance', 'attendance_evidence'] loop
    begin
      execute format('select 1 from public.%I limit 1', table_name);
      raise exception 'Anon dapat membaca public.%.', table_name;
    exception when insufficient_privilege then null;
    end;
    if has_table_privilege('public.' || table_name, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'Anon memiliki hak tulis pada public.%.', table_name;
    end if;
  end loop;

  begin
    if exists (select 1 from storage.objects where bucket_id = 'attendance-photos') then
      raise exception 'Anon dapat melihat objek foto privat.';
    end if;
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('request.jwt.claim.sub'), 'role', 'authenticated', 'user_metadata', jsonb_build_object('role', 'owner')
)::text, true);

do $$
begin
  if exists (select 1 from public.owner_profiles)
    or exists (select id from public.employees)
    or exists (select 1 from public.attendance)
    or exists (select 1 from public.attendance_evidence) then
    raise exception 'Pengguna Auth non-Owner bisa membaca data privat.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('absentoko.qa_owner'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('absentoko.qa_owner'), 'role', 'authenticated'
)::text, true);

do $$
declare
  table_name text;
begin
  if not exists (select 1 from public.owner_profiles where user_id = auth.uid())
    or not exists (select id, name, is_active, created_at, updated_at from public.employees
                   where id = current_setting('absentoko.qa_employee')::uuid)
    or not exists (select 1 from public.attendance where id = current_setting('absentoko.qa_attendance')::uuid)
    or (select count(*) from public.attendance_evidence
        where attendance_id = current_setting('absentoko.qa_attendance')::uuid) <> 2 then
    raise exception 'Owner tidak dapat membaca data yang diizinkan.';
  end if;
  if exists (select 1 from public.owner_profiles where user_id <> auth.uid()) then
    raise exception 'Owner dapat membaca profil Owner lain.';
  end if;
  begin
    perform pin_hash from public.employees where id = current_setting('absentoko.qa_employee')::uuid;
    raise exception 'Owner dapat membaca hash PIN.';
  exception when insufficient_privilege then null;
  end;
  foreach table_name in array array['owner_profiles', 'employees', 'attendance', 'attendance_evidence'] loop
    if has_table_privilege('public.' || table_name, 'INSERT,UPDATE,DELETE,TRUNCATE')
      or has_any_column_privilege('public.' || table_name, 'INSERT,UPDATE') then
      raise exception 'Owner memiliki hak tulis langsung pada public.%.', table_name;
    end if;
  end loop;
  begin
    if exists (select 1 from storage.buckets where id = 'attendance-photos')
      or exists (select 1 from storage.objects where bucket_id = 'attendance-photos') then
      raise exception 'Owner dapat mengakses bucket atau objek secara langsung.';
    end if;
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
select 'LULUS — constraint, RLS, izin Owner, dan konfigurasi Storage Fase 2' as hasil;
