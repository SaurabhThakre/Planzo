-- Additive manual itinerary slice. Target only ewysgpuwvufbklesdhuj.
-- Prices/times are a fictional teaching catalogue, never live quotes or bookings.
do $$ declare name text; expected text; actual text; begin
 for name,expected in select * from (values
 ('evaluate_plan','22b9d83caabaf38b6a5f2f4b6146a05f3b1d6a78343699191d1af63d2dbc3d83'),
 ('invalidate_planning','e0fac5fa52eab57b26ca2b7e19f2db04293d240a8a56066b8249226e8b8b91e6'),
 ('planning_api','363ee8a1c72abf1377a2ae087bec67bbf76a1f01574fca3fe512cd850b8c3cb8'),
 ('planning_state','f14cb2f33bca3bf1e6a37f97ce67e400228aaaececa22b9f4d38f3a4d5a766fe')) v(name,expected) loop
  select encode(extensions.digest(p.prosrc,'sha256'),'hex') into actual from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='planzo_private' and p.proname=name;
  if actual is distinct from expected then raise exception 'Planning baseline differs for %. Stop and inspect before applying.',name; end if;
 end loop;
end $$;
create table planzo_private.itinerary_drafts (
  trip_id uuid primary key references public.planzo_trips(id),
  source_revision integer not null,
  window_id uuid not null,
  items jsonb not null check(jsonb_typeof(items)='object'),
  catalogue_snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  foreign key(trip_id,window_id) references public.planzo_trip_windows(trip_id,id)
);
create table planzo_private.itinerary_polls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.planzo_trips(id),
  source_revision integer not null,
  slot_id text not null,
  roster uuid[] not null check(cardinality(roster) between 4 and 8),
  options jsonb not null,
  deadline timestamptz not null,
  status text not null check(status in ('open','closed','stale','unresolved')),
  result jsonb,
  created_at timestamptz not null default now(),
  unique(trip_id,id)
);
create index planzo_itinerary_window_idx on planzo_private.itinerary_drafts(trip_id,window_id);
create unique index planzo_one_item_poll_idx on planzo_private.itinerary_polls(trip_id) where status='open';
create index planzo_item_polls_trip_idx on planzo_private.itinerary_polls(trip_id,created_at desc,id desc);
create table planzo_private.itinerary_ballots (
  trip_id uuid not null,
  poll_id uuid not null,
  user_id uuid not null,
  revision integer not null check(revision>0),
  choice text not null check(length(choice) between 1 and 64),
  updated_at timestamptz not null default now(),
  primary key(poll_id,user_id),
  foreign key(trip_id,poll_id) references planzo_private.itinerary_polls(trip_id,id),
  foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id)
);
create index planzo_item_ballots_member_idx on planzo_private.itinerary_ballots(trip_id,user_id);
create index planzo_item_ballots_poll_idx on planzo_private.itinerary_ballots(trip_id,poll_id);
alter table planzo_private.itinerary_drafts enable row level security;
alter table planzo_private.itinerary_polls enable row level security;
alter table planzo_private.itinerary_ballots enable row level security;
revoke all on planzo_private.itinerary_drafts,planzo_private.itinerary_polls,planzo_private.itinerary_ballots from public,anon,authenticated;

