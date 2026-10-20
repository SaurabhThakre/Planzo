-- Package 3. Additive workflow-2 booking guidance, no backfill or provider calls.
create table planzo_private.journey_handoffs(
 plan_id uuid primary key references planzo_private.flow_plans(id), revision integer not null default 1 check(revision>0),created_at timestamptz not null default now()
);
create table planzo_private.journey_tasks(
 plan_id uuid not null references planzo_private.journey_handoffs(plan_id),task_key text not null,revision integer not null check(revision>0),
 personal_owner uuid references auth.users(id),owner_id uuid not null references auth.users(id),due_at timestamptz not null,
 basis jsonb not null,source_id text not null default 'unselected',provider_name text not null default '',
 status text not null default 'pending' check(status in ('pending','checked','reported','not_needed','problem')),
 price_paise bigint check(price_paise between 0 and 10000000000),checked_at timestamptz,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 primary key(plan_id,task_key,revision),check(personal_owner is null or personal_owner=owner_id)
);
create index journey_tasks_owner_idx on planzo_private.journey_tasks(owner_id);
create index journey_tasks_personal_idx on planzo_private.journey_tasks(personal_owner);
create index journey_tasks_creator_idx on planzo_private.journey_tasks(created_by);
create table planzo_private.journey_reserves(
 plan_id uuid not null references planzo_private.journey_handoffs(plan_id),user_id uuid not null references auth.users(id),revision integer not null check(revision>0),
 amount_paise bigint not null check(amount_paise between 0 and 10000000000),created_at timestamptz not null default now(),primary key(plan_id,user_id,revision)
);
create index journey_reserves_user_idx on planzo_private.journey_reserves(user_id);
create table planzo_private.journey_reviews(
 plan_id uuid not null references planzo_private.journey_handoffs(plan_id),user_id uuid not null references auth.users(id),revision integer not null,
 created_at timestamptz not null default now(),primary key(plan_id,user_id,revision)
);
create index journey_reviews_user_idx on planzo_private.journey_reviews(user_id);
do $$declare n text;begin
 foreach n in array array['journey_handoffs','journey_tasks','journey_reserves','journey_reviews'] loop
 execute format('alter table planzo_private.%I enable row level security',n);
 execute format('revoke all on planzo_private.%I from public,anon,authenticated',n);
 if n<>'journey_handoffs' then execute format('create trigger %I before update or delete on planzo_private.%I for each row execute function planzo_private.immutable_plan()',n||'_immutable',n);end if;
 end loop;
end$$;

-- Public official search sources, reviewed 17 October 2026. No fares/availability asserted.
create function planzo_private.journey_sources(destination text,category text,title text) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x-'categories'-'goa'-'scuba'),'[]'::jsonb) from jsonb_array_elements('[
 {"id":"manual","label":"A provider I checked directly","url":null,"scope":"Record the provider name and an all-in checked price.","categories":["travel","stay","activity","local"]},
 {"id":"airindia","label":"Air India","url":"https://www.airindia.com/en-in/book-flights/","scope":"Search flights for your route and exact personal travel window.","categories":["travel"]},
 {"id":"indigo","label":"IndiGo","url":"https://www.goindigo.in/","scope":"Search flights; check baggage, transfers and final total.","categories":["travel"]},
 {"id":"irctc","label":"IRCTC","url":"https://www.irctc.co.in/","scope":"Search trains; verify station, dates and arrival time.","categories":["travel"]},
 {"id":"ksrtc","label":"Karnataka KSRTC","url":"https://www.ksrtc.in/","scope":"Search available bus routes. Coverage depends on your starting city.","categories":["travel"]},
 {"id":"booking","label":"Booking.com accommodation search","url":"https://www.booking.com/","scope":"Search the destination and all stay dates; check location, occupancy, taxes and cancellation.","categories":["stay"]},
 {"id":"gtdc_stay","label":"GTDC accommodation catalogue","url":"https://goa-tourism.com/stay/","scope":"Official Goa stays catalogue. Check location and every required night.","categories":["stay"],"goa":true},
 {"id":"calangute","label":"GTDC Calangute Residency","url":"https://goa-tourism.com/stay/calangute-residency/","scope":"Named North Goa stay candidate. Check whether its location fits your steps; no room or rate is confirmed.","categories":["stay"],"goa":true},
 {"id":"goamiles","label":"GoaMiles","url":"https://www.goamiles.com/","scope":"Official local taxi service. Check pickup, time, capacity and quoted fare directly.","categories":["local"],"goa":true},
 {"id":"gtdc_activity","label":"GTDC experiences","url":"https://bookings.goa-tourism.com/","scope":"Official Goa experiences portal. Find the exact activity and check location, duration and conditions.","categories":["activity"],"goa":true},
 {"id":"gtdc_scuba","label":"GTDC FlyingFish scuba information","url":"https://bookings.goa-tourism.com/Appln/UIL/ActivitiesHome?__Mode=AC003","scope":"The official page describes an eight-hour excursion and courses. Short itinerary slots do not fit that excursion. Check current duration and conditions; replan if needed.","minimum_minutes":480,"categories":["activity"],"goa":true,"scuba":true}
 ]'::jsonb) x where x->'categories' ? category and (not coalesce((x->>'goa')::boolean,false) or lower(btrim(destination))='goa') and (not coalesce((x->>'scuba')::boolean,false) or lower(title)~'scuba|diving')
