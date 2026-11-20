begin;
do $$
declare
  shop uuid := gen_random_uuid();
  other_shop uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  a_hash text := repeat('a',64);
  b_hash text := repeat('b',64);
  c_hash text := repeat('c',64);
  request_a uuid := gen_random_uuid();
  start_a jsonb;
  start_b jsonb;
  saved jsonb;
  first_item text;
  second_item text;
  patch_a jsonb;
  report_id uuid;
  workday date;
  actor_count integer;
  owner_id uuid;
  edit_values jsonb;
  owner_target uuid;
  owner_version timestamptz;
begin
  select user_id into strict owner_id from public.owner_profiles limit 1;
  insert into public.stores(id,name) values(shop,'SO Tim'),(other_shop,'SO Toko Lain');
  insert into public.employees(id,name,store_id) values(a,'Karyawan A',shop),(b,'Karyawan B',shop),(c,'Karyawan C',other_shop);
  perform public.attendance_select_employee(shop,a,a_hash);
  perform public.attendance_select_employee(shop,b,b_hash);
  perform public.attendance_select_employee(other_shop,c,c_hash);
  start_a := public.employee_shared_stock(a_hash);
  start_b := public.employee_shared_stock(b_hash);
  workday := (start_a->>'report_date')::date;
  first_item := start_a#>>'{items,0,id}';
  second_item := start_b#>>'{items,1,id}';
  patch_a := jsonb_build_object(first_item,'{"values":["2/4",""],"revision":0}'::jsonb);

  saved := public.employee_shared_stock(a_hash,request_a,null,start_a->>'version',workday,patch_a,'Hitung awal');
  report_id := (saved->>'report_id')::uuid;
  if saved#>>'{items,0,last_editor}' <> 'Karyawan A' then raise exception 'first actor missing'; end if;
  if public.employee_shared_stock(a_hash,request_a,null,start_a->>'version',workday,patch_a,'Hitung awal') <> saved then
    raise exception 'exact retry differed';
  end if;

  -- A tab opened before the first save can still change a different item.
  saved := public.employee_shared_stock(b_hash,gen_random_uuid(),null,start_b->>'version',workday,
    jsonb_build_object(second_item,'{"values":["3",""],"revision":0}'::jsonb));
  if (saved->>'report_id')::uuid <> report_id or saved#>>'{items,0,values,0}' <> '2/4'
    or saved#>>'{items,1,last_editor}' <> 'Karyawan B' or jsonb_array_length(saved->'contributors') <> 2
    then raise exception 'shared report or attribution incorrect'; end if;
  if (select count(*) from public.so_reports where store_id=shop) <> 1 then raise exception 'duplicate shared report'; end if;
  if (select status_flag from public.so_report_items where catalog_item_id::text=first_item) <> 'low' then
    raise exception 'equivalent fraction not recognized';
  end if;

  begin
    perform public.employee_shared_stock(b_hash,gen_random_uuid(),report_id,start_b->>'version',workday,patch_a);
    raise exception 'stale item overwrite allowed';
  exception when raise_exception then if sqlerrm <> 'so item conflict' then raise; end if; end;
  begin
    perform public.employee_shared_stock(c_hash,gen_random_uuid(),report_id,start_b->>'version',workday,patch_a);
    raise exception 'cross-store edit allowed';
  exception when raise_exception then if sqlerrm <> 'so stale form' then raise; end if; end;
  begin
    perform public.employee_shared_stock(b_hash,gen_random_uuid(),report_id,start_b->>'version',workday-1,patch_a);
    raise exception 'backdated edit allowed';
  exception when raise_exception then if sqlerrm <> 'so stale form' then raise; end if; end;
  begin
    perform public.employee_shared_stock(a_hash,request_a,report_id,start_a->>'version',workday,patch_a,'Berbeda');
    raise exception 'changed replay accepted';
  exception when raise_exception then if sqlerrm <> 'so stale form' then raise; end if; end;

  saved := public.employee_shared_stock(b_hash,gen_random_uuid(),report_id,start_b->>'version',workday,
    jsonb_build_object(first_item,'{"values":["5",""],"revision":1}'::jsonb));
  if saved#>>'{items,0,last_editor}' <> 'Karyawan B' or saved#>>'{items,0,revision}' <> '2'
    then raise exception 'cross-employee correction failed'; end if;
  select count(distinct actor_id) into actor_count from public.so_revisions r where r.report_id=(saved->>'report_id')::uuid;
  if actor_count <> 2 then raise exception 'history lost previous contributor'; end if;

  select updated_at into owner_version from public.so_reports where id=report_id;
  select jsonb_object_agg(id,jsonb_build_array(raw_value,secondary_value)) into edit_values
    from public.so_report_items i where i.report_id=(saved->>'report_id')::uuid;
  select id into owner_target from public.so_report_items where catalog_item_id::text=first_item;
  edit_values := edit_values || jsonb_build_object(owner_target,'["6",null]'::jsonb);
  perform public.owner_update_stock_opname(owner_id,report_id,owner_version,false,edit_values,'Koreksi');
  saved := public.employee_shared_stock(a_hash);
  if saved#>>'{items,0,last_editor}' <> 'Owner' or saved#>>'{items,0,revision}' <> '3' then
    raise exception 'owner edit not visible to team'; end if;
  if has_table_privilege('anon','public.so_revisions','SELECT')
    or has_table_privilege('authenticated','public.so_revisions','INSERT')
    or has_function_privilege('authenticated','public.employee_shared_stock(text,uuid,uuid,text,date,jsonb,text)','EXECUTE') then
    raise exception 'excess shared SO permission';
  end if;
  perform set_config('request.jwt.claim.sub',c::text,true);
  set local role authenticated;
  if exists(select 1 from public.so_revisions) then raise exception 'non-owner read history'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  if (select count(*) from public.so_revisions) <> 4 then raise exception 'owner did not read all revisions'; end if;
  reset role;
end $$;
rollback;
