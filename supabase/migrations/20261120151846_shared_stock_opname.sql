begin;

alter table public.so_reports
  add column catalog_version text,
  add column contributors jsonb not null default '{}',
  add column requires_all boolean not null default true,
  add column filled_count integer not null default 0,
  add column item_count integer not null default 0;
alter table public.so_reports add column search_names text generated always as
  (employee_name || ' ' || contributors::text) stored;
alter table public.so_reports drop constraint so_reports_employee_id_store_id_report_date_key;
create unique index so_reports_individual_day on public.so_reports(employee_id, store_id, report_date)
  where catalog_version is null;
create unique index so_reports_shared_day on public.so_reports(store_id, report_date)
  where catalog_version is not null;

alter table public.so_report_items
  add column catalog_item_id uuid,
  add column revision integer not null default 0,
  add column last_editor text,
  add column last_edit_at timestamptz;
create unique index so_report_items_catalog_key on public.so_report_items(report_id, catalog_item_id);

-- Keep history even when an Owner deletes the report. Browser users can only read it as Owner.
create table public.so_revisions (
  id uuid primary key,
  report_id uuid not null,
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('employee','owner')),
  actor_name text not null,
  action text not null check (action in ('save','edit','delete')),
  recorded_at timestamptz not null,
  note text not null,
  changes jsonb not null,
  request_fingerprint text
);
create index so_revisions_report_date on public.so_revisions(report_id, recorded_at desc, id);
alter table public.so_revisions enable row level security;
revoke all on public.so_revisions from public, anon, authenticated, service_role;
grant select on public.so_revisions to authenticated;
create policy so_owner_read on public.so_revisions for select to authenticated using
  (exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'));

create or replace function attendance_private.so_status(p_value text, p_secondary text)
returns text language sql immutable set search_path='' as $$
  select case
    when p_value is null and p_secondary is null then 'unfilled'
    when replace(coalesce(p_secondary,'-'),'.','') ~ '^(-|0+)$' and replace(coalesce(p_value,'-'),'.','') ~ '^(-|0+|0+/[1-9][0-9]*)$' then 'empty'
    when p_value ~ '^[0-9]+/[1-9][0-9]*$' then
      case when split_part(p_value,'/',1)::numeric * 2 <= split_part(p_value,'/',2)::numeric then 'low' else 'ok' end
    else 'ok'
  end
$$;

create function public.employee_shared_stock(p_hash text, p_request uuid default null,
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
revoke all on function public.employee_shared_stock(text,uuid,uuid,text,date,jsonb,text) from public,anon,authenticated;
grant execute on function public.employee_shared_stock(text,uuid,uuid,text,date,jsonb,text) to service_role;

-- Retain the original routine signature for existing installations during rollout.
create or replace function public.owner_update_stock_opname(p_owner uuid,p_id uuid,p_version timestamptz,
  p_delete boolean,p_values jsonb default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  report public.so_reports;
  item public.so_report_items;
  vals text[];
  taken_at timestamptz;
  edits jsonb := '[]';
  old_items jsonb;
begin
  perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
  if not found then raise exception 'owner required'; end if;
  select * into report from public.so_reports where id=p_id for update;
  if not found or p_version is distinct from report.updated_at then raise exception 'so stale report'; end if;
  taken_at := clock_timestamp();
  if p_delete is true then
    select coalesce(jsonb_agg(to_jsonb(i) order by sort_order),'[]') into old_items
      from public.so_report_items i where report_id=p_id;
    insert into public.so_revisions values(gen_random_uuid(),p_id,p_owner,'owner','Owner','delete',taken_at,
      '',jsonb_build_object('report',to_jsonb(report),'items',old_items),null);
    delete from public.so_reports where id=p_id;
    return jsonb_build_object('ok',true);
  end if;
  if jsonb_typeof(p_values) is distinct from 'object' or length(coalesce(p_notes,''))>500
    or (select count(*) from jsonb_object_keys(p_values)) <> (select count(*) from public.so_report_items where report_id=p_id)
    then raise exception 'so invalid value'; end if;
  for item in select * from public.so_report_items where report_id=p_id loop
    if not (p_values ? item.id::text) then raise exception 'so invalid value'; end if;
    vals := attendance_private.so_values(p_values->item.id::text,item.unit_type_snapshot,false);
    if array[item.raw_value,item.secondary_value] is distinct from vals then
      update public.so_report_items set raw_value=vals[1],secondary_value=vals[2],
        status_flag=attendance_private.so_status(vals[1],vals[2]),revision=revision+1,
        last_editor='Owner',last_edit_at=taken_at where id=item.id;
      edits := edits || jsonb_build_array(jsonb_build_object('item',item.item_name_snapshot,
        'before',array[item.raw_value,item.secondary_value],'after',vals));
    end if;
  end loop;
  if report.notes is distinct from btrim(coalesce(p_notes,'')) then
    edits := edits || jsonb_build_array(jsonb_build_object('item','Catatan laporan',
      'before',array[report.notes],'after',array[btrim(coalesce(p_notes,''))]));
  end if;
  if edits <> '[]'::jsonb then
    update public.so_reports set notes=btrim(coalesce(p_notes,'')),updated_at=taken_at,updated_by=p_owner,
      filled_count=(select count(*) from public.so_report_items where report_id=p_id and status_flag <> 'unfilled')
      where id=p_id;
    insert into public.so_revisions values(gen_random_uuid(),p_id,p_owner,'owner','Owner','edit',taken_at,'',edits,null);
  end if;
  return jsonb_build_object('ok',true);
end $$;

commit;
