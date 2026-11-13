-- Run only against the named synthetic QA fixture. All mutations roll back.
begin;
do $test$
declare
 base jsonb:='{"trip_id":"791e21bb-b93e-470b-a22e-5dbad90b8863","plan_id":"93d9c27c-b9be-4799-8d26-7cbaf0e41eea","step_id":"step_13","expected_revision":0,"status":"booked","provider_name":"TEST QA direct hotel","amount_paise":420025,"booked_by":"18d569d2-5f3e-474d-9688-e5cf249e7527","reference":"TEST-NOT-A-RESERVATION","notes":"TEST transaction, rolled back"}';
 payload jsonb;bad jsonb;got jsonb;denied boolean;oldplan uuid;counttests int:=0;conflict_detail text;
begin
 if not exists(select 1 from public.planzo_trips where id=(base->>'trip_id')::uuid and name like 'TEST %Phase 3 booking QA 1fcb41f1' and created_by='8d80db6b-2cf2-4dc5-b0b5-16a7fa82f2b5') then raise exception 'Expected labelled QA fixture is missing';end if;
 -- Reset only this synthetic fixture inside the rollback-only transaction.
 -- Its existing browser-test records are restored by the final ROLLBACK.
 delete from planzo_private.flow_booking_events where trip_id=(base->>'trip_id')::uuid;
 perform set_config('request.jwt.claim.sub','8d80db6b-2cf2-4dc5-b0b5-16a7fa82f2b5',true);
 if has_table_privilege('authenticated','planzo_private.flow_booking_events','SELECT') or has_function_privilege('anon','public.planzo_booking_tracker(text,jsonb)','EXECUTE') or has_function_privilege('authenticated','planzo_private.booking_tracker_state(uuid,uuid)','EXECUTE') then raise exception 'grant regression';end if;counttests:=counttests+1;
 payload:=base||jsonb_build_object('request_id',gen_random_uuid());
 got:=public.planzo_booking_tracker('save',payload);
 if jsonb_array_length(got->'records')<>1 or got#>>'{records,0,amount_paise}'<>'420025' or got#>>'{records,0,actor}'<>'8d80db6b-2cf2-4dc5-b0b5-16a7fa82f2b5' then raise exception 'save regression';end if;counttests:=counttests+1;
 got:=public.planzo_booking_tracker('save',payload);
 if jsonb_array_length(got->'history')<>1 then raise exception 'idempotency regression';end if;counttests:=counttests+1;
 denied:=false;begin perform public.planzo_booking_tracker('save',base||jsonb_build_object('request_id',gen_random_uuid()));exception when sqlstate 'PGRST' then get stacked diagnostics conflict_detail=pg_exception_detail;denied:=(sqlerrm::jsonb->>'code'='40001' and conflict_detail::jsonb->>'status'='409');end;
 if not denied then raise exception 'Stale booking did not expose HTTP 409';end if;counttests:=counttests+1;
 for bad in select value from jsonb_array_elements('[
  {"actor":"18d569d2-5f3e-474d-9688-e5cf249e7527"},{"step_id":"unknown"},{"step_id":"step_5"},{"step_id":"step_7"},
  {"booked_by":"00000000-0000-0000-0000-000000000001"},{"amount_paise":-1},{"amount_paise":0.5},{"amount_paise":10000000001},
  {"status":"invented"},{"provider_name":""},{"amount_paise":null},{"booked_by":null},{"expected_revision":0}
 ]'::jsonb) loop
  denied:=false;
  begin perform public.planzo_booking_tracker('save',base||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',1)||bad);
  exception when others then denied:=true;end;
  if not denied then raise exception 'accepted invalid payload: %',bad;end if;counttests:=counttests+1;
 end loop;
 denied:=false;begin perform public.planzo_booking_tracker('save',payload||'{"notes":"changed payload"}'::jsonb);exception when others then denied:=true;end;
 if not denied then raise exception 'idempotency hash regression';end if;counttests:=counttests+1;
 perform set_config('request.jwt.claim.sub','18d569d2-5f3e-474d-9688-e5cf249e7527',true);
 got:=public.planzo_booking_tracker('save',base||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',1,'status','cancelled','notes','TEST member cancellation'));
 if jsonb_array_length(got->'history')<>2 or got#>>'{records,0,revision}'<>'2' or got#>>'{records,0,actor}'<>'18d569d2-5f3e-474d-9688-e5cf249e7527' then raise exception 'shared update/history regression';end if;counttests:=counttests+1;
 select id into oldplan from planzo_private.flow_plans where trip_id=(base->>'trip_id')::uuid and version=1;
 got:=public.planzo_booking_tracker('get',jsonb_build_object('trip_id',base->>'trip_id','plan_id',oldplan));
 if jsonb_array_length(got->'records')<>0 or (got->>'editable')::boolean then raise exception 'version isolation regression';end if;counttests:=counttests+1;
 denied:=false;begin perform public.planzo_booking_tracker('save',base||jsonb_build_object('request_id',gen_random_uuid(),'plan_id',oldplan));exception when others then denied:=true;end;
 if not denied then raise exception 'old version writable';end if;counttests:=counttests+1;
 update public.planzo_trip_members set included=false where trip_id=(base->>'trip_id')::uuid and user_id='18d569d2-5f3e-474d-9688-e5cf249e7527';
 denied:=false;begin perform public.planzo_booking_tracker('get',jsonb_build_object('trip_id',base->>'trip_id','plan_id',base->>'plan_id'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'excluded member access';end if;counttests:=counttests+1;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 denied:=false;begin perform public.planzo_booking_tracker('get',jsonb_build_object('trip_id',base->>'trip_id','plan_id',base->>'plan_id'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'outsider access';end if;counttests:=counttests+1;
 perform set_config('request.jwt.claim.sub','8d80db6b-2cf2-4dc5-b0b5-16a7fa82f2b5',true);
 update public.planzo_trips set stage='archived',removal_kind='archived',removed_at=now() where id=(base->>'trip_id')::uuid;
 got:=public.planzo_booking_tracker('get',jsonb_build_object('trip_id',base->>'trip_id','plan_id',base->>'plan_id'));
 if (got->>'editable')::boolean then raise exception 'archive writable';end if;counttests:=counttests+1;
 denied:=false;begin perform public.planzo_booking_tracker('save',base||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',2));exception when others then denied:=true;end;
 if not denied then raise exception 'archive save';end if;counttests:=counttests+1;
 perform set_config('planzo.qa_booking_checks',counttests::text,true);
end;$test$;
select current_setting('planzo.qa_booking_checks')::int as checks_passed, 'All test records, roster and archive changes rolled back' as cleanup;
rollback;