insert into planzo_private.planning_catalogues(id,content) values('goa-items-v1','{
 "label":"Illustrative Goa item catalogue · not live quotes",
 "source":"Manual item extension of Trip Pact Prototype Playbook v1, page 14; fictional amounts and timing",
 "source_date":"2026-10-16","illustrative":true,"currency":"INR","origin":"bengaluru","destination":"goa",
 "days":3,"nights":2,"vehicle_capacity":8,"room_capacity":2,"step_free_verified":false,
 "fees":[20000,30000],"boat":[80000,100000],"contingency_percent":10,
 "assumptions":["Bengaluru to Goa only; three calendar days and two nights, departure by 06:00 and return by 22:00 IST.","Item prices and time slots are fictional planning allowances, not provider quotes, available inventory or reservations.","Twin rooms are recalculated for the included roster; the villa allowance covers up to eight. Exact paise shares preserve shared totals.","Food and local transport allowances cover all three days. Fees and 10% contingency are always included.","Optional boat is Day 2, 15:00–17:00, charged only to opted-in travellers; others have free time.","Provider availability, journey timing and accessibility require independent checking before booking."],
 "slots":[
  {"id":"outbound","label":"Outbound travel","day":1,"kind":"travel","timing":"Day 1 · 06:00–12:00 IST","default":"outbound_allowance","choices":["outbound_allowance"]},
  {"id":"local","label":"Local travel","day":1,"kind":"allowance","timing":"All three days · transfer and local travel allowance","default":"shared_vehicle","choices":["shared_vehicle"]},
  {"id":"food","label":"Food for the trip","day":1,"kind":"allowance","timing":"All three days · vegetarian choices included","default":"local_thali","choices":["local_thali","regular_food"]},
  {"id":"activity_1","label":"Day 1 afternoon","day":1,"kind":"activity","timing":"Day 1 · 15:00–17:00 IST","default":"beach","choices":["beach","heritage","free_time"]},
  {"id":"stay_1","label":"Night 1 stay","day":1,"kind":"stay","timing":"Night after Day 1 · check-in 14:00, check-out Day 2 at 10:00 IST","default":"twin_hotel","choices":["twin_hotel","shared_villa"]},
  {"id":"activity_2","label":"Day 2 morning","day":2,"kind":"activity","timing":"Day 2 · 10:00–13:00 IST","default":"beach","choices":["beach","heritage","free_time"]},
  {"id":"stay_2","label":"Night 2 stay","day":2,"kind":"stay","timing":"Night after Day 2 · check-in 14:00, check-out Day 3 at 10:00 IST","default":"twin_hotel","choices":["twin_hotel","shared_villa"]},
  {"id":"return","label":"Return travel","day":3,"kind":"travel","timing":"Day 3 · 16:00–22:00 IST","default":"return_allowance","choices":["return_allowance"]}
 ],
 "choices":{
  "outbound_allowance":{"title":"Bengaluru → Goa travel allowance","basis":"person","price":[175000,210000]},
  "return_allowance":{"title":"Goa → Bengaluru travel allowance","basis":"person","price":[175000,210000]},
  "shared_vehicle":{"title":"Shared vehicle and transfers","basis":"shared","price":[540000,660000]},
  "twin_hotel":{"title":"Twin-room hotel allowance","basis":"room","price":[160000,200000]},
  "shared_villa":{"title":"Shared villa allowance · up to eight","basis":"shared","price":[520000,640000]},
  "local_thali":{"title":"Local thali and simple meals","basis":"person","price":[130000,160000]},
  "regular_food":{"title":"Cafés and mixed dining","basis":"person","price":[140000,170000]},
  "beach":{"title":"Beach and coast time","basis":"person","price":[10000,30000]},
  "heritage":{"title":"Churches and heritage walk","basis":"person","price":[30000,50000]},
  "free_time":{"title":"Unscheduled free time","basis":"person","price":[0,0]}
 }
}'::jsonb);

