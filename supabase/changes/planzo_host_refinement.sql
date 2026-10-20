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
