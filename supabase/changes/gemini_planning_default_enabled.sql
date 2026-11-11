-- Existing ACLs, input stamps, confirmed summaries and locked history are preserved.
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('planzo_private.flow_api(text,jsonb)'::regprocedure)) <> 'f8795cdc1f9548c09d1462db9aca12ee' OR md5(pg_get_functiondef('planzo_private.flow_legacy_state(uuid,uuid)'::regprocedure)) <> '71e769ecf1d30bb59d815f29fd43d7fe' THEN RAISE EXCEPTION 'Planning functions changed; review before applying.'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION planzo_private.flow_api(p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<flow_api>>
declare actor uuid:=auth.uid();trip uuid;role_name text;included boolean;t public.planzo_trips%rowtype;req uuid;receipt record;digest text;result jsonb;ctx jsonb;stamp text;
 b jsonb;own planzo_private.flow_inputs%rowtype;win public.planzo_trip_windows%rowtype;k text;s timestamptz;e timestamptz;plan planzo_private.flow_plans%rowtype;doc jsonb;
 poll planzo_private.flow_polls%rowtype;step jsonb;ref text;choice text;votes jsonb;highest integer;winner text;ties integer;roster_count integer;responded integer;v integer;newid uuid;hard boolean;ai_receipt planzo_private.flow_ai_receipts%rowtype;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception using errcode='42501',message='Sign in with a verified email.';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid request.';end if;
 trip:=(p_payload->>'trip_id')::uuid;
 select m.role,m.included into role_name,included from public.planzo_trip_members m where m.trip_id=trip and m.user_id=actor;
 if role_name is null then raise exception using errcode='42501',message='You do not have access to this trip.';end if;
 select * into t from public.planzo_trips where id=trip for update;
 if t.workflow_version<>2 then raise exception 'This trip keeps its saved original workflow.';end if;
 if p_action='get_version' then
 if exists(select 1 from jsonb_object_keys(p_payload) x where x not in ('trip_id','plan_id')) then raise exception 'Unsupported request fields.';end if;
 select * into plan from planzo_private.flow_plans p where p.trip_id=trip and p.id=(p_payload->>'plan_id')::uuid;
 if plan.id is null then raise exception 'That version is not part of this trip.';end if;
 return jsonb_build_object('version',plan.version,'document',plan.document,'locked',exists(select 1 from planzo_private.flow_locks where plan_id=plan.id));
 end if;
 if p_action='get' then
 if exists(select 1 from jsonb_object_keys(p_payload) x where x<>'trip_id') then raise exception 'Unsupported request fields.';end if;
 return planzo_private.flow_state(trip,actor);end if;
 if p_action not in ('confirm_input','reopen_input','generate_reserve','generate_finish','vote','close_poll','raise_concern','resolve_personal','review','lock','extend_deadline','postpone','set_roster') then raise exception 'Unsupported planning action.';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) x where x not in ('trip_id','request_id','expected_revision','expected_input_revision','expected_stamp','content','acknowledged','choice','poll_id','expected_ballot_revision','step_id','replacement','hard','deadline','plan_id','accept_exclusions','concern_note','share_concern','response','roster')) then raise exception 'Unsupported request fields.';end if;
 req:=(p_payload->>'request_id')::uuid;if req is null then raise exception 'A request identifier is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
 digest:=md5(p_payload::text);select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
 if found then if receipt.action<>'flow:'||p_action or receipt.result->>'digest'<>digest then raise exception 'This request identifier was already used.';end if;return receipt.result->'response';end if;
 if t.stage in ('postponed','archived') then raise exception 'This trip is postponed or archived. Saved input and history are read-only.';end if;
 if (p_payload->>'expected_revision')::integer is distinct from t.revision then raise exception using errcode='40001',message='The trip changed. Refresh before saving.';end if;
 stamp:=planzo_private.flow_stamp(trip);
 if p_action not in ('confirm_input','reopen_input','extend_deadline') and p_payload->>'expected_stamp' is distinct from stamp then raise exception using errcode='40001',message='Group inputs changed. Refresh before continuing.';end if;
 if p_action in ('generate_reserve','generate_finish','lock','extend_deadline','close_poll','postpone','set_roster') and role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can do this.';end if;
 if not included and p_action not in ('extend_deadline','close_poll','postpone','set_roster') then raise exception using errcode='42501',message='Only included travellers can contribute.';end if;
 select * into own from planzo_private.flow_inputs where trip_id=trip and user_id=actor;
 select * into plan from planzo_private.flow_plans where trip_id=trip order by version desc limit 1;
 if p_action in ('postpone','set_roster') then
  if t.stage='agreed' or p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Confirm an action on an unlocked trip.';end if;
  if p_action='postpone' then
   update public.planzo_trips set revision=revision+1,stage='postponed' where id=trip;
  else
   b:=p_payload->'roster';
   if jsonb_typeof(b) is distinct from 'array' then raise exception 'Choose the travelling roster.';end if;
   if not (b ? actor::text) or jsonb_array_length(b)<t.minimum_group_size
     or jsonb_array_length(b)<>(select count(distinct value) from jsonb_array_elements_text(b))
     or exists(select 1 from jsonb_array_elements_text(b) x where not exists(select 1 from public.planzo_trip_members m where m.trip_id=trip and m.user_id::text=x.value)) then
    raise exception 'Keep the organiser and at least the trip minimum in the roster.';end if;
   update public.planzo_trip_members m set included=(b ? m.user_id::text) where m.trip_id=trip and m.included is distinct from (b ? m.user_id::text);
   if not found then raise exception 'Choose a different travelling roster.';end if;
   update planzo_private.flow_inputs set confirmed=false where trip_id=trip;
   update public.planzo_brief_status set confirmed=false where trip_id=trip;
   update public.planzo_trips set revision=revision+1,stage='collecting' where id=trip;
  end if;
  update planzo_private.flow_polls set status='stale' where trip_id=trip and status in ('open','unresolved');
 elsif p_action='extend_deadline' then
 s:=(p_payload->>'deadline')::timestamptz;
 if s is null or s<=now() or s>=(select min(starts_at) from public.planzo_trip_windows where trip_id=trip) or p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Apply a future deadline before departure and acknowledge fresh planning.';end if;
 update public.planzo_trips set response_deadline=s,revision=revision+1,stage='collecting' where id=trip;
 elsif p_action in ('confirm_input','reopen_input') then
 if (p_payload->>'expected_input_revision')::integer is distinct from coalesce(own.revision,0) then raise exception using errcode='40001',message='Your saved input changed. Refresh before editing.';end if;
 if t.response_deadline<=now() then raise exception 'The response deadline passed. Ask the organiser to extend it.';end if;
 if p_action='reopen_input' then
 if p_payload->'acknowledged' is distinct from 'true'::jsonb or own.revision is null then raise exception 'Acknowledge that changed input requires a new plan and review.';end if;
 update planzo_private.flow_inputs set confirmed=false where trip_id=trip and user_id=actor;
 update public.planzo_brief_status set confirmed=false where trip_id=trip and user_id=actor;
 else
 b:=p_payload->'content';
 if p_payload->'acknowledged' is distinct from 'true'::jsonb or jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>17
 or exists(select 1 from jsonb_object_keys(b) x where x not in ('origin','window_id','start','end','outbound_minutes','return_minutes','ceiling_paise','travel_reserve_paise','interests','places','hard','soft','fictional','ai_consent','version','requests','requests_reviewed')) then raise exception 'Review and confirm your complete summary.';end if;
 foreach k in array array['origin','window_id','start','end','hard','soft'] loop if jsonb_typeof(b->k) is distinct from 'string' then raise exception 'Invalid personal summary.';end if;end loop;
 if length(btrim(b->>'origin')) not between 1 and 80 or length(btrim(b->>'hard')) not between 1 and 1500 or length(btrim(b->>'soft')) not between 1 and 1500 then raise exception 'Complete the city, must-have and flexible answers.';end if;
 if jsonb_typeof(b->'fictional') is distinct from 'boolean' or jsonb_typeof(b->'ai_consent') is distinct from 'boolean' or (jsonb_typeof(b->'version') is distinct from 'number' or b->>'version' not in ('2','3')) or (b->>'version'='2' and (b->>'ai_consent')::boolean and not (b->>'fictional')::boolean) then raise exception 'Check the fictional-input and Gemini choices.';end if;
 if b->>'version'='3' and (b->'outbound_minutes' is distinct from '0'::jsonb or b->'return_minutes' is distinct from '0'::jsonb or b->'travel_reserve_paise' is distinct from '0'::jsonb) then raise exception 'Destination availability has no separate travel buffers or upfront allowance.';end if;
 foreach k in array array['ceiling_paise','travel_reserve_paise','outbound_minutes','return_minutes'] loop if jsonb_typeof(b->k) is distinct from 'number' or (b->>k)!~'^[0-9]+$' then raise exception 'Enter whole paise and whole travel minutes in the personal summary.';end if;end loop;
 if (b->>'ceiling_paise')!~'^[0-9]+$' or (b->>'travel_reserve_paise')!~'^[0-9]+$' or (b->>'ceiling_paise')::bigint not between 100 and 10000000000 or (b->>'travel_reserve_paise')::bigint<0 or (b->>'travel_reserve_paise')::bigint>=(b->>'ceiling_paise')::bigint then raise exception 'Check your whole-trip ceiling and personal travel allowance.';end if;
 select * into win from public.planzo_trip_windows where trip_id=trip and id=(b->>'window_id')::uuid;
 s:=(b->>'start')::timestamptz;e:=(b->>'end')::timestamptz;
 if win.id is null or s is null or e is null or s<win.starts_at or e>win.ends_at or e<=s then raise exception 'Personal dates must fit the chosen tentative option.';end if;
 if (b->>'outbound_minutes')::integer not between 0 and 4320 or (b->>'return_minutes')::integer not between 0 and 4320 or e-s<=make_interval(mins=>(b->>'outbound_minutes')::integer+(b->>'return_minutes')::integer) then raise exception 'Travel durations must leave time at the destination.';end if;
 if jsonb_typeof(b->'interests') is distinct from 'array' or jsonb_array_length(b->'interests')>8 or exists(select 1 from jsonb_array_elements(b->'interests') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('Beach','Relaxation','Culture','Nature','Food','Adventure','Nightlife','Shopping'))
 or (select count(distinct value) from jsonb_array_elements(b->'interests'))<>jsonb_array_length(b->'interests') or jsonb_typeof(b->'places') is distinct from 'array' or jsonb_array_length(b->'places')>6 or exists(select 1 from jsonb_array_elements(b->'places') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 80) or (select count(distinct value) from jsonb_array_elements(b->'places'))<>jsonb_array_length(b->'places') then raise exception 'Check the shareable interests and places.';end if;
 if b->'requests_reviewed' is distinct from 'true'::jsonb or jsonb_typeof(b->'requests') is distinct from 'array' or jsonb_array_length(b->'requests')>20 then raise exception 'Review the planning requests that may be shared, including every must-have you want considered.';end if;
 for step in select value from jsonb_array_elements(b->'requests') loop
 if jsonb_typeof(step)<>'object' or (select count(*) from jsonb_object_keys(step))<>3 or exists(select 1 from jsonb_object_keys(step) x where x not in ('title','kind','priority')) or jsonb_typeof(step->'title') is distinct from 'string' or length(btrim(step->>'title')) not between 1 and 120 or step->>'kind' not in ('activity','food','stay','rule') or step->>'priority' not in ('hard','soft') or step->>'kind' is null or step->>'priority' is null then raise exception 'Check each planning request, type and priority.';end if;
 end loop;
 if (select count(distinct lower(btrim(value->>'title'))||':'||(value->>'kind')) from jsonb_array_elements(b->'requests'))<>jsonb_array_length(b->'requests') then raise exception 'Remove duplicate planning requests.';end if;
 v:=coalesce(own.revision,0)+1;
 insert into planzo_private.flow_inputs values(trip,actor,v,true,b) on conflict(trip_id,user_id) do update set revision=excluded.revision,confirmed=true,content=excluded.content;
 insert into planzo_private.flow_input_versions(trip_id,user_id,revision,content) values(trip,actor,v,b);
 update public.planzo_brief_status set revision=v,confirmed=true,confirmed_revision=v,updated_at=now() where trip_id=trip and user_id=actor;
 end if;
 update public.planzo_trips set revision=revision+1,stage='collecting' where id=trip;
 elsif p_action='generate_reserve' then
 if plan.stamp=stamp and exists(select 1 from planzo_private.flow_locks where plan_id=plan.id) then raise exception 'This itinerary is locked. Reopen private input before fresh planning.';end if;
 if t.response_deadline<=now() then raise exception 'The deadline passed. Extend it before generating.';end if;
 ctx:=planzo_private.flow_context(trip);
 if not (ctx->>'requests_ready')::boolean then raise exception 'Each traveller must reopen and confirm the planning requests to share before generating. Previous answers remain private.';end if;
 -- Gemini is an enabled planning service. Reviewed requests remain mandatory;
 -- historic per-input opt-in flags are retained without rewriting user records.
 if exists(select 1 from planzo_private.flow_ai_receipts r where r.actor=flow_api.actor and r.request_id=req) then raise exception 'This generation attempt was already used.';end if;
 if exists(select 1 from planzo_private.flow_ai_receipts where trip_id=trip and created_at>now()-interval '3 seconds') then raise exception 'Please wait a moment before generating again.';end if;
 insert into planzo_private.flow_ai_receipts(actor,request_id,trip_id,stamp) values(actor,req,trip,stamp);
 return ctx;
 elsif p_action='generate_finish' then
 select * into ai_receipt from planzo_private.flow_ai_receipts r where r.actor=flow_api.actor and r.request_id=req and r.trip_id=trip for update;
 if ai_receipt.request_id is null or ai_receipt.used or ai_receipt.stamp<>stamp or ai_receipt.created_at<now()-interval '2 minutes' then raise exception 'The generation attempt expired or inputs changed.';end if;
 ctx:=planzo_private.flow_context(trip);doc:=planzo_private.flow_document(ctx||jsonb_build_object('spend_limit_paise',(select min((i.content->>'ceiling_paise')::bigint-(i.content->>'travel_reserve_paise')::bigint) from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=trip and m.included)),p_payload->'choice');
 insert into planzo_private.flow_plans(trip_id,version,stamp,document) values(trip,coalesce(plan.version,0)+1,stamp,doc) returning id into newid;
 update planzo_private.flow_ai_receipts r set used=true where r.actor=flow_api.actor and r.request_id=req;
 update planzo_private.flow_polls set status='stale' where trip_id=trip and status in ('open','unresolved');
 for step in select value from jsonb_array_elements(doc->'steps') loop
 if jsonb_array_length(step->'alternatives')>0 then insert into planzo_private.flow_polls(trip_id,stamp,step_id,base_ref,options,mode,author,deadline)
 values(trip,stamp,step->>'id',step->>'ref',jsonb_build_array(step->>'ref',step->'alternatives'->>0),'choice',actor,t.response_deadline);end if;end loop;
 if jsonb_array_length(doc->'unplaced')>0 then
 select value into step from jsonb_array_elements(doc->'steps') where value->>'kind'='activity' limit 1;
 if step is not null then
 update planzo_private.flow_polls set status='stale' where trip_id=trip and flow_polls.stamp=flow_api.stamp and step_id=step->>'id' and status='open';
 insert into planzo_private.flow_polls(trip_id,stamp,step_id,base_ref,options,mode,author,deadline) values(trip,stamp,step->>'id',step->>'ref',jsonb_build_array(step->>'ref')||(doc->'unplaced'),'choice',actor,t.response_deadline);
 end if;end if;
 update public.planzo_trips set stage='planning' where id=trip;
 else
 ctx:=planzo_private.flow_context(trip);
 if plan.id is null or plan.stamp<>stamp then raise exception 'Generate the itinerary for the current confirmed inputs first.';end if;
 if exists(select 1 from planzo_private.flow_locks where plan_id=plan.id) then raise exception 'This itinerary is locked. Reopen your input for a fresh plan; history is retained.';end if;
 select count(*) into roster_count from public.planzo_trip_members m where m.trip_id=trip and m.included;
 if p_action='raise_concern' then
 step:=null;select value into step from jsonb_array_elements(plan.document->'steps') where value->>'id'=p_payload->>'step_id';ref:=p_payload->>'replacement';hard:=coalesce((p_payload->>'hard')::boolean,false);
 if step is null or ref is null or ref=step->>'ref' or not(case step->>'kind' when 'activity' then ref='rest' or exists(select 1 from jsonb_array_elements(plan.document->'refs') r where r->>'id'=ref and coalesce(r->>'kind','activity')='activity') when 'food' then ref in ('food','food_alternative') when 'stay' then ref in ('stay','stay_alternative') else ref in ('rest','rest_alternative') end) then raise exception 'Choose a different supported arrangement for this step.';end if;
 if t.response_deadline<=now() then raise exception 'The voting deadline passed. Ask the organiser to extend it.';end if;
 if exists(select 1 from planzo_private.flow_polls p where p.trip_id=trip and p.stamp=flow_api.stamp and p.step_id=step->>'id' and p.status in ('open','unresolved')) then raise exception 'This step already has an unresolved vote.';end if;
 if (p_payload ? 'concern_note' and jsonb_typeof(p_payload->'concern_note') is distinct from 'string')
    or char_length(p_payload->>'concern_note')>1000
    or (p_payload ? 'share_concern' and jsonb_typeof(p_payload->'share_concern') is distinct from 'boolean') then
   raise exception 'Use up to 1,000 characters of feedback and choose whether to share it.';end if;
 insert into planzo_private.flow_polls(trip_id,stamp,step_id,base_ref,options,mode,author,hard,deadline,concern_note,concern_shared)
 values(trip,stamp,step->>'id',step->>'ref',jsonb_build_array(step->>'ref',ref),'concern',actor,hard,t.response_deadline,
   nullif(btrim(p_payload->>'concern_note'),''),coalesce((p_payload->>'share_concern')::boolean,false));
 elsif p_action in ('vote','close_poll','resolve_personal') then
 select * into poll from planzo_private.flow_polls p where p.id=(p_payload->>'poll_id')::uuid and p.trip_id=trip and p.stamp=flow_api.stamp for update;
 if poll.id is null then raise exception 'This vote is no longer current.';end if;
 if p_action='resolve_personal' then
 if poll.author<>actor or not poll.hard or p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception using errcode='42501',message='Only the affected author can resolve their own must-have concern.';end if;
 if poll.status not in ('closed','stale') then raise exception 'Close the step vote before reviewing your must-have requirement.';end if;
 if (p_payload->>'plan_id')::uuid is distinct from plan.id then raise exception using errcode='40001',message='Check the current itinerary before resolving your personal requirement.';end if;
 update planzo_private.flow_polls set personal_resolved=true where id=poll.id;
 elsif p_action='vote' then
 if poll.status<>'open' or poll.deadline<=now() then raise exception 'This vote is closed or its deadline passed.';end if;
 choice:=p_payload->>'choice';
 if choice<>'abstain' and not poll.options ? choice then raise exception 'Choose one of this vote’s alternatives.';end if;
 select revision into v from planzo_private.flow_ballots where poll_id=poll.id and user_id=actor;
 if (p_payload->>'expected_ballot_revision')::integer is distinct from coalesce(v,0) then raise exception using errcode='40001',message='Your ballot changed. Refresh before voting.';end if;
 insert into planzo_private.flow_ballots values(poll.id,actor,choice,coalesce(v,0)+1) on conflict(poll_id,user_id) do update set choice=excluded.choice,revision=excluded.revision;
 else
 if poll.status not in ('open','unresolved') then raise exception 'This vote is already closed.';end if;
 select count(*) into responded from planzo_private.flow_ballots b join public.planzo_trip_members m on m.trip_id=trip and m.user_id=b.user_id and m.included where b.poll_id=poll.id;
 if responded*2<roster_count and poll.deadline>now() then raise exception 'Wait for at least half of the included travellers to vote, or for the voting deadline.';end if;
 select jsonb_object_agg(option,amount) into votes from(select x#>>'{}' option,(select count(*) from planzo_private.flow_ballots b join public.planzo_trip_members m on m.trip_id=trip and m.user_id=b.user_id and m.included where b.poll_id=poll.id and b.choice=x#>>'{}') amount from jsonb_array_elements(poll.options) x) counts;
 winner:=null;
 if poll.mode='concern' then winner:=case when (votes->>(poll.options->>1))::integer>roster_count/2 then poll.options->>1 else poll.options->>0 end;
 else select max(value::integer) into highest from jsonb_each_text(votes);select count(*) into ties from jsonb_each_text(votes) where value::integer=highest;
 if highest>0 and ties=1 then select key into winner from jsonb_each_text(votes) where value::integer=highest;end if;end if;
 result:=jsonb_build_object('counts',votes,'winner',winner,'missing',roster_count-responded,'abstain',(select count(*) from planzo_private.flow_ballots b where b.poll_id=poll.id and b.choice='abstain'));
 update planzo_private.flow_polls set status=case when winner is null then 'unresolved' else 'closed' end,result=flow_api.result where id=poll.id;
 if winner is not null and (winner<>poll.base_ref or (plan.document->'unplaced') ?| array(select value#>>'{}' from jsonb_array_elements(poll.options))) then
 doc:=plan.document;
 select value into step from jsonb_array_elements(doc->'steps') where value->>'id'=poll.step_id;
 if step->>'ref'<>poll.base_ref then raise exception using errcode='40001',message='This step changed. Reopen a vote on the current step.';end if;
 doc:=jsonb_set(doc,array['steps',(substring(poll.step_id from 6)::integer-1)::text,'ref'],to_jsonb(winner));
 doc:=jsonb_set(doc,'{unplaced}',coalesce((select jsonb_agg(x) from jsonb_array_elements(doc->'unplaced') x where not poll.options ? (x#>>'{}')),'[]'));
 -- Recalculate outcomes and costs after a vote. Changed requirements require fresh individual review.
 if doc->>'requirements_version'='1' then
 doc:=planzo_private.flow_reconcile_document(doc);
 if exists(select 1 from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=trip and m.included and (doc->>'cost_paise')::bigint+(i.content->>'travel_reserve_paise')::bigint>(i.content->>'ceiling_paise')::bigint) then raise exception 'This proposed step exceeds a confirmed budget. Choose a cheaper alternative or revise inputs; no private amount is shared.';end if;
 end if;
 insert into planzo_private.flow_plans(trip_id,version,stamp,document) values(trip,plan.version+1,stamp,doc);
 end if;
 end if;
 elsif p_action in ('review','lock') then
 if (p_payload->>'plan_id')::uuid is distinct from plan.id or p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception using errcode='40001',message='Review and acknowledge the current itinerary version.';end if;
 if exists(select 1 from planzo_private.flow_polls p where p.trip_id=trip and p.stamp=flow_api.stamp and p.status in ('open','unresolved')) or exists(select 1 from planzo_private.flow_polls p where p.trip_id=trip and p.stamp=flow_api.stamp and p.hard and not p.personal_resolved) then raise exception 'Resolve the step votes and personal must-have concerns first.';end if;
 if jsonb_array_length(plan.document->'unplaced')>0 then raise exception 'Some shared choices do not fit. Review the shareable choices and generate a new plan.';end if;
 if p_action='review' then
 if p_payload ? 'response' and (jsonb_typeof(p_payload->'response') is distinct from 'string' or p_payload->>'response' not in ('ready','change','decline')) then raise exception 'Choose a response for this itinerary.';end if;
 if p_payload->>'response' in ('change','decline') then
  insert into planzo_private.flow_review_holds(plan_id,user_id,response) values(plan.id,actor,p_payload->>'response')
  on conflict(plan_id,user_id) do update set response=excluded.response;
 else
 if plan.document->>'requirements_version' is distinct from '1' then raise exception 'This earlier draft did not evaluate all requirements. Reopen and confirm the shareable requests, then generate a new draft.';end if;
 if exists(select 1 from jsonb_array_elements(planzo_private.flow_requirement_checks(own.content,plan.document)) x where x->>'status'='excluded') and p_payload->'accept_exclusions' is distinct from 'true'::jsonb then raise exception 'Read and explicitly acknowledge your excluded requirements before confirming this itinerary.';end if;
 if (plan.document->>'cost_paise')::bigint+(own.content->>'travel_reserve_paise')::bigint>(own.content->>'ceiling_paise')::bigint then raise exception 'Your whole-trip estimate exceeds your private ceiling. Revise your input; a vote cannot override it.';end if;
 insert into planzo_private.flow_reviews(plan_id,user_id) values(plan.id,actor) on conflict do nothing;
 delete from planzo_private.flow_review_holds where plan_id=plan.id and user_id=actor;
 end if;
 else
 if exists(select 1 from public.planzo_trip_members m
   left join planzo_private.flow_reviews r on r.plan_id=plan.id and r.user_id=m.user_id
   left join planzo_private.flow_review_holds h on h.plan_id=plan.id and h.user_id=m.user_id
   where m.trip_id=trip and m.included and (r.user_id is null or h.user_id is not null)) then raise exception 'Every included traveller must review this exact version before lock-in.';end if;
 insert into planzo_private.flow_locks(plan_id,actor) values(plan.id,actor);update public.planzo_trips set stage='agreed' where id=trip;
 end if;
 end if;
 end if;
 insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'flow:'||req,case p_action when 'confirm_input' then 'A traveller confirmed their private summary. Any earlier itinerary needs a new review.' when 'reopen_input' then 'A traveller reopened their private input. Earlier plans remain in history.' when 'generate_finish' then 'An itinerary draft was generated for all confirmed inputs; personal checks and step decisions remain.' when 'raise_concern' then 'A concern was raised against one itinerary step.' when 'vote' then 'A private step ballot was saved.' when 'close_poll' then 'A step vote was closed; review its result.' when 'resolve_personal' then 'A personal requirement was reviewed by its author.' when 'review' then 'A traveller recorded a response to the current itinerary.' when 'postpone' then 'The organiser postponed the trip. Earlier plans remain in History.' when 'set_roster' then 'The organiser explicitly changed the travelling roster. Fresh inputs and reviews are required.' when 'lock' then 'The organiser locked the resolved itinerary after every included traveller reviewed it. No reservation was made.' else 'The response deadline changed. Earlier plans remain historical.' end);
 result:=planzo_private.flow_state(trip,actor);
 insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,'flow:'||p_action,jsonb_build_object('digest',digest,'response',result));
 return result;
end$function$
;
CREATE OR REPLACE FUNCTION planzo_private.flow_legacy_state(p_trip uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
<<flow_legacy_state>>
declare t public.planzo_trips%rowtype;ctx jsonb;blocked text;plan planzo_private.flow_plans%rowtype;own planzo_private.flow_inputs%rowtype;stamp text:=planzo_private.flow_stamp(p_trip);n integer;c integer;
begin
 select * into t from public.planzo_trips where id=p_trip;select * into own from planzo_private.flow_inputs where trip_id=p_trip and user_id=p_actor;
 select count(*),count(*) filter(where i.confirmed) into n,c from public.planzo_trip_members m left join planzo_private.flow_inputs i using(trip_id,user_id) where m.trip_id=p_trip and m.included;
 begin ctx:=planzo_private.flow_context(p_trip);exception when others then blocked:=sqlerrm;end;
 select * into plan from planzo_private.flow_plans where trip_id=p_trip order by version desc limit 1;
 return jsonb_build_object('trip_id',p_trip,'revision',t.revision,'stage',t.stage,'stamp',stamp,'included',n,'confirmed',c,'blocker',blocked,'context',ctx,
 'own',case when own.revision is null then null else jsonb_build_object('revision',own.revision,'confirmed',own.confirmed,'content',own.content) end,
 'ai_available',ctx is not null,
 'plan',case when plan.id is null or ctx is null or plan.stamp<>stamp then null else jsonb_build_object('id',plan.id,'version',plan.version,'document',plan.document,'locked',exists(select 1 from planzo_private.flow_locks where plan_id=plan.id),
 'reviewed',exists(select 1 from planzo_private.flow_reviews r where r.plan_id=plan.id and r.user_id=p_actor)
   and not exists(select 1 from planzo_private.flow_review_holds h where h.plan_id=plan.id and h.user_id=p_actor),
 'own_response',coalesce((select h.response from planzo_private.flow_review_holds h where h.plan_id=plan.id and h.user_id=p_actor),
   (select 'ready' from planzo_private.flow_reviews r where r.plan_id=plan.id and r.user_id=p_actor)),
 'review_count',(select count(*) from planzo_private.flow_reviews r
   join public.planzo_trip_members m on m.trip_id=p_trip and m.user_id=r.user_id and m.included
   where r.plan_id=plan.id and not exists(select 1 from planzo_private.flow_review_holds h where h.plan_id=r.plan_id and h.user_id=r.user_id)),
 'change_count',(select count(*) from planzo_private.flow_review_holds h join public.planzo_trip_members m on m.trip_id=p_trip and m.user_id=h.user_id and m.included where h.plan_id=plan.id and h.response='change'),
 'decline_count',(select count(*) from planzo_private.flow_review_holds h join public.planzo_trip_members m on m.trip_id=p_trip and m.user_id=h.user_id and m.included where h.plan_id=plan.id and h.response='decline'),
 'own_total_paise',(plan.document->>'cost_paise')::bigint+coalesce((own.content->>'travel_reserve_paise')::bigint,0),
 'own_over_budget',(plan.document->>'cost_paise')::bigint+coalesce((own.content->>'travel_reserve_paise')::bigint,0)>coalesce((own.content->>'ceiling_paise')::bigint,0)) end,
 'polls',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'step_id',p.step_id,'mode',p.mode,'options',p.options,'deadline',p.deadline,'status',p.status,'result',case when p.status='open' then null else p.result end,'own_ballot',(select jsonb_build_object('choice',b.choice,'revision',b.revision) from planzo_private.flow_ballots b where b.poll_id=p.id and b.user_id=p_actor),
 'responded',(select count(*) from planzo_private.flow_ballots b join public.planzo_trip_members m on m.trip_id=p_trip and m.user_id=b.user_id and m.included where b.poll_id=p.id),
 'concern_note',case when p.author=p_actor or (p.concern_shared and t.created_by=p_actor) then p.concern_note end,
 'concern_shared',case when p.author=p_actor or (p.concern_shared and t.created_by=p_actor) then p.concern_shared end,'own_requirement',p.author=p_actor and p.hard,'personal_resolved',case when p.author=p_actor then p.personal_resolved else null end) order by p.created_at,p.id) from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_legacy_state.stamp and ctx is not null),'[]'),
 'personal_checks_pending',exists(select 1 from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_legacy_state.stamp and p.hard and not p.personal_resolved),
 'history',coalesce((select jsonb_agg(x order by x->>'created_at' desc) from(select jsonb_build_object('id',p.id,'version',p.version,'created_at',p.created_at,'locked',exists(select 1 from planzo_private.flow_locks l where l.plan_id=p.id)) x from planzo_private.flow_plans p where p.trip_id=p_trip order by version desc limit 40) q),'[]'));
end$function$
;