-- All client item IDs are resolved against the server catalogue. Costs never come from a client.
create function planzo_private.evaluate_itinerary(p_trip uuid,p_window uuid,p_items jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.planzo_trips%rowtype; w public.planzo_trip_windows%rowtype; cat jsonb;
 roster uuid[]; inputs jsonb:='{}'; costs jsonb:='{}'; blockers jsonb:='[]'; gaps jsonb:='[]';
 slot jsonb; fact jsonb; price jsonb; chosen text; m record; b jsonb; rows jsonb;
 n integer; rooms integer; pos integer:=0; seen integer:=0; lo bigint; hi bigint; sublo bigint; subhi bigint; shared_hi bigint:=0;
 bad_input boolean:=false; bad_date boolean:=false; bad_price boolean:=false; bad_requirement boolean:=false; bad_budget boolean:=false;
begin
 select * into t from public.planzo_trips where id=p_trip;
 select * into w from public.planzo_trip_windows where trip_id=p_trip and id=p_window;
 select content into cat from planzo_private.planning_catalogues where id='goa-items-v1';
 select coalesce(array_agg(user_id order by user_id),'{}') into roster from public.planzo_trip_members where trip_id=p_trip and included;
 n:=cardinality(roster); rooms:=(n+1)/2;
 if n<t.minimum_group_size or n>8 then blockers:=blockers||jsonb_build_array('Confirm an included roster that meets the trip minimum (four to eight).'); end if;
 if w.id is null then blockers:=blockers||jsonb_build_array('Choose a travel window belonging to this trip.'); end if;
 if cat is null or lower(btrim(t.destination))<>cat->>'destination' or n>coalesce((cat->>'vehicle_capacity')::integer,0)
   or (w.ends_at at time zone 'Asia/Kolkata')::date-(w.starts_at at time zone 'Asia/Kolkata')::date<>2
   or (w.starts_at at time zone 'Asia/Kolkata')::time>time '06:00'
   or (w.ends_at at time zone 'Asia/Kolkata')::time<time '22:00' then bad_price:=true; end if;
 if jsonb_typeof(p_items) is distinct from 'object' then raise exception 'Choose supported itinerary items.'; end if;
 if exists(select 1 from jsonb_object_keys(p_items) k where not exists(select 1 from jsonb_array_elements(cat->'slots') s where s->>'id'=k)) then raise exception 'Unsupported itinerary slot.'; end if;
 for slot in select value from jsonb_array_elements(cat->'slots') loop
  chosen:=p_items->> (slot->>'id');
  if chosen is null then gaps:=gaps||jsonb_build_array(jsonb_build_object('slot_id',slot->>'id','message','Choose an arrangement for '||(slot->>'label')||'.'));
  elsif not (slot->'choices' ? chosen) then raise exception 'This choice does not belong to this itinerary slot.';
  else
   fact:=cat->'choices'->chosen; price:=fact->'price';
   if jsonb_typeof(price) is distinct from 'array' then bad_price:=true;
   elsif jsonb_array_length(price)<>2 then bad_price:=true;
   elsif coalesce(price->>0,'') !~ '^[0-9]+$' or coalesce(price->>1,'') !~ '^[0-9]+$' then bad_price:=true;
   elsif (price->>0)::bigint>(price->>1)::bigint or fact->>'basis' not in ('person','room','shared') then bad_price:=true; end if;
  end if;
 end loop;
 for chosen in select unnest(array['fees','boat']) loop
  price:=cat->chosen;
  if jsonb_typeof(price) is distinct from 'array' then bad_price:=true;
  elsif jsonb_array_length(price)<>2 then bad_price:=true;
  elsif coalesce(price->>0,'') !~ '^[0-9]+$' or coalesce(price->>1,'') !~ '^[0-9]+$' then bad_price:=true;
  elsif (price->>0)::bigint>(price->>1)::bigint then bad_price:=true; end if;
 end loop;
 for m in select mm.user_id,s.revision,s.confirmed,d.content from public.planzo_trip_members mm
  join public.planzo_brief_status s using(trip_id,user_id) left join planzo_private.member_brief_drafts d using(trip_id,user_id)
  where mm.trip_id=p_trip and mm.included order by mm.user_id loop
  seen:=seen+1; pos:=pos+1; b:=m.content; inputs:=inputs||jsonb_build_object(m.user_id::text,m.revision);
  if not m.confirmed or b is null then bad_input:=true; continue; end if;
  if not coalesce(b->'windows' ? p_window::text,false) then bad_date:=true; end if;
  if lower(btrim(b->>'origin')) is distinct from cat->>'origin' then bad_price:=true; end if;
  if coalesce((b->>'step_free')::boolean,false) and not coalesce((cat->>'step_free_verified')::boolean,false) then bad_requirement:=true; end if;
 end loop;
 if seen<>n then bad_input:=true; end if;
 if bad_input then blockers:=blockers||jsonb_build_array('Every included traveller needs current confirmed private input.'); end if;
 if bad_date then blockers:=blockers||jsonb_build_array('This window does not fit the included group. Try another window or revise the proposal.'); end if;
 if bad_requirement then blockers:=blockers||jsonb_build_array('A required accessibility fact is unverified. Confirm suitable arrangements before review.'); end if;
 if bad_price then blockers:=blockers||jsonb_build_array('Complete supported prices and timing are unavailable. This reference covers Bengaluru to Goa, three days and two nights.'); end if;
 if jsonb_array_length(gaps)>0 then blockers:=blockers||jsonb_build_array('The itinerary has missing steps. Fill each required stay, travel and activity/free-time slot before review.'); end if;
 if not bad_price and jsonb_array_length(gaps)=0 and n>0 then
  pos:=0;
  for m in select mm.user_id,d.content from public.planzo_trip_members mm left join planzo_private.member_brief_drafts d using(trip_id,user_id) where mm.trip_id=p_trip and mm.included order by mm.user_id loop
   pos:=pos+1; b:=m.content; rows:='[]'; sublo:=0; subhi:=0;
   for slot in select value from jsonb_array_elements(cat->'slots') loop
    chosen:=p_items->>(slot->>'id'); fact:=cat->'choices'->chosen; lo:=(fact->'price'->>0)::bigint; hi:=(fact->'price'->>1)::bigint;
    if fact->>'basis'='room' then lo:=lo*rooms; hi:=hi*rooms; end if;
    if fact->>'basis' in ('room','shared') then lo:=planzo_private.money_share(lo,n,pos);hi:=planzo_private.money_share(hi,n,pos); end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('label',(slot->>'label')||' · '||(fact->>'title'),'range',jsonb_build_array(lo,hi)));
    sublo:=sublo+lo; subhi:=subhi+hi;
   end loop;
   lo:=(cat->'fees'->>0)::bigint;hi:=(cat->'fees'->>1)::bigint;sublo:=sublo+lo;subhi:=subhi+hi;
   rows:=rows||jsonb_build_array(jsonb_build_object('label','Fees and incidentals','range',cat->'fees'));shared_hi:=shared_hi+subhi;
   if coalesce((b->>'boat')::boolean,false) then
    rows:=rows||jsonb_build_array(jsonb_build_object('label','Your optional boat · Day 2, 15:00–17:00','range',cat->'boat'));
    sublo:=sublo+(cat->'boat'->>0)::bigint;subhi:=subhi+(cat->'boat'->>1)::bigint;
   end if;
   lo:=sublo/10;hi:=(subhi+9)/10;
   rows:=rows||jsonb_build_array(jsonb_build_object('label','Contingency · 10%','range',jsonb_build_array(lo,hi)));
   if b->>'ceiling_paise' is null then bad_input:=true;
   elsif subhi+hi>(b->>'ceiling_paise')::bigint then bad_budget:=true; end if;
   costs:=costs||jsonb_build_object(m.user_id::text,jsonb_build_object('rows',rows,'total',jsonb_build_array(sublo+lo,subhi+hi),'complete',true,'boat',coalesce((b->>'boat')::boolean,false)));
  end loop;
 end if;
 if bad_budget then blockers:=blockers||jsonb_build_array('This complete itinerary does not fit the group’s private limits. Try a cheaper item or revise the proposal.'); end if;
 return jsonb_build_object('blockers',blockers,'gaps',gaps,'roster',roster,'inputs',inputs,'costs',costs,'upper_shared',shared_hi,'catalogue',cat,'rooms',rooms,'complete',not bad_price and jsonb_array_length(gaps)=0 and not bad_input);
