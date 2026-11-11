begin;
do $$
declare
  manager uuid;
  shop uuid := gen_random_uuid();
  staff uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  failed_request uuid := gen_random_uuid();
  result jsonb;
begin
  select user_id into manager from public.owner_profiles where role='owner' limit 1;
  result := public.owner_apply_change(manager,request_id,shop,'create_store','Retry fixture',null);
  if result->>'ok' <> 'true' or result->>'replayed' <> 'false' then raise exception 'missing commit'; end if;
  result := public.owner_apply_change(manager,request_id,shop,'create_store','Retry fixture',null);
  if result->>'replayed' <> 'true' then raise exception 'retry not replayed'; end if;
  if (select count(*) from public.stores where id=shop) <> 1 then raise exception 'duplicate store'; end if;
  begin
    perform public.owner_apply_change(manager,request_id,shop,'create_store','Changed payload',null);
    raise exception 'changed request accepted';
  exception when raise_exception then
    if sqlerrm <> 'request conflict' then raise; end if;
  end;
  begin
    perform public.owner_apply_change(gen_random_uuid(),gen_random_uuid(),shop,'rename_store','No owner',null);
    raise exception 'non owner accepted';
  exception when raise_exception then
    if sqlerrm <> 'owner required' then raise; end if;
  end;
  perform public.owner_apply_change(manager,gen_random_uuid(),staff,'create','Fixture employee',shop);
  begin
    perform public.owner_apply_change(manager,failed_request,shop,'archive_store',null,null);
    raise exception 'populated store archived';
  exception when raise_exception then
    if sqlerrm <> 'store has employees' then raise; end if;
  end;
  if exists(select 1 from attendance_private.owner_change_requests r where r.request_id=failed_request) then
    raise exception 'failed transaction left receipt';
  end if;
  perform public.owner_apply_change(manager,gen_random_uuid(),staff,'archive_employee',null,null);
  perform public.owner_apply_change(manager,failed_request,shop,'archive_store',null,null);
  if not exists(select 1 from public.stores where id=shop and archived_at is not null) then raise exception 'archive failed'; end if;
  if has_function_privilege('anon','public.owner_apply_change(uuid,uuid,uuid,text,text,uuid)','EXECUTE') or
     has_function_privilege('authenticated','public.owner_apply_change(uuid,uuid,uuid,text,text,uuid)','EXECUTE') then
    raise exception 'private write exposed';
  end if;
  if has_table_privilege('authenticated','attendance_private.owner_change_requests','SELECT') then raise exception 'audit exposed'; end if;
end $$;
rollback;
select 'Owner reliability tests passed' as hasil;
