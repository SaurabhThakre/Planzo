-- Forward correction only. Preserve saved inputs, plans, reviews and locks. Trip Pact only.
do $baseline$begin
 if (select md5(prosrc) from pg_proc where oid='planzo_private.flow_api(text,jsonb)'::regprocedure)<>'fc72a5539741d4e7229e49abfaefa00e' or (select md5(prosrc) from pg_proc where oid='planzo_private.flow_context(uuid)'::regprocedure)<>'dc2214fb89f46c6da2a2502566618d98' or (select md5(prosrc) from pg_proc where oid='planzo_private.flow_document(jsonb,jsonb)'::regprocedure)<>'9bd240868d65d4b40f7e93f19eb0ec77' or (select md5(prosrc) from pg_proc where oid='planzo_private.flow_state(uuid,uuid)'::regprocedure)<>'9645d5b804f54f21e0ea1e08c82307ef' then raise exception 'Unexpected private-planning baseline; inspect before applying this forward correction.';end if;
end$baseline$;
create function planzo_private.flow_reference_cost(title text,kind text) returns bigint language sql immutable security invoker set search_path='' as $$
 select case when kind<>'activity' then 0 when lower(title) like '%scuba%' then 450000 when lower(title) like '%surfing%' then 250000 when lower(title) like '%sailing%' then 200000 else 55000 end::bigint
$$;
create or replace function planzo_private.flow_context(p_trip uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare n integer;c integer;lo timestamptz;hi timestamptz;refs jsonb;t public.planzo_trips%rowtype;
begin
 select * into t from public.planzo_trips where id=p_trip;
 select count(*),count(*) filter(where i.confirmed),max((i.content->>'start')::timestamptz+make_interval(mins=>coalesce((i.content->>'outbound_minutes')::integer,0))),min((i.content->>'end')::timestamptz-make_interval(mins=>coalesce((i.content->>'return_minutes')::integer,0)))
 into n,c,lo,hi from public.planzo_trip_members m left join planzo_private.flow_inputs i using(trip_id,user_id) where m.trip_id=p_trip and m.included;
 if n<t.minimum_group_size or n<>c then raise exception 'Wait for every included traveller to confirm, and meet the minimum group size.';end if;
 if (select count(distinct i.content->>'window_id') from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=p_trip and m.included)<>1 or hi-lo<interval '1 hour' then
 raise exception 'Personal availability has no shared interval. Each person must review their own dates; a vote cannot override availability.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id','ref_'||rn,'title',title) order by rn),'[]') into refs from(
 select row_number() over(order by title) rn,title from(
 select distinct value#>>'{}' title from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id)
 cross join lateral jsonb_array_elements((i.content->'interests')||(i.content->'places')) where i.trip_id=p_trip and m.included
 ) titles) ordered;
 if jsonb_array_length(refs)>80 then raise exception 'There are more than 80 different shared choices. Simplify the shareable places before generating.';end if;
 if refs='[]' then refs:='[{"id":"ref_1","title":"Relaxation"}]';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id','ref_'||rn,'title',title,'kind',kind,'priority',priority,'cost_paise',planzo_private.flow_reference_cost(title,kind)) order by rn),'[]') into refs from(
 select row_number() over(order by kind,lower(title)) rn,title,kind,case when bool_or(priority='hard') then 'hard' else 'soft' end priority from(
 select value#>>'{}' title,'activity'::text kind,'soft'::text priority from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) cross join lateral jsonb_array_elements((i.content->'interests')||(i.content->'places')) where i.trip_id=p_trip and m.included
 union all select btrim(r->>'title'),r->>'kind',r->>'priority' from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) cross join lateral jsonb_array_elements(coalesce(i.content->'requests','[]')) r where i.trip_id=p_trip and m.included
 ) q group by kind,lower(title),title) x;
 if jsonb_array_length(refs)>80 then raise exception 'Simplify the shared requests to at most 80 choices.';end if;
 if refs='[]' then refs:='[{"id":"ref_1","title":"Relaxation","kind":"activity","priority":"soft","cost_paise":55000}]';end if;
 return jsonb_build_object('traveller_count',n,'requirements_version',1,'requests_ready',not exists(select 1 from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=p_trip and m.included and i.content->'requests_reviewed' is distinct from 'true'::jsonb),'stamp',planzo_private.flow_stamp(p_trip),'start',lo,'end',hi,'destination',t.destination,'refs',refs);