end $$;

alter table planzo_private.plan_versions drop constraint plan_versions_option_id_check;
alter table planzo_private.plan_versions add constraint plan_versions_option_id_check check(option_id in ('common','easy','itinerary'));
alter function planzo_private.evaluate_plan(uuid,text,uuid) rename to evaluate_reference_plan;
create function planzo_private.evaluate_plan(p_trip uuid,p_option text,p_window uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d planzo_private.itinerary_drafts%rowtype; e jsonb;
begin
 if p_option is distinct from 'itinerary' then return planzo_private.evaluate_reference_plan(p_trip,p_option,p_window); end if;
 select * into d from planzo_private.itinerary_drafts where trip_id=p_trip;
 if d.trip_id is null or d.window_id<>p_window then return jsonb_build_object('blockers',jsonb_build_array('The itinerary needs fresh checking.'),'complete',false); end if;
 e:=planzo_private.evaluate_itinerary(p_trip,p_window,d.items);
 if d.source_revision<>(select revision from public.planzo_trips where id=p_trip) or d.catalogue_snapshot is distinct from e->'catalogue'
  or exists(select 1 from planzo_private.itinerary_polls where trip_id=p_trip and status in ('open','unresolved')) then
  e:=jsonb_set(e,'{blockers}',(e->'blockers')||jsonb_build_array('The itinerary or item decision needs fresh checking.'));
 end if;
 return e;
end $$;

create or replace function planzo_private.invalidate_planning() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.revision<>old.revision then
  update planzo_private.plan_polls set status='stale' where trip_id=new.id and status in ('open','unresolved');
  update planzo_private.itinerary_polls set status='stale' where trip_id=new.id and status in ('open','unresolved');
  if new.stage in ('reviewing','agreed') then new.stage:='revise'; end if;
 end if;
 return new;
end $$;

create function planzo_private.itinerary_state(p_trip uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.planzo_trips%rowtype;d planzo_private.itinerary_drafts%rowtype;p planzo_private.itinerary_polls%rowtype;
 cat jsonb;e jsonb;poll jsonb;options jsonb:='[]';key text;opt jsonb;wins jsonb:='[]';win record;
begin
 select * into t from public.planzo_trips where id=p_trip;
 select content into cat from planzo_private.planning_catalogues where id='goa-items-v1';
 select * into d from planzo_private.itinerary_drafts where trip_id=p_trip;
 if d.trip_id is not null then e:=planzo_private.evaluate_itinerary(p_trip,d.window_id,d.items); end if;
 for win in select w.id,not exists(select 1 from public.planzo_trip_members m left join public.planzo_brief_status s using(trip_id,user_id)
   left join planzo_private.member_brief_drafts b using(trip_id,user_id) where m.trip_id=p_trip and m.included and (not coalesce(s.confirmed,false) or not coalesce(b.content->'windows' ? w.id::text,false))) compatible
   from public.planzo_trip_windows w where w.trip_id=p_trip order by w.starts_at loop
  wins:=wins||jsonb_build_array(jsonb_build_object('id',win.id,'compatible',win.compatible));
 end loop;
 select * into p from planzo_private.itinerary_polls where trip_id=p_trip order by created_at desc,id desc limit 1;
 if p.id is not null then
  for key,opt in select * from jsonb_each(p.options) loop
   options:=options||jsonb_build_array(jsonb_build_object('id',key,'title',p.options->key->'catalogue'->'choices'->key->>'title','own_cost',opt->'costs'->p_actor::text));
  end loop;
  poll:=jsonb_build_object('id',p.id,'slot_id',p.slot_id,'source_revision',p.source_revision,'roster',p.roster,'deadline',p.deadline,
   'status',case when p.status in ('open','unresolved') and (p.source_revision<>t.revision or d.catalogue_snapshot is distinct from cat) then 'stale' else p.status end,
   'options',options,'responded',(select count(*) from planzo_private.itinerary_ballots where poll_id=p.id),
   'own_ballot',(select jsonb_build_object('choice',choice,'revision',revision) from planzo_private.itinerary_ballots where poll_id=p.id and user_id=p_actor),
   'result',case when p.status in ('closed','unresolved') then p.result else null end);
 end if;
 return jsonb_build_object('revision',t.revision,'stage',t.stage,'deadline',t.response_deadline,'catalogue',cat,'windows',wins,
  'draft',case when d.trip_id is not null then jsonb_build_object('source_revision',d.source_revision,'current',d.source_revision=t.revision and d.catalogue_snapshot=cat,'window_id',d.window_id,'items',d.items,
   'gaps',e->'gaps','blockers',e->'blockers','own_cost',case when (e->>'complete')::boolean then e->'costs'->p_actor::text else null end,'rooms',e->'rooms') else null end,'poll',poll);
end $$;

create function planzo_private.itinerary_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();trip uuid;role_name text;t public.planzo_trips%rowtype;d planzo_private.itinerary_drafts%rowtype;p planzo_private.itinerary_polls%rowtype;v planzo_private.plan_versions%rowtype;
 req uuid;request_hash text;receipt record;cat jsonb;new_items jsonb;slot jsonb;e jsonb;other jsonb;opts jsonb;key text;choice text;a text;b text;winner text;
 window_id uuid;deadline timestamptz;roster uuid[];n integer;ca integer;cb integer;different integer;current_rev integer;result jsonb;lines jsonb;structured jsonb;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception using errcode='42501',message='Sign in with a verified email to continue.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid request.'; end if;
 for key in select jsonb_object_keys(p_payload) loop
  if key not in ('trip_id','request_id','expected_revision','window_id','slot_id','choice','choice_a','choice_b','deadline','poll_id','expected_ballot_revision') then raise exception 'Unsupported request field.'; end if;
 end loop;
 trip:=(p_payload->>'trip_id')::uuid;
 select role into role_name from public.planzo_trip_members where trip_id=trip and user_id=actor;
 if role_name is null then raise exception using errcode='42501',message='You do not have access to this trip.'; end if;
 select * into t from public.planzo_trips where id=trip for update;
 if p_action='get' then return planzo_private.itinerary_state(trip,actor); end if;
 if p_action not in ('prepare','set_item','open_poll','vote','close_poll','cancel_poll','publish_plan') then raise exception 'Unknown itinerary action.'; end if;
 if p_action<>'vote' and role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can manage this itinerary.'; end if;
 req:=(p_payload->>'request_id')::uuid;if req is null then raise exception 'A request identifier is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));request_hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
 if found then
  if receipt.action<>'itinerary:'||p_action or receipt.request_hash is distinct from request_hash then raise exception 'This request identifier was already used for different input.'; end if;
  return receipt.result;
 end if;
 if (p_payload->>'expected_revision')::integer is distinct from t.revision then raise exception using errcode='40001',message='This trip changed. Refresh and review the latest saved state before trying again.'; end if;
 if t.stage in ('postponed','archived') then raise exception 'This trip is postponed or archived.'; end if;
 if p_action not in ('close_poll','cancel_poll') and t.response_deadline<=now() then raise exception 'The response deadline passed. Extend, revise or postpone.'; end if;
 select content into cat from planzo_private.planning_catalogues where id='goa-items-v1';
 select * into d from planzo_private.itinerary_drafts where trip_id=trip;
 if p_action='prepare' then
  window_id:=(p_payload->>'window_id')::uuid;
  if not exists(select 1 from public.planzo_trip_windows where trip_id=trip and id=window_id) then raise exception 'Choose a travel window belonging to this trip.'; end if;
  -- Rechecking preserves deliberate missing steps and manual choices; first start supplies a labelled template.
  new_items:=coalesce(d.items,(select jsonb_object_agg(s->>'id',s->>'default') from jsonb_array_elements(cat->'slots') s));
  perform planzo_private.evaluate_itinerary(trip,window_id,new_items);
  update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
  insert into planzo_private.itinerary_drafts(trip_id,source_revision,window_id,items,catalogue_snapshot) values(trip,t.revision,window_id,new_items,cat)
   on conflict(trip_id) do update set source_revision=excluded.source_revision,window_id=excluded.window_id,items=excluded.items,catalogue_snapshot=excluded.catalogue_snapshot,updated_at=now();
  result:=jsonb_build_object('prepared',true);
 else
  if d.trip_id is null or d.source_revision<>t.revision or d.catalogue_snapshot is distinct from cat then raise exception 'The itinerary is stale. Recheck it after the latest input, roster or catalogue change.'; end if;
  if p_action in ('set_item','open_poll','publish_plan') and (exists(select 1 from planzo_private.itinerary_polls where trip_id=trip and status in ('open','unresolved')) or exists(select 1 from planzo_private.plan_polls where trip_id=trip and status in ('open','unresolved'))) then raise exception 'Resolve or end the current poll before changing the itinerary.'; end if;
  if p_action in ('set_item','open_poll') then
   select value into slot from jsonb_array_elements(cat->'slots') where value->>'id'=p_payload->>'slot_id';
   if slot is null then raise exception 'Choose a supported itinerary slot.'; end if;
  end if;
  if p_action='set_item' then
   choice:=p_payload->>'choice';
   if choice is not null and not (slot->'choices' ? choice) then raise exception 'This choice does not belong to this itinerary slot.'; end if;
   new_items:=jsonb_set(d.items,array[slot->>'id'],coalesce(to_jsonb(choice),'null'::jsonb));
   perform planzo_private.evaluate_itinerary(trip,d.window_id,new_items);
   update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
   update planzo_private.itinerary_drafts set items=new_items,source_revision=t.revision,updated_at=now() where trip_id=trip;
   result:=jsonb_build_object('saved',true);
  elsif p_action='open_poll' then
   a:=p_payload->>'choice_a';b:=p_payload->>'choice_b';
   if a is null or b is null or a=b or not (slot->'choices' ? a) or not (slot->'choices' ? b) then raise exception 'Choose two different supported choices for this same item.'; end if;
   e:=planzo_private.evaluate_itinerary(trip,d.window_id,jsonb_set(d.items,array[slot->>'id'],to_jsonb(a)));
   other:=planzo_private.evaluate_itinerary(trip,d.window_id,jsonb_set(d.items,array[slot->>'id'],to_jsonb(b)));
   if jsonb_array_length(e->'blockers')>0 or jsonb_array_length(other->'blockers')>0 then raise exception 'Both alternatives need a complete itinerary that fits every included traveller. Fill other missing steps and review the safe blockers.'; end if;
   deadline:=(p_payload->>'deadline')::timestamptz;
   if deadline is null or deadline<=now() or deadline>t.response_deadline then raise exception 'Choose a future poll deadline no later than the response deadline.'; end if;
   update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
   update planzo_private.itinerary_drafts set source_revision=t.revision,updated_at=now() where trip_id=trip;
   select array_agg(value::uuid order by value::uuid) into roster from jsonb_array_elements_text(e->'roster');
   insert into planzo_private.itinerary_polls(trip_id,source_revision,slot_id,roster,options,deadline,status) values(trip,t.revision,slot->>'id',roster,jsonb_build_object(a,e,b,other),deadline,'open') returning * into p;
   result:=jsonb_build_object('poll_id',p.id);
  elsif p_action in ('vote','close_poll','cancel_poll') then
   select * into p from planzo_private.itinerary_polls where trip_id=trip and id=(p_payload->>'poll_id')::uuid;
   if p.id is null or p.source_revision<>t.revision or p.status not in ('open','unresolved') then raise exception 'This item poll is closed, stale or belongs to another trip.'; end if;
   if p_action='cancel_poll' then
    update planzo_private.itinerary_polls set status='stale' where id=p.id;
    update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
    update planzo_private.itinerary_drafts set source_revision=t.revision,updated_at=now() where trip_id=trip;
    result:=jsonb_build_object('cancelled',true);
   else
    if p.status<>'open' then raise exception 'This poll is unresolved. End it and propose fresh choices.'; end if;
    for key in select jsonb_object_keys(p.options) loop
     e:=planzo_private.evaluate_itinerary(trip,d.window_id,jsonb_set(d.items,array[p.slot_id],to_jsonb(key)));
     if jsonb_array_length(e->'blockers')>0 or e->'catalogue' is distinct from p.options->key->'catalogue' then raise exception 'The item poll needs fresh feasibility checking.'; end if;
    end loop;
    if p_action='vote' then
     if now()>=p.deadline then raise exception 'This item poll deadline passed.'; end if;
     if not actor=any(p.roster) then raise exception 'Only included travellers can vote.'; end if;
     choice:=p_payload->>'choice';
     if choice is null or (not (p.options ? choice) and choice not in ('abstain','different')) then raise exception 'Choose an option from this item poll, abstain or request a different option.'; end if;
     select revision into current_rev from planzo_private.itinerary_ballots where poll_id=p.id and user_id=actor;
     if (p_payload->>'expected_ballot_revision')::integer is distinct from coalesce(current_rev,0) then raise exception 'Your ballot changed in another tab. Refresh before replacing it.'; end if;
     insert into planzo_private.itinerary_ballots(trip_id,poll_id,user_id,revision,choice) values(trip,p.id,actor,coalesce(current_rev,0)+1,choice)
      on conflict(poll_id,user_id) do update set choice=excluded.choice,revision=excluded.revision,updated_at=now();
     result:=jsonb_build_object('saved',true);
    else
     select min(k),max(k) into a,b from jsonb_object_keys(p.options) k;
     select count(*),count(*) filter(where bb.choice=a),count(*) filter(where bb.choice=b),count(*) filter(where bb.choice='different') into n,ca,cb,different from planzo_private.itinerary_ballots bb where poll_id=p.id;
     if now()<p.deadline and n<cardinality(p.roster) then raise exception 'Wait for every ballot or the stated deadline. Missing ballots are not votes.'; end if;
     winner:=null;
     if different=0 and ca+cb>0 then
      if ca>cb then winner:=a; elsif cb>ca then winner:=b;
      elsif (p.options->a->>'upper_shared')::bigint<(p.options->b->>'upper_shared')::bigint then winner:=a;
      elsif (p.options->b->>'upper_shared')::bigint<(p.options->a->>'upper_shared')::bigint then winner:=b; end if;
     end if;
     update planzo_private.itinerary_polls set status=case when winner is null then 'unresolved' else 'closed' end,result=jsonb_build_object('counts',jsonb_build_object(a,ca,b,cb),'abstain',n-ca-cb-different,'different',different,'missing',cardinality(p.roster)-n,'winner',winner) where id=p.id;
     if winner is not null then
      update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
      update planzo_private.itinerary_drafts set items=jsonb_set(d.items,array[p.slot_id],to_jsonb(winner)),source_revision=t.revision,updated_at=now() where trip_id=trip;
     end if;
     result:=jsonb_build_object('winner',winner);
    end if;
   end if;
  elsif p_action='publish_plan' then
   e:=planzo_private.evaluate_itinerary(trip,d.window_id,d.items);
   if jsonb_array_length(e->'blockers')>0 then raise exception 'Complete all missing steps and hard checks before sharing a review version.'; end if;
   select * into v from planzo_private.plan_versions where trip_id=trip order by version desc limit 1;
   if v.id is not null and v.source_revision=t.revision and v.option_id='itinerary' then result:=jsonb_build_object('plan_id',v.id,'version',v.version);
   else
    select coalesce(max(version),0)+1 into n from planzo_private.plan_versions where trip_id=trip;
    select array_agg(value::uuid order by value::uuid) into roster from jsonb_array_elements_text(e->'roster');
    select jsonb_agg(to_jsonb((s->>'timing')||' · '||(cat->'choices'->(d.items->>(s->>'id'))->>'title')) order by ord),
     jsonb_agg(jsonb_build_object('slot_id',s->>'id','day',s->'day','kind',s->>'kind','timing',s->>'timing','choice',d.items->>(s->>'id'),'title',cat->'choices'->(d.items->>(s->>'id'))->>'title') order by ord)
     into lines,structured from jsonb_array_elements(cat->'slots') with ordinality x(s,ord);
    insert into planzo_private.plan_versions(trip_id,version,source_revision,window_id,option_id,roster,input_revisions,catalogue_snapshot,content)
     values(trip,n,t.revision,d.window_id,'itinerary',roster,e->'inputs',cat,jsonb_build_object('title','Our Goa itinerary','rooms',e->'rooms','currency','INR','estimate_basis','illustrative_item_reference','contingency_percent',10,'itinerary',lines,'structured_items',structured,'optional','Day 2, 15:00–17:00: optional boat for opted-in travellers; others have free time. All prices, timing and arrangements require checking before booking.')) returning * into v;
    insert into planzo_private.plan_costs(trip_id,plan_id,user_id,content) select trip,v.id,j.key::uuid,j.value from jsonb_each(e->'costs') j;
    update public.planzo_trips set stage='reviewing',updated_at=now() where id=trip;
    insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'version:'||v.id,'Plan v'||v.version||' shared for individual review. Every included traveller must respond again.');
    result:=jsonb_build_object('plan_id',v.id,'version',v.version);
   end if;
  end if;
 end if;
 if p_action not in ('vote','publish_plan') then
  insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,req::text,case p_action
   when 'prepare' then 'One itinerary checked. Existing versions remain historical when the context changes.'
   when 'set_item' then 'An itinerary item changed. Costs and all final responses need fresh review.'
   when 'open_poll' then 'An item poll opened for two complete feasible alternatives. Live totals stay private.'
   when 'close_poll' then 'An item poll closed. Its result changes only the draft and never grants readiness.'
   else 'The organiser ended an item poll explicitly. No preference or agreement was inferred.' end);
 end if;
 insert into planzo_private.operation_receipts(user_id,request_id,action,request_hash,result) values(actor,req,'itinerary:'||p_action,request_hash,result);
 return result;
