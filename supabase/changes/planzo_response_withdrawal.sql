-- Preserve a traveller’s ability to withdraw nonbinding readiness after the deadline.
create or replace function planzo_private.planning_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); trip uuid; role_name text; t public.planzo_trips%rowtype;
  d planzo_private.planning_drafts%rowtype; v planzo_private.plan_versions%rowtype; p planzo_private.plan_polls%rowtype;
  req uuid; request_hash text; receipt record; result jsonb:='{}'; e jsonb; other jsonb;
  opts jsonb; window_id uuid; choice text; roster uuid[]; n integer; rev integer; current_rev integer;
  deadline timestamptz; reason text; key text; winner text; ca integer; cb integer; different integer;
begin
  if actor is null or not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    raise exception using errcode='42501',message='Sign in with a verified email to continue.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid request.'; end if;
  for key in select jsonb_object_keys(p_payload) loop
    if key not in ('trip_id','request_id','expected_revision','window_id','option_id','poll_id','choice','expected_ballot_revision','plan_id','status','expected_response_revision','private_reason','acknowledged','roster','acknowledge_roster','deadline') then raise exception 'Unsupported request field.'; end if;
  end loop;
  trip:=(p_payload->>'trip_id')::uuid;
  select role into role_name from public.planzo_trip_members where trip_id=trip and user_id=actor;
  if role_name is null then raise exception using errcode='42501',message='You do not have access to this trip.'; end if;
  -- Shared lock order with existing save/join ensures each operation sees one whole context.
  select * into t from public.planzo_trips where id=trip for update;
  if p_action='get' then return planzo_private.planning_state(trip,actor); end if;
  if p_action not in ('prepare','select','open_poll','vote','close_poll','cancel_poll','publish_plan','respond','close_round','roster','revise','extend','postpone') then raise exception 'Unknown planning action.'; end if;
  req:=(p_payload->>'request_id')::uuid;
  if req is null then raise exception 'A request identifier is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
  request_hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
  select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
  if found then
    if receipt.action<>'planning:'||p_action or receipt.request_hash is distinct from request_hash then raise exception 'This request identifier was already used for different input.'; end if;
    return receipt.result;
  end if;
  if (p_payload->>'expected_revision')::integer is distinct from t.revision then raise exception using errcode='40001',message='This trip changed. Refresh and review the latest saved state before trying again.'; end if;
  if t.stage in ('postponed','archived') then raise exception 'This trip is postponed or archived. Start another trip for a new proposal.'; end if;
  if p_action not in ('vote','respond') and role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can manage the plan or decision round.'; end if;
  select * into d from planzo_private.planning_drafts where trip_id=trip;
  select * into v from planzo_private.plan_versions where trip_id=trip order by version desc limit 1;

  if p_action in ('prepare','select','open_poll','publish_plan') and t.response_deadline<=now() then raise exception 'The response deadline passed. Extend it, revise or postpone; silence is not agreement.'; end if;
  if p_action='prepare' then
    window_id:=(p_payload->>'window_id')::uuid;
    if not exists(select 1 from public.planzo_trip_windows where trip_id=trip and id=window_id) then raise exception 'Choose a travel window belonging to this trip.'; end if;
    e:=planzo_private.evaluate_plan(trip,'common',window_id); other:=planzo_private.evaluate_plan(trip,'easy',window_id);
    update public.planzo_trips set revision=revision+1,stage=case when cardinality(array(select user_id from public.planzo_trip_members where trip_id=trip and included))>=minimum_group_size then 'planning' else 'collecting' end,updated_at=now() where id=trip returning * into t;
    insert into planzo_private.planning_drafts(trip_id,source_revision,window_id,selected_option,options)
      values(trip,t.revision,window_id,null,jsonb_build_object('common',e,'easy',other))
      on conflict(trip_id) do update set source_revision=excluded.source_revision,window_id=excluded.window_id,selected_option=null,options=excluded.options,created_at=now();
    result:=jsonb_build_object('prepared',true);
  elsif p_action in ('select','open_poll','publish_plan') then
    if d.trip_id is null or d.source_revision<>t.revision then raise exception 'Prepare current options after the latest input or roster change.'; end if;
    if exists(select 1 from planzo_private.plan_polls where trip_id=trip and status in ('open','unresolved')) then raise exception 'Resolve the current poll, or explicitly revise the decision context first.'; end if;
    choice:=p_payload->>'option_id';
    if p_action='publish_plan' then choice:=d.selected_option; end if;
    if p_action='open_poll' then choice:='common'; end if;
    e:=planzo_private.evaluate_plan(trip,choice,d.window_id);
    if e->'catalogue' is distinct from d.options->choice->'catalogue' then raise exception 'Catalogue facts changed. Prepare and review new options.'; end if;
    if jsonb_array_length(e->'blockers')>0 then raise exception 'This option does not pass all group checks. Review the safe blockers and revise.'; end if;
    if p_action='select' then
      if choice is distinct from d.selected_option then
        update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
        update planzo_private.planning_drafts set selected_option=choice,source_revision=t.revision where trip_id=trip;
      end if;
      result:=jsonb_build_object('selected',choice);
    elsif p_action='open_poll' then
      other:=planzo_private.evaluate_plan(trip,'easy',d.window_id);
      if jsonb_array_length(other->'blockers')>0 then raise exception 'Two independently feasible options are needed for voting.'; end if;
      deadline:=(p_payload->>'deadline')::timestamptz;
      if deadline is null or deadline<=now() or deadline>t.response_deadline then raise exception 'Choose a future poll deadline no later than the response deadline.'; end if;
      update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
      update planzo_private.planning_drafts set source_revision=t.revision,selected_option=null where trip_id=trip;
      select array_agg(value::uuid order by value::uuid) into roster from jsonb_array_elements_text(e->'roster');
      insert into planzo_private.plan_polls(trip_id,source_revision,roster,options,deadline) values(trip,t.revision,roster,jsonb_build_object('common',e,'easy',other),deadline) returning * into p;
      result:=jsonb_build_object('poll_id',p.id);
    else
      if v.id is not null and v.source_revision=t.revision and v.option_id=choice then result:=jsonb_build_object('plan_id',v.id,'version',v.version);
      else
        select coalesce(max(version),0)+1 into n from planzo_private.plan_versions where trip_id=trip;
        select array_agg(value::uuid order by value::uuid) into roster from jsonb_array_elements_text(e->'roster');
        insert into planzo_private.plan_versions(trip_id,version,source_revision,window_id,option_id,roster,input_revisions,catalogue_snapshot,content)
          values(trip,n,t.revision,d.window_id,choice,roster,e->'inputs',e->'catalogue',jsonb_build_object(
            'title',case when choice='common' then 'Coast & common ground' else 'Easy beach & local food' end,
            'rooms',e->'rooms','currency','INR','estimate_basis','illustrative_reference','contingency_percent',10,
            'itinerary',jsonb_build_array('Day 1 · Return-travel allowance begins; transfer, check in and a relaxed coast evening.',case when choice='common' then 'Day 2 · Heritage afternoon and vegetarian-friendly cafés.' else 'Day 2 · Beach afternoon and local thali meals.' end,'Day 3 · Slow morning, check out and return by the agreed window boundary.'),
            'optional','Boat is optional for those who selected it. Others keep a free-time alternative. Providers, prices and timing need checking before booking.')) returning * into v;
        insert into planzo_private.plan_costs(trip_id,plan_id,user_id,content) select trip,v.id,j.key::uuid,j.value from jsonb_each(e->'costs') j;
        update public.planzo_trips set stage='reviewing',updated_at=now() where id=trip;
        insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'version:'||v.id,'Plan v'||v.version||' shared for individual review. Every included traveller must respond again.');
        result:=jsonb_build_object('plan_id',v.id,'version',v.version);
      end if;
    end if;
  elsif p_action in ('vote','close_poll','cancel_poll') then
    select * into p from planzo_private.plan_polls where trip_id=trip and id=(p_payload->>'poll_id')::uuid;
    if p.id is null or p.source_revision<>t.revision or p.status not in ('open','unresolved') then raise exception 'This poll is closed, stale or belongs to another trip.'; end if;
    if p_action='cancel_poll' then
      update planzo_private.plan_polls set status='stale' where id=p.id;
      update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip;
      result:=jsonb_build_object('cancelled',true);
    else
      e:=planzo_private.evaluate_plan(trip,'common',d.window_id);other:=planzo_private.evaluate_plan(trip,'easy',d.window_id);
      if jsonb_array_length(e->'blockers')>0 or jsonb_array_length(other->'blockers')>0 or e->'catalogue' is distinct from p.options->'common'->'catalogue' then raise exception 'The poll context changed. Revise and prepare fresh options.'; end if;
      if p.status<>'open' then raise exception 'This poll is unresolved. Revise the choice before starting a fresh poll.'; end if;
      if p_action='vote' then
        if now()>=p.deadline then raise exception 'This poll deadline passed.'; end if;
        if not actor=any(p.roster) then raise exception 'Only included travellers can vote.'; end if;
        choice:=p_payload->>'choice';
        if choice is null or choice not in ('common','easy','abstain','different') then raise exception 'Choose a current option, abstain or request a different option.'; end if;
        select revision into current_rev from planzo_private.poll_ballots where poll_id=p.id and user_id=actor;
        if (p_payload->>'expected_ballot_revision')::integer is distinct from coalesce(current_rev,0) then raise exception 'Your ballot changed in another tab. Refresh before replacing it.'; end if;
        insert into planzo_private.poll_ballots(trip_id,poll_id,user_id,revision,choice) values(trip,p.id,actor,coalesce(current_rev,0)+1,choice)
          on conflict(poll_id,user_id) do update set choice=excluded.choice,revision=excluded.revision,updated_at=now();
        result:=jsonb_build_object('saved',true);
      else
        select count(*),count(*) filter(where bb.choice='common'),count(*) filter(where bb.choice='easy'),count(*) filter(where bb.choice='different') into n,ca,cb,different from planzo_private.poll_ballots bb where bb.poll_id=p.id;
        if now()<p.deadline and n<cardinality(p.roster) then raise exception 'Wait for every ballot or the stated deadline. Missing ballots are not votes.'; end if;
        winner:=null;
        if different=0 and ca+cb>0 then
          if ca>cb then winner:='common'; elsif cb>ca then winner:='easy';
          elsif (e->>'upper_shared')::bigint<(other->>'upper_shared')::bigint then winner:='common';
          elsif (other->>'upper_shared')::bigint<(e->>'upper_shared')::bigint then winner:='easy'; end if;
        end if;
        update planzo_private.plan_polls set status=case when winner is null then 'unresolved' else 'closed' end,
          result=jsonb_build_object('common',ca,'easy',cb,'abstain',n-ca-cb-different,'different',different,'missing',cardinality(p.roster)-n,'winner',winner) where id=p.id;
        if winner is not null then
          update public.planzo_trips set revision=revision+1,stage='planning',updated_at=now() where id=trip returning * into t;
          update planzo_private.planning_drafts set source_revision=t.revision,selected_option=winner where trip_id=trip;
        end if;
        result:=jsonb_build_object('winner',winner);
      end if;
    end if;
  elsif p_action in ('respond','close_round') then
    if v.id is null or v.id is distinct from (p_payload->>'plan_id')::uuid or v.source_revision<>t.revision or t.stage not in ('reviewing','agreed') then raise exception 'Review the current plan version. Older approvals cannot be reused.'; end if;
    e:=planzo_private.evaluate_plan(trip,v.option_id,v.window_id);
    if jsonb_array_length(e->'blockers')>0 or e->'catalogue' is distinct from v.catalogue_snapshot then raise exception 'The current plan needs revalidation before responses or agreement.'; end if;
    if t.response_deadline<=now() and (p_action='close_round' or p_payload->>'status'='ready') then raise exception 'The response deadline passed. Extend, revise or postpone before new readiness or agreement. You may still withdraw an earlier response.'; end if;
    if exists(select 1 from planzo_private.plan_polls where trip_id=trip and status in ('open','unresolved')) then raise exception 'Resolve the outstanding poll first.'; end if;
    if p_action='respond' then
      if not actor=any(v.roster) then raise exception 'Only included travellers can respond to this plan.'; end if;
      choice:=p_payload->>'status'; reason:=coalesce(p_payload->>'private_reason','');
      if choice is null or choice not in ('ready','change','decline') or length(reason)>2000 then raise exception 'Choose a valid response and keep the private note under 2,000 characters.'; end if;
      if choice='ready' and not coalesce((p_payload->>'acknowledged')::boolean,false) then raise exception 'Acknowledge your complete estimate and the nonbinding booking intention.'; end if;
      select max(revision) into current_rev from planzo_private.plan_responses where plan_id=v.id and user_id=actor;
      if (p_payload->>'expected_response_revision')::integer is distinct from coalesce(current_rev,0) then raise exception 'Your response changed in another tab. Refresh before replacing it.'; end if;
      insert into planzo_private.plan_responses(trip_id,plan_id,user_id,revision,brief_revision,status,acknowledged,private_reason)
        values(trip,v.id,actor,coalesce(current_rev,0)+1,(v.input_revisions->>actor::text)::integer,choice,coalesce((p_payload->>'acknowledged')::boolean,false),reason);
      if t.stage='agreed' and choice<>'ready' then update public.planzo_trips set stage='reviewing',updated_at=now() where id=trip; end if;
      result:=jsonb_build_object('saved',true);
    else
      select count(*) into n from (select distinct on(user_id) user_id,status,brief_revision from planzo_private.plan_responses where plan_id=v.id order by user_id,revision desc) r
        where user_id=any(v.roster) and status='ready' and brief_revision=(v.input_revisions->>user_id::text)::integer;
      if n<>cardinality(v.roster) then raise exception 'Every included traveller must explicitly be ready for this version. Silence, change requests and declines cannot become agreement.'; end if;
      update public.planzo_trips set stage='agreed',updated_at=now() where id=trip;
      insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'agreement:'||v.id,'Everyone included confirmed Plan v'||v.version||'. Bookings remain pending; no reservation was made.') on conflict do nothing;
      result:=jsonb_build_object('agreed',true,'version',v.version);
    end if;
  elsif p_action='roster' then
    if not coalesce((p_payload->>'acknowledge_roster')::boolean,false) or jsonb_typeof(p_payload->'roster') is distinct from 'array' then raise exception 'Explicitly acknowledge the proposed travelling roster.'; end if;
    select array_agg(value::uuid order by value::uuid) into roster from jsonb_array_elements_text(p_payload->'roster');
    if cardinality(roster) not between t.minimum_group_size and 8 or roster is null or cardinality(roster)<>(select count(distinct value) from unnest(roster) value)
      or exists(select 1 from unnest(roster) value where not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=value)) then raise exception 'Choose a unique travelling roster of joined members meeting the minimum.'; end if;
    update public.planzo_trip_members set included=user_id=any(roster) where trip_id=trip;
    update public.planzo_trips set revision=revision+1,stage='revise',updated_at=now() where id=trip;
    result:=jsonb_build_object('roster_saved',true);
  elsif p_action='extend' then
    deadline:=(p_payload->>'deadline')::timestamptz;
    if deadline is null or deadline<=now() or deadline<=t.response_deadline or deadline>=(select min(starts_at) from public.planzo_trip_windows where trip_id=trip) then raise exception 'Choose a later future deadline before the first travel window.'; end if;
    update public.planzo_trips set response_deadline=deadline,revision=revision+1,stage='collecting',updated_at=now() where id=trip;
    result:=jsonb_build_object('extended',true);
  elsif p_action in ('revise','postpone') then
    update public.planzo_trips set revision=revision+1,stage=case when p_action='postpone' then 'postponed' else 'collecting' end,updated_at=now() where id=trip;
    result:=jsonb_build_object('recorded',true);
  end if;
  if p_action not in ('vote','respond','publish_plan','close_round') then
    insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,req::text,case p_action
      when 'prepare' then 'Planning options checked against the current included group and private inputs.'
      when 'select' then 'A working draft was selected. Individual readiness is still required.'
      when 'open_poll' then 'A poll opened. Ballots stay private until the aggregate result is closed.'
      when 'close_poll' then 'The poll closed. Its result is a draft preference, not trip confirmation.'
      when 'cancel_poll' then 'The organiser ended this poll. Fresh options and review are required.'
      when 'roster' then 'A new travelling roster was proposed openly. Everyone retains workspace access; costs and confirmations need fresh review.'
      when 'extend' then 'The organiser extended the deadline. Review fresh options and terms before responding again.'
      when 'revise' then 'The trip reopened for revision and inputs. Earlier versions remain historical.'
      else 'The trip was postponed without inferring consent or blaming any traveller.' end);
  end if;
  insert into planzo_private.operation_receipts(user_id,request_id,action,request_hash,result) values(actor,req,'planning:'||p_action,request_hash,result);
  return result;
end $$;

