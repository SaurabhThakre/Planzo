-- Forward-only authorised refinement; no existing trip/input/version rows rewritten.
do $guard$begin if (select md5(prosrc) from pg_proc where oid='planzo_private.flow_api(text,jsonb)'::regprocedure) is distinct from '9a116528c9af2522c83c9fd50f8d44a4' then raise exception 'Unexpected flow_api baseline';end if;end$guard$;
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
 if p_action not in ('confirm_input','reopen_input','generate_reserve','generate_finish','vote','close_poll','raise_concern','resolve_personal','review','lock','extend_deadline') then raise exception 'Unsupported planning action.';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) x where x not in ('trip_id','request_id','expected_revision','expected_input_revision','expected_stamp','content','acknowledged','choice','poll_id','expected_ballot_revision','step_id','replacement','hard','deadline','plan_id','accept_exclusions')) then raise exception 'Unsupported request fields.';end if;
 req:=(p_payload->>'request_id')::uuid;if req is null then raise exception 'A request identifier is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
 digest:=md5(p_payload::text);select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
 if found then if receipt.action<>'flow:'||p_action or receipt.result->>'digest'<>digest then raise exception 'This request identifier was already used.';end if;return receipt.result->'response';end if;
 if t.stage in ('postponed','archived') then raise exception 'This trip is postponed or archived. Saved input and history are read-only.';end if;
 if (p_payload->>'expected_revision')::integer is distinct from t.revision then raise exception using errcode='40001',message='The trip changed. Refresh before saving.';end if;
 stamp:=planzo_private.flow_stamp(trip);
 if p_action not in ('confirm_input','reopen_input','extend_deadline') and p_payload->>'expected_stamp' is distinct from stamp then raise exception using errcode='40001',message='Group inputs changed. Refresh before continuing.';end if;
 if p_action in ('generate_reserve','generate_finish','lock','extend_deadline') and role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can do this.';end if;
 if not included and p_action not in ('extend_deadline') then raise exception using errcode='42501',message='Only included travellers can contribute.';end if;
 select * into own from planzo_private.flow_inputs where trip_id=trip and user_id=actor;
 select * into plan from planzo_private.flow_plans where trip_id=trip order by version desc limit 1;
 if p_action='extend_deadline' then
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
 if exists(select 1 from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=trip and m.included and not ((i.content->>'ai_consent')::boolean and (i.content->>'version'='3' or (i.content->>'fictional')::boolean))) then raise exception 'Every included traveller must review the shared requests and separately allow Gemini.';end if;
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
 insert into planzo_private.flow_polls(trip_id,stamp,step_id,base_ref,options,mode,author,hard,deadline) values(trip,stamp,step->>'id',step->>'ref',jsonb_build_array(step->>'ref',ref),'concern',actor,hard,t.response_deadline);
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
 if responded<roster_count and poll.deadline>now() then raise exception 'Wait for every ballot or the stated voting deadline.';end if;
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
 if plan.document->>'requirements_version' is distinct from '1' then raise exception 'This earlier draft did not evaluate all requirements. Reopen and confirm the shareable requests, then generate a new draft.';end if;
 if exists(select 1 from jsonb_array_elements(planzo_private.flow_requirement_checks(own.content,plan.document)) x where x->>'status'='excluded') and p_payload->'accept_exclusions' is distinct from 'true'::jsonb then raise exception 'Read and explicitly acknowledge your excluded requirements before confirming this itinerary.';end if;
 if (plan.document->>'cost_paise')::bigint+(own.content->>'travel_reserve_paise')::bigint>(own.content->>'ceiling_paise')::bigint then raise exception 'Your whole-trip estimate exceeds your private ceiling. Revise your input; a vote cannot override it.';end if;
 insert into planzo_private.flow_reviews(plan_id,user_id) values(plan.id,actor) on conflict do nothing;
 else
 if exists(select 1 from public.planzo_trip_members m left join planzo_private.flow_reviews r on r.plan_id=plan.id and r.user_id=m.user_id where m.trip_id=trip and m.included and r.user_id is null) then raise exception 'Every included traveller must review this exact version before lock-in.';end if;
 insert into planzo_private.flow_locks(plan_id,actor) values(plan.id,actor);update public.planzo_trips set stage='agreed' where id=trip;
 end if;
 end if;
 end if;
 insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'flow:'||req,case p_action when 'confirm_input' then 'A traveller confirmed their private summary. Any earlier itinerary needs a new review.' when 'reopen_input' then 'A traveller reopened their private input. Earlier plans remain in history.' when 'generate_finish' then 'An itinerary draft was generated for all confirmed inputs; personal checks and step decisions remain.' when 'raise_concern' then 'A concern was raised against one itinerary step.' when 'vote' then 'A private step ballot was saved.' when 'close_poll' then 'A step vote was closed; review its result.' when 'resolve_personal' then 'A personal requirement was reviewed by its author.' when 'review' then 'A traveller reviewed the current itinerary and personal estimate.' when 'lock' then 'The organiser locked the resolved itinerary after every included traveller reviewed it. No reservation was made.' else 'The response deadline changed. Earlier plans remain historical.' end);
 result:=planzo_private.flow_state(trip,actor);
 insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,'flow:'||p_action,jsonb_build_object('digest',digest,'response',result));
 return result;
