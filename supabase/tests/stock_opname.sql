-- Run after all migrations with one provisioned fixture Owner.
begin;
do $$
declare
  shop uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  owner_id uuid;
  fixture_report uuid := gen_random_uuid();
  a_token text := repeat('a',64);
  b_token text := repeat('b',64);
  config jsonb;
  receipt jsonb;
  vals jsonb;
  edits jsonb;
  sugar uuid;
  choco uuid;
  revision timestamptz;
  d date;
begin
  select user_id into strict owner_id from public.owner_profiles limit 1;
  insert into public.stores(id,name) values(shop,'SO Fixture');
  insert into public.employees(id,name,store_id) values(a,'SO Karyawan A',shop),(b,'SO Karyawan B',shop);
  perform public.attendance_select_employee(shop,a,a_token);
  perform public.attendance_select_employee(shop,b,b_token);
  config := public.employee_stock_opname(a_token);
  d := (config->>'report_date')::date;
  if jsonb_array_length(config->'items') <> 42 or config->>'store_name' <> 'SO Fixture'
    or d <> (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'seed, store or business date incorrect';
  end if;
  select id into sugar from public.so_items where name='Gula';
  select id into choco from public.so_items where name='Bubuk Royal Choco';
  select jsonb_object_agg(id,case unit_type when 'combined' then '["0","24"]'::jsonb else '["-",""]'::jsonb end)
    into vals from public.so_items;
  vals := jsonb_set(vals,array[choco::text],'["1/4",""]');

  begin
    perform public.employee_stock_opname(a_token,fixture_report,config->>'version',d,vals - sugar::text);
    raise exception 'missing required field allowed';
  exception when raise_exception then if sqlerrm <> 'so invalid value' then raise; end if; end;
  if exists(select 1 from public.so_reports where id=fixture_report) then raise exception 'partial report saved'; end if;

  begin
    perform public.employee_stock_opname(a_token,fixture_report,config->>'version',d-1,vals);
    raise exception 'backdated report allowed';
  exception when raise_exception then if sqlerrm <> 'so stale form' then raise; end if; end;

  receipt := public.employee_stock_opname(a_token,fixture_report,config->>'version',d,vals,'Cek SO');
  revision := (receipt->'report'->>'updated_at')::timestamptz;
  if jsonb_array_length(receipt->'items') <> 42 or (receipt->'report'->>'employee_name') <> 'SO Karyawan A'
    or not exists(select 1 from public.so_report_items where item_id=sugar and secondary_value='24' and status_flag='ok')
    or not exists(select 1 from public.so_report_items where item_id=choco and status_flag='low')
    or not exists(select 1 from public.so_report_items where report_id=fixture_report and status_flag='empty') then
    raise exception 'receipt or status incorrect';
  end if;
  if public.employee_stock_opname(a_token,fixture_report,config->>'version',d,vals,'Cek SO') <> receipt
    then raise exception 'retry did not return saved report'; end if;
  begin
    perform public.employee_stock_opname(a_token,gen_random_uuid(),config->>'version',d,vals);
    raise exception 'duplicate allowed';
  exception when unique_violation then null; end;
  begin
    perform public.employee_stock_opname(b_token,fixture_report);
    raise exception 'another employee read the report';
  exception when raise_exception then if sqlerrm <> 'so duplicate' then raise; end if; end;
  begin
    perform public.owner_update_stock_opname(b,fixture_report,revision,true);
    raise exception 'nonowner deleted a report';
  exception when raise_exception then if sqlerrm <> 'owner required' then raise; end if; end;

  if has_table_privilege('anon','public.so_reports','SELECT')
    or has_table_privilege('authenticated','public.so_reports','UPDATE')
    or has_function_privilege('authenticated','public.employee_stock_opname(text,uuid,text,date,jsonb,text)','execute')
    or has_function_privilege('authenticated','public.owner_update_stock_opname(uuid,uuid,timestamptz,boolean,jsonb,text)','execute')
    then raise exception 'excess privileges'; end if;

  perform set_config('request.jwt.claim.sub',b::text,true);
  set local role authenticated;
  if exists(select 1 from public.so_reports) or exists(select 1 from public.so_items)
    then raise exception 'ordinary authenticated user bypassed SO RLS'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  update public.so_items set name='Nama Baru' where id=choco;
  delete from public.so_items where id=sugar;
  if not exists(select 1 from public.so_report_items where report_id=fixture_report and
      item_name_snapshot='Gula' and item_id is null and unit_snapshot='kardus + pcs')
    or not exists(select 1 from public.so_report_items where report_id=fixture_report and
      item_id=choco and item_name_snapshot='Bubuk Royal Choco') then raise exception 'snapshot corrupted'; end if;
  reset role;

  begin
    perform public.employee_stock_opname(b_token,gen_random_uuid(),config->>'version',d,vals);
    raise exception 'outdated master accepted';
  exception when raise_exception then if sqlerrm <> 'so stale form' then raise; end if; end;
  update public.so_settings set require_all_fields=false,quick_presets='{}' where id=1;
  config := public.employee_stock_opname(b_token);
  receipt := public.employee_stock_opname(b_token,gen_random_uuid(),config->>'version',d,'{}');
  if exists(select 1 from jsonb_array_elements(receipt->'items') r where r->>'status_flag'<>'unfilled')
    then raise exception 'unfilled stock classified as empty'; end if;
  select jsonb_object_agg(id,jsonb_build_array(raw_value,secondary_value)) into edits
    from public.so_report_items where so_report_items.report_id=fixture_report;
  perform public.owner_update_stock_opname(owner_id,fixture_report,revision,false,edits,'Koreksi Owner');
  begin
    perform public.owner_update_stock_opname(owner_id,fixture_report,revision,true);
    raise exception 'stale update allowed';
  exception when raise_exception then if sqlerrm <> 'so stale report' then raise; end if; end;
  select updated_at into revision from public.so_reports where id=fixture_report and updated_by=owner_id and notes='Koreksi Owner';
  perform public.owner_update_stock_opname(owner_id,fixture_report,revision,true);
  if exists(select 1 from public.so_report_items where so_report_items.report_id=fixture_report) then raise exception 'orphan lines'; end if;
end $$;
rollback;
