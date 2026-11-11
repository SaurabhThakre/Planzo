-- Trip-scoped expense ledger. Settlements only record externally completed payments.
create table planzo_private.flow_payment_booking_shares(
 plan_id uuid not null references planzo_private.flow_plans(id),step_id text not null,
 trip_id uuid not null references public.planzo_trips(id),participants uuid[] not null,
 split_mode text not null default 'equal' check(split_mode in ('equal','exact')),
 shares jsonb not null default '[]',revision integer not null default 1,
 primary key(plan_id,step_id)
);
create index flow_payment_booking_trip on planzo_private.flow_payment_booking_shares(trip_id);
create table planzo_private.flow_payment_expenses(
 id uuid primary key,trip_id uuid not null references public.planzo_trips(id),
 title text not null check(length(title) between 1 and 120),amount_paise bigint not null check(amount_paise between 1 and 10000000000),
 payer_id uuid not null references auth.users(id),kind text not null check(kind in ('expense','refund')),
 split_mode text not null check(split_mode in ('equal','exact')),shares jsonb not null,
 paid_on date not null,notes text not null check(length(notes)<=500),voided boolean not null default false,
 revision integer not null default 1,actor uuid not null references auth.users(id),updated_at timestamptz not null default clock_timestamp()
);
create index flow_payment_expenses_trip on planzo_private.flow_payment_expenses(trip_id);
create index flow_payment_expenses_payer on planzo_private.flow_payment_expenses(payer_id);
create index flow_payment_expenses_actor on planzo_private.flow_payment_expenses(actor);
create table planzo_private.flow_payment_settlements(
 id uuid primary key,trip_id uuid not null references public.planzo_trips(id),
 from_id uuid not null references auth.users(id),to_id uuid not null references auth.users(id),check(from_id<>to_id),
 amount_paise bigint not null check(amount_paise between 1 and 10000000000),
 method text not null check(method in ('UPI','Cash','Bank transfer','Other')),paid_on date not null,
 notes text not null check(length(notes)<=500),status text not null default 'pending' check(status in ('pending','confirmed','rejected','cancelled')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index flow_payment_settlements_trip on planzo_private.flow_payment_settlements(trip_id);
create index flow_payment_settlements_from on planzo_private.flow_payment_settlements(from_id);
create index flow_payment_settlements_to on planzo_private.flow_payment_settlements(to_id);
create table planzo_private.flow_payment_events(
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.planzo_trips(id),
 entity_id text not null,action text not null,actor uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),body jsonb not null
);
create index flow_payment_events_trip on planzo_private.flow_payment_events(trip_id,created_at desc);
create index flow_payment_events_actor on planzo_private.flow_payment_events(actor);
alter table planzo_private.flow_payment_booking_shares enable row level security;
alter table planzo_private.flow_payment_expenses enable row level security;
alter table planzo_private.flow_payment_settlements enable row level security;
alter table planzo_private.flow_payment_events enable row level security;
revoke all on planzo_private.flow_payment_booking_shares,planzo_private.flow_payment_expenses,planzo_private.flow_payment_settlements,planzo_private.flow_payment_events from public,anon,authenticated;

create function planzo_private.payment_equal_shares(p_amount bigint,p_members uuid[]) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('user_id',id,'amount_paise',p_amount/n+case when i<=p_amount%n then 1 else 0 end) order by id),'[]'::jsonb)
 from (select id,row_number() over(order by id) i,count(*) over() n from(select distinct unnest(p_members) id)x)y;
$$;
revoke all on function planzo_private.payment_equal_shares(bigint,uuid[]) from public,anon,authenticated;

