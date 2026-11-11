begin;
-- A committed request is also an audit receipt. Only the server may access it.
create table attendance_private.owner_change_requests (
  owner_id uuid not null references public.owner_profiles(user_id),
  request_id uuid not null,
  target_id uuid not null,
  operation text not null,
  payload_hash text not null,
  completed_at timestamptz,
  primary key (owner_id, request_id)
);
alter table attendance_private.owner_change_requests enable row level security;
revoke all on attendance_private.owner_change_requests from public, anon, authenticated;

create function public.owner_apply_change(
  p_owner uuid, p_request uuid, p_id uuid, p_operation text, p_name text, p_store uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt attendance_private.owner_change_requests;
  fingerprint text;
begin
  perform 1 from public.owner_profiles where user_id = p_owner and role = 'owner' for share;
  if not found then raise exception 'owner required'; end if;
  if p_request is null or p_id is null or p_operation is null or p_operation not in (
    'create', 'rename', 'activate', 'deactivate', 'archive_employee',
    'create_store', 'rename_store', 'archive_store'
  ) then raise exception 'invalid operation'; end if;
  if p_operation in ('create','rename','create_store','rename_store') and
    (p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]')
    then raise exception 'invalid name'; end if;
  fingerprint := md5(jsonb_build_array(p_id,p_operation,p_name,p_store)::text);
  insert into attendance_private.owner_change_requests(owner_id,request_id,target_id,operation,payload_hash)
    values(p_owner,p_request,p_id,p_operation,fingerprint) on conflict do nothing;
  select * into receipt from attendance_private.owner_change_requests
    where owner_id=p_owner and request_id=p_request for update;
  if receipt.payload_hash <> fingerprint then raise exception 'request conflict'; end if;
  if receipt.completed_at is not null then return jsonb_build_object('ok',true,'replayed',true); end if;
  perform public.owner_manage_staff(p_owner,p_id,p_operation,p_name,p_store,null);
  update attendance_private.owner_change_requests set completed_at=clock_timestamp()
    where owner_id=p_owner and request_id=p_request;
  return jsonb_build_object('ok',true,'replayed',false);
end $$;
revoke all on function public.owner_apply_change(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.owner_apply_change(uuid,uuid,uuid,text,text,uuid) to service_role;
commit;
