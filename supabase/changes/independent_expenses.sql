-- Separate booking tracking from the expense ledger. No provider or money transfers.
-- Existing booking-derived expenses are frozen as ordinary editable expenses once.
-- Existing pending transfers become recorded; subsequent records apply immediately.
lock table planzo_private.flow_booking_events,planzo_private.flow_payment_booking_shares,planzo_private.flow_payment_expenses,planzo_private.flow_payment_settlements in share row exclusive mode;
do $guard$ begin
 if md5(pg_get_functiondef('planzo_private.payment_entries(uuid)'::regprocedure))<>'ea1e7eca994f63c9a7292c30ca6594e1' then raise exception 'Current payment_entries differs from reviewed baseline';end if;
 if md5(pg_get_functiondef('planzo_private.payments_api(text,jsonb)'::regprocedure))<>'f16c7365ae9f71026b8b4a58b7d48481' then raise exception 'Current payments_api differs from reviewed baseline';end if;
 if md5(pg_get_functiondef('planzo_private.payments_state(uuid)'::regprocedure))<>'bc5b7056765c857338ef91cd457552de' then raise exception 'Current payments_state differs from reviewed baseline';end if;
 if exists(select 1 from public.planzo_trips t cross join lateral jsonb_array_elements(planzo_private.payment_entries(t.id))e where e->>'source'='booking' and (e->>'needs_review')::boolean) then raise exception 'Resolve existing booking splits before switching ledgers';end if;
end $guard$;
create temporary table payment_separation_baseline on commit drop as select id,planzo_private.payments_state(id)->'balances' balances from public.planzo_trips;
insert into planzo_private.flow_payment_expenses(id,trip_id,title,amount_paise,payer_id,kind,split_mode,shares,paid_on,notes,voided,revision,actor,updated_at)
select md5('planzo-independent-expense:'||(e->>'id'))::uuid,t.id,e->>'title',(e->>'amount_paise')::bigint,(e->>'payer_id')::uuid,e->>'kind',e->>'split_mode',e->'shares',(e->>'paid_on')::date,e->>'notes',false,1,b.actor,(e->>'updated_at')::timestamptz
from public.planzo_trips t cross join lateral jsonb_array_elements(planzo_private.payment_entries(t.id))e
join lateral(select actor from planzo_private.flow_booking_events where plan_id=(e->>'plan_id')::uuid and step_id=e->>'step_id' and revision=(e->>'booking_revision')::integer)b on true
where e->>'source'='booking';
drop trigger flow_booking_payment_capture on planzo_private.flow_booking_events;
create or replace function planzo_private.payment_entries(p_trip uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg((to_jsonb(e)-'trip_id')||jsonb_build_object('source','manual','needs_review',false) order by e.paid_on desc,e.id),'[]'::jsonb)
 from planzo_private.flow_payment_expenses e where e.trip_id=p_trip;
$$;
do $preserve$ begin
 if exists(select 1 from payment_separation_baseline b where b.balances is distinct from planzo_private.payments_state(b.id)->'balances') then raise exception 'Independent expenses failed to preserve existing balances';end if;
end $preserve$;
-- Preserve transfer history while removing the receipt approval stage.
with recorded as(update planzo_private.flow_payment_settlements set status='confirmed',updated_at=clock_timestamp() where status='pending' returning *)
insert into planzo_private.flow_payment_events(trip_id,entity_id,action,actor,body)
select trip_id,id::text,'receipt_requirement_removed',from_id,to_jsonb(recorded)-'trip_id' from recorded;
alter table planzo_private.flow_payment_settlements alter column status set default 'confirmed';
CREATE OR REPLACE FUNCTION planzo_private.payments_api(p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 elsif p_action='record_settlement' then allowed:=allowed||array['to_id','amount_paise','method','paid_on','notes','acknowledged'];
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
 elsif p_action='record_settlement' then
  if p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Confirm that you already paid outside Planzo.';end if;
  to_person:=(p_payload->>'to_id')::uuid;
  if to_person is null or to_person=actor_id or not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=to_person and included) then raise exception 'Choose another included traveller to receive this payment.';end if;
  method:=p_payload->>'method';if method is null or method not in ('UPI','Cash','Bank transfer','Other') then raise exception 'Choose a payment method.';end if;
  insert into planzo_private.flow_payment_settlements(id,trip_id,from_id,to_id,amount_paise,method,paid_on,notes,status) values(eid::uuid,trip,actor_id,to_person,amount,method,day,note,'confirmed') returning to_jsonb(flow_payment_settlements)-'trip_id' into entry;
 else
  select * into settlement from planzo_private.flow_payment_settlements where id=eid::uuid and trip_id=trip for update;
  if settlement.id is null or settlement.status not in ('pending','confirmed') then raise exception 'This payment record is no longer active.';end if;
  if actor_id not in (settlement.from_id,settlement.to_id) then raise exception using errcode='42501',message='Only the sender or recipient can remove this payment record.';end if;
  newstatus:='cancelled';
  update planzo_private.flow_payment_settlements set status=newstatus,updated_at=clock_timestamp() where id=settlement.id returning to_jsonb(flow_payment_settlements)-'trip_id' into entry;
 end if;
 insert into planzo_private.flow_payment_events(trip_id,entity_id,action,actor,body) values(trip,eid,p_action,actor_id,entry);
 insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor_id,req,'payments:'||p_action,jsonb_build_object('digest',digest));
 return planzo_private.payments_state(trip);
end;$function$
;
-- CREATE OR REPLACE retains the existing guarded API privileges and HTTP 409 wrapper.