end$function$
;
do $guard$begin if (select md5(prosrc) from pg_proc where oid='planzo_private.flow_legacy_state(uuid,uuid)'::regprocedure) is distinct from 'e630d7f62d0c6a72d58ab7614a50f18a' then raise exception 'Unexpected flow_legacy_state baseline';end if;end$guard$;
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
 'ai_available',ctx is not null and not exists(select 1 from public.planzo_trip_members m join planzo_private.flow_inputs i using(trip_id,user_id) where m.trip_id=p_trip and m.included and not ((i.content->>'ai_consent')::boolean and (i.content->>'version'='3' or (i.content->>'fictional')::boolean))),
 'plan',case when plan.id is null or ctx is null or plan.stamp<>stamp then null else jsonb_build_object('id',plan.id,'version',plan.version,'document',plan.document,'locked',exists(select 1 from planzo_private.flow_locks where plan_id=plan.id),
 'reviewed',exists(select 1 from planzo_private.flow_reviews where plan_id=plan.id and user_id=p_actor),'review_count',(select count(*) from planzo_private.flow_reviews where plan_id=plan.id),
 'own_total_paise',(plan.document->>'cost_paise')::bigint+coalesce((own.content->>'travel_reserve_paise')::bigint,0),
 'own_over_budget',(plan.document->>'cost_paise')::bigint+coalesce((own.content->>'travel_reserve_paise')::bigint,0)>coalesce((own.content->>'ceiling_paise')::bigint,0)) end,
 'polls',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'step_id',p.step_id,'mode',p.mode,'options',p.options,'deadline',p.deadline,'status',p.status,'result',p.result,'own_ballot',(select jsonb_build_object('choice',b.choice,'revision',b.revision) from planzo_private.flow_ballots b where b.poll_id=p.id and b.user_id=p_actor),
 'responded',(select count(*) from planzo_private.flow_ballots where poll_id=p.id),'own_requirement',p.author=p_actor and p.hard,'personal_resolved',case when p.author=p_actor then p.personal_resolved else null end) order by p.created_at,p.id) from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_legacy_state.stamp and ctx is not null),'[]'),
 'personal_checks_pending',exists(select 1 from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_legacy_state.stamp and p.hard and not p.personal_resolved),
 'history',coalesce((select jsonb_agg(x order by x->>'created_at' desc) from(select jsonb_build_object('id',p.id,'version',p.version,'created_at',p.created_at,'locked',exists(select 1 from planzo_private.flow_locks l where l.plan_id=p.id)) x from planzo_private.flow_plans p where p.trip_id=p_trip order by version desc limit 40) q),'[]'));
