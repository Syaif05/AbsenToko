begin;
create or replace function public.attendance_get_intent(p_hash text,p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent attendance_private.upload_intents;
begin
  perform 1 from attendance_private.sessions s join public.employees e on e.id=s.employee_id
  where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null and e.is_active and e.archived_at is null;
  if not found then raise exception 'invalid session'; end if;
  select * into intent from attendance_private.upload_intents where id=p_id and session_hash=p_hash;
  if not found or (intent.result is null and intent.expires_at<=clock_timestamp()) then raise exception 'invalid intent'; end if;
  return to_jsonb(intent)-'session_hash';
end $$;


revoke all on function public.attendance_get_intent(text,uuid) from public,anon,authenticated;
grant execute on function public.attendance_get_intent(text,uuid) to service_role;
commit;
