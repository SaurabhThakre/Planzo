-- Trip Pact ewysgpuwvufbklesdhuj. Additive v2 workflow; existing trips remain v1.
alter table public.planzo_trips add column workflow_version smallint not null default 1 check(workflow_version in (1,2));
create table planzo_private.flow_inputs(
 trip_id uuid not null,user_id uuid not null,revision integer not null check(revision>0),confirmed boolean not null,content jsonb not null,
 primary key(trip_id,user_id),foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id)
);
create table planzo_private.flow_input_versions(
 trip_id uuid not null,user_id uuid not null,revision integer not null,content jsonb not null,created_at timestamptz not null default now(),
 primary key(trip_id,user_id,revision),foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id)
);
create table planzo_private.flow_plans(
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.planzo_trips(id),version integer not null,
 stamp text not null,document jsonb not null,created_at timestamptz not null default now(),unique(trip_id,version)
);
create table planzo_private.flow_reviews(
 plan_id uuid not null references planzo_private.flow_plans(id),user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(plan_id,user_id)
);
create table planzo_private.flow_locks(
 plan_id uuid primary key references planzo_private.flow_plans(id),actor uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table planzo_private.flow_polls(
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.planzo_trips(id),stamp text not null,step_id text not null,base_ref text not null,
 options jsonb not null,mode text not null check(mode in ('choice','concern')),author uuid not null references auth.users(id),hard boolean not null default false,
 personal_resolved boolean not null default false,deadline timestamptz not null,status text not null default 'open' check(status in ('open','closed','unresolved','stale')),
 result jsonb,created_at timestamptz not null default now()
);
create index flow_polls_trip_idx on planzo_private.flow_polls(trip_id,created_at);
create table planzo_private.flow_ballots(
 poll_id uuid not null references planzo_private.flow_polls(id),user_id uuid not null references auth.users(id),choice text not null,revision integer not null check(revision>0),primary key(poll_id,user_id)
);
create table planzo_private.flow_ai_receipts(
 actor uuid not null references auth.users(id),request_id uuid not null,trip_id uuid not null references public.planzo_trips(id),stamp text not null,used boolean not null default false,created_at timestamptz not null default now(),primary key(actor,request_id)
);
create index flow_ai_trip_idx on planzo_private.flow_ai_receipts(trip_id,created_at);
do $$declare n text;begin
 foreach n in array array['flow_inputs','flow_input_versions','flow_plans','flow_reviews','flow_locks','flow_polls','flow_ballots','flow_ai_receipts'] loop
 execute format('alter table planzo_private.%I enable row level security',n);
 execute format('revoke all on planzo_private.%I from public,anon,authenticated',n);
 end loop;
end$$;
create trigger flow_input_history_immutable before update or delete on planzo_private.flow_input_versions for each row execute function planzo_private.immutable_plan();
create trigger flow_plan_history_immutable before update or delete on planzo_private.flow_plans for each row execute function planzo_private.immutable_plan();
create trigger flow_locks_immutable before update or delete on planzo_private.flow_locks for each row execute function planzo_private.immutable_plan();
create trigger flow_reviews_immutable before update or delete on planzo_private.flow_reviews for each row execute function planzo_private.immutable_plan();

create function planzo_private.flow_stamp(p_trip uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(t.revision::text||coalesce(string_agg(m.user_id::text||':'||coalesce(i.revision,0)||':'||coalesce(i.confirmed,false)::text,',' order by m.user_id),''))
 from public.planzo_trips t join public.planzo_trip_members m on m.trip_id=t.id and m.included
 left join planzo_private.flow_inputs i on i.trip_id=m.trip_id and i.user_id=m.user_id where t.id=p_trip group by t.id
$$;
create function planzo_private.flow_context(p_trip uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
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
 return jsonb_build_object('stamp',planzo_private.flow_stamp(p_trip),'start',lo,'end',hi,'destination',t.destination,'refs',refs);
end$$;

create function planzo_private.flow_document(ctx jsonb,choice jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
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

create function planzo_private.flow_state(p_trip uuid,p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
<<flow_state>>
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
 'responded',(select count(*) from planzo_private.flow_ballots where poll_id=p.id),'own_requirement',p.author=p_actor and p.hard,'personal_resolved',case when p.author=p_actor then p.personal_resolved else null end) order by p.created_at,p.id) from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_state.stamp and ctx is not null),'[]'),
 'personal_checks_pending',exists(select 1 from planzo_private.flow_polls p where p.trip_id=p_trip and p.stamp=flow_state.stamp and p.hard and not p.personal_resolved),
 'history',coalesce((select jsonb_agg(x order by x->>'created_at' desc) from(select jsonb_build_object('id',p.id,'version',p.version,'created_at',p.created_at,'locked',exists(select 1 from planzo_private.flow_locks l where l.plan_id=p.id)) x from planzo_private.flow_plans p where p.trip_id=p_trip order by version desc limit 40) q),'[]'));
end$$;