end $$;

create function public.planzo_itinerary(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select planzo_private.itinerary_api(p_action,p_payload)$$;
revoke all on function planzo_private.evaluate_itinerary(uuid,uuid,jsonb),planzo_private.evaluate_plan(uuid,text,uuid),planzo_private.itinerary_state(uuid,uuid),planzo_private.itinerary_api(text,jsonb),public.planzo_itinerary(text,jsonb) from public,anon,authenticated;
grant execute on function planzo_private.itinerary_api(text,jsonb),public.planzo_itinerary(text,jsonb) to authenticated;

-- Preserve legacy version reads; current item plans use their own catalogue snapshot.
create or replace function planzo_private.planning_state(p_trip uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.planzo_trips%rowtype; d planzo_private.planning_drafts%rowtype;
  v planzo_private.plan_versions%rowtype; p planzo_private.plan_polls%rowtype;
  response record; e jsonb; cat jsonb; opts jsonb:='[]'; plan jsonb; poll jsonb;
  current_version boolean:=false; statuses jsonb:='[]'; own_response jsonb; history jsonb;
  responded integer; latest_revision integer; key text;
begin
  select * into t from public.planzo_trips where id=p_trip;
  select content into cat from planzo_private.planning_catalogues where id='goa-reference-v1';
  select * into d from planzo_private.planning_drafts where trip_id=p_trip;
  if d.trip_id is not null then
    for key,e in select * from jsonb_each(d.options) loop opts:=opts||jsonb_build_array(planzo_private.safe_option(key,e,p_actor)); end loop;
  end if;
  select * into v from planzo_private.plan_versions where trip_id=p_trip order by version desc limit 1;
  if v.id is not null then
    if v.option_id='itinerary' then select content into cat from planzo_private.planning_catalogues where id='goa-items-v1'; end if;
    e:=planzo_private.evaluate_plan(p_trip,v.option_id,v.window_id);
    current_version:=v.source_revision=t.revision and v.catalogue_snapshot=cat and jsonb_array_length(e->'blockers')=0
      and t.stage not in ('postponed','archived','collecting','revise');
    for response in select distinct on (r.user_id) r.user_id,r.status,r.brief_revision,r.revision,r.created_at
      from planzo_private.plan_responses r where r.plan_id=v.id order by r.user_id,r.revision desc loop
      statuses:=statuses||jsonb_build_array(jsonb_build_object('user_id',response.user_id,'status',response.status,'at',response.created_at));
    end loop;
    select jsonb_build_object('status',r.status,'revision',r.revision,'private_reason',r.private_reason,'acknowledged',r.acknowledged)
      into own_response from planzo_private.plan_responses r where r.plan_id=v.id and r.user_id=p_actor order by r.revision desc limit 1;
    plan:=jsonb_build_object('id',v.id,'version',v.version,'source_revision',v.source_revision,'window_id',v.window_id,
      'option_id',v.option_id,'roster',v.roster,'content',v.content,'catalogue',v.catalogue_snapshot,'created_at',v.created_at,
      'current',current_version,'responses',statuses,'own_response',own_response,
      'own_cost',(select c.content from planzo_private.plan_costs c where c.plan_id=v.id and c.user_id=p_actor));
  end if;
  select * into p from planzo_private.plan_polls where trip_id=p_trip order by created_at desc,id desc limit 1;
  if p.id is not null then
    select count(*) into responded from planzo_private.poll_ballots where poll_id=p.id;
    poll:=jsonb_build_object('id',p.id,'source_revision',p.source_revision,'roster',p.roster,'deadline',p.deadline,
      'status',case when p.status in ('open','unresolved') and (p.source_revision<>t.revision or p.options->'common'->'catalogue'<>cat) then 'stale' else p.status end,
      'responded',responded,'result',case when p.status in ('closed','unresolved') then p.result else null end,
      'own_ballot',(select jsonb_build_object('choice',choice,'revision',revision) from planzo_private.poll_ballots where poll_id=p.id and user_id=p_actor));
  end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]') into history from (
    select jsonb_build_object('id',id,'message',message,'created_at',created_at) x from planzo_private.planning_events where trip_id=p_trip order by created_at desc,id desc limit 40
  ) h;
  return jsonb_build_object('revision',t.revision,'stage',t.stage,'deadline',t.response_deadline,'catalogue',cat,
    'draft',case when d.trip_id is not null then jsonb_build_object('source_revision',d.source_revision,'current',d.source_revision=t.revision and d.options->'common'->'catalogue'=cat,'window_id',d.window_id,'selected_option',d.selected_option,'options',opts) else null end,
    'plan',plan,'poll',poll,'history',history,
    'versions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',version,'created_at',created_at) order by version desc) from planzo_private.plan_versions where trip_id=p_trip),'[]'));
end $$;

