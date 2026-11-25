begin;

do $$
declare
  shop uuid := gen_random_uuid();
  another_shop uuid := gen_random_uuid();
  employee uuid := gen_random_uuid();
  other_employee uuid := gen_random_uuid();
  owner_id uuid;
  employee_hash text := repeat('7',64);
  other_hash text := repeat('8',64);
  request_id uuid := gen_random_uuid();
  milk uuid;
  sugar uuid;
  report uuid;
  form jsonb;
  patch jsonb;
  change_time timestamptz;
  workday date := (statement_timestamp() at time zone 'Asia/Jakarta')::date;
begin
  select user_id into strict owner_id from public.owner_profiles limit 1;
  select id into strict milk from public.so_items where name='Susu Indomilk';
  select id into strict sugar from public.so_items where name='Gula';
  insert into public.stores(id,name) values(shop,'SOH Test'),(another_shop,'SOH Other');
  insert into public.employees(id,name,store_id) values(employee,'Pengisi SOH',shop),(other_employee,'Pengisi Lain',another_shop);
  perform public.attendance_select_employee(shop,employee,employee_hash);
  perform public.attendance_select_employee(another_shop,other_employee,other_hash);

  perform public.owner_set_stock_on_hand(owner_id,shop,milk,'["30",""]',null,null,'Stok awal');
  perform public.owner_set_stock_on_hand(owner_id,shop,sugar,'["2","0"]',24,null,'Stok awal');
  perform public.owner_set_stock_on_hand(owner_id,shop,milk,'["30",""]',null,null,'Stok awal');
  if (select count(*) from public.so_on_hand_history where store_id=shop) <> 2 then
    raise exception 'owner retry duplicated history';
  end if;
  if public.employee_check_stock_on_hand(employee_hash,milk,'["31",""]') is distinct from 'soh exceeded'
    or public.employee_check_stock_on_hand(employee_hash,milk,'["30",""]') is not null
    or public.employee_check_stock_on_hand(other_hash,milk,'["31",""]') is not null
    or public.employee_check_stock_on_hand(employee_hash,sugar,'["1","25"]') is distinct from 'soh exceeded'
    or public.employee_check_stock_on_hand(employee_hash,sugar,'["1","24"]') is not null
  then raise exception 'preview did not respect store, count, or box conversion'; end if;

  form := public.employee_shared_stock(employee_hash);
  if form::text ~ '"(report_limit|units_per_box|quantity|so_on_hand)"' then
    raise exception 'private quantities leaked in form';
  end if;

  begin
    perform public.employee_shared_stock(employee_hash,gen_random_uuid(),null,form->>'version',workday,
      jsonb_build_object(milk,'{"values":["20",""],"revision":0}'::jsonb,sugar,'{"values":["2","1"],"revision":0}'::jsonb));
    raise exception 'oversized count was saved';
  exception when raise_exception then
    if sqlerrm <> 'soh exceeded' then raise; end if;
  end;
  if exists(select 1 from public.so_reports where store_id=shop)
    or (select quantity[1] from public.so_on_hand where store_id=shop and item_id=milk) is distinct from '30'
    or (select count(*) from public.so_on_hand_history where store_id=shop) <> 2
  then raise exception 'rejected save left partial changes'; end if;

  patch := jsonb_build_object(milk,'{"values":["20",""],"revision":0}'::jsonb);
  form := public.employee_shared_stock(employee_hash,request_id,null,form->>'version',workday,patch);
  report := (form->>'report_id')::uuid;
  perform public.employee_shared_stock(employee_hash,request_id,report,form->>'version',workday,patch);
  if (select quantity[1] from public.so_on_hand where store_id=shop and item_id=milk) is distinct from '20'
    or (select count(*) from public.so_on_hand_history where store_id=shop) <> 3
    or public.employee_check_stock_on_hand(employee_hash,milk,'["25",""]') is not null
    or public.employee_check_stock_on_hand(employee_hash,milk,'["31",""]') is distinct from 'soh exceeded'
  then raise exception 'same-day correction or stock history failed'; end if;

  -- Simulate the previous report having been closed yesterday in WIB.
  update public.so_reports set report_date=workday-1 where id=report;
  update public.so_on_hand set source_report_date=workday-1 where source_report_id=report;
  if public.employee_check_stock_on_hand(employee_hash,milk,'["21",""]') is distinct from 'soh exceeded'
    or public.employee_check_stock_on_hand(employee_hash,milk,'["20",""]') is not null
  then raise exception 'next SO must use the last count as its limit'; end if;

  select updated_at into change_time from public.so_on_hand where store_id=shop and item_id=milk;
  perform public.owner_set_stock_on_hand(owner_id,shop,milk,'["45",""]',null,change_time,'Restok');
  if public.employee_check_stock_on_hand(employee_hash,milk,'["45",""]') is not null
    or public.employee_check_stock_on_hand(employee_hash,milk,'["46",""]') is distinct from 'soh exceeded'
  then raise exception 'manual adjustment did not reset the limit'; end if;
  begin
    perform public.owner_set_stock_on_hand(owner_id,shop,milk,'["40",""]',null,change_time,'Stale');
    raise exception 'stale adjustment was accepted';
  exception when raise_exception then
    if sqlerrm <> 'soh changed' then raise; end if;
  end;

  form := public.employee_shared_stock(employee_hash);
  form := public.employee_shared_stock(employee_hash,gen_random_uuid(),null,form->>'version',workday,
    jsonb_build_object(milk,'{"values":["-",""],"revision":0}'::jsonb));
  perform public.employee_shared_stock(employee_hash,gen_random_uuid(),(form->>'report_id')::uuid,form->>'version',workday,
    jsonb_build_object(milk,'{"values":["",""],"revision":1}'::jsonb));
  if (select quantity[1] from public.so_on_hand where store_id=shop and item_id=milk) is distinct from '-'
    or public.employee_check_stock_on_hand(employee_hash,milk,'["1",""]') is distinct from null
  then raise exception 'zero, blank, or same-report limit behaved incorrectly'; end if;

  if attendance_private.soh_amount(array['1.400',null],null) <> 1400
    or attendance_private.soh_amount(array['1/4',null],null) <> 0.25
    or attendance_private.soh_amount(array['2/4',null],null) <> 0.5
    or has_table_privilege('anon','public.so_on_hand','SELECT')
    or has_table_privilege('authenticated','public.so_on_hand','UPDATE')
    or has_function_privilege('authenticated','public.employee_check_stock_on_hand(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.owner_set_stock_on_hand(uuid,uuid,uuid,jsonb,integer,timestamptz,text)','EXECUTE')
  then raise exception 'quantity conversion or grants failed'; end if;
  perform set_config('request.jwt.claim.sub',employee::text,true);
  set local role authenticated;
  if exists(select 1 from public.so_on_hand) or exists(select 1 from public.so_on_hand_history) then
    raise exception 'non-owner read private balances';
  end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  if (select count(*) from public.so_on_hand where store_id=shop) <> 2
    or (select count(*) from public.so_on_hand_history where store_id=shop) <> 5 then
    raise exception 'owner missing balances or history';
  end if;
  reset role;
end $$;

rollback;