end$$;

create function planzo_private.flow_legacy_document(ctx jsonb,choice jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare seq jsonb:=choice->'sequence';conf jsonb:=choice->'conflicts';refs jsonb:=ctx->'refs';steps jsonb:='[]';seen text[]:='{}';unplaced jsonb:='[]';
 cursor_at timestamptz:=(ctx->>'start')::timestamptz;finish timestamptz:=(ctx->>'end')::timestamptz;local_at timestamp;until_at timestamptz;
 boundary integer;kind text;ref text;cost bigint;idx integer:=0;count_steps integer:=0;total bigint:=5000;alt text;part jsonb;prev jsonb;key text;
begin
 if jsonb_typeof(choice)<>'object' or exists(select 1 from jsonb_object_keys(choice) k where k not in ('sequence','conflicts'))
 or jsonb_typeof(seq) is distinct from 'array' or jsonb_typeof(conf) is distinct from 'array' or jsonb_array_length(seq)<>jsonb_array_length(refs)
 or jsonb_array_length(conf)>12 or (select count(distinct value) from jsonb_array_elements(seq))<>jsonb_array_length(seq)
 or exists(select 1 from jsonb_array_elements(seq) x where jsonb_typeof(x)<>'string' or not exists(select 1 from jsonb_array_elements(refs) r where r->>'id'=x#>>'{}')) then raise exception 'The generated choices failed validation.';end if;
 for part in select value from jsonb_array_elements(conf) loop
 if jsonb_typeof(part)<>'object' or (select count(*) from jsonb_object_keys(part))<>2 or part->>'a'=part->>'b'
 or not seq ? (part->>'a') or not seq ? (part->>'b') then raise exception 'Invalid generated alternative.';end if;
 end loop;
 if (select count(distinct value->>'a') from jsonb_array_elements(conf))<>jsonb_array_length(conf) then raise exception 'Repeated alternatives.';end if;
 if finish-cursor_at<interval '1 hour' or finish-cursor_at>interval '366 days' then raise exception 'Unsupported shared interval.';end if;
 while cursor_at<finish loop
 local_at:=cursor_at at time zone 'Asia/Kolkata';
 boundary:=case when extract(hour from local_at)<6 then 6 when extract(hour from local_at)<9 then 9 when extract(hour from local_at)<12 then 12 when extract(hour from local_at)<14 then 14 when extract(hour from local_at)<18 then 18 when extract(hour from local_at)<21 then 21 else 24 end;
 kind:=case boundary when 6 then 'stay' when 9 then 'food' when 12 then 'activity' when 14 then 'food' when 18 then 'activity' when 21 then 'food' else 'stay' end;
 until_at:=least(finish,(date_trunc('day',local_at)+make_interval(hours=>boundary)) at time zone 'Asia/Kolkata');
 ref:=kind;alt:=null;
 if kind='activity' then ref:=seq->>(idx%jsonb_array_length(seq));idx:=idx+1;
 if until_at-cursor_at<interval '1 hour' then ref:='rest';kind:='rest';idx:=idx-1;
 else seen:=array_append(seen,ref);select value->>'b' into alt from jsonb_array_elements(conf) where value->>'a'=ref;end if;end if;
 cost:=case kind when 'food' then 35000 when 'stay' then 150000 when 'activity' then 55000 else 0 end;
 prev:=steps->-1;
 if kind='stay' and prev->>'kind'='stay' then steps:=jsonb_set(steps,array[(jsonb_array_length(steps)-1)::text,'end'],to_jsonb(until_at));
 else count_steps:=count_steps+1;total:=total+cost;steps:=steps||jsonb_build_array(jsonb_build_object('id','step_'||count_steps,'start',cursor_at,'end',until_at,'kind',kind,'ref',ref,'cost_paise',cost,'alternatives',case when alt is null then '[]'::jsonb else jsonb_build_array(alt) end));end if;
 cursor_at:=until_at;
 end loop;
 for key in select value#>>'{}' from jsonb_array_elements(seq) loop if not key=any(seen) then unplaced:=unplaced||to_jsonb(key);end if;end loop;
 return jsonb_build_object('start',ctx->'start','end',ctx->'end','steps',steps,'refs',refs,'unplaced',unplaced,'cost_paise',ceil(total*1.1),'basis','fictional_reference_v1');
end$$;

create function planzo_private.flow_legacy_state(p_trip uuid,p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
<<flow_legacy_state>>
declare t public.planzo_trips%rowtype;ctx jsonb;blocked text;plan planzo_private.flow_plans%rowtype;own planzo_private.flow_inputs%rowtype;stamp text:=planzo_private.flow_stamp(p_trip);n integer;c integer;
begin
 select * into t from public.planzo_trips where id=p_trip;select * into own from planzo_private.flow_inputs where trip_id=p_trip and user_id=p_actor;
 select count(*),count(*) filter(where i.confirmed) into n,c from public.planzo_trip_members m left join planzo_private.flow_inputs i using(trip_id,user_id) where m.trip_id=p_trip and m.included;
 begin ctx:=planzo_private.flow_context(p_trip);exception when others then blocked:=sqlerrm;end;
 select * into plan from planzo_private.flow_plans where trip_id=p_trip order by version desc limit 1;
 return jsonb_build_object('trip_id',p_trip,'revision',t.revision,'stage',t.stage,'stamp',stamp,'included',n,'confirmed',c,'blocker',blocked,'context',ctx,
 'own',case when own.revision is null then null else jsonb_build_object('revision',own.revision,'confirmed',own.confirmed,'content',own.content) end,
 'ai_available',ctx is not null and t.name like 'TEST · AI%' and not exists(select 1 from public.planzo_trip_members m join planzo_private.flow_inputs i using(trip_id,user_id) where m.trip_id=p_trip and m.included and not ((i.content->>'fictional')::boolean and (i.content->>'ai_consent')::boolean)),
 'plan',case when plan.id is null or ctx is null or plan.stamp<>stamp then null else jsonb_build_object('id',plan.id,'version',plan.version,'document',plan.document,'locked',exists(select 1 from planzo_private.flow_locks where plan_id=plan.id),
 'reviewed',exists(select 1 from planzo_private.flow_reviews where plan_id=plan.id and user_id=p_actor),'review_count',(select count(*) from planzo_private.flow_reviews where plan_id=plan.id),
 'own_total_paise',(plan.document->>'cost_paise')::bigint+coalesce((own.content->>'travel_reserve_paise')::bigint,0),
 'own_over_budget',(plan.document->>'cost_paise')::bigint+coalesce((own.content->>'travel_reserve_paise')::bigint,0)>coalesce((own.content->>'ceiling_paise')::bigint,0)) end,
 'polls',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'step_id',p.step_id,'mode',p.mode,'options',p.options,'deadline',p.deadline,'status',p.status,'result',p.result,'own_ballot',(select jsonb_build_object('choice',b.choice,'revision',b.revision) from planzo_private.flow_ballots b where b.poll_id=p.id and b.user_id=p_actor),
 'responded',(select count(*) from planzo_private.flow_ballots where poll_id=p.id),'own_requirement',p.author=p_actor and p.hard,'personal_resolved',case when p.author=p_actor then p.personal_resolved else null end) order by p.created_at,p.id) from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_legacy_state.stamp and ctx is not null),'[]'),
 'personal_checks_pending',exists(select 1 from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_legacy_state.stamp and p.hard and not p.personal_resolved),
 'history',coalesce((select jsonb_agg(x order by x->>'created_at' desc) from(select jsonb_build_object('id',p.id,'version',p.version,'created_at',p.created_at,'locked',exists(select 1 from planzo_private.flow_locks l where l.plan_id=p.id)) x from planzo_private.flow_plans p where p.trip_id=p_trip order by version desc limit 40) q),'[]'));
