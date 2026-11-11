begin;
-- The identity is always derived from the hashed session, never from client IDs.
create function public.attendance_my_schedule(p_hash text, p_month date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.employees; shop public.stores; days jsonb;
begin
  select e.* into person from attendance_private.sessions s
    join public.employees e on e.id=s.employee_id
    join public.stores t on t.id=e.store_id
    where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null
      and e.is_active and e.archived_at is null and t.archived_at is null;
  if not found then raise exception 'invalid session'; end if;
  if p_month is null or extract(day from p_month)<>1 or p_month < date '2000-01-01' or p_month >= date '2100-01-01' then
    raise exception 'invalid month';
  end if;
  select * into shop from public.stores where id=person.store_id;
  select coalesce(jsonb_agg(jsonb_build_object('date',work_date,'code',code) order by work_date),'[]'::jsonb)
    into days from public.shift_schedule where employee_id=person.id and store_id=person.store_id
      and work_date>=p_month and work_date<(p_month+interval '1 month')::date;
  return jsonb_build_object('employee',jsonb_build_object('id',person.id,'name',person.name),
    'store',jsonb_build_object('id',shop.id,'name',shop.name),'days',days);
end $$;
revoke all on function public.attendance_my_schedule(text,date) from public,anon,authenticated;
grant execute on function public.attendance_my_schedule(text,date) to service_role;
commit;
