begin;

create table public.so_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  sort_order int not null default 0,
  is_active boolean not null default true
);
create unique index so_categories_name on public.so_categories(lower(btrim(name)));

create table public.so_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.so_categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  unit_type text not null check (unit_type in ('single', 'combined')),
  unit_label text not null check (length(btrim(unit_label)) between 1 and 40),
  sort_order int not null default 0,
  is_active boolean not null default true,
  check (unit_type <> 'combined' or unit_label = 'kardus + pcs')
);
create unique index so_items_category_name on public.so_items(category_id, lower(btrim(name)));

create table public.so_settings (
  id integer primary key check (id = 1),
  store_name text not null default 'Teh Idaman Jambe' check (length(btrim(store_name)) between 1 and 120),
  guidelines_text text not null check (length(btrim(guidelines_text)) between 1 and 2000),
  quick_presets text[] not null check (
    cardinality(quick_presets) <= 12
    and array_to_json(quick_presets)::text ~ '^\[("-"|"[0-9]{1,12}"|"[0-9]{1,3}([.][0-9]{3}){1,3}"|"[0-9]{1,6}/[1-9][0-9]{0,5}")?(,("-"|"[0-9]{1,12}"|"[0-9]{1,3}([.][0-9]{3}){1,3}"|"[0-9]{1,6}/[1-9][0-9]{0,5}"))*\]$'
  ),
  require_all_fields boolean not null default true
);

create table public.so_reports (
  id uuid primary key,
  employee_id uuid not null references public.employees(id),
  employee_name text not null,
  store_id uuid references public.stores(id) on delete set null,
  store_name text not null,
  report_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  notes text not null check (length(notes) <= 500),
  guidelines_snapshot text not null,
  unique (employee_id, store_id, report_date)
);
create index so_reports_date on public.so_reports(report_date desc, created_at desc, id);
create index so_reports_store on public.so_reports(store_id);

create table public.so_report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.so_reports(id) on delete cascade,
  item_id uuid references public.so_items(id) on delete set null,
  item_name_snapshot text not null,
  category_id_snapshot uuid not null,
  category_name_snapshot text not null,
  unit_snapshot text not null,
  unit_type_snapshot text not null,
  sort_order int not null,
  raw_value text,
  secondary_value text,
  status_flag text not null check (status_flag in ('empty', 'low', 'ok', 'unfilled'))
);
create index so_report_items_report on public.so_report_items(report_id, sort_order);
create index so_report_items_master on public.so_report_items(item_id);

