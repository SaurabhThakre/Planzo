-- Additive shared booking reports. No payment, supplier reservation or budget mutation.
create table planzo_private.flow_booking_events (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.planzo_trips(id),
 plan_id uuid not null references planzo_private.flow_plans(id),
 step_id text not null check(length(step_id) between 1 and 100),
 revision integer not null check(revision>0),
 status text not null check(status in ('not_booked','in_progress','booked','cancelled','not_needed')),
 provider_name text not null check(length(provider_name)<=120),
 amount_paise bigint check(amount_paise between 0 and 10000000000),
 booked_by uuid references auth.users(id), booked_by_name text,
 reference text not null check(length(reference)<=120),
 notes text not null check(length(notes)<=500),
 actor uuid not null references auth.users(id), actor_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 request_id uuid not null, payload_hash text not null,
 step_title text not null, step_start timestamptz not null, step_end timestamptz not null,
 unique(plan_id,step_id,revision),unique(actor,request_id),
 check(status<>'booked' or (provider_name<>'' and amount_paise is not null and booked_by is not null))
);
create index flow_booking_events_history on planzo_private.flow_booking_events(trip_id,created_at desc);
create index flow_booking_events_booked_by on planzo_private.flow_booking_events(booked_by);
alter table planzo_private.flow_booking_events enable row level security;
revoke all on planzo_private.flow_booking_events from public,anon,authenticated;

create function planzo_private.booking_tracker_state(p_trip uuid,p_plan uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('plan_id',p.id,'version',p.version,
 'editable',t.removal_kind is null and t.stage='agreed' and p.stamp=planzo_private.flow_stamp(t.id)
   and exists(select 1 from planzo_private.flow_locks l where l.plan_id=p.id)
   and not exists(select 1 from planzo_private.flow_plans n where n.trip_id=t.id and n.version>p.version),
 'records',coalesce((select jsonb_agg(to_jsonb(e)-'payload_hash'-'request_id'-'trip_id') from
   (select distinct on(step_id) * from planzo_private.flow_booking_events where plan_id=p.id order by step_id,revision desc)e),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(h)-'payload_hash'-'request_id'-'trip_id') from
   (select e.*,v.version as plan_version from planzo_private.flow_booking_events e join planzo_private.flow_plans v on v.id=e.plan_id
    where e.trip_id=t.id order by e.created_at desc,e.id desc limit 50)h),'[]'::jsonb))
 from planzo_private.flow_plans p join public.planzo_trips t on t.id=p.trip_id where p.id=p_plan and t.id=p_trip;
$$;
revoke all on function planzo_private.booking_tracker_state(uuid,uuid) from public,anon,authenticated;

create function planzo_private.booking_tracker_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid();trip uuid;pid uuid;req uuid;sid text;expected integer;actual integer;
 t public.planzo_trips%rowtype;p planzo_private.flow_plans%rowtype;prior planzo_private.flow_booking_events%rowtype;
 s jsonb;r jsonb;item jsonb;title text;provider text;amount bigint;booker uuid;booker_name text;editor_name text;
 stat text;ref text;note text;digest text;major boolean;free_entry boolean;