$$;

create function planzo_private.journey_budget(p_plan uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare doc jsonb;content jsonb;floor_amount bigint;reserve_amount bigint;bookings bigint;pending integer;reserve_revision integer;
begin
 select p.document,i.content into doc,content from planzo_private.flow_plans p join planzo_private.flow_inputs i on i.trip_id=p.trip_id and i.user_id=p_actor where p.id=p_plan;
 select (doc->>'cost_paise')::bigint-coalesce(sum((s->>'cost_paise')::bigint) filter(where s->>'kind' in ('stay','activity')),0) into floor_amount from jsonb_array_elements(doc->'steps') s;
 select r.amount_paise,r.revision into reserve_amount,reserve_revision from planzo_private.journey_reserves r where r.plan_id=p_plan and r.user_id=p_actor order by r.revision desc limit 1;
 reserve_amount:=coalesce(reserve_amount,floor_amount);
 with latest as(select distinct on(task_key) * from planzo_private.journey_tasks where plan_id=p_plan order by task_key,revision desc)
 select coalesce(sum(case when status in ('reported','not_needed') or (status='checked' and checked_at>=now()-interval '7 days') then price_paise else (basis->>'estimate_paise')::bigint end),0),count(*) filter(where status not in ('checked','reported','not_needed') or (status='checked' and checked_at<now()-interval '7 days')) into bookings,pending from latest where personal_owner is null or personal_owner=p_actor;
 return jsonb_build_object('floor_paise',floor_amount,'reserve_paise',reserve_amount,'reserve_revision',coalesce(reserve_revision,0),'ceiling_paise',(content->>'ceiling_paise')::bigint,'bookings_paise',bookings,'total_paise',bookings+reserve_amount,'remaining_paise',(content->>'ceiling_paise')::bigint-bookings-reserve_amount,'pending',pending);
end$$;

create function planzo_private.journey_state(p_trip uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare f jsonb:=planzo_private.flow_state(p_trip,p_actor);p uuid:=(f#>>'{plan,id}')::uuid;h integer;tasks jsonb;budget jsonb;reviews integer;n integer;prepared boolean;current_plan boolean;
begin
 select revision into h from planzo_private.journey_handoffs where plan_id=p;
 select count(*) into n from public.planzo_trip_members where trip_id=p_trip and included;
 current_plan:=coalesce((f#>>'{plan,locked}')::boolean,false) and f->>'stage'='agreed';
 with latest as(select distinct on(task_key) * from planzo_private.journey_tasks where plan_id=p order by task_key,revision desc)
 select coalesce(jsonb_agg(jsonb_build_object('key',task_key,'revision',revision,'personal',personal_owner is not null,'owner_id',owner_id,'due_at',due_at,'basis',basis,'source_id',source_id,'provider_name',provider_name,'status',case when status='checked' and checked_at<now()-interval '7 days' then 'pending' else status end,'price_paise',case when status='checked' and checked_at<now()-interval '7 days' then null else price_paise end,'checked_at',checked_at,'sources',planzo_private.journey_sources((select destination from public.planzo_trips where id=p_trip),basis->>'category',basis->>'title')) order by (basis->>'start')::timestamptz,task_key),'[]') into tasks from latest where personal_owner is null or personal_owner=p_actor;
 if h is not null and exists(select 1 from public.planzo_trip_members where trip_id=p_trip and user_id=p_actor and included) then budget:=planzo_private.journey_budget(p,p_actor);end if;
 select count(*) into reviews from planzo_private.journey_reviews r join public.planzo_trip_members m on m.trip_id=p_trip and m.user_id=r.user_id and m.included where r.plan_id=p and r.revision=h;
 prepared:=current_plan and h is not null and reviews=n and not exists(select 1 from (select distinct on(task_key) * from planzo_private.journey_tasks where plan_id=p order by task_key,revision desc) j where status not in ('checked','reported','not_needed') or (status='checked' and checked_at<now()-interval '7 days'));
 return jsonb_build_object('trip_id',p_trip,'trip_revision',(f->>'revision')::integer,'stamp',f->>'stamp','plan_id',p,'version',f#>'{plan,version}','locked',current_plan,'revision',coalesce(h,0),'tasks',tasks,'budget',budget,'reviews',reviews,'included',n,'reviewed',exists(select 1 from planzo_private.journey_reviews where plan_id=p and user_id=p_actor and revision=h),'prepared',prepared,
 'history',(select coalesce(jsonb_agg(jsonb_build_object('plan_version',fp.version,'task',j.task_key,'revision',j.revision,'owner_id',j.owner_id,'status',j.status,'at',j.created_at) order by j.created_at desc),'[]') from planzo_private.journey_tasks j join planzo_private.flow_plans fp on fp.id=j.plan_id where fp.trip_id=p_trip and (j.personal_owner is null or j.personal_owner=p_actor)),
 'earlier_handoffs',(select count(*) from planzo_private.journey_handoffs j join planzo_private.flow_plans fp on fp.id=j.plan_id where fp.trip_id=p_trip and fp.id is distinct from p));
end$$;

create function planzo_private.journey_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<journey_api>>
declare actor uuid:=auth.uid();trip uuid;t public.planzo_trips%rowtype;member public.planzo_trip_members%rowtype;f jsonb;plan uuid;req uuid;digest text;receipt record;result jsonb;h integer;task planzo_private.journey_tasks%rowtype;step jsonb;ref jsonb;input record;v integer;due timestamptz;owner uuid;amount bigint;status text;source text;provider text;price bigint;checked timestamptz;budget jsonb;title text;stay jsonb;total bigint;first_time timestamptz;last_time timestamptz;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception using errcode='42501',message='Sign in with a verified email.';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid request.';end if;
 trip:=(p_payload->>'trip_id')::uuid;
 select * into member from public.planzo_trip_members where trip_id=trip and user_id=actor;
 if member.user_id is null then raise exception using errcode='42501',message='You do not have access to this trip.';end if;
 select * into t from public.planzo_trips where id=trip for update;
 if t.workflow_version<>2 then raise exception 'Use the original booking handoff for this trip.';end if;
 if p_action='get' then
 if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'trip_id') then raise exception 'Unsupported request fields.';end if;
 return planzo_private.journey_state(trip,actor);end if;
 if p_action not in ('prepare','assign','save_task','reserve','review') then raise exception 'Unsupported booking action.';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('trip_id','request_id','expected_trip_revision','expected_stamp','plan_id','expected_revision','task_key','expected_task_revision','owner_id','due_at','source_id','provider_name','status','price_paise','checked_at','acknowledged','amount_paise','expected_reserve_revision')) then raise exception 'Unsupported request fields.';end if;
 req:=(p_payload->>'request_id')::uuid;if req is null then raise exception 'A request identifier is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));digest:=md5(p_payload::text);
 select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
 if found then if receipt.action<>'journey:'||p_action or receipt.result->>'digest'<>digest then raise exception 'This request identifier was already used.';end if;return receipt.result->'response';end if;
 f:=planzo_private.flow_state(trip,actor);plan:=(f#>>'{plan,id}')::uuid;
 if not member.included then raise exception using errcode='42501',message='Only included travellers can contribute.';end if;
 if t.stage<>'agreed' or not coalesce((f#>>'{plan,locked}')::boolean,false) or plan is null then raise exception 'Lock the current resolved itinerary first. Earlier handoffs remain historical.';end if;
 if (p_payload->>'expected_trip_revision')::integer is distinct from t.revision or p_payload->>'expected_stamp' is distinct from f->>'stamp' or (p_payload->>'plan_id')::uuid is distinct from plan then raise exception using errcode='40001',message='The itinerary changed. Refresh before saving.';end if;
 select revision into h from planzo_private.journey_handoffs where plan_id=plan;
 if (p_payload->>'expected_revision')::integer is distinct from coalesce(h,0) then raise exception using errcode='40001',message='Booking arrangements changed. Refresh before saving.';end if;
 if p_action='prepare' then
 if member.role<>'organiser' then raise exception using errcode='42501',message='Only the organiser can prepare the booking handoff.';end if;
 if h is not null then raise exception 'The booking handoff already exists.';end if;
 insert into planzo_private.journey_handoffs(plan_id) values(plan);
 due:=least(now()+interval '1 day',(f#>>'{plan,document,start}')::timestamptz);h:=1;
 -- One stay task covers every locked stay block; costs counted once, per person.
 select coalesce(jsonb_agg(s),'[]'),coalesce(sum((s->>'cost_paise')::bigint),0),min((s->>'start')::timestamptz),max((s->>'end')::timestamptz) into stay,total,first_time,last_time from jsonb_array_elements(f#>'{plan,document,steps}') s where s->>'kind'='stay';
 if jsonb_array_length(stay)>0 then insert into planzo_private.journey_tasks(plan_id,task_key,revision,owner_id,due_at,basis,created_by) values(plan,'stay',1,actor,due,jsonb_build_object('title','Accommodation for every stay block','category','stay','start',first_time,'end',last_time,'blocks',stay,'estimate_paise',total),actor);end if;
 for step in select value from jsonb_array_elements(f#>'{plan,document,steps}') where value->>'kind'='activity' and value->>'ref'<>'rest' loop
 select value into ref from jsonb_array_elements(f#>'{plan,document,refs}') where value->>'id'=step->>'ref';
 insert into planzo_private.journey_tasks(plan_id,task_key,revision,owner_id,due_at,basis,created_by) values(plan,step->>'id',1,actor,due,jsonb_build_object('title',coalesce(ref->>'title','Activity arrangement'),'category','activity','start',step->>'start','end',step->>'end','ref',step->>'ref','estimate_paise',(step->>'cost_paise')::bigint),actor);
 end loop;
 insert into planzo_private.journey_tasks(plan_id,task_key,revision,owner_id,due_at,basis,created_by) values(plan,'local',1,actor,due,jsonb_build_object('title','Pre-booked local transfers, if needed','category','local','start',f#>>'{plan,document,start}','end',f#>>'{plan,document,end}','estimate_paise',0),actor);
 for input in select i.user_id,i.content from planzo_private.flow_inputs i join public.planzo_trip_members m using(trip_id,user_id) where i.trip_id=trip and m.included loop
 foreach title in array array['outbound','return'] loop
 first_time:=case when title='outbound' then (input.content->>'start')::timestamptz else (input.content->>'end')::timestamptz-make_interval(mins=>(input.content->>'return_minutes')::integer) end;
 last_time:=case when title='outbound' then (input.content->>'start')::timestamptz+make_interval(mins=>(input.content->>'outbound_minutes')::integer) else (input.content->>'end')::timestamptz end;
 insert into planzo_private.journey_tasks(plan_id,task_key,revision,personal_owner,owner_id,due_at,basis,created_by) values(plan,title||':'||input.user_id,1,input.user_id,input.user_id,least(due,(input.content->>'start')::timestamptz),jsonb_build_object('title',case when title='outbound' then 'Outbound · '||(input.content->>'origin')||' → '||t.destination else 'Return · '||t.destination||' → '||(input.content->>'origin') end,'category','travel','leg',title,'start',first_time,'end',last_time,'estimate_paise',case when title='outbound' then (input.content->>'travel_reserve_paise')::bigint/2 else (input.content->>'travel_reserve_paise')::bigint-(input.content->>'travel_reserve_paise')::bigint/2 end),actor);
 end loop;end loop;
 else
 if h is null then raise exception 'Ask the organiser to prepare the booking handoff first.';end if;
 if p_action in ('assign','save_task') then
 select * into task from planzo_private.journey_tasks j where j.plan_id=plan and j.task_key=p_payload->>'task_key' and (j.personal_owner is null or j.personal_owner=actor) order by j.revision desc limit 1;
 if task.task_key is null then raise exception 'This booking task is unavailable.';end if;
 if (p_payload->>'expected_task_revision')::integer is distinct from task.revision then raise exception using errcode='40001',message='This task changed. Refresh before saving.';end if;
 if p_action='assign' then
 if member.role<>'organiser' or task.personal_owner is not null then raise exception using errcode='42501',message='Only the organiser assigns shared responsibilities.';end if;
 owner:=(p_payload->>'owner_id')::uuid;due:=(p_payload->>'due_at')::timestamptz;
 if not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=owner and included) or due is null or due>(task.basis->>'start')::timestamptz then raise exception 'Choose an included owner and a due date no later than this arrangement starts.';end if;
 insert into planzo_private.journey_tasks(plan_id,task_key,revision,personal_owner,owner_id,due_at,basis,created_by) values(plan,task.task_key,task.revision+1,null,owner,due,task.basis,actor);
 else
 if task.owner_id<>actor then raise exception using errcode='42501',message='Only the assigned owner can record a provider check.';end if;
 source:=p_payload->>'source_id';provider:=btrim(coalesce(p_payload->>'provider_name',''));status:=p_payload->>'status';
 if source is null or not exists(select 1 from jsonb_array_elements(planzo_private.journey_sources(t.destination,task.basis->>'category',task.basis->>'title')) s where s->>'id'=source) then raise exception 'Choose one of this task’s sourced options.';end if;
 if length(provider)>100 or (source='manual' and length(provider)<1) then raise exception 'Enter the directly checked provider name (up to 100 characters).';end if;
 if status is null or status not in ('pending','checked','reported','not_needed','problem') or (status='not_needed' and task.basis->>'category'<>'local') then raise exception 'Only optional local transfers can be marked not needed. Revise the itinerary for other changes.';end if;
 if status in ('checked','reported','not_needed') then
 if exists(select 1 from jsonb_array_elements(planzo_private.journey_sources(t.destination,task.basis->>'category',task.basis->>'title')) s where s->>'id'=source and (s->>'minimum_minutes')::integer>extract(epoch from ((task.basis->>'end')::timestamptz-(task.basis->>'start')::timestamptz))/60) then raise exception 'The sourced excursion duration does not fit this locked step. Choose a fitting arrangement or replan.';end if;
 if p_payload->'acknowledged' is distinct from 'true'::jsonb or jsonb_typeof(p_payload->'price_paise') is distinct from 'number' or p_payload->>'price_paise'!~'^[0-9]+$' then raise exception 'Confirm the all-in price, dates, requirements and terms you checked.';end if;
 price:=(p_payload->>'price_paise')::bigint;checked:=(p_payload->>'checked_at')::timestamptz;
 if price not between 0 and 10000000000 or checked is null or checked>now()+interval '1 minute' or checked<now()-interval '7 days' or (status='not_needed' and price<>0) then raise exception 'Enter a recent checked date and valid all-in price; not-needed transfers cost zero.';end if;
 else price:=null;checked:=null;end if;
 insert into planzo_private.journey_tasks(plan_id,task_key,revision,personal_owner,owner_id,due_at,basis,source_id,provider_name,status,price_paise,checked_at,created_by) values(plan,task.task_key,task.revision+1,task.personal_owner,actor,task.due_at,task.basis,source,provider,status,price,checked,actor);
 end if;
 elsif p_action='reserve' then
 budget:=planzo_private.journey_budget(plan,actor);
 if (p_payload->>'expected_reserve_revision')::integer is distinct from (budget->>'reserve_revision')::integer then raise exception using errcode='40001',message='Your reserve changed. Refresh before saving.';end if;
 if p_payload->'acknowledged' is distinct from 'true'::jsonb or jsonb_typeof(p_payload->'amount_paise') is distinct from 'number' or p_payload->>'amount_paise'!~'^[0-9]+$' then raise exception 'Confirm your private on-trip expense reserve.';end if;
 amount:=(p_payload->>'amount_paise')::bigint;
 if amount<(budget->>'floor_paise')::bigint or amount>10000000000 then raise exception 'Keep at least the meal, fee and contingency allowance for on-trip spending.';end if;
 insert into planzo_private.journey_reserves(plan_id,user_id,revision,amount_paise) values(plan,actor,(budget->>'reserve_revision')::integer+1,amount);
 else
 budget:=planzo_private.journey_budget(plan,actor);
 if p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Review and acknowledge this exact booking handoff.';end if;
 if (budget->>'reserve_revision')::integer=0 or (budget->>'pending')::integer>0 or (budget->>'remaining_paise')::bigint<0 then raise exception 'Check every shared and personal task, save your expense reserve and stay within your private ceiling first.';end if;
 insert into planzo_private.journey_reviews(plan_id,user_id,revision) values(plan,actor,h) on conflict do nothing;
 end if;
 if p_action<>'review' then update planzo_private.journey_handoffs set revision=revision+1 where plan_id=plan;end if;
 end if;
 insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'journey:'||req,case when p_action='review' then 'A traveller reviewed the current booking handoff. Reservations remain self-reported.' else 'Booking arrangements changed. Everyone needs to review the current handoff; earlier records remain historical.' end);
 result:=planzo_private.journey_state(trip,actor);
 insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,'journey:'||p_action,jsonb_build_object('digest',digest,'response',result));return result;
end$$;
create function public.planzo_journey(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select planzo_private.journey_api(p_action,p_payload) $$;
revoke all on function planzo_private.journey_sources(text,text,text),planzo_private.journey_budget(uuid,uuid),planzo_private.journey_state(uuid,uuid),planzo_private.journey_api(text,jsonb),public.planzo_journey(text,jsonb) from public,anon,authenticated;
grant execute on function planzo_private.journey_api(text,jsonb),public.planzo_journey(text,jsonb) to authenticated;