do $$
declare tbl text;
begin
  foreach tbl in array array['so_categories','so_items','so_settings','so_reports','so_report_items'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', tbl);
    execute format('grant select on public.%I to authenticated', tbl);
    execute format('create policy so_owner_read on public.%I for select to authenticated using
      (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role=''owner''))', tbl);
  end loop;
  foreach tbl in array array['so_categories','so_items','so_settings'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', tbl);
    execute format('create policy so_owner_manage on public.%I for all to authenticated using
      (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role=''owner''))
      with check (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role=''owner''))', tbl);
  end loop;
end $$;
revoke insert, delete on public.so_settings from authenticated;
grant select on public.so_categories, public.so_items, public.so_settings to service_role;
grant select, insert, update, delete on public.so_reports, public.so_report_items to service_role;

insert into public.so_settings(id,guidelines_text,quick_presets) values
(1, E'Isi - jika stok kosong atau habis.\nIsi 1/2 atau 1/4 jika tanpa stok cadangan dan hanya tersisa stok display.\nIsi 1 dan seterusnya jika ada stok cadangan.', array['-','1/4','1/2','1','2']);

with categories as (
  insert into public.so_categories(name,sort_order) values
    ('Milky Series',10),('Tea Series',20),('Bahan Baku Utama & Minuman',30),('Kemasan & Perlengkapan',40)
  returning id,sort_order
), seed(cat, names, units) as (
  values
    (10,array['Bubuk Royal Choco','Bubuk Choco Oreo','Bubuk Silverqueen','Bubuk Caramel','Bubuk BlackCurrant','Bubuk Strawberry','Bubuk Red Velvet','Bubuk Taro','Bubuk Bubble Gum','Bubuk Matcha','Bubuk Avocado','Bubuk Macchiato'],array_fill('pack/toples'::text,array[12])),
    (20,array['Bubuk Lemon Tea','Bubuk Grape Tea','Bubuk Mangga Tea','Bubuk Apple Tea','Bubuk Lychee Tea','Bubuk Melon Tea','Bubuk Strawberry Tea','Bubuk Markisa Tea'],array_fill('pack/toples'::text,array[8])),
    (30,array['Bubuk Thai Tea Series','Bubuk Tea Best','Susu SKM','Susu Indomilk','Susu Evaporasi','Yakult','Sprite','Sp Cream','Gula'],array['pcs','ball','pcs','botol','botol','botol','botol','pcs','kardus + pcs']),
    (40,array['Sedotan','Struk Termal','Sealer Cup / Silen Cup','Solatip','Plastik 1 Cup','Plastik 2 Cup','Plastik 3 Cup','Plastik Sampah','Sabun Cuci Piring','Sabun Pel','Tissue','Cup Polos','Cup Idaman'],array['pcs','roll','roll','roll','pcs','pcs','pcs','pcs','botol/pouch','ranting','pcs','pcs','pcs'])
)
insert into public.so_items(category_id,name,unit_type,unit_label,sort_order)
select categories.id, entry.name, case when entry.unit='kardus + pcs' then 'combined' else 'single' end, entry.unit, entry.position*10
from categories join seed on seed.cat=categories.sort_order
cross join lateral unnest(seed.names,seed.units) with ordinality as entry(name,unit,position);

create function attendance_private.so_status(p_value text, p_secondary text)
returns text language sql immutable set search_path='' as $$
  select case
    when p_value is null and p_secondary is null then 'unfilled'
    when replace(coalesce(p_secondary,'-'),'.','') ~ '^(-|0+)$' and replace(coalesce(p_value,'-'),'.','') ~ '^(-|0+|0+/[1-9][0-9]*)$' then 'empty'
    when p_value in ('1/4','1/2') and replace(coalesce(p_secondary,'-'),'.','') ~ '^(-|0+)$' then 'low'
    else 'ok'
  end
$$;

create function attendance_private.so_values(p_entry jsonb, p_unit text, p_required boolean)
returns text[] language plpgsql immutable set search_path='' as $$
declare qty text := nullif(btrim(p_entry->>0),''); loose text := nullif(btrim(p_entry->>1),'');
begin
  if p_entry is not null and (jsonb_typeof(p_entry) <> 'array'
    or jsonb_array_length(p_entry) <> 2
    or jsonb_typeof(p_entry->0) not in ('string','null')
    or jsonb_typeof(p_entry->1) not in ('string','null')) then
    raise exception 'so invalid value';
  end if;
  if (p_required and (qty is null or (p_unit='combined' and loose is null)))
    or (qty is not null and (length(qty)>24 or qty !~ '^(-|[0-9]{1,12}|[0-9]{1,3}([.][0-9]{3}){1,3}|[0-9]{1,6}/[1-9][0-9]{0,5})$'))
    or (p_unit='single' and loose is not null)
    or (p_unit='combined' and (
      (qty is null) <> (loose is null)
      or (qty is not null and qty !~ '^(-|[0-9]{1,12}|[0-9]{1,3}([.][0-9]{3}){1,3})$')
      or (loose is not null and loose !~ '^(-|[0-9]{1,12}|[0-9]{1,3}([.][0-9]{3}){1,3})$')
    )) then
    raise exception 'so invalid value';
  end if;
  return array[qty,loose];
end $$;

create function public.employee_stock_opname(p_hash text, p_id uuid default null, p_version text default null,
  p_date date default null, p_values jsonb default null, p_notes text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  person public.employees;
  shop text;
  settings jsonb;
  catalog jsonb;
  version text;
  workday date := (statement_timestamp() at time zone 'Asia/Jakarta')::date;
  entry record;
  vals text[];
  report public.so_reports;
begin
  select e.* into person from attendance_private.sessions s
    join public.employees e on e.id=s.employee_id
    where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null
    and e.is_active and e.archived_at is null for share of e;
  if not found then raise exception 'invalid session'; end if;
  select name into shop from public.stores where id=person.store_id and archived_at is null;
  if not found then raise exception 'invalid session'; end if;

  if p_id is not null then
    -- Serialize retries of the same submission before reading the receipt.
    perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
    select * into report from public.so_reports where id=p_id;
    if found and (report.employee_id<>person.id or report.store_id is distinct from person.store_id)
      then raise exception 'so duplicate'; end if;
  end if;

  if report.id is null then
    select to_jsonb(s), coalesce(items.data,'[]'::jsonb) into settings, catalog
    from public.so_settings s cross join lateral (
      select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'unit_type',i.unit_type,'unit_label',i.unit_label,
        'category_id',c.id,'category_name',c.name) order by c.sort_order,c.name,c.id,i.sort_order,i.name,i.id) as data
      from public.so_items i join public.so_categories c on c.id=i.category_id
      where i.is_active and c.is_active
    ) items where s.id=1;
    version := md5(catalog::text || settings::text || person.store_id::text || shop);

    if p_id is null then
      return jsonb_build_object('employee_name',person.name,'store_name',shop,'report_date',workday,
        'settings',settings,'items',catalog,'version',version,
        'existing_id',(select id from public.so_reports where employee_id=person.id and store_id=person.store_id and report_date=workday));
    end if;
    if p_values is null then raise exception 'so missing report'; end if;
    if p_version is distinct from version or p_date is distinct from workday then raise exception 'so stale form'; end if;
    if jsonb_array_length(catalog)=0 or jsonb_array_length(catalog)>250 or jsonb_typeof(p_values) is distinct from 'object'
      or length(coalesce(p_notes,''))>500 then raise exception 'so invalid value'; end if;
    if exists(select 1 from jsonb_object_keys(p_values) k where not exists
      (select 1 from jsonb_array_elements(catalog) i where i->>'id'=k)) then raise exception 'so invalid value'; end if;

    insert into public.so_reports(id,employee_id,employee_name,store_id,store_name,report_date,notes,guidelines_snapshot)
      values(p_id,person.id,person.name,person.store_id,shop,workday,btrim(coalesce(p_notes,'')),settings->>'guidelines_text')
      returning * into report;
    for entry in select value as item, ordinality as position from jsonb_array_elements(catalog) with ordinality loop
      vals := attendance_private.so_values(p_values->(entry.item->>'id'),entry.item->>'unit_type',(settings->>'require_all_fields')::boolean);
      insert into public.so_report_items(report_id,item_id,item_name_snapshot,category_id_snapshot,category_name_snapshot,
        unit_snapshot,unit_type_snapshot,sort_order,raw_value,secondary_value,status_flag)
      values(report.id,(entry.item->>'id')::uuid,entry.item->>'name',(entry.item->>'category_id')::uuid,entry.item->>'category_name',
        entry.item->>'unit_label',entry.item->>'unit_type',entry.position,vals[1],vals[2],attendance_private.so_status(vals[1],vals[2]));
    end loop;
  end if;

  return jsonb_build_object('report',to_jsonb(report),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order),'[]')
    from public.so_report_items i where i.report_id=report.id));