end$function$
;
do $guard$begin if (select md5(prosrc) from pg_proc where oid='planzo_private.ai_api(text,jsonb)'::regprocedure) is distinct from 'e90159ccc08cc03c117357f923f535cb' then raise exception 'Unexpected ai_api baseline';end if;end$guard$;
CREATE OR REPLACE FUNCTION planzo_private.ai_api(p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();trip uuid;req uuid;t public.planzo_trips%rowtype;
  key text;brief_revision integer;request_hash text;receipt record;result jsonb;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then
    raise exception using errcode='42501',message='Sign in with a verified email to use the AI preview.';
  end if;
  if p_action not in ('reserve','check') or p_action is null then raise exception 'Unknown AI action.';end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid AI request.';end if;
  for key in select jsonb_object_keys(p_payload) loop
    if key not in ('trip_id','request_id','expected_trip_revision','expected_brief_revision','text_sha256','consent','fictional_input','consent_policy') then
      raise exception 'Unsupported AI request field.';
    end if;
  end loop;
  if p_payload->'consent' is distinct from 'true'::jsonb or jsonb_typeof(p_payload->'fictional_input') is distinct from 'boolean' or p_payload->>'consent_policy' is distinct from 'planzo-ai-owner-consent-2026-10-18' then
    raise exception 'Review what will be sent and allow Gemini to interpret it, or use the manual form.';
  end if;
  if coalesce(p_payload->>'text_sha256','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_payload->'expected_trip_revision') is distinct from 'number'
    or coalesce(p_payload->>'expected_trip_revision','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_payload->'expected_brief_revision') is distinct from 'number'
    or coalesce(p_payload->>'expected_brief_revision','') !~ '^[0-9]{1,9}$' then raise exception 'Invalid AI request context.';end if;
  trip:=(p_payload->>'trip_id')::uuid;req:=(p_payload->>'request_id')::uuid;
  if trip is null or req is null then raise exception 'Trip and request identifiers are required.';end if;
  select * into t from public.planzo_trips where id=trip for update;
  if not found or not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=actor) then
    raise exception using errcode='42501',message='You do not have access to this trip.';
  end if;
  if t.stage in ('postponed','archived') then raise exception 'This trip is postponed or archived. Manual input and history remain available.';end if;
  select revision into brief_revision from public.planzo_brief_status where trip_id=trip and user_id=actor;
  brief_revision:=coalesce(brief_revision,0);
  if (p_payload->>'expected_trip_revision')::integer<>t.revision
    or (p_payload->>'expected_brief_revision')::integer<>brief_revision then
    raise exception using errcode='40001',message='Your trip or saved input changed. Refresh before requesting another AI preview.';
  end if;
  -- Serialize this person's admission across trips to enforce the short cooldown.
  perform pg_advisory_xact_lock(hashtextextended('planzo:ai:gemini:actor:'||actor::text,0));
  request_hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
  select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
  if p_action='check' then
    if not found or receipt.action<>'ai:gemini' or receipt.request_hash is distinct from request_hash then
      raise exception using errcode='42501',message='This AI request is unavailable.';
    end if;
    return receipt.result;
  end if;
  if found then raise exception 'This preview attempt was already used. Request a new preview if needed; nothing was saved to your brief.';end if;
  if exists(select 1 from planzo_private.operation_receipts where action='ai:gemini' and user_id=actor and created_at>now()-interval '3 seconds') then
    raise exception 'Please wait a moment before requesting another AI preview.';
  end if;
  result:=jsonb_build_object('trip_id',trip,'trip_revision',t.revision,'brief_revision',brief_revision,
    'consent_policy','planzo-ai-owner-consent-2026-10-18','consented',true,'fictional_input',(p_payload->>'fictional_input')::boolean,'provider','gemini','admitted_at',now(),
    'windows',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'start',w.starts_at,'end',w.ends_at) order by w.starts_at),'[]'::jsonb)
      from public.planzo_trip_windows w where w.trip_id=trip));
  insert into planzo_private.operation_receipts(user_id,request_id,action,result,request_hash)
    values(actor,req,'ai:gemini',result,request_hash);
  return result;
