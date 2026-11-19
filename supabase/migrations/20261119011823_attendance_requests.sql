begin;
create table public.attendance_requests (
 id uuid primary key, employee_id uuid not null references public.employees(id), store_id uuid references public.stores(id) on delete set null,
 work_date date not null, kind text not null check(kind in ('SHIFT','OUT')), check_in_at timestamptz, check_out_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 5 and 500), status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default clock_timestamp(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id), review_note text,
 attendance_id uuid, check(check_in_at is null or check_out_at>=check_in_at)
);
create unique index attendance_request_pending on public.attendance_requests(employee_id,work_date) where status='pending';
alter table public.attendance_requests enable row level security;
revoke all on public.attendance_requests from public,anon,authenticated;
grant select on public.attendance_requests to authenticated;
create policy owner_read_requests on public.attendance_requests for select to authenticated using(exists(select 1 from public.owner_profiles where user_id=(select auth.uid()) and role='owner'));
create function public.employee_attendance_requests(p_hash text,p_id uuid default null,p_date date default null,p_kind text default null,p_in timestamptz default null,p_out timestamptz default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.employees; prior public.attendance_requests; entry public.attendance; today date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date;
begin
 select e.* into person from attendance_private.sessions s join public.employees e on e.id=s.employee_id
 where s.token_hash=p_hash and s.expires_at>clock_timestamp() and s.consumed_at is null and e.is_active and e.archived_at is null for update of e;
 if not found then raise exception 'invalid session'; end if;
 if p_id is not null then
 select * into prior from public.attendance_requests where id=p_id;
 if found then
 if prior.employee_id<>person.id or prior.work_date is distinct from p_date or prior.kind is distinct from p_kind or prior.check_in_at is distinct from p_in or prior.check_out_at is distinct from p_out or prior.reason is distinct from btrim(p_reason) then raise exception 'request conflict'; end if;
 else
 if p_date is null or p_date<today-7 or p_date>=today or p_kind is null or p_kind not in ('SHIFT','OUT') or p_out is null or not isfinite(p_out) or p_out>clock_timestamp() or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'invalid request'; end if;
 select * into entry from public.attendance where employee_id=person.id and work_date=p_date;
 if p_kind='SHIFT' then
 if entry.id is not null or p_in is null or not isfinite(p_in) or (p_in at time zone 'Asia/Jakarta')::date<>p_date then raise exception 'attendance conflict'; end if;
 else
 if entry.id is null or entry.check_out_at is not null or p_in is not null then raise exception 'attendance conflict'; end if;
 end if;
 if p_out<coalesce(p_in,entry.check_in_at) or p_out>coalesce(p_in,entry.check_in_at)+interval '48 hours' then raise exception 'invalid checkout'; end if;
 if exists(select 1 from public.attendance_requests where employee_id=person.id and work_date=p_date and status='pending') then raise exception 'pending request'; end if;
 insert into public.attendance_requests(id,employee_id,store_id,work_date,kind,check_in_at,check_out_at,reason,attendance_id)
 values(p_id,person.id,case when p_kind='OUT' then entry.store_id else person.store_id end,p_date,p_kind,p_in,p_out,btrim(p_reason),case when p_kind='OUT' then entry.id end);
 end if;
 end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (select id,work_date,kind,check_in_at,check_out_at,reason,status,created_at,review_note from public.attendance_requests where employee_id=person.id order by created_at desc limit 30) r),'[]'::jsonb);
end $$;
create function public.owner_review_attendance_request(p_owner uuid,p_id uuid,p_approve boolean,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.attendance_requests; person public.employees; target uuid; entry public.attendance; note text:=btrim(p_note);
begin
 perform 1 from public.owner_profiles where user_id=p_owner and role='owner' for share;
 if not found then raise exception 'owner required'; end if;
 if p_approve is null or note is null or length(note) not between 5 and 500 then raise exception 'invalid review'; end if;
 select employee_id into target from public.attendance_requests where id=p_id;
 select * into person from public.employees where id=target for update;
 select * into req from public.attendance_requests where id=p_id for update;
 if not found then raise exception 'request unavailable'; end if;
 if req.status<>'pending' then
 if req.reviewed_by=p_owner and req.review_note=note and req.status=(case when p_approve then 'approved' else 'rejected' end) then return jsonb_build_object('ok',true); end if;
 raise exception 'already reviewed'; end if;
 if p_approve then
 if req.kind='OUT' then
 perform public.owner_confirm_checkout(p_owner,req.id,req.attendance_id,req.check_out_at,'Pengajuan karyawan: '||left(req.reason,200)||' | Owner: '||left(note,200));
 else
 if person.store_id is distinct from req.store_id or not person.is_active or person.archived_at is not null then raise exception 'employee changed'; end if;
 if exists(select 1 from public.attendance where employee_id=req.employee_id and (work_date=req.work_date or (check_in_at<req.check_out_at and coalesce(check_out_at,check_in_at+make_interval(secs=>(select work_window_seconds from attendance_private.settings)))>req.check_in_at))) then raise exception 'attendance conflict'; end if;
 insert into public.attendance(employee_id,check_in_at,check_out_at,closed_at,owner_confirmed_at,owner_confirmed_by,owner_confirmation_reason)
 values(req.employee_id,req.check_in_at,req.check_out_at,clock_timestamp(),clock_timestamp(),p_owner,'Pengajuan karyawan: '||left(req.reason,200)||' | Owner: '||left(note,200)) returning * into entry;
 update public.attendance_requests set attendance_id=entry.id where id=req.id;
 end if;
 end if;
 update public.attendance_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=p_owner,reviewed_at=clock_timestamp(),review_note=note where id=req.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.employee_attendance_requests(text,uuid,date,text,timestamptz,timestamptz,text),public.owner_review_attendance_request(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.employee_attendance_requests(text,uuid,date,text,timestamptz,timestamptz,text),public.owner_review_attendance_request(uuid,uuid,boolean,text) to service_role;
commit;