end $$;

create function public.owner_update_stock_opname(p_owner uuid, p_id uuid, p_version timestamptz,
  p_delete boolean, p_values jsonb default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare report public.so_reports; item public.so_report_items; vals text[]; item_count int;
begin
  perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
  if not found then raise exception 'owner required'; end if;
  select * into report from public.so_reports where id=p_id for update;
  if not found or p_version is distinct from report.updated_at then raise exception 'so stale report'; end if;
  if p_delete is true then
    delete from public.so_reports where id=p_id;
    return jsonb_build_object('ok',true);
  end if;
  select count(*) into item_count from public.so_report_items where report_id=p_id;
  if jsonb_typeof(p_values) is distinct from 'object' or length(coalesce(p_notes,''))>500
    or (select count(*) from jsonb_object_keys(p_values)) <> item_count then raise exception 'so invalid value'; end if;
  for item in select * from public.so_report_items where report_id=p_id loop
    if not (p_values ? item.id::text) then raise exception 'so invalid value'; end if;
    vals := attendance_private.so_values(p_values->item.id::text,item.unit_type_snapshot,false);
    update public.so_report_items set raw_value=vals[1],secondary_value=vals[2],
      status_flag=attendance_private.so_status(vals[1],vals[2]) where id=item.id;
  end loop;
  update public.so_reports set notes=btrim(coalesce(p_notes,'')), updated_at=clock_timestamp(), updated_by=p_owner where id=p_id;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.employee_stock_opname(text,uuid,text,date,jsonb,text),
  public.owner_update_stock_opname(uuid,uuid,timestamptz,boolean,jsonb,text),
  attendance_private.so_status(text,text), attendance_private.so_values(jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.employee_stock_opname(text,uuid,text,date,jsonb,text),
  public.owner_update_stock_opname(uuid,uuid,timestamptz,boolean,jsonb,text),
  attendance_private.so_status(text,text), attendance_private.so_values(jsonb,text,boolean) to service_role;
commit;