create function planzo_private.flow_api(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if exists(select 1 from jsonb_object_keys(p_payload) x where x not in ('trip_id','request_id','expected_revision','expected_input_revision','expected_stamp','content','acknowledged','choice','poll_id','expected_ballot_revision','step_id','replacement','hard','deadline','plan_id')) then raise exception 'Unsupported request fields.';end if;
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
 if p_payload->'acknowledged' is distinct from 'true'::jsonb or jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>15
 or exists(select 1 from jsonb_object_keys(b) x where x not in ('origin','window_id','start','end','outbound_minutes','return_minutes','ceiling_paise','travel_reserve_paise','interests','places','hard','soft','fictional','ai_consent','version')) then raise exception 'Review and confirm your complete summary.';end if;
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
 if t.name not like 'TEST · AI%' or exists(select 1 from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=trip and m.included and not ((i.content->>'fictional')::boolean and (i.content->>'ai_consent')::boolean)) then raise exception 'Gemini Free Tier requires a labelled fictional AI trip and every included person’s separate consent.';end if;
 if exists(select 1 from planzo_private.flow_ai_receipts r where r.actor=flow_api.actor and r.request_id=req) then raise exception 'This generation attempt was already used.';end if;
 if exists(select 1 from planzo_private.flow_ai_receipts where trip_id=trip and created_at>now()-interval '3 seconds') then raise exception 'Please wait a moment before generating again.';end if;
 insert into planzo_private.flow_ai_receipts(actor,request_id,trip_id,stamp) values(actor,req,trip,stamp);
 return ctx;
 elsif p_action='generate_finish' then
 select * into ai_receipt from planzo_private.flow_ai_receipts r where r.actor=flow_api.actor and r.request_id=req and r.trip_id=trip for update;
 if ai_receipt.request_id is null or ai_receipt.used or ai_receipt.stamp<>stamp or ai_receipt.created_at<now()-interval '2 minutes' then raise exception 'The generation attempt expired or inputs changed.';end if;
 ctx:=planzo_private.flow_context(trip);doc:=planzo_private.flow_document(ctx,p_payload->'choice');
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
 -- Reference costs remain conservative when a vote changes an activity to free time.
 insert into planzo_private.flow_plans(trip_id,version,stamp,document) values(trip,plan.version+1,stamp,doc);
 end if;
 end if;
 elsif p_action in ('review','lock') then
 if (p_payload->>'plan_id')::uuid is distinct from plan.id or p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception using errcode='40001',message='Review and acknowledge the current itinerary version.';end if;
 if exists(select 1 from planzo_private.flow_polls p where p.trip_id=trip and p.stamp=flow_api.stamp and p.status in ('open','unresolved')) or exists(select 1 from planzo_private.flow_polls p where p.trip_id=trip and p.stamp=flow_api.stamp and p.hard and not p.personal_resolved) then raise exception 'Resolve the step votes and personal must-have concerns first.';end if;
 if jsonb_array_length(plan.document->'unplaced')>0 then raise exception 'Some shared choices do not fit. Review the shareable choices and generate a new plan.';end if;
 if p_action='review' then
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

create function public.planzo_flow(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select planzo_private.flow_api(p_action,p_payload)$$;
revoke all on function planzo_private.flow_stamp(uuid),planzo_private.flow_context(uuid),planzo_private.flow_document(jsonb,jsonb),planzo_private.flow_state(uuid,uuid),planzo_private.flow_api(text,jsonb),public.planzo_flow(text,jsonb) from public,anon,authenticated;
grant execute on function planzo_private.flow_api(text,jsonb),public.planzo_flow(text,jsonb) to authenticated;

do $patch$declare definition text;body text;n text;expected text;
begin
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid='planzo_private.api(text,jsonb)'::regprocedure;
 if md5(body)<>'9709c834f82af874b53ecc41cbf857a9' then raise exception 'Unexpected core API baseline';end if;
 definition:=replace(definition,'response_deadline,tentative_days)','response_deadline,tentative_days,workflow_version)');
 definition:=replace(definition,'coalesce((p_payload->>''tentative_days'')::integer,3))','coalesce((p_payload->>''tentative_days'')::integer,3),2)');
 definition:=replace(definition,'elsif p_action=''save_brief'' then','elsif p_action=''save_brief'' then'||chr(10)||'    if exists(select 1 from public.planzo_trips where id=trip and workflow_version=2) then raise exception ''Use the private conversation and confirmed summary for this trip.'';end if;');
 if position('tentative_days,workflow_version)' in definition)=0 or position('private conversation' in definition)=0 then raise exception 'Core workflow patch failed';end if;
 execute definition;
 foreach n in array array['planning_api','itinerary_api'] loop
 expected:=case n when 'planning_api' then 'f822b6abe689099a1beb3c19af6ccec6' else '2f43d69477730aacfd206467ddabbf60' end;
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid=('planzo_private.'||n||'(text,jsonb)')::regprocedure;
 if md5(body)<>expected then raise exception 'Unexpected legacy planning API baseline';end if;
 definition:=replace(definition,chr(10)||'begin',chr(10)||'begin'||chr(10)||' if p_action<>''get'' and exists(select 1 from public.planzo_trips where id=(p_payload->>''trip_id'')::uuid and workflow_version=2) then raise exception ''Use the current planning workflow for this trip.'';end if;');
 if position('current planning workflow' in definition)=0 then raise exception 'Legacy planning guard patch failed';end if;execute definition;
 end loop;
end$patch$;
