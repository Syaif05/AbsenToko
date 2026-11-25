begin;

do $$
declare
  shop uuid := gen_random_uuid();
  employee uuid := gen_random_uuid();
  owner_id uuid;
  session_hash text := repeat('9',64);
begin
  select user_id into strict owner_id from public.owner_profiles limit 1;
  insert into public.stores(id,name) values(shop,'Uji Laporan Masalah');
  insert into public.employees(id,name,store_id) values(employee,'Karyawan Uji',shop);
  perform public.attendance_select_employee(shop,employee,session_hash);
  if (public.website_issue_employee(session_hash)->>'id')::uuid is distinct from employee
    or public.website_issue_employee(repeat('f',64)) is not null then
    raise exception 'issue reporting did not bind the employee session';
  end if;

  if has_column_privilege('anon','public.website_issues','message','SELECT')
    or has_column_privilege('authenticated','public.website_issues','media','SELECT')
    or has_table_privilege('authenticated','public.website_issues','UPDATE')
    or has_function_privilege('authenticated','public.website_issue_employee(text)','EXECUTE')
    or (select public from storage.buckets where id='website-issue-media') is distinct from false
    or (select permissive from pg_policies where policyname='issue_media_deny_direct_access') is distinct from 'RESTRICTIVE'
  then raise exception 'issue data or media are exposed'; end if;

  insert into public.website_issues(id,reporter_id,reporter_role,reporter_name,page,message,media,status,upload_id)
    values(gen_random_uuid(),employee,'employee','Karyawan Uji','/','Jadwal gagal dimuat','[]','new',gen_random_uuid()),
          (gen_random_uuid(),employee,'employee','Karyawan Uji','/','Unggahan belum selesai','[]','receiving',gen_random_uuid());
  perform set_config('request.jwt.claim.sub',employee::text,true);
  set local role authenticated;
  if exists(select id from public.website_issues) then raise exception 'non-owner read website issues'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  if (select count(id) from public.website_issues) <> 1 then
    raise exception 'owner inbox must show received reports only'; end if;
  reset role;

  update attendance_private.sessions set consumed_at=clock_timestamp() where token_hash=session_hash;
  if public.website_issue_employee(session_hash) is not null then
    raise exception 'revoked session accepted'; end if;
end $$;

rollback;
