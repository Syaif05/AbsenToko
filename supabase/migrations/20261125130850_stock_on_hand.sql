begin;

create table public.so_on_hand (
  store_id uuid not null references public.stores(id) on delete cascade,
  item_id uuid not null references public.so_items(id) on delete cascade,
  unit_type text not null check (unit_type in ('single','combined')),
  unit_label text not null,
  units_per_box integer check (units_per_box between 1 and 999999),
  quantity text[] not null,
  report_limit text[],
  source_report_id uuid,
  source_report_date date,
  updated_at timestamptz not null,
  primary key (store_id, item_id),
  check ((unit_type = 'combined') = (units_per_box is not null))
);
create index so_on_hand_item_id on public.so_on_hand(item_id);

create table public.so_on_hand_history (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  item_id uuid not null,
  item_name text not null,
  unit_label text not null,
  before_quantity text[],
  before_unit_label text,
  quantity text[] not null,
  report_id uuid,
  actor_id uuid not null,
  actor_name text not null,
  note text not null default '',
  recorded_at timestamptz not null
);
create index so_on_hand_history_store on public.so_on_hand_history(store_id,id desc);

alter table public.so_on_hand enable row level security;
alter table public.so_on_hand_history enable row level security;
revoke all on public.so_on_hand, public.so_on_hand_history from public, anon, authenticated, service_role;
revoke all on sequence public.so_on_hand_history_id_seq from public, anon, authenticated, service_role;
grant select on public.so_on_hand, public.so_on_hand_history to authenticated;
create policy soh_owner_read on public.so_on_hand for select to authenticated using
  (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'));
create policy soh_history_owner_read on public.so_on_hand_history for select to authenticated using
  (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'));

-- Quantities have already passed so_values. Keep enough decimal places to distinguish
-- all supported fractions (denominators up to six digits).
create function attendance_private.soh_amount(p_quantity text[], p_units_per_box integer)
returns numeric language sql immutable set search_path='' as $$
  select case
    when p_units_per_box is not null then
      coalesce(nullif(replace(p_quantity[1],'.',''),'-'),'0')::numeric * p_units_per_box
      + coalesce(nullif(replace(p_quantity[2],'.',''),'-'),'0')::numeric
    when position('/' in p_quantity[1]) > 0 then
      split_part(p_quantity[1],'/',1)::numeric(40,24) / split_part(p_quantity[1],'/',2)::numeric
    else coalesce(nullif(replace(p_quantity[1],'.',''),'-'),'0')::numeric
  end
$$;

create function attendance_private.soh_issue(p_balance public.so_on_hand, p_report uuid, p_quantity text[],
  p_unit_type text, p_unit_label text)
returns text language sql immutable set search_path='' as $$
  select case
    when p_balance.item_id is null or p_quantity[1] is null then null
    when p_balance.unit_type <> p_unit_type or p_balance.unit_label <> p_unit_label then 'soh unit changed'
    when attendance_private.soh_amount(p_quantity,p_balance.units_per_box) >
      attendance_private.soh_amount(case when p_report = p_balance.source_report_id then p_balance.report_limit
        else p_balance.quantity end,p_balance.units_per_box) then 'soh exceeded'
  end
$$;

create function public.owner_set_stock_on_hand(p_owner uuid, p_store uuid, p_item uuid,
  p_quantity jsonb, p_units_per_box integer, p_updated_at timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  item public.so_items;
  stock public.so_on_hand;
  counted text[];
  changed_at timestamptz;
begin
  perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
  if not found then raise exception 'owner required'; end if;
  perform 1 from public.stores where id=p_store and archived_at is null for share;
  if not found then raise exception 'soh inactive'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soh:' || p_store::text,0));
  select i.* into item from public.so_items i join public.so_categories c on c.id=i.category_id
    where i.id=p_item and i.is_active and c.is_active for share of i,c;
  if not found then raise exception 'soh inactive'; end if;

  if length(coalesce(p_note,'')) > 160 or ((item.unit_type='combined') <> (p_units_per_box is not null))
    or p_units_per_box not between 1 and 999999 then raise exception 'so invalid value'; end if;
  counted := attendance_private.so_values(p_quantity,item.unit_type,true);
  select * into stock from public.so_on_hand where store_id=p_store and item_id=p_item;

  if stock.source_report_id is null and stock.quantity = counted
    and stock.units_per_box is not distinct from p_units_per_box
    and stock.unit_type = item.unit_type and stock.unit_label = item.unit_label
    and stock.updated_at is distinct from p_updated_at then
    return jsonb_build_object('ok',true);
  end if;
  if stock.updated_at is distinct from p_updated_at then raise exception 'soh changed'; end if;
  changed_at := clock_timestamp();
  insert into public.so_on_hand(store_id,item_id,unit_type,unit_label,units_per_box,quantity,updated_at)
    values(p_store,p_item,item.unit_type,item.unit_label,p_units_per_box,counted,changed_at)
  on conflict(store_id,item_id) do update set unit_type=excluded.unit_type,unit_label=excluded.unit_label,
    units_per_box=excluded.units_per_box,quantity=excluded.quantity,
    updated_at=excluded.updated_at,report_limit=null,source_report_id=null,source_report_date=null;
  insert into public.so_on_hand_history(store_id,item_id,item_name,unit_label,before_quantity,before_unit_label,quantity,
    actor_id,actor_name,note,recorded_at)
    values(p_store,p_item,item.name,item.unit_label,stock.quantity,stock.unit_label,counted,p_owner,'Owner',btrim(coalesce(p_note,'')),changed_at);
  return jsonb_build_object('ok',true);
end $$;

create function public.employee_check_stock_on_hand(p_hash text, p_item uuid, p_quantity jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
  shop uuid;
  today date := (statement_timestamp() at time zone 'Asia/Jakarta')::date;
  stock public.so_on_hand;
  report uuid;
  unit_kind text;
  unit_label text;
begin
  select e.store_id into shop from attendance_private.sessions s
    join public.employees e on e.id=s.employee_id
    join public.stores st on st.id=e.store_id
    where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null
      and e.is_active and e.archived_at is null and st.archived_at is null;
  if not found then raise exception 'invalid session'; end if;
  select * into stock from public.so_on_hand where store_id=shop and item_id=p_item;
  if not found then return null; end if;

  select r.id, i.unit_type_snapshot, i.unit_snapshot into report, unit_kind, unit_label
    from public.so_reports r left join public.so_report_items i on i.report_id=r.id and i.catalog_item_id=p_item
    where r.store_id=shop and r.report_date=today and r.catalog_version is not null;
  if report is null then
    select i.unit_type,i.unit_label into unit_kind,unit_label from public.so_items i where i.id=p_item;
  end if;
  if unit_kind is null then return null; end if;
  return attendance_private.soh_issue(stock,report,attendance_private.so_values(p_quantity,unit_kind,true),unit_kind,unit_label);
end $$;

create function attendance_private.apply_soh_count(p_person public.employees, p_report public.so_reports,
  p_item public.so_report_items, p_quantity text[], p_taken_at timestamptz)
returns void language plpgsql set search_path='' as $$
declare
  stock public.so_on_hand;
  issue text;
begin
  -- A blank is an unfinished count. Only a confirmed quantity (including explicit zero) changes SOH.
  if p_quantity[1] is null then return; end if;
  select * into stock from public.so_on_hand where store_id=p_person.store_id and item_id=p_item.catalog_item_id;
  if not found then return; end if;
  if stock.source_report_date > p_report.report_date then raise exception 'so stale form'; end if;
  issue := attendance_private.soh_issue(stock,p_report.id,p_quantity,p_item.unit_type_snapshot,p_item.unit_snapshot);
  if issue is not null then raise exception '%',issue using detail=p_item.catalog_item_id::text; end if;

  update public.so_on_hand set quantity=p_quantity, updated_at=p_taken_at,
    report_limit=case when stock.source_report_id=p_report.id then stock.report_limit else stock.quantity end,
    source_report_id=p_report.id,source_report_date=p_report.report_date
    where store_id=stock.store_id and item_id=stock.item_id;
  insert into public.so_on_hand_history(store_id,item_id,item_name,unit_label,before_quantity,before_unit_label,quantity,
    report_id,actor_id,actor_name,recorded_at)
  values(stock.store_id,stock.item_id,p_item.item_name_snapshot,stock.unit_label,stock.quantity,stock.unit_label,p_quantity,
    p_report.id,p_person.id,p_person.name,p_taken_at);
end $$;

revoke all on function attendance_private.soh_amount(text[],integer),
  attendance_private.soh_issue(public.so_on_hand,uuid,text[],text,text),
  attendance_private.apply_soh_count(public.employees,public.so_reports,public.so_report_items,text[],timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.owner_set_stock_on_hand(uuid,uuid,uuid,jsonb,integer,timestamptz,text),
  public.employee_check_stock_on_hand(text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.owner_set_stock_on_hand(uuid,uuid,uuid,jsonb,integer,timestamptz,text),
  public.employee_check_stock_on_hand(text,uuid,jsonb) to service_role;

create or replace function public.employee_shared_stock(p_hash text, p_request uuid default null,
  p_report uuid default null, p_version text default null, p_date date default null,
  p_changes jsonb default null, p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  person public.employees;
  shop text;
  workday date := (statement_timestamp() at time zone 'Asia/Jakarta')::date;
  taken_at timestamptz;
  report public.so_reports;
  previous public.so_revisions;
  item public.so_report_items;
  patch record;
  vals text[];
  catalog jsonb;
  rules public.so_settings;
  version text;
  fingerprint text;
  edits jsonb := '[]';
begin
  select e.* into person from attendance_private.sessions s join public.employees e on e.id=s.employee_id
    where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null
      and e.is_active and e.archived_at is null for share of e;
  if not found then raise exception 'invalid session'; end if;
  select name into shop from public.stores where id=person.store_id and archived_at is null for share;
  if not found then raise exception 'invalid session'; end if;

  -- Serialize the first save per store/day and lock the same header as Owner edits.
  if p_request is not null then
    -- Serialize SOH writes from all reports and direct Owner adjustments for this store.
    perform pg_advisory_xact_lock(hashtextextended('soh:' || person.store_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('so:' || person.store_id::text || ':' || workday::text,0));
  end if;
  select * into report from public.so_reports
    where store_id=person.store_id and report_date=workday and catalog_version is not null for update;

  if report.id is null then
    select s.* into strict rules from public.so_settings s where s.id=1;
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'unit_type',i.unit_type,'unit_label',i.unit_label,
        'category_id',c.id,'category_name',c.name) order by c.sort_order,c.name,c.id,i.sort_order,i.name,i.id),'[]') into catalog
      from public.so_items i join public.so_categories c on c.id=i.category_id where i.is_active and c.is_active;
    version := md5(catalog::text || rules.require_all_fields::text || rules.guidelines_text || person.store_id::text);
  else
    version := report.catalog_version;
  end if;

  if p_request is not null then
    if p_date is distinct from workday or p_version is distinct from version
      or (p_report is not null and p_report is distinct from report.id) then raise exception 'so stale form'; end if;
    if jsonb_typeof(p_changes) is distinct from 'object' or p_changes='{}'::jsonb
      or length(coalesce(p_note,''))>500 then raise exception 'so invalid value'; end if;
    fingerprint := md5(p_date::text || p_version || p_changes::text || coalesce(p_note,''));
    select * into previous from public.so_revisions where id=p_request;
    if found and (previous.report_id is distinct from report.id or previous.actor_id <> person.id
      or previous.actor_role <> 'employee' or previous.request_fingerprint is distinct from fingerprint) then
      raise exception 'so stale form';
    end if;
    if previous.id is null then
      taken_at := clock_timestamp();
      if report.id is null then
        if jsonb_array_length(catalog) not between 1 and 250 then raise exception 'so invalid value'; end if;
        insert into public.so_reports(id,employee_id,employee_name,store_id,store_name,report_date,notes,guidelines_snapshot,
          catalog_version,requires_all,item_count)
        values(gen_random_uuid(),person.id,person.name,person.store_id,shop,workday,'',rules.guidelines_text,
          version,rules.require_all_fields,jsonb_array_length(catalog)) returning * into report;
        insert into public.so_report_items(report_id,catalog_item_id,item_name_snapshot,category_id_snapshot,
          category_name_snapshot,unit_snapshot,unit_type_snapshot,sort_order,status_flag)
        select report.id,(i->>'id')::uuid,i->>'name',(i->>'category_id')::uuid,
          i->>'category_name',i->>'unit_label',i->>'unit_type',ordinality,'unfilled'
        from jsonb_array_elements(catalog) with ordinality as entry(i,ordinality);
      end if;
      for patch in select key,value from jsonb_each(p_changes) loop
        if patch.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or jsonb_typeof(patch.value) is distinct from 'object'
          or jsonb_typeof(patch.value->'values') is distinct from 'array'
          or jsonb_typeof(patch.value->'revision') is distinct from 'number' then raise exception 'so invalid value'; end if;
        select * into item from public.so_report_items where report_id=report.id and catalog_item_id=patch.key::uuid;
        if not found then raise exception 'so invalid value'; end if;
        if to_jsonb(item.revision) is distinct from patch.value->'revision' then raise exception 'so item conflict'; end if;
        vals := attendance_private.so_values(patch.value->'values',item.unit_type_snapshot,false);
        if array[item.raw_value,item.secondary_value] is distinct from vals then
          perform attendance_private.apply_soh_count(person,report,item,vals,taken_at);
          update public.so_report_items set raw_value=vals[1],secondary_value=vals[2],
            status_flag=attendance_private.so_status(vals[1],vals[2]), revision=revision+1,
            last_editor=person.name,last_edit_at=taken_at where id=item.id;
          edits := edits || jsonb_build_array(jsonb_build_object('item',item.item_name_snapshot,
            'before',array[item.raw_value,item.secondary_value],'after',vals));
        end if;
      end loop;
      if edits='[]'::jsonb then raise exception 'so no changes'; end if;
      update public.so_reports set updated_at=taken_at, updated_by=null,
        contributors=contributors || jsonb_build_object(person.id::text,person.name),
        filled_count=(select count(*) from public.so_report_items where report_id=report.id and status_flag <> 'unfilled')
        where id=report.id returning * into report;
      insert into public.so_revisions values(p_request,report.id,person.id,'employee',person.name,'save',taken_at,
        btrim(coalesce(p_note,'')),edits,fingerprint);
    end if;
  end if;

  if report.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',catalog_item_id,'name',item_name_snapshot,
      'category_id',category_id_snapshot,'category_name',category_name_snapshot,'unit_label',unit_snapshot,
      'unit_type',unit_type_snapshot,'revision',revision,'values',array[raw_value,secondary_value],
      'last_editor',last_editor) order by sort_order),'[]') into catalog
      from public.so_report_items where report_id=report.id;
  end if;
  return jsonb_build_object('report_id',report.id,'employee_name',person.name,'store_name',coalesce(report.store_name,shop),
    'report_date',workday,'version',version,'requires_all',coalesce(report.requires_all,rules.require_all_fields),
    'contributors',(select coalesce(jsonb_agg(value order by value),'[]') from jsonb_each_text(report.contributors)),
    'guidelines',coalesce(report.guidelines_snapshot,rules.guidelines_text),'items',catalog);
end $$;

commit;