end $function$
;
do $guard$begin if (select md5(prosrc) from pg_proc where oid='planzo_private.api(text,jsonb)'::regprocedure) is distinct from '1377be3e33fcba77e4ef89c9bd650e37' then raise exception 'Unexpected api baseline';end if;end$guard$;
CREATE OR REPLACE FUNCTION planzo_private.api(p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  actor_name text;
  trip uuid;
  role_name text;
  item jsonb;
  result jsonb;
  req uuid;
  existing_receipt record;
  invite planzo_private.trip_invites%rowtype;
  status_row public.planzo_brief_status%rowtype;
  trip_row public.planzo_trips%rowtype;
  b jsonb;
  token text;
  ceiling bigint;
  n integer;
  star_total integer;
  key_name text;
  start_time timestamptz;
  end_time timestamptz;
  deadline timestamptz;
  confirm_input boolean;
begin
  if actor is null or not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    raise exception using errcode='42501', message='Sign in with a verified email to continue.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023', message='Invalid request.';
  end if;
  select display_name into actor_name from public.planzo_profiles where user_id=actor;
  if actor_name is null then
    actor_name := 'Traveller';
    insert into public.planzo_profiles(user_id,display_name) values(actor,actor_name) on conflict do nothing;
  end if;

  if p_action='profile' then
    actor_name := btrim(coalesce(p_payload->>'name',''));
    if length(actor_name) not between 1 and 50 then raise exception 'Enter a name between 1 and 50 characters.'; end if;
    update public.planzo_profiles set display_name=actor_name where user_id=actor;
    return jsonb_build_object('id',actor,'name',actor_name);
  elsif p_action='list' then
    return jsonb_build_object('profile',jsonb_build_object('id',actor,'name',actor_name),'trips',coalesce((
      select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'destination',t.destination,'revision',t.revision,
      'role',m.role,'stage',t.stage,'created_at',t.created_at,'tentative_days',t.tentative_days,'removal_kind',t.removal_kind,'can_delete',m.role='organiser' and planzo_private.unused_trip(t.id)) order by t.created_at desc)
      from public.planzo_trips t join public.planzo_trip_members m on m.trip_id=t.id where m.user_id=actor
    ),'[]'::jsonb));
  elsif p_action='create_trip' then
    req := (p_payload->>'request_id')::uuid;
    if req is null then raise exception 'A request identifier is required.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
    select * into existing_receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
    if found then
      if existing_receipt.action<>p_action then raise exception 'This request identifier was already used.'; end if;
      return existing_receipt.result;
    end if;
    if jsonb_typeof(p_payload->'windows') is distinct from 'array' or jsonb_array_length(p_payload->'windows') not between 1 and 3 then
      raise exception 'Choose one to three travel windows.';
    end if;
    deadline := (p_payload->>'deadline')::timestamptz;
    if deadline is null or deadline<=now() then raise exception 'Choose a future response deadline.'; end if;
    insert into public.planzo_trips(created_by,name,destination,minimum_group_size,response_deadline,tentative_days,workflow_version)
    values(actor,btrim(p_payload->>'name'),btrim(p_payload->>'destination'),(p_payload->>'minimum')::integer,deadline,coalesce((p_payload->>'tentative_days')::integer,3),2)
    returning id into trip;
    for item in select value from jsonb_array_elements(p_payload->'windows') loop
      start_time := (item->>'start')::timestamptz;
      end_time := (item->>'end')::timestamptz;
      if start_time is null or end_time is null or start_time<=now() or end_time<=start_time or deadline>=start_time then
        raise exception 'Travel windows must be in the future, after the response deadline, with return after departure.';
      end if;
      insert into public.planzo_trip_windows(id,trip_id,starts_at,ends_at) values((item->>'id')::uuid,trip,start_time,end_time);
    end loop;
    insert into public.planzo_trip_members(trip_id,user_id,display_name,role) values(trip,actor,actor_name,'organiser');
    insert into public.planzo_brief_status(trip_id,user_id) values(trip,actor);
    result := jsonb_build_object('trip_id',trip);
    insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,p_action,result);
    return result;
  elsif p_action='join' then
    token := p_payload->>'token';
    perform planzo_private.invite_preview(token);
    select * into invite from planzo_private.trip_invites where token_hash=encode(extensions.digest(token,'sha256'),'hex') for share;
    if invite.revoked_at is not null or invite.expires_at<=now() then raise exception 'This invitation is invalid, expired or revoked.'; end if;
    trip := invite.trip_id;
    select * into trip_row from public.planzo_trips where id=trip for update;
    if exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=actor) then
      return jsonb_build_object('trip_id',trip);
    end if;
    if trip_row.stage<>'collecting' then raise exception 'This trip is not accepting new members.'; end if;
    if (select count(*) from public.planzo_trip_members where trip_id=trip)>=100 then raise exception 'This trip already has 100 members.'; end if;
    actor_name := btrim(coalesce(p_payload->>'name',''));
    if length(actor_name) not between 1 and 50 then raise exception 'Enter your name to join.'; end if;
    update public.planzo_profiles set display_name=actor_name where user_id=actor;
    insert into public.planzo_trip_members(trip_id,user_id,display_name,role) values(trip,actor,actor_name,'member');
    insert into public.planzo_brief_status(trip_id,user_id) values(trip,actor);
    update public.planzo_trips set revision=revision+1,updated_at=now() where id=trip;
    return jsonb_build_object('trip_id',trip);
  end if;

  trip := (p_payload->>'trip_id')::uuid;
  select role into role_name from public.planzo_trip_members where trip_id=trip and user_id=actor;
  if role_name is null then raise exception using errcode='42501',message='You do not have access to this trip.'; end if;

  if p_action='workspace' then
    select * into trip_row from public.planzo_trips where id=trip;
    return jsonb_build_object('trip',to_jsonb(trip_row),
      'windows',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,
        'start',to_char(w.starts_at at time zone 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI'),
        'end',to_char(w.ends_at at time zone 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI')) order by starts_at)
        from public.planzo_trip_windows w where w.trip_id=trip),'[]'::jsonb),
      'members',(select jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.display_name,'role',m.role,'included',m.included,
        'confirmed',s.confirmed,'revision',s.revision) order by joined_at)
        from public.planzo_trip_members m join public.planzo_brief_status s using(trip_id,user_id) where m.trip_id=trip),
      'own_brief',(select jsonb_build_object('content',d.content,'revision',d.revision,'confirmed',s.confirmed)
        from planzo_private.member_brief_drafts d join public.planzo_brief_status s using(trip_id,user_id)
        where d.trip_id=trip and d.user_id=actor));
  elsif p_action='create_invite' then
    if role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can create invitations.'; end if;
    select * into trip_row from public.planzo_trips where id=trip for update;
    if trip_row.stage<>'collecting' then raise exception 'This trip is not accepting new members.'; end if;
    if trip_row.response_deadline<=now() then raise exception 'The response deadline has passed. A new invitation cannot be issued.'; end if;
    if (select count(*) from planzo_private.trip_invites where trip_id=trip and revoked_at is null and expires_at>now())>=10 then
      raise exception 'Revoke an existing invitation before creating another.';
    end if;
    token := gen_random_uuid()::text;
    insert into planzo_private.trip_invites(trip_id,created_by,token_hash,expires_at)
    values(trip,actor,encode(extensions.digest(token,'sha256'),'hex'),least(now()+interval '7 days',trip_row.response_deadline))
    returning jsonb_build_object('id',id,'token',token,'expires_at',expires_at) into result;
    return result;
  elsif p_action='list_invites' then
    if role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can manage invitations.'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id',id,'expires_at',expires_at,'revoked_at',revoked_at,'created_at',created_at)
      order by created_at desc) from planzo_private.trip_invites where trip_id=trip),'[]'::jsonb);
  elsif p_action='revoke_invite' then
    if role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can revoke invitations.'; end if;
    update planzo_private.trip_invites set revoked_at=coalesce(revoked_at,now()) where id=(p_payload->>'invite_id')::uuid and trip_id=trip;
    if not found then raise exception 'Invitation not found.'; end if;
    return jsonb_build_object('revoked',true);
  elsif p_action='save_brief' then
    if exists(select 1 from public.planzo_trips where id=trip and workflow_version=2) then raise exception 'Use the private conversation and confirmed summary for this trip.';end if;
    select * into trip_row from public.planzo_trips where id=trip for update;
    if trip_row.stage='archived' then raise exception 'This trip is archived.'; end if;
    select * into status_row from public.planzo_brief_status where trip_id=trip and user_id=actor for update;
    req := (p_payload->>'request_id')::uuid;
    if req is null then raise exception 'A request identifier is required.'; end if;
    select * into existing_receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
    if found then
      if existing_receipt.action<>p_action or existing_receipt.result->>'trip_id'<>trip::text then raise exception 'This request identifier was already used.'; end if;
      return existing_receipt.result;
    end if;
    if (p_payload->>'expected_revision')::integer is distinct from status_row.revision then
      raise exception using errcode='40001',message='Your saved brief changed in another tab. Reload the latest saved version before saving again.';
    end if;
    b := p_payload->'brief';
    confirm_input := coalesce((p_payload->>'confirm')::boolean,false);
    if jsonb_typeof(b) is distinct from 'object' then raise exception 'Invalid brief.'; end if;
    for key_name in select jsonb_object_keys(b) loop
      if key_name not in ('origin','ceiling_paise','windows','vegetarian','step_free','stars','text','boat') then raise exception 'Unsupported brief field.'; end if;
    end loop;
    if jsonb_typeof(b->'origin') is distinct from 'string' or length(b->>'origin')>80
       or jsonb_typeof(b->'text') is distinct from 'string' or length(b->>'text')>2000
       or jsonb_typeof(b->'windows') is distinct from 'array' or jsonb_array_length(b->'windows')>3
       or jsonb_typeof(b->'stars') is distinct from 'object'
       or jsonb_typeof(b->'vegetarian') is distinct from 'boolean'
       or jsonb_typeof(b->'step_free') is distinct from 'boolean'
       or jsonb_typeof(b->'boat') is distinct from 'boolean' then raise exception 'Check the brief fields.'; end if;
    ceiling := null;
    if b->'ceiling_paise' is distinct from 'null'::jsonb then
      if jsonb_typeof(b->'ceiling_paise') is distinct from 'number' or (b->>'ceiling_paise') !~ '^[0-9]+$' then raise exception 'Enter a valid whole-trip ceiling.'; end if;
      ceiling := (b->>'ceiling_paise')::bigint;
      if ceiling not between 1 and 100000000 then raise exception 'Enter a ceiling between INR 0.01 and INR 1,000,000.'; end if;
    end if;
    star_total := 0;
    for key_name,item in select key,value from jsonb_each(b->'stars') loop
      if key_name not in ('Relaxation','Food','Beach','Culture','Adventure') or jsonb_typeof(item)<>'number'
         or item::text !~ '^[0-2]$' then raise exception 'Use at most two stars per interest.'; end if;
      star_total := star_total + item::text::integer;
    end loop;
    if star_total>3 then raise exception 'Use at most three priority stars.'; end if;
    for item in select value from jsonb_array_elements(b->'windows') loop
      if jsonb_typeof(item)<>'string' or not exists(select 1 from public.planzo_trip_windows where trip_id=trip and id::text=item#>>'{}') then
        raise exception 'Choose travel windows belonging to this trip.';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(b->'windows'))<>(select count(distinct value) from jsonb_array_elements(b->'windows')) then
      raise exception 'Choose each travel window once.';
    end if;
    if confirm_input and (not coalesce((p_payload->>'acknowledged')::boolean,false) or ceiling is null
      or length(btrim(b->>'origin'))=0 or jsonb_array_length(b->'windows')=0) then
      raise exception 'Check and acknowledge your origin, dates, whole-trip ceiling and requirements before confirming.';
    end if;
    n := status_row.revision+1;
    insert into planzo_private.member_brief_drafts(trip_id,user_id,revision,content) values(trip,actor,n,b)
      on conflict(trip_id,user_id) do update set revision=excluded.revision,content=excluded.content,updated_at=now();
    if confirm_input then insert into planzo_private.member_brief_revisions(trip_id,user_id,revision,content) values(trip,actor,n,b); end if;
    update public.planzo_brief_status set revision=n,confirmed=confirm_input,
      confirmed_revision=case when confirm_input then n else confirmed_revision end,updated_at=now() where trip_id=trip and user_id=actor;
    update public.planzo_trips set revision=revision+1,updated_at=now(),
      stage=case when stage in ('reviewing','agreed') then 'revise' else stage end where id=trip;
    result := jsonb_build_object('trip_id',trip,'revision',n,'confirmed',confirm_input);
    insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,p_action,result);
    return result;
  end if;
  raise exception using errcode='22023',message='This action is not available in the connected slice.';