begin
 if actor_id is null or not exists(select 1 from auth.users where id=actor_id and email_confirmed_at is not null
  and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then
  raise exception using errcode='42501',message='Sign in with a verified email.';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action not in ('get','save') or p_action is null then raise exception 'Invalid booking request.';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('trip_id','plan_id','step_id','expected_revision','request_id','status','provider_name','amount_paise','booked_by','reference','notes')) then raise exception 'Unsupported booking fields.';end if;
 trip:=(p_payload->>'trip_id')::uuid;pid:=(p_payload->>'plan_id')::uuid;
 select * into t from public.planzo_trips where id=trip for update;
 select display_name into editor_name from public.planzo_trip_members where trip_id=trip and user_id=actor_id and included;
 if not found then raise exception using errcode='42501',message='Only included travellers can access booking details.';end if;
 select * into p from planzo_private.flow_plans where id=pid and trip_id=trip;
 if p.id is null or t.workflow_version<>2 then raise exception 'This itinerary is unavailable.';end if;
 if p_action='get' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('trip_id','plan_id')) then raise exception 'Unsupported booking read fields.';end if;
  return planzo_private.booking_tracker_state(trip,pid);
 end if;
 req:=(p_payload->>'request_id')::uuid;
 if req is null then raise exception 'A request identifier is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor_id::text||req::text,0));
 digest:=md5(p_payload::text);
 select * into prior from planzo_private.flow_booking_events where actor=actor_id and request_id=req;
 if found then
  if prior.payload_hash<>digest then raise exception 'This booking request identifier was already used.';end if;
  return planzo_private.booking_tracker_state(trip,pid);
 end if;
 if not coalesce((planzo_private.booking_tracker_state(trip,pid)->>'editable')::boolean,false) then raise exception 'Booking updates need the current locked itinerary on an active trip. Refresh the trip.';end if;
 sid:=p_payload->>'step_id';
 select value into s from jsonb_array_elements(p.document->'steps') where value->>'id'=sid;
 if s is null or s->>'kind' not in ('stay','activity') then raise exception 'Choose a stay, major activity or pre-bookable transfer in this itinerary.';end if;
 select value into r from jsonb_array_elements(p.document->'refs') where value->>'id'=case when s->>'kind'='activity' then s->>'ref' else coalesce(s->>'route_ref',case when s->>'ref'=s->>'kind' then s->>'detail_ref' end) end;
 item:=r->'route_item';title:=coalesce(r->>'title',case when s->>'kind'='stay' then 'Stay / overnight rest' else 'Activity' end);
 major:=title ~* '\m(tours?|guided|heritage walk|cruise|class|workshop|safari|scuba|kayak(ing)?|surf(ing)?|tickets?)\M';
 free_entry:=coalesce(item#>>'{price,low_inr}'='0',false) or coalesce(item#>>'{price,assumptions}','') ~* '(free (entry|admission|access)|no (entry|admission) fee)';
 if s->>'kind'='activity' then
  if item->>'category'='transfer' then
   if not coalesce(item->>'mode'='taxi' or (item->>'mode' in ('ferry','rail','bus') and item->>'title' ~* '\m(reserved|private|airport|express|coach|shuttle|high-speed)\M'),false) then raise exception 'This transfer does not need advance booking.';end if;
  elsif (item is not null and item->>'category'<>'visit') or (not major and (free_entry or coalesce((s->>'cost_paise')::bigint,0)<=0)) then raise exception 'This stop does not need advance booking.';
  end if;
 end if;
 if jsonb_typeof(p_payload->'expected_revision') is distinct from 'number' or (p_payload->>'expected_revision') !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'Refresh booking details before saving.';end if;
 expected:=(p_payload->>'expected_revision')::integer;
 select coalesce(max(revision),0) into actual from planzo_private.flow_booking_events where plan_id=pid and step_id=sid;
 if actual<>expected then raise exception using errcode='40001',message='Another traveller updated this booking. Refresh bookings, then review your changes.';end if;
 stat:=p_payload->>'status';
 if stat is null or stat not in ('not_booked','in_progress','booked','cancelled','not_needed') then raise exception 'Choose a valid booking status.';end if;
 if jsonb_typeof(p_payload->'provider_name') is distinct from 'string' or jsonb_typeof(p_payload->'reference') is distinct from 'string' or jsonb_typeof(p_payload->'notes') is distinct from 'string' then raise exception 'Enter text booking details.';end if;
 provider:=btrim(p_payload->>'provider_name');ref:=btrim(p_payload->>'reference');note:=btrim(p_payload->>'notes');
 if length(provider)>120 or length(ref)>120 or length(note)>500 then raise exception 'Booking details are too long.';end if;
 if p_payload->'amount_paise' is not null and p_payload->'amount_paise'<>'null'::jsonb then
  if jsonb_typeof(p_payload->'amount_paise')<>'number' or p_payload->>'amount_paise' !~ '^(0|[1-9][0-9]{0,10})$' then raise exception 'Enter a non-negative INR amount with at most two decimals.';end if;
  amount:=(p_payload->>'amount_paise')::bigint;
  if amount>10000000000 then raise exception 'Amount is too large.';end if;
 end if;
 booker:=nullif(p_payload->>'booked_by','')::uuid;
 if booker is not null then
  select display_name into booker_name from public.planzo_trip_members where trip_id=trip and user_id=booker and included;
  if not found then raise exception 'Choose an included traveller as the person who booked.';end if;
 end if;
 if stat='booked' and (provider='' or amount is null or booker is null) then raise exception 'Booked needs a provider, total paid and the traveller who booked.';end if;
 insert into planzo_private.flow_booking_events(trip_id,plan_id,step_id,revision,status,provider_name,amount_paise,booked_by,booked_by_name,reference,notes,actor,actor_name,request_id,payload_hash,step_title,step_start,step_end)
 values(trip,pid,sid,actual+1,stat,provider,amount,booker,booker_name,ref,note,actor_id,editor_name,req,digest,title,(s->>'start')::timestamptz,(s->>'end')::timestamptz);
 return planzo_private.booking_tracker_state(trip,pid);
end;
$$;
revoke all on function planzo_private.booking_tracker_api(text,jsonb) from public,anon;
grant execute on function planzo_private.booking_tracker_api(text,jsonb) to authenticated;
create function public.planzo_booking_tracker(p_action text,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select planzo_private.booking_tracker_api(p_action,p_payload);$$;
revoke all on function public.planzo_booking_tracker(text,jsonb) from public,anon;
grant execute on function public.planzo_booking_tracker(text,jsonb) to authenticated;
