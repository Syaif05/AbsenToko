begin;

-- Retain failed intents until the Storage cleanup confirms removal.
-- Completed intents are temporary receipts, separate from attendance evidence.
create function public.attendance_prune_technical_data()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from attendance_private.upload_intents
  where result is not null and expires_at < now() - interval '1 day';

  delete from attendance_private.sessions s
  where expires_at < now() - interval '1 day'
    and not exists (
      select 1 from attendance_private.upload_intents i where i.session_hash = s.token_hash
    );

  delete from attendance_private.rate_limits
  where resets_at < now() - interval '1 day';
end
$$;
revoke all on function public.attendance_prune_technical_data() from public, anon, authenticated, service_role;
grant execute on function public.attendance_prune_technical_data() to service_role;

commit;
