begin;
do $$
declare
  owner_id uuid;
  emp uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  attempt uuid := gen_random_uuid();
  token text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  pin_hash text := '$argon2id$v=19$m=19456,t=2,p=1$Zml4dHVyZS1zYWx0$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
begin
  select user_id into owner_id from public.owner_profiles where role='owner' limit 1;
  if owner_id is null then raise exception 'Provisioning Owner diperlukan.'; end if;
  perform public.owner_manage_store_assignment(owner_id,a,'create_store','Fixture A ' || a,null,null,null);
  perform public.owner_manage_store_assignment(owner_id,b,'create_store','Fixture B ' || b,null,null,null);
  perform public.owner_manage_store_assignment(owner_id,emp,'create','Fixture Toko',a,pin_hash,null);
  perform public.attendance_issue_store_session(emp,token,pin_hash,a);
  perform public.attendance_prepare(token,attempt,'IN');
  perform public.attendance_commit(token,attempt,-6,106,20);
  perform public.owner_manage_store_assignment(owner_id,emp,'rename','Fixture Toko',b,null,null);
  if (select store_id from public.employees where id=emp) is distinct from b then
    raise exception 'Penempatan tidak berubah';
  end if;
  if (select store_id from public.attendance where employee_id=emp) is distinct from a then
    raise exception 'Riwayat toko ikut berpindah';
  end if;
  begin
    perform public.attendance_status(token);
    raise exception 'Sesi lama masih aktif';
  exception when raise_exception then
    if sqlerrm <> 'invalid session' then raise; end if;
  end;
  if has_table_privilege('anon','public.stores','SELECT')
    or has_function_privilege('authenticated','public.owner_manage_store_assignment(uuid,uuid,text,text,uuid,text,text)','EXECUTE')
    or has_column_privilege('authenticated','public.employees','pin_hash','SELECT') then
    raise exception 'Izin data toko atau PIN terlalu luas';
  end if;
end $$;
rollback;
select 'LULUS — pengelompokan toko dan perpindahan' as hasil;