end$$;


create function planzo_private.flow_reconcile_document(doc jsonb,missing_reason text default 'group_decision') returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare steps jsonb:='[]';outcomes jsonb:='[]';r jsonb;s jsonb;ids jsonb;total bigint:=5000;reason text;
begin
 for s in select value from jsonb_array_elements(doc->'steps') loop
 if s->>'kind'='activity' then
 select value into r from jsonb_array_elements(doc->'refs') where value->>'id'=s->>'ref';
 if r is null or s->>'ref'='rest' then s:=s||jsonb_build_object('kind','rest','cost_paise',0);
 else s:=s||jsonb_build_object('cost_paise',(r->>'cost_paise')::bigint);end if;
 end if;
 total:=total+(s->>'cost_paise')::bigint;steps:=steps||jsonb_build_array(s);
 end loop;
 for r in select value from jsonb_array_elements(doc->'refs') loop
 select coalesce(jsonb_agg(st.value->>'id'),'[]') into ids from jsonb_array_elements(steps) st where
 case r->>'kind' when 'activity' then st.value->>'kind'='activity' and st.value->>'ref'=r->>'id' when 'food' then st.value->>'kind'='food' when 'stay' then st.value->>'kind'='stay' else false end;
 reason:=case when jsonb_array_length(ids)>0 then 'scheduled' when r->>'kind'='rule' then 'unverified' else coalesce(doc->'exclusion_reasons'->>(r->>'id'),(select value->>'reason' from jsonb_array_elements(coalesce(doc->'outcomes','[]')) where value->>'ref'=r->>'id' and value->>'status'='excluded'),missing_reason) end;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('ref',r->>'id','status',case when jsonb_array_length(ids)>0 then 'included' else 'excluded' end,'reason',reason,'steps',ids));
 end loop;
 return (doc-'exclusion_reasons')||jsonb_build_object('steps',steps,'outcomes',outcomes,'cost_paise',ceil(total*1.1),'unplaced','[]'::jsonb,'requirements_version',1);
