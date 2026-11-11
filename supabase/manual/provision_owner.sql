-- Ganti UUID nol dengan User UID yang sudah dibuat di Authentication → Users.
-- Jalankan di SQL Editor. File ini tidak membuat akun atau kata sandi.
do $$
declare
  owner_uid constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if owner_uid = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Ganti UUID nol dengan User UID dari Authentication → Users.';
  end if;

  perform 1 from auth.users
  where id = owner_uid
    and email is not null
    and email_confirmed_at is not null
    and deleted_at is null
    and not is_anonymous;

  if not found then
    raise exception 'UID harus menunjuk ke akun Auth aktif dengan email terkonfirmasi.';
  end if;

  insert into public.owner_profiles (user_id)
  values (owner_uid)
  on conflict (user_id) do nothing;
end;
$$;
