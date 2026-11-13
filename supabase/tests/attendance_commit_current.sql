begin;
do $$
declare shop uuid:=gen_random_uuid(); employee uuid:=gen_random_uuid(); token text:=repeat('e',64); attempt uuid:=gen_random_uuid(); r jsonb;
begin
 insert into public.stores(id,name) values(shop,'Transaction fixture');
 insert into public.employees(id,name,store_id) values(employee,'Transaction fixture',shop);
 perform public.attendance_select_employee(shop,employee,token);
 perform public.attendance_prepare(token,attempt,'IN');
 perform public.attendance_get_intent(token,attempt);
 r:=public.attendance_commit(token,attempt,-6,106,20);
 if r is distinct from public.attendance_commit(token,attempt,-6,106,20) then raise exception 'retry mismatch'; end if;
 attempt:=gen_random_uuid();
 perform public.attendance_prepare(token,attempt,'OUT');
 perform public.attendance_commit(token,attempt,-6,106,20);
 if (select count(*) from public.attendance_evidence where attendance_id=(r->>'attendance_id')::uuid)<>2 then raise exception 'missing evidence'; end if;
end $$;
rollback;
