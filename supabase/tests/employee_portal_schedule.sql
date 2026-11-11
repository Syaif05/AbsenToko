begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); result jsonb;
begin
  insert into public.stores(id,name) values(shop,'Portal test');
  insert into public.employees(id,name,store_id) values(a,'Karyawan A',shop),(b,'Karyawan B',shop);
  insert into attendance_private.sessions(token_hash,employee_id,expires_at) values(repeat('d',64),a,now()+interval '1 hour');
  insert into public.shift_schedule values(shop,a,'2026-11-01','P'),(shop,b,'2026-11-01','S'),(shop,a,'2026-12-01','O');
  result:=public.attendance_my_schedule(repeat('d',64),'2026-11-01');
  if result->'employee'->>'id'<>a::text or jsonb_array_length(result->'days')<>1 or result->'days'->0->>'code'<>'P' then raise exception 'schedule isolation failed'; end if;
  if jsonb_array_length(public.attendance_my_schedule(repeat('d',64),'2027-01-01')->'days')<>0 then raise exception 'empty month failed'; end if;
  begin
    perform public.attendance_my_schedule(repeat('d',64),'2026-11-02');
    raise exception 'invalid month allowed';
  exception when raise_exception then if sqlerrm<>'invalid month' then raise; end if; end;
  update attendance_private.sessions set consumed_at=now() where employee_id=a;
  begin
    perform public.attendance_my_schedule(repeat('d',64),'2026-11-01');
    raise exception 'revoked session allowed';
  exception when raise_exception then if sqlerrm<>'invalid session' then raise; end if; end;
  update attendance_private.sessions set consumed_at=null,expires_at=now()-interval '1 minute' where employee_id=a;
  begin
    perform public.attendance_my_schedule(repeat('d',64),'2026-11-01');
    raise exception 'expired session allowed';
  exception when raise_exception then if sqlerrm<>'invalid session' then raise; end if; end;
  update attendance_private.sessions set expires_at=now()+interval '1 hour' where employee_id=a;
  update public.employees set is_active=false where id=a;
  begin
    perform public.attendance_my_schedule(repeat('d',64),'2026-11-01');
    raise exception 'inactive employee allowed';
  exception when raise_exception then if sqlerrm<>'invalid session' then raise; end if; end;
  if has_function_privilege('anon','public.attendance_my_schedule(text,date)','execute') or has_function_privilege('authenticated','public.attendance_my_schedule(text,date)','execute') then raise exception 'public RPC exposed'; end if;
end $$;
rollback;