end $function$
;
do $guard$begin if (select md5(prosrc) from pg_proc where oid='planzo_private.invite_preview(text)'::regprocedure) is distinct from '9593a78080e967da9e2e899bdd65a3a6' then raise exception 'Unexpected invite_preview baseline';end if;end$guard$;
CREATE OR REPLACE FUNCTION planzo_private.invite_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if p_token is null or (p_token !~ '^[0-9a-f]{64}$' and p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception using errcode='22023', message='This invitation is invalid, expired or revoked.';
  end if;
  select jsonb_build_object('name',t.name,'destination',t.destination,'expires_at',i.expires_at)
  into result from planzo_private.trip_invites i join public.planzo_trips t on t.id=i.trip_id
  where i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and i.revoked_at is null
    and i.expires_at>now() and t.stage <> 'archived';
  if result is null then
    raise exception using errcode='22023', message='This invitation is invalid, expired or revoked.';
  end if;
  return result;
end $function$
;
-- Trip Pact only. Host changes create fresh drafts; old versions/locks stay immutable.
create function planzo_private.refine_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<refine_api>>
declare actor uuid:=auth.uid();trip uuid;req uuid;t public.planzo_trips%rowtype;role_name text;included boolean;
 receipt record;digest text;result jsonb;details jsonb;w jsonb;old_windows jsonb;new_windows jsonb;material boolean;
 plan planzo_private.flow_plans%rowtype;ctx jsonb;doc jsonb;steps jsonb:='[]';refs jsonb;s jsonb;r jsonb;
 lo timestamptz;hi timestamptz;cursor_at timestamptz;ref text;kind text;title text;cost bigint;idx integer:=0;stamp text;newid uuid;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception using errcode='42501',message='Sign in with a verified email.';end if;
 if p_action is null or p_action not in ('edit_trip','edit_plan') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Unsupported organiser edit.';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('trip_id','request_id','expected_revision','expected_stamp','plan_id','details','steps','acknowledged')) then raise exception 'Unsupported edit field.';end if;
 trip:=(p_payload->>'trip_id')::uuid;req:=(p_payload->>'request_id')::uuid;
 if trip is null or req is null or p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Review and acknowledge this edit.';end if;
 select * into t from public.planzo_trips where id=trip for update;
 select m.role,m.included into role_name,included from public.planzo_trip_members m where m.trip_id=trip and m.user_id=actor;
 if role_name is distinct from 'organiser' then raise exception using errcode='42501',message='Only the organiser can edit this trip or master plan.';end if;
 if t.workflow_version<>2 then raise exception 'This trip keeps its saved original workflow.';end if;
 if t.stage in ('archived','postponed') then raise exception 'This trip is read-only. Restore it before editing.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
 digest:=md5(p_payload::text);select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
 if found then if receipt.action<>'refine:'||p_action or receipt.result->>'digest'<>digest then raise exception 'This request identifier was already used.';end if;return receipt.result->'response';end if;
 if p_payload->'expected_revision' is distinct from to_jsonb(t.revision) then raise exception using errcode='40001',message='The trip changed. Refresh before editing.';end if;
 if p_action='edit_trip' then
  details:=p_payload->'details';
  if jsonb_typeof(details) is distinct from 'object' or (select count(*) from jsonb_object_keys(details))<>6 or exists(select 1 from jsonb_object_keys(details) k where k not in ('name','destination','tentative_days','minimum','deadline','windows')) then raise exception 'Check the complete trip details.';end if;
  if jsonb_typeof(details->'name') is distinct from 'string' or jsonb_typeof(details->'destination') is distinct from 'string' or length(btrim(details->>'name')) not between 1 and 80 or length(btrim(details->>'destination')) not between 1 and 80 then raise exception 'Enter a trip name and destination.';end if;
  if coalesce(details->>'tentative_days','')!~'^[0-9]+$' or coalesce(details->>'minimum','')!~'^[0-9]+$' or (details->>'tentative_days')::integer not between 1 and 365 or (details->>'minimum')::integer not between 1 and 100 then raise exception 'Check duration and minimum travellers.';end if;
  if jsonb_typeof(details->'windows') is distinct from 'array' or jsonb_array_length(details->'windows') not between 1 and 3 then raise exception 'Keep the existing date options when editing this trip.';end if;
  if jsonb_array_length(details->'windows')<>(select count(*) from public.planzo_trip_windows where trip_id=trip) or (select count(distinct value->>'id') from jsonb_array_elements(details->'windows'))<>jsonb_array_length(details->'windows') then raise exception 'Keep the existing date-option identifiers.';end if;
  for w in select value from jsonb_array_elements(details->'windows') loop
   if jsonb_typeof(w) is distinct from 'object' or (select count(*) from jsonb_object_keys(w))<>3 or exists(select 1 from jsonb_object_keys(w) k where k not in ('id','start','end')) or not exists(select 1 from public.planzo_trip_windows where trip_id=trip and id=(w->>'id')::uuid) then raise exception 'Use the existing date options from this trip.';end if;
   lo:=(w->>'start')::timestamptz;hi:=(w->>'end')::timestamptz;
   if lo is null or hi is null or hi<=lo or hi-lo>interval '366 days' then raise exception 'Check each ordered destination date window.';end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',id,'start',starts_at,'end',ends_at) order by id) into old_windows from public.planzo_trip_windows where trip_id=trip;
  select jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'start',(value->>'start')::timestamptz,'end',(value->>'end')::timestamptz) order by (value->>'id')::uuid) into new_windows from jsonb_array_elements(details->'windows');
  lo:=(details->>'deadline')::timestamptz;
  if lo is null then raise exception 'Choose a response deadline.';end if;
  material:=t.destination<>btrim(details->>'destination') or t.tentative_days<>(details->>'tentative_days')::integer or t.minimum_group_size<>(details->>'minimum')::integer or t.response_deadline<>lo or old_windows<>new_windows;
  if material and (lo<=now() or exists(select 1 from jsonb_array_elements(details->'windows') x where (x->>'start')::timestamptz<=lo)) then raise exception 'Use future dates after a future response deadline.';end if;
  update public.planzo_trips set name=btrim(details->>'name'),destination=btrim(details->>'destination'),tentative_days=(details->>'tentative_days')::integer,minimum_group_size=(details->>'minimum')::integer,response_deadline=lo,revision=revision+case when material then 1 else 0 end,stage=case when material then 'collecting' else stage end,updated_at=now() where id=trip;
  if material then
   for w in select value from jsonb_array_elements(details->'windows') loop update public.planzo_trip_windows set starts_at=(w->>'start')::timestamptz,ends_at=(w->>'end')::timestamptz where trip_id=trip and id=(w->>'id')::uuid;end loop;
   update planzo_private.flow_inputs set confirmed=false where trip_id=trip;
   update public.planzo_brief_status set confirmed=false where trip_id=trip;
   update planzo_private.flow_polls set status='stale' where trip_id=trip and status in ('open','unresolved');
  end if;
  insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'refine:'||req,case when material then 'The organiser edited trip details. Travellers must check and reconfirm their own inputs; earlier plans and agreement remain in History.' else 'The organiser edited the trip name.' end);
  result:=jsonb_build_object('trip_id',trip,'requires_new_inputs',material);
 else
  if not included then raise exception using errcode='42501',message='Only an included organiser can edit the master plan.';end if;
  stamp:=planzo_private.flow_stamp(trip);ctx:=planzo_private.flow_context(trip);
  select * into plan from planzo_private.flow_plans where trip_id=trip order by version desc limit 1;
  if plan.id is null or plan.stamp<>stamp or p_payload->>'expected_stamp' is distinct from stamp or (p_payload->>'plan_id')::uuid is distinct from plan.id then raise exception using errcode='40001',message='The master plan changed. Refresh before editing.';end if;
  if jsonb_typeof(p_payload->'steps') is distinct from 'array' or jsonb_array_length(p_payload->'steps') not between 1 and 3000 then raise exception 'Keep at least one step in the master plan.';end if;
  refs:=plan.document->'refs';cursor_at:=(ctx->>'start')::timestamptz;
  for s in select value from jsonb_array_elements(p_payload->'steps') loop
   idx:=idx+1;
   if jsonb_typeof(s) is distinct from 'object' or (select count(*) from jsonb_object_keys(s))<>6 or exists(select 1 from jsonb_object_keys(s) k where k not in ('start','end','kind','ref','title','cost_paise')) then raise exception 'Check every step arrangement, date and estimate.';end if;
   kind:=s->>'kind';ref:=s->>'ref';title:=s->>'title';lo:=(s->>'start')::timestamptz;hi:=(s->>'end')::timestamptz;
   if kind is null or kind not in ('activity','food','stay','rest') or lo is null or hi is null or lo<>cursor_at or hi<=lo or hi>(ctx->>'end')::timestamptz then raise exception 'Steps must form a continuous ordered timeline within everyone’s shared destination availability.';end if;
   if jsonb_typeof(s->'cost_paise') is distinct from 'number' or coalesce(s->>'cost_paise','')!~'^[0-9]+$' or (s->>'cost_paise')::bigint>10000000000 then raise exception 'Use a non-negative whole-paise estimate.';end if;
   cost:=(s->>'cost_paise')::bigint;
   if kind='activity' then
    if ref='custom' then
     if jsonb_typeof(s->'title') is distinct from 'string' or length(btrim(title)) not between 1 and 120 or title~'[[:cntrl:]]' then raise exception 'Give the new shared activity a short title without private details.';end if;
     if exists(select 1 from jsonb_array_elements(refs) x where x->>'kind'='activity' and lower(btrim(x->>'title'))=lower(btrim(title))) then raise exception 'Choose the existing activity with this title instead of adding a duplicate.';end if;
     ref:='host_'||replace(gen_random_uuid()::text,'-','');refs:=refs||jsonb_build_array(jsonb_build_object('id',ref,'title',btrim(title),'kind','activity','priority','soft','cost_paise',cost));
    else
     r:=null;select value into r from jsonb_array_elements(refs) where value->>'id'=ref and value->>'kind'='activity';
     if r is null then raise exception 'Choose a known activity or add a named shared activity.';end if;
     if cost<>(r->>'cost_paise')::bigint then raise exception 'Keep the recorded estimate for an existing activity; add a new arrangement to change its estimate.';end if;
    end if;
   elsif kind='rest' then ref:='rest';cost:=0;
   else
    if ref is null or ref not in (kind,kind||'_alternative') then raise exception 'Use a supported meal or stay arrangement.';end if;
   end if;
   steps:=steps||jsonb_build_array(jsonb_build_object('id','step_'||idx,'start',lo,'end',hi,'kind',kind,'ref',ref,'cost_paise',cost,'alternatives','[]'::jsonb));cursor_at:=hi;
  end loop;
  if cursor_at<>(ctx->>'end')::timestamptz then raise exception 'The final step must reach the end of everyone’s shared destination interval.';end if;
  doc:=planzo_private.flow_reconcile_document(plan.document||jsonb_build_object('steps',steps,'refs',refs),'group_decision');
  if exists(select 1 from public.planzo_trip_members m join planzo_private.flow_inputs i using(trip_id,user_id) where m.trip_id=trip and m.included and (doc->>'cost_paise')::bigint+coalesce((i.content->>'travel_reserve_paise')::bigint,0)>(i.content->>'ceiling_paise')::bigint) then raise exception 'This edit exceeds an included traveller’s private whole-trip ceiling. Revise the estimates or request fresh private input.';end if;
  insert into planzo_private.flow_plans(trip_id,version,stamp,document) values(trip,plan.version+1,stamp,doc) returning id into newid;
  update planzo_private.flow_polls set status='stale' where trip_id=trip and flow_polls.stamp=refine_api.stamp and status in ('open','unresolved');
  update public.planzo_trips set stage='planning',updated_at=now() where id=trip;
  insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'refine:'||req,'The organiser edited the master itinerary. A fresh draft version requires every included traveller’s review. Earlier votes, plans and locks remain in History.');
  result:=planzo_private.flow_state(trip,actor);
 end if;
 insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,'refine:'||p_action,jsonb_build_object('digest',digest,'response',result));
 return result;
end$$;
revoke all on function planzo_private.refine_api(text,jsonb) from public,anon,authenticated;
grant execute on function planzo_private.refine_api(text,jsonb) to authenticated;
create function public.planzo_refine(p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return planzo_private.refine_api(p_action,p_payload);
exception when sqlstate '40001' then
 raise sqlstate 'PGRST' using message=jsonb_build_object('code','40001','message',sqlerrm,'details','The saved trip or itinerary changed.','hint','Refresh before saving again.')::text,detail='{"status":409,"headers":{}}';
end$$;
revoke all on function public.planzo_refine(text,jsonb) from public,anon,authenticated;
grant execute on function public.planzo_refine(text,jsonb) to authenticated;
