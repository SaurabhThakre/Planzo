-- Four existing synthetic QA identities. Run via tests/prepare-group-workflow.mjs to date the fixture.
-- Public RPC admission + real database validators. Provider output is a deterministic fixture, not a Gemini call.
begin;
do $test$
declare
 host uuid:='8d80db6b-2cf2-4dc5-b0b5-16a7fa82f2b5';m1 uuid:='18d569d2-5f3e-474d-9688-e5cf249e7527';m2 uuid:='c52fd525-4ea7-4b73-8e32-1cd1a7320ebc';m3 uuid:='a028d463-9554-4d2c-bc10-95dc6e3a1de6';
 people uuid[];person uuid;trip uuid;win uuid:=gen_random_uuid();win2 uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();pid uuid;
 createbody jsonb;body jsonb;input jsonb;bad jsonb;s jsonb;stale jsonb;response jsonb;context jsonb;choice jsonb:='__CHOICE__'::jsonb;
 token text;revoked text;denied boolean;checked int:=0;i int;before_count int;
begin
 people:=array[host,m1,m2,m3];perform set_config('request.jwt.claim.sub',host::text,true);
 createbody:=jsonb_build_object('request_id',rid,'name','TEST - Four-traveller exception QA','destination','Japan','minimum',3,'tentative_days',7,'deadline',now()+interval '7 days','windows',jsonb_build_array(jsonb_build_object('id',win,'start','__START__','end','__END__'),jsonb_build_object('id',win2,'start',('__START__'::timestamptz+interval '14 days'),'end',('__END__'::timestamptz+interval '14 days'))));
 for bad in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('minimum',0),jsonb_build_object('deadline',now()-interval '1 day'),jsonb_build_object('windows','[]'::jsonb),jsonb_build_object('windows',jsonb_build_array(jsonb_build_object('id',win,'start','__END__','end','__START__'))))) loop
  denied:=false;begin perform public.planzo_api('create_trip',createbody||bad);exception when others then denied:=true;end;
  if not denied then raise exception 'Invalid creation accepted %',bad;end if;checked:=checked+1;
 end loop;
 response:=public.planzo_api('create_trip',createbody);trip:=(response->>'trip_id')::uuid;
 if public.planzo_api('create_trip',createbody)<>response then raise exception 'Duplicate create generated another trip';end if;checked:=checked+1;
 response:=public.planzo_api('create_invite',jsonb_build_object('trip_id',trip));token:=response->>'token';
 if token is null then raise exception 'Invite missing';end if;
 foreach person in array array[m1,m2,m3] loop
  perform set_config('request.jwt.claim.sub',person::text,true);perform public.planzo_api('join',jsonb_build_object('token',token,'name','TEST traveller'));
  perform public.planzo_api('join',jsonb_build_object('token',token,'name','TEST traveller'));
 end loop;
 if (select count(*) from public.planzo_trip_members where trip_id=trip)<>4 then raise exception 'Join idempotency';end if;checked:=checked+1;
 perform set_config('request.jwt.claim.sub',host::text,true);response:=public.planzo_api('create_invite',jsonb_build_object('trip_id',trip));revoked:=response->>'token';
 perform public.planzo_api('revoke_invite',jsonb_build_object('trip_id',trip,'invite_id',response->>'id'));
 denied:=false;begin perform public.planzo_api('join',jsonb_build_object('token',revoked,'name','TEST'));exception when others then denied:=true;end;
 if not denied then raise exception 'Revoked invitation accepted';end if;checked:=checked+1;
 perform set_config('request.jwt.claim.sub',m1::text,true);denied:=false;
 begin perform public.planzo_api('create_invite',jsonb_build_object('trip_id',trip));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Member created invitation';end if;checked:=checked+1;
 s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 denied:=false;begin perform public.planzo_flow('generate_reserve',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Member generated plan';end if;checked:=checked+1;
 input:=jsonb_build_object('version',3,'origin','PRIVATE_ORIGIN_CANARY','window_id',win,'start','__START__','end','__END__','outbound_minutes',0,'return_minutes',0,'ceiling_paise',50000000,'travel_reserve_paise',0,'interests','[]'::jsonb,'places','[]'::jsonb,'hard','PRIVATE_HARD_CANARY','soft','PRIVATE_SOFT_CANARY','fictional',true,'ai_consent',true,'requests_reviewed',true,'requests',jsonb_build_array(jsonb_build_object('title','TEST iconic highlights and transfer timings','kind','activity','priority','hard'),jsonb_build_object('title','TEST Tokyo nightlife','kind','activity','priority','soft')));
 perform set_config('request.jwt.claim.sub',host::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 for bad in select value from jsonb_array_elements(jsonb_build_array('{"ceiling_paise":0}'::jsonb,'{"ceiling_paise":99}'::jsonb,'{"ceiling_paise":100.5}'::jsonb,'{"travel_reserve_paise":1}'::jsonb,'{"requests_reviewed":false}'::jsonb,'{"hard":""}'::jsonb,jsonb_build_object('start','__END__'),jsonb_build_object('window_id',gen_random_uuid()),jsonb_build_object('requests',jsonb_build_array(input#>'{requests,0}',input#>'{requests,0}')),jsonb_build_object('requests',(select jsonb_agg(jsonb_build_object('title','Request '||n,'kind','activity','priority','soft')) from generate_series(1,21)n)))) loop
  denied:=false;begin perform public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',0,'content',input||bad,'acknowledged',true));exception when others then denied:=true;end;
  if not denied then raise exception 'Bad input accepted %',bad;end if;checked:=checked+1;
 end loop;
 foreach person in array people loop
  perform set_config('request.jwt.claim.sub',person::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
  body:=jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',0,'content',input,'acknowledged',true);
  response:=public.planzo_flow('confirm_input',body);perform public.planzo_flow('confirm_input',body);
  if (select revision from planzo_private.flow_inputs where trip_id=trip and user_id=person)<>1 then raise exception 'Repeated confirmation created input twice';end if;checked:=checked+1;
  if person<>host and response#>>'{own,content,origin}'<>'PRIVATE_ORIGIN_CANARY' then raise exception 'Own private input missing';end if;
  if person=host then
   denied:=false;begin perform public.planzo_flow('generate_reserve',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',response->'revision','expected_stamp',response->'stamp'));exception when others then denied:=true;end;
   if not denied then raise exception 'Incomplete group admitted';end if;checked:=checked+1;
   stale:=body;
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',host::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 if s->>'blocker' is not null or jsonb_array_length(s#>'{context,refs}')<>2 then raise exception 'Shared duplicate requests did not merge';end if;checked:=checked+1;
 if (s->'context')::text like '%PRIVATE_%' or (public.planzo_api('workspace',jsonb_build_object('trip_id',trip)))::text like '%PRIVATE_%' then raise exception 'Private input leaked into shared context/workspace';end if;checked:=checked+1;
 denied:=false;begin perform public.planzo_flow('confirm_input',stale||jsonb_build_object('request_id',gen_random_uuid(),'expected_input_revision',1));exception when sqlstate 'PGRST' then denied:=sqlerrm::jsonb->>'code'='40001';end;
 if not denied then raise exception 'Stale other-user update overwrote current trip';end if;checked:=checked+1;
 -- Different tentative windows and disjoint hours within the same window both block planning.
 perform set_config('request.jwt.claim.sub',m3::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 s:=public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',1,'content',input||jsonb_build_object('window_id',win2,'start',('__START__'::timestamptz+interval '14 days'),'end',('__END__'::timestamptz+interval '14 days')),'acknowledged',true));
 if s->>'blocker' is null or s->'context'<>'null'::jsonb then raise exception 'Mismatched windows did not block';end if;checked:=checked+1;
 s:=public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',2,'content',input||jsonb_build_object('start',('__END__'::timestamptz-interval '2 hours')),'acknowledged',true));
 perform set_config('request.jwt.claim.sub',m2::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 s:=public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',1,'content',input||jsonb_build_object('end',('__START__'::timestamptz+interval '2 hours')),'acknowledged',true));
 if s->>'blocker' is null then raise exception 'Disjoint availability did not block';end if;checked:=checked+1;
 foreach person in array array[m2,m3] loop
  perform set_config('request.jwt.claim.sub',person::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
  s:=public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','content',input,'acknowledged',true));
 end loop;
 -- Keep a valid plan, but prove tiny budgets cannot be approved or locked.
 perform set_config('request.jwt.claim.sub',m1::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 s:=public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','content',input||'{"ceiling_paise":100}'::jsonb,'acknowledged',true));
 perform set_config('request.jwt.claim.sub',host::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));rid:=gen_random_uuid();
 context:=public.planzo_flow('generate_reserve',jsonb_build_object('trip_id',trip,'request_id',rid,'expected_revision',s->'revision','expected_stamp',s->'stamp'));
 body:=jsonb_build_object('trip_id',trip,'request_id',rid,'expected_revision',s->'revision','expected_stamp',s->'stamp','choice',choice);
 denied:=false;begin response:=public.planzo_flow('generate_finish',body);exception when others then denied:=true;end;
 if not denied then
  perform set_config('request.jwt.claim.sub',m1::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
  if not (s#>>'{plan,own_over_budget}')::boolean then raise exception 'Tiny budget was silently approved';end if;
  denied:=false;begin perform public.planzo_flow('review',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','plan_id',s#>'{plan,id}','response','ready','accept_exclusions',true,'acknowledged',true));exception when others then denied:=true;end;
  if not denied then raise exception 'Over-budget approval accepted';end if;
 end if;checked:=checked+1;
 perform set_config('request.jwt.claim.sub',m1::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 s:=public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','content',input,'acknowledged',true));
 perform set_config('request.jwt.claim.sub',host::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));rid:=gen_random_uuid();
 -- QA-only admission receipt; no external provider call; previous receipt still in the 3-second rate window.
 insert into planzo_private.flow_ai_receipts(actor,request_id,trip_id,stamp) values(host,rid,trip,s->>'stamp');
 s:=public.planzo_flow('generate_finish',jsonb_build_object('trip_id',trip,'request_id',rid,'expected_revision',s->'revision','expected_stamp',s->'stamp','choice',choice));pid:=(s#>>'{plan,id}')::uuid;
 if pid is null then raise exception 'Valid deterministic route was not saved';end if;checked:=checked+1;
 denied:=false;begin perform public.planzo_flow('lock',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','plan_id',pid,'acknowledged',true));exception when others then denied:=true;end;
 if not denied then raise exception 'Locked without everyone reviewing';end if;checked:=checked+1;
 -- A decline stays explicit. The organiser can change roster before a locked trip.
 perform set_config('request.jwt.claim.sub',m3::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 s:=public.planzo_flow('review',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','plan_id',pid,'response','decline','acknowledged',true));
 if s#>>'{plan,decline_count}'<>'1' then raise exception 'Decline lost';end if;checked:=checked+1;
 perform set_config('request.jwt.claim.sub',host::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 for bad in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_array(host,m1),jsonb_build_array(m1,m2,m3),jsonb_build_array(host,m1,m1),jsonb_build_array(host,m1,gen_random_uuid()))) loop
  denied:=false;begin perform public.planzo_flow('set_roster',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','roster',bad,'acknowledged',true));exception when others then denied:=true;end;
  if not denied then raise exception 'Invalid roster accepted %',bad;end if;checked:=checked+1;
 end loop;
 s:=public.planzo_flow('set_roster',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','roster',jsonb_build_array(host,m1,m2),'acknowledged',true));
 if s->>'confirmed'<>'0' or s->>'included'<>'3' or s->'plan'<>'null'::jsonb then raise exception 'Roster change did not invalidate inputs and plan';end if;checked:=checked+1;
 perform set_config('request.jwt.claim.sub',m3::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));denied:=false;
 begin perform public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','content',input,'acknowledged',true));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Excluded traveller contributed';end if;checked:=checked+1;
 foreach person in array array[host,m1,m2] loop
  perform set_config('request.jwt.claim.sub',person::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
  s:=public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','content',input,'acknowledged',true));
 end loop;
 perform set_config('request.jwt.claim.sub',host::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));rid:=gen_random_uuid();
 insert into planzo_private.flow_ai_receipts(actor,request_id,trip_id,stamp) values(host,rid,trip,s->>'stamp');
 s:=public.planzo_flow('generate_finish',jsonb_build_object('trip_id',trip,'request_id',rid,'expected_revision',s->'revision','expected_stamp',s->'stamp','choice',choice));pid:=(s#>>'{plan,id}')::uuid;
 foreach person in array array[host,m1,m2] loop
  perform set_config('request.jwt.claim.sub',person::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
  s:=public.planzo_flow('review',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','plan_id',pid,'response','ready','accept_exclusions',true,'acknowledged',true));
 end loop;
 perform set_config('request.jwt.claim.sub',host::text,true);s:=public.planzo_flow('get',jsonb_build_object('trip_id',trip));
 s:=public.planzo_flow('lock',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','plan_id',pid,'acknowledged',true));
 if s->>'stage'<>'agreed' or not (s#>>'{plan,locked}')::boolean then raise exception 'Exact-version lock failed';end if;checked:=checked+1;
 denied:=false;begin perform public.planzo_flow('set_roster',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','roster',to_jsonb(people),'acknowledged',true));exception when others then denied:=true;end;
 if not denied then raise exception 'Locked roster changed silently';end if;checked:=checked+1;
 -- Expired deadline and postponed trips preserve history and block fresh inputs.
 s:=public.planzo_flow('reopen_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','acknowledged',true));
 if s->'plan'<>'null'::jsonb or jsonb_array_length(s->'history')<1 then raise exception 'Reopen did not preserve old history';end if;checked:=checked+1;
 update public.planzo_trips set response_deadline=now()-interval '1 second' where id=trip;
 denied:=false;begin perform public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','content',input,'acknowledged',true));exception when others then denied:=true;end;
 if not denied then raise exception 'Expired input accepted';end if;checked:=checked+1;
 s:=public.planzo_flow('extend_deadline',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','deadline',now()+interval '8 days','acknowledged',true));checked:=checked+1;
 s:=public.planzo_flow('postpone',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_stamp',s->'stamp','acknowledged',true));
 if s->>'stage'<>'postponed' then raise exception 'Postpone failed';end if;checked:=checked+1;
 denied:=false;begin perform public.planzo_flow('confirm_input',jsonb_build_object('trip_id',trip,'request_id',gen_random_uuid(),'expected_revision',s->'revision','expected_input_revision',s#>'{own,revision}','content',input,'acknowledged',true));exception when others then denied:=true;end;
 if not denied then raise exception 'Postponed trip writable';end if;checked:=checked+1;
 perform set_config('request.jwt.claim.sub','',true);denied:=false;
 begin perform public.planzo_flow('get',jsonb_build_object('trip_id',trip));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Signed-out flow accessible';end if;checked:=checked+1;
 perform set_config('planzo.group_checks',checked::text,true);
end;$test$;
select current_setting('planzo.group_checks')::int as checks_passed,'Rollback-only four-traveller workflow; no provider call' as scope;
rollback;