end$$;
create or replace function planzo_private.flow_document(ctx jsonb,choice jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare doc jsonb;steps jsonb:='[]';s jsonb;r jsonb;refs jsonb:=ctx->'refs';reasons jsonb:='{}';total bigint:=5000;limit_paise bigint:=coalesce((ctx->>'spend_limit_paise')::bigint,10000000000);slot integer;cost bigint;ix integer;
begin
 if ctx->>'requirements_version' is distinct from '1' then return planzo_private.flow_legacy_document(ctx,choice);end if;
 doc:=planzo_private.flow_legacy_document(ctx,choice);
 for s in select value from jsonb_array_elements(doc->'steps') loop
 if s->>'kind'='activity' then s:=s||jsonb_build_object('kind','rest','ref','rest','cost_paise',0,'alternatives','[]'::jsonb);end if;
 total:=total+(s->>'cost_paise')::bigint;steps:=steps||jsonb_build_array(s);
 end loop;
 -- Prioritise every hard request, including for a roster of one. Each paid request is scheduled once.
 for r in select rr.value from jsonb_array_elements(refs) rr order by case when rr.value->>'priority'='hard' then 0 else 1 end,(select ord from jsonb_array_elements_text(choice->'sequence') with ordinality q(id,ord) where q.id=rr.value->>'id') loop
 if r->>'kind'<>'activity' then continue;end if;
 cost:=(r->>'cost_paise')::bigint;
 if ceil((total+cost)*1.1)>limit_paise then reasons:=reasons||jsonb_build_object(r->>'id','budget');continue;end if;
 select ord::integer-1 into slot from jsonb_array_elements(steps) with ordinality q(value,ord) where value->>'kind'='rest' and (value->>'end')::timestamptz-(value->>'start')::timestamptz>=interval '1 hour' order by ord limit 1;
 if slot is null then reasons:=reasons||jsonb_build_object(r->>'id','timing');continue;end if;
 s:=steps->slot;s:=s||jsonb_build_object('kind','activity','ref',r->>'id','cost_paise',cost);
 s:=s||jsonb_build_object('alternatives',case when (ctx->>'traveller_count')::integer=1 then '[]'::jsonb else coalesce((select jsonb_build_array(c->>'b') from jsonb_array_elements(choice->'conflicts') c join lateral jsonb_array_elements(refs) b on b->>'id'=c->>'b' where c->>'a'=r->>'id' and b->>'kind'='activity'),'[]'::jsonb) end);
 steps:=jsonb_set(steps,array[slot::text],s);total:=total+cost;
 end loop;
 doc:=doc||jsonb_build_object('steps',steps,'exclusion_reasons',reasons);
 return planzo_private.flow_reconcile_document(doc,'timing');
end$$;

create function planzo_private.flow_requirement_checks(content jsonb,doc jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('title',r->>'title','kind',r->>'kind','priority',r->>'priority','status',coalesce(o->>'status','excluded'),'reason',coalesce(o->>'reason','unverified'),'steps',coalesce(o->'steps','[]'::jsonb)) order by n),'[]')
 from jsonb_array_elements(coalesce(content->'requests','[]')) with ordinality q(r,n)
 left join lateral (select value from jsonb_array_elements(coalesce(doc->'refs','[]')) where value->>'kind'=r->>'kind' and lower(btrim(value->>'title'))=lower(btrim(r->>'title')) limit 1) rf on true
 left join lateral (select value o from jsonb_array_elements(coalesce(doc->'outcomes','[]')) where value->>'ref'=rf.value->>'id') outcome on true