create function planzo_private.payment_check_shares(p_trip uuid,p_amount bigint,p_mode text,p_shares jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare members uuid[];total bigint;normalized jsonb;
begin
 if p_mode is null or p_mode not in ('equal','exact') or jsonb_typeof(p_shares) is distinct from 'array' then raise exception 'Choose an equal or exact split.';end if;
 if jsonb_array_length(p_shares) not between 1 and 200 then raise exception 'Choose at least one traveller to split with.';end if;
 if exists(select 1 from jsonb_array_elements(p_shares) e where jsonb_typeof(e)<>'object'
  or not(e ?& array['user_id','amount_paise']) or exists(select 1 from jsonb_object_keys(e) k where k not in ('user_id','amount_paise'))
  or jsonb_typeof(e->'user_id')<>'string' or jsonb_typeof(e->'amount_paise')<>'number' or e->>'amount_paise' !~ '^(0|[1-9][0-9]{0,10})$') then raise exception 'Invalid split details.';end if;
 select array_agg((e->>'user_id')::uuid order by (e->>'user_id')::uuid),sum((e->>'amount_paise')::bigint),jsonb_agg(jsonb_build_object('user_id',(e->>'user_id')::uuid,'amount_paise',(e->>'amount_paise')::bigint) order by (e->>'user_id')::uuid) into members,total,normalized from jsonb_array_elements(p_shares)e;
 if cardinality(members)<>(select count(distinct x) from unnest(members)x) or exists(select 1 from unnest(members)x where not exists(select 1 from public.planzo_trip_members m where m.trip_id=p_trip and m.user_id=x)) then raise exception 'Choose distinct travellers from this trip.';end if;
 if total<>p_amount then raise exception 'Shares must add up exactly to the total.';end if;
 if p_mode='equal' and normalized<>planzo_private.payment_equal_shares(p_amount,members) then raise exception 'Equal shares must use the exact paise allocation.';end if;
 return normalized;
end;$$;
revoke all on function planzo_private.payment_check_shares(uuid,bigint,text,jsonb) from public,anon,authenticated;

create function planzo_private.payment_capture_booking() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.amount_paise is not null and new.booked_by is not null then
  insert into planzo_private.flow_payment_booking_shares(plan_id,step_id,trip_id,participants)
  select new.plan_id,new.step_id,new.trip_id,array(select distinct id from(
   select user_id id from public.planzo_trip_members where trip_id=new.trip_id and included union select new.booked_by)x order by id)
  on conflict(plan_id,step_id) do nothing;
  insert into planzo_private.flow_payment_events(trip_id,entity_id,action,actor,body)
  values(new.trip_id,'booking:'||new.plan_id||':'||new.step_id,'booking_sync',new.actor,
   jsonb_build_object('title',new.step_title,'amount_paise',new.amount_paise,'payer_id',new.booked_by,'booking_revision',new.revision,'status',new.status));
 end if;
 return new;
end;$$;
revoke all on function planzo_private.payment_capture_booking() from public,anon,authenticated;
create trigger flow_booking_payment_capture after insert on planzo_private.flow_booking_events for each row execute function planzo_private.payment_capture_booking();
-- Adopt existing paid records once without modifying their immutable booking events.
insert into planzo_private.flow_payment_booking_shares(plan_id,step_id,trip_id,participants)
select b.plan_id,b.step_id,b.trip_id,array(select distinct id from(
 select user_id id from public.planzo_trip_members where trip_id=b.trip_id and included union select b.booked_by)x order by id)
from(select distinct on(plan_id,step_id) * from planzo_private.flow_booking_events where amount_paise is not null and booked_by is not null order by plan_id,step_id,revision desc)b;

create function planzo_private.payment_entries(p_trip uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with booking as(select distinct on(plan_id,step_id) * from planzo_private.flow_booking_events where trip_id=p_trip and amount_paise is not null and booked_by is not null order by plan_id,step_id,revision desc),
 entries as(
 select jsonb_build_object('id','booking:'||b.plan_id||':'||b.step_id,'source','booking','plan_id',b.plan_id,'step_id',b.step_id,'plan_version',p.version,
 'booking_revision',b.revision,'revision',s.revision,'title',b.step_title,'amount_paise',b.amount_paise,'payer_id',b.booked_by,'kind','expense','voided',false,
 'split_mode',s.split_mode,'shares',case when s.split_mode='equal' then planzo_private.payment_equal_shares(b.amount_paise,s.participants) else s.shares end,
 'needs_review',s.split_mode='exact' and coalesce((select sum((x->>'amount_paise')::bigint) from jsonb_array_elements(s.shares)x),-1)<>b.amount_paise,
 'paid_on',(b.created_at at time zone 'Asia/Kolkata')::date,'notes',b.notes,'provider_name',b.provider_name,'reference',b.reference,'booking_status',b.status,'updated_at',b.created_at) value
 from booking b join planzo_private.flow_payment_booking_shares s using(plan_id,step_id) join planzo_private.flow_plans p on p.id=b.plan_id where b.amount_paise>0
 union all
 select (to_jsonb(e)-'trip_id')||jsonb_build_object('source','manual','needs_review',false) from planzo_private.flow_payment_expenses e where e.trip_id=p_trip
 ) select coalesce(jsonb_agg(value order by value->>'paid_on' desc,value->>'id'),'[]'::jsonb) from entries;
$$;
revoke all on function planzo_private.payment_entries(uuid) from public,anon,authenticated;

create function planzo_private.payments_state(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare entries jsonb:=planzo_private.payment_entries(p_trip);settlements jsonb;members jsonb;balances jsonb;events jsonb;editable boolean;fingerprint text;
begin
 select coalesce(jsonb_agg(to_jsonb(s)-'trip_id' order by created_at desc,id),'[]'::jsonb) into settlements from planzo_private.flow_payment_settlements s where trip_id=p_trip;
 select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',display_name,'included',included) order by joined_at,user_id),'[]'::jsonb) into members from public.planzo_trip_members where trip_id=p_trip;
 with active as(select e from jsonb_array_elements(entries)e where not(e->>'voided')::boolean and not(e->>'needs_review')::boolean),
 paid as(select (e->>'payer_id')::uuid id,sum((e->>'amount_paise')::bigint*case when e->>'kind'='refund' then -1 else 1 end) amount from active group by 1),
 shares as(select (s->>'user_id')::uuid id,sum((s->>'amount_paise')::bigint*case when e->>'kind'='refund' then -1 else 1 end) amount from active cross join lateral jsonb_array_elements(e->'shares')s group by 1),
 transfers as(select id,sum(amount) amount from(
 select from_id id,amount_paise amount from planzo_private.flow_payment_settlements where trip_id=p_trip and status='confirmed'
 union all select to_id,-amount_paise from planzo_private.flow_payment_settlements where trip_id=p_trip and status='confirmed')x group by id)
 select jsonb_agg(jsonb_build_object('user_id',m.user_id,'paid_paise',coalesce(p.amount,0),'share_paise',coalesce(s.amount,0),'settled_paise',coalesce(t.amount,0),'balance_paise',coalesce(p.amount,0)-coalesce(s.amount,0)+coalesce(t.amount,0)) order by m.joined_at,m.user_id) into balances
 from public.planzo_trip_members m left join paid p on p.id=m.user_id left join shares s on s.id=m.user_id left join transfers t on t.id=m.user_id where m.trip_id=p_trip;
 select coalesce(jsonb_agg(to_jsonb(x)-'trip_id' order by x.created_at desc,x.id),'[]'::jsonb) into events from(select * from planzo_private.flow_payment_events where trip_id=p_trip order by created_at desc,id limit 50)x;
 select removal_kind is null and stage not in ('archived','postponed') into editable from public.planzo_trips where id=p_trip;
 fingerprint:=md5(entries::text||settlements::text||members::text||coalesce(editable,false)::text);
 return jsonb_build_object('entries',entries,'settlements',settlements,'members',members,'balances',coalesce(balances,'[]'::jsonb),'history',events,'editable',editable,'stamp',fingerprint,
 'needs_review',(select count(*) from jsonb_array_elements(entries)e where not(e->>'voided')::boolean and (e->>'needs_review')::boolean));
end;$$;
revoke all on function planzo_private.payments_state(uuid) from public,anon,authenticated;

create function planzo_private.payments_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<payments_api>>
declare actor_id uuid:=auth.uid();trip uuid;req uuid;digest text;receipt record;t public.planzo_trips%rowtype;state jsonb;
 entry jsonb;eid text;title text;amount bigint;payer uuid;mode text;shares jsonb;kind text;day date;note text;
 expense planzo_private.flow_payment_expenses%rowtype;settlement planzo_private.flow_payment_settlements%rowtype;
 to_person uuid;method text;allowed text[];newstatus text;
begin
 if actor_id is null or not exists(select 1 from auth.users where id=actor_id and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception using errcode='42501',message='Sign in with a verified email.';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Invalid payments request.';end if;
 trip:=(p_payload->>'trip_id')::uuid;
 select * into t from public.planzo_trips where id=trip for update;
 if not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=actor_id and included) then raise exception using errcode='42501',message='Only included travellers can access payments.';end if;
 if t.workflow_version<>2 or not exists(select 1 from planzo_private.flow_plans p join planzo_private.flow_locks l on l.plan_id=p.id where p.trip_id=trip) then raise exception 'Payments open after the itinerary is finalized.';end if;
 if p_action='get' then
  if exists(select 1 from jsonb_object_keys(p_payload)k where k<>'trip_id') then raise exception 'Unsupported payments read fields.';end if;
  return planzo_private.payments_state(trip);
 end if;
 allowed:=array['trip_id','request_id','expected_stamp','id'];
 if p_action='save_expense' then allowed:=allowed||array['title','amount_paise','payer_id','kind','split_mode','shares','paid_on','notes'];
 elsif p_action='save_split' then allowed:=allowed||array['split_mode','shares'];
 elsif p_action='record_settlement' then allowed:=allowed||array['to_id','amount_paise','method','paid_on','notes','acknowledged'];
 elsif p_action in ('confirm_settlement','reject_settlement') then allowed:=allowed||array['acknowledged'];
 elsif p_action not in ('void_expense','cancel_settlement') then raise exception 'Unsupported payments action.';end if;
 if exists(select 1 from jsonb_object_keys(p_payload)k where not(k=any(allowed))) then raise exception 'Unsupported payments fields.';end if;
 req:=(p_payload->>'request_id')::uuid;if req is null then raise exception 'A request identifier is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor_id::text||req::text,0));digest:=md5(p_payload::text);
 select * into receipt from planzo_private.operation_receipts where user_id=actor_id and request_id=req;
 if found then
  if receipt.action<>'payments:'||p_action or receipt.result->>'digest'<>digest then raise exception 'This payment request identifier was already used.';end if;
  return planzo_private.payments_state(trip);
 end if;
 state:=planzo_private.payments_state(trip);
 if not coalesce((state->>'editable')::boolean,false) then raise exception 'This trip is read only.';end if;
 if p_payload->>'expected_stamp' is distinct from state->>'stamp' then raise exception using errcode='40001',message='Payments changed. Refresh payments and review the latest details before saving.';end if;
 eid:=p_payload->>'id';if eid is null or length(eid)>150 then raise exception 'An expense or payment identifier is required.';end if;
 if p_action in ('save_expense','record_settlement') then
  if jsonb_typeof(p_payload->'amount_paise') is distinct from 'number' or p_payload->>'amount_paise' !~ '^[1-9][0-9]{0,10}$' then raise exception 'Enter a positive INR amount with at most two decimals.';end if;
  amount:=(p_payload->>'amount_paise')::bigint;if amount>10000000000 then raise exception 'Amount is too large.';end if;
  if jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>500 then raise exception 'Use at most 500 characters for notes.';end if;note:=btrim(p_payload->>'notes');
  if coalesce(p_payload->>'paid_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Enter a payment date.';end if;day:=(p_payload->>'paid_on')::date;
  if day<'2000-01-01'::date or day>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose the date the payment was made, up to today.';end if;
 end if;
 if p_action='save_expense' then
  select * into expense from planzo_private.flow_payment_expenses where id=eid::uuid;
  if found and (expense.trip_id<>trip or expense.voided) then raise exception 'This expense cannot be edited.';end if;
  if not found and (select count(*) from planzo_private.flow_payment_expenses where trip_id=trip)>=2000 then raise exception 'This trip has reached its expense limit.';end if;
  if jsonb_typeof(p_payload->'title') is distinct from 'string' then raise exception 'Enter an expense title.';end if;title:=btrim(p_payload->>'title');
  if length(title) not between 1 and 120 then raise exception 'Use a title of 1 to 120 characters.';end if;
  payer:=(p_payload->>'payer_id')::uuid;
  if payer is null or not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=payer) then raise exception 'Choose a payer from this trip.';end if;
  kind:=p_payload->>'kind';if kind is null or kind not in ('expense','refund') then raise exception 'Choose an expense or refund.';end if;
  mode:=p_payload->>'split_mode';shares:=planzo_private.payment_check_shares(trip,amount,mode,p_payload->'shares');
  insert into planzo_private.flow_payment_expenses(id,trip_id,title,amount_paise,payer_id,kind,split_mode,shares,paid_on,notes,actor)
   values(eid::uuid,trip,title,amount,payer,kind,mode,shares,day,note,actor_id)
   on conflict(id) do update set title=excluded.title,amount_paise=excluded.amount_paise,payer_id=excluded.payer_id,kind=excluded.kind,split_mode=excluded.split_mode,shares=excluded.shares,paid_on=excluded.paid_on,notes=excluded.notes,actor=actor_id,revision=planzo_private.flow_payment_expenses.revision+1,updated_at=clock_timestamp();
  select to_jsonb(e)-'trip_id' into entry from planzo_private.flow_payment_expenses e where id=eid::uuid;
 elsif p_action='void_expense' then
  update planzo_private.flow_payment_expenses set voided=true,revision=revision+1,actor=actor_id,updated_at=clock_timestamp() where id=eid::uuid and trip_id=trip and not voided returning to_jsonb(flow_payment_expenses)-'trip_id' into entry;
  if not found then raise exception 'This manual expense is unavailable.';end if;
 elsif p_action='save_split' then
  select e into entry from jsonb_array_elements(state->'entries')e where e->>'id'=eid and e->>'source'='booking';
  if entry is null then raise exception 'This paid booking is unavailable.';end if;
  mode:=p_payload->>'split_mode';shares:=planzo_private.payment_check_shares(trip,(entry->>'amount_paise')::bigint,mode,p_payload->'shares');
  update planzo_private.flow_payment_booking_shares set split_mode=mode,shares=payments_api.shares,participants=array(select (s->>'user_id')::uuid from jsonb_array_elements(payments_api.shares)s),revision=revision+1 where plan_id=(entry->>'plan_id')::uuid and step_id=entry->>'step_id' and trip_id=trip;
  entry:=jsonb_build_object('title',entry->>'title','amount_paise',entry->'amount_paise','split_mode',mode,'shares',shares);
 elsif p_action='record_settlement' then
  if (state->>'needs_review')::integer>0 then raise exception 'Review changed booking splits before recording a settlement.';end if;
  if p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Confirm that you already paid outside Planzo.';end if;
  to_person:=(p_payload->>'to_id')::uuid;
  if to_person is null or to_person=actor_id or not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=to_person and included) then raise exception 'Choose another included traveller to receive this payment.';end if;
  method:=p_payload->>'method';if method is null or method not in ('UPI','Cash','Bank transfer','Other') then raise exception 'Choose a payment method.';end if;
  insert into planzo_private.flow_payment_settlements(id,trip_id,from_id,to_id,amount_paise,method,paid_on,notes) values(eid::uuid,trip,actor_id,to_person,amount,method,day,note) returning to_jsonb(flow_payment_settlements)-'trip_id' into entry;
 else
  select * into settlement from planzo_private.flow_payment_settlements where id=eid::uuid and trip_id=trip for update;
  if settlement.id is null or settlement.status<>'pending' then raise exception 'This payment is no longer pending.';end if;
  if p_action='cancel_settlement' then
   if settlement.from_id<>actor_id then raise exception using errcode='42501',message='Only the sender can cancel this pending payment.';end if;newstatus:='cancelled';
  else
   if settlement.to_id<>actor_id then raise exception using errcode='42501',message='Only the recipient can confirm or reject this payment.';end if;
   if p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Confirm your response to this payment.';end if;
   newstatus:=case when p_action='confirm_settlement' then 'confirmed' else 'rejected' end;
  end if;
  update planzo_private.flow_payment_settlements set status=newstatus,updated_at=clock_timestamp() where id=settlement.id returning to_jsonb(flow_payment_settlements)-'trip_id' into entry;
 end if;
 insert into planzo_private.flow_payment_events(trip_id,entity_id,action,actor,body) values(trip,eid,p_action,actor_id,entry);
 insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor_id,req,'payments:'||p_action,jsonb_build_object('digest',digest));
 return planzo_private.payments_state(trip);
end;$$;
revoke all on function planzo_private.payments_api(text,jsonb) from public,anon;
grant execute on function planzo_private.payments_api(text,jsonb) to authenticated;
create function public.planzo_payments(p_action text,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select planzo_private.payments_api(p_action,p_payload);$$;
revoke all on function public.planzo_payments(text,jsonb) from public,anon;
grant execute on function public.planzo_payments(text,jsonb) to authenticated;