$$;
create or replace function planzo_private.flow_state(p_trip uuid,p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s jsonb;doc jsonb;
begin
 s:=planzo_private.flow_legacy_state(p_trip,p_actor);doc:=s->'plan'->'document';
 if s->'plan'<>'null'::jsonb then s:=jsonb_set(s,'{plan}',(s->'plan')||jsonb_build_object('requirements_legacy',doc->>'requirements_version' is distinct from '1','own_requirement_checks',planzo_private.flow_requirement_checks(s->'own'->'content',doc)));end if;
 s:=s||jsonb_build_object('ai_available',coalesce((s->>'ai_available')::boolean,false) and coalesce((s->'context'->>'requests_ready')::boolean,false));
 return s;
end$$;

create or replace function planzo_private.flow_api(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if jsonb_typeof(b->'fictional') is distinct from 'boolean' or jsonb_typeof(b->'ai_consent') is distinct from 'boolean' or b->>'version'<>'2' or ((b->>'ai_consent')::boolean and not (b->>'fictional')::boolean) then raise exception 'Check the fictional-input and Gemini choices.';end if;
 foreach k in array array['ceiling_paise','travel_reserve_paise','outbound_minutes','return_minutes'] loop if jsonb_typeof(b->k) is distinct from 'number' or (b->>k)!~'^[0-9]+$' then raise exception 'Enter whole paise and whole travel minutes in the personal summary.';end if;end loop;
 if (b->>'ceiling_paise')!~'^[0-9]+$' or (b->>'travel_reserve_paise')!~'^[0-9]+$' or (b->>'ceiling_paise')::bigint not between 100 and 10000000000 or (b->>'travel_reserve_paise')::bigint<100 or (b->>'travel_reserve_paise')::bigint>=(b->>'ceiling_paise')::bigint then raise exception 'Check your whole-trip ceiling and personal travel allowance.';end if;
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
 if t.name not like 'TEST · AI%' or exists(select 1 from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=trip and m.included and not ((i.content->>'fictional')::boolean and (i.content->>'ai_consent')::boolean)) then raise exception 'Gemini Free Tier requires a labelled fictional AI trip and every included person’s separate consent.';end if;
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
 if step is null or ref is null or ref=step->>'ref' or not(case step->>'kind' when 'activity' then ref='rest' or exists(select 1 from jsonb_array_elements(ctx->'refs') r where r->>'id'=ref) when 'food' then ref in ('food','food_alternative') when 'stay' then ref in ('stay','stay_alternative') else ref in ('rest','rest_alternative') end) then raise exception 'Choose a different supported arrangement for this step.';end if;
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
 insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'flow:'||req,case p_action when 'confirm_input' then 'A traveller confirmed their private summary. Any earlier itinerary needs a new review.' when 'reopen_input' then 'A traveller reopened their private input. Earlier plans remain in history.' when 'generate_finish' then 'A fictional itinerary was generated for all confirmed inputs; personal checks and step decisions remain.' when 'raise_concern' then 'A concern was raised against one itinerary step.' when 'vote' then 'A private step ballot was saved.' when 'close_poll' then 'A step vote was closed; review its result.' when 'resolve_personal' then 'A personal requirement was reviewed by its author.' when 'review' then 'A traveller reviewed the current itinerary and personal estimate.' when 'lock' then 'The organiser locked the resolved itinerary after every included traveller reviewed it. No reservation was made.' else 'The response deadline changed. Earlier plans remain historical.' end);
 result:=planzo_private.flow_state(trip,actor);
 insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,'flow:'||p_action,jsonb_build_object('digest',digest,'response',result));
 return result;
end$$;


revoke all on function planzo_private.flow_reference_cost(text,text),planzo_private.flow_legacy_document(jsonb,jsonb),planzo_private.flow_legacy_state(uuid,uuid),planzo_private.flow_reconcile_document(jsonb,text),planzo_private.flow_requirement_checks(jsonb,jsonb) from public,anon,authenticated;
