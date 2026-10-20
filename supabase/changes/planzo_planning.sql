-- Planzo B05/B06 and voting subset of B07. Target ewysgpuwvufbklesdhuj.
-- Private constraint processing is justified here: only checked, authenticated trip RPCs
-- can invoke the definer boundary. No raw group briefs or personal costs cross it.
alter table planzo_private.operation_receipts add column request_hash text;
create table planzo_private.planning_catalogues (
  id text primary key,
  content jsonb not null check(jsonb_typeof(content)='object'),
  recorded_at timestamptz not null default now()
);
insert into planzo_private.planning_catalogues(id,content) values ('goa-reference-v1', '{
  "label":"Illustrative Goa planning reference · not live quotes",
  "source":"Trip Pact Prototype Playbook v1, fictional arithmetic fixture, page 14",
  "source_date":"2026-10-15","illustrative":true,"currency":"INR","days":3,"nights":2,
  "origin":"bengaluru","destination":"goa","vehicle_capacity":8,"room_capacity":2,
  "return_travel":[350000,420000],"room_night":[160000,200000],"vehicle":[540000,660000],
  "food":[140000,170000],"activities":[30000,50000],"fees":[20000,30000],
  "boat":[80000,100000],"contingency_percent":10,"step_free_verified":false,
  "assumptions":["Three calendar days and two nights; departure by 06:00 and return by 22:00 IST.","Twin rooms and one vehicle for up to eight; shared amounts split exactly in paise.","Food allowance includes vegetarian choices; providers and availability are not verified.","Optional boat charges apply only to the traveller who selected it; others have free time.","No reservations, live prices or verified accessibility are supplied."]
}'::jsonb) on conflict do nothing;
create table planzo_private.planning_drafts (
  trip_id uuid primary key references public.planzo_trips(id),
  source_revision integer not null,
  window_id uuid not null,
  selected_option text check(selected_option in ('common','easy')),
  options jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(trip_id,window_id) references public.planzo_trip_windows(trip_id,id)
);
create table planzo_private.plan_versions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.planzo_trips(id),
  version integer not null check(version>0),
  source_revision integer not null,
  window_id uuid not null,
  option_id text not null check(option_id in ('common','easy')),
  roster uuid[] not null check(cardinality(roster) between 4 and 8),
  input_revisions jsonb not null,
  catalogue_snapshot jsonb not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique(trip_id,version), unique(trip_id,id),
  foreign key(trip_id,window_id) references public.planzo_trip_windows(trip_id,id)
);
create table planzo_private.plan_costs (
  trip_id uuid not null,
  plan_id uuid not null,
  user_id uuid not null,
  content jsonb not null,
  primary key(plan_id,user_id),
  foreign key(trip_id,plan_id) references planzo_private.plan_versions(trip_id,id),
  foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id)
);
create index planzo_costs_member_idx on planzo_private.plan_costs(trip_id,user_id);
create table planzo_private.plan_responses (
  trip_id uuid not null,
  plan_id uuid not null,
  user_id uuid not null,
  revision integer not null check(revision>0),
  brief_revision integer not null,
  status text not null check(status in ('ready','change','decline')),
  acknowledged boolean not null,
  private_reason text not null default '' check(length(private_reason)<=2000),
  created_at timestamptz not null default now(),
  primary key(plan_id,user_id,revision),
  foreign key(trip_id,plan_id) references planzo_private.plan_versions(trip_id,id),
  foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id),
  check(status<>'ready' or acknowledged)
);
create index planzo_responses_member_idx on planzo_private.plan_responses(trip_id,user_id);
create table planzo_private.plan_polls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.planzo_trips(id),
  source_revision integer not null,
  roster uuid[] not null check(cardinality(roster) between 4 and 8),
  options jsonb not null,
  deadline timestamptz not null,
  status text not null default 'open' check(status in ('open','closed','stale','unresolved')),
  result jsonb,
  created_at timestamptz not null default now(),
  unique(trip_id,id)
);
create unique index planzo_one_open_poll_idx on planzo_private.plan_polls(trip_id) where status='open';
create index planzo_polls_trip_idx on planzo_private.plan_polls(trip_id,created_at desc);
create table planzo_private.poll_ballots (
  trip_id uuid not null,
  poll_id uuid not null,
  user_id uuid not null,
  revision integer not null check(revision>0),
  choice text not null check(choice in ('common','easy','abstain','different')),
  updated_at timestamptz not null default now(),
  primary key(poll_id,user_id),
  foreign key(trip_id,poll_id) references planzo_private.plan_polls(trip_id,id),
  foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id)
);
create index planzo_ballots_member_idx on planzo_private.poll_ballots(trip_id,user_id);
create table planzo_private.planning_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.planzo_trips(id),
  event_key text not null,
  message text not null,
  created_at timestamptz not null default now(),
  unique(trip_id,event_key)
);

-- Exact deterministic shares. UUID order fixes who receives any residual paise.
create function planzo_private.money_share(total bigint,n integer,pos integer) returns bigint
language sql immutable security invoker set search_path='' as $$
  select total/n + case when pos<=total%n then 1 else 0 end
$$;
create function planzo_private.immutable_plan() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  raise exception 'Published plan snapshots and response history are immutable.';
end $$;
create trigger planzo_versions_immutable before update or delete on planzo_private.plan_versions for each row execute function planzo_private.immutable_plan();
create trigger planzo_costs_immutable before update or delete on planzo_private.plan_costs for each row execute function planzo_private.immutable_plan();
create trigger planzo_responses_immutable before update or delete on planzo_private.plan_responses for each row execute function planzo_private.immutable_plan();

create function planzo_private.evaluate_plan(p_trip uuid,p_option text,p_window uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.planzo_trips%rowtype; w public.planzo_trip_windows%rowtype;
  cat jsonb; roster uuid[]; inputs jsonb:='{}'; costs jsonb:='{}'; blockers jsonb:='[]';
  m record; b jsonb; rows jsonb; lo bigint; hi bigint; sublo bigint; subhi bigint;
  pos integer:=0; n integer; rooms integer; foodlo bigint; foodhi bigint; actlo bigint; acthi bigint;
  bad_input boolean:=false; bad_date boolean:=false; unknown_price boolean:=false;
  bad_requirement boolean:=false; bad_budget boolean:=false; total_shared bigint:=0; price_key text; price jsonb;
begin
  select * into t from public.planzo_trips where id=p_trip;
  select * into w from public.planzo_trip_windows where trip_id=p_trip and id=p_window;
  select content into cat from planzo_private.planning_catalogues where id='goa-reference-v1';
  select array_agg(user_id order by user_id) into roster from public.planzo_trip_members where trip_id=p_trip and included;
  roster:=coalesce(roster,'{}'); n:=cardinality(roster); rooms:=(n+1)/2;
  if p_option is null or p_option not in ('common','easy') then raise exception 'Choose a supported catalogue option.'; end if;
  if n<t.minimum_group_size or n>8 then blockers:=blockers||jsonb_build_array('Confirm an included roster that meets the trip minimum (four to eight).'); end if;
  if w.id is null then blockers:=blockers||jsonb_build_array('Choose a travel window belonging to this trip.'); end if;
  if cat is null or lower(btrim(t.destination))<>cat->>'destination' or n>coalesce((cat->>'vehicle_capacity')::integer,0)
    or (w.ends_at at time zone 'Asia/Kolkata')::date-(w.starts_at at time zone 'Asia/Kolkata')::date<>2
    or (w.starts_at at time zone 'Asia/Kolkata')::time>time '06:00'
    or (w.ends_at at time zone 'Asia/Kolkata')::time<time '22:00' then unknown_price:=true; end if;
  -- No price supplied by the client is accepted. A missing catalogue value is never zero.
  if cat->'return_travel'->>1 is null or cat->'room_night'->>1 is null or cat->'vehicle'->>1 is null
    or cat->'food'->>1 is null or cat->'activities'->>1 is null or cat->'fees'->>1 is null or cat->'boat'->>1 is null then unknown_price:=true; end if;
  foreach price_key in array array['return_travel','room_night','vehicle','food','activities','fees','boat'] loop
    price:=cat->price_key;
    if jsonb_typeof(price) is distinct from 'array' then unknown_price:=true;
    elsif jsonb_array_length(price)<>2 then unknown_price:=true;
    elsif coalesce(price->>0,'') !~ '^[0-9]+$' or coalesce(price->>1,'') !~ '^[0-9]+$' then unknown_price:=true;
    elsif (price->>0)::bigint>(price->>1)::bigint then unknown_price:=true; end if;
  end loop;
  if unknown_price then
    return jsonb_build_object('blockers',blockers||jsonb_build_array('Complete costs are unavailable for these dates, origins or catalogue facts. The reference covers Bengaluru to Goa, three days and two nights.'),'roster',to_jsonb(roster),'inputs',inputs,'costs',costs,'upper_shared',0,'catalogue',cat,'rooms',rooms,'complete',false);
  end if;
  for m in select mm.user_id,s.revision,s.confirmed,d.content from public.planzo_trip_members mm
      join public.planzo_brief_status s using(trip_id,user_id)
      left join planzo_private.member_brief_drafts d using(trip_id,user_id)
      where mm.trip_id=p_trip and mm.included order by mm.user_id loop
    pos:=pos+1; b:=m.content; inputs:=inputs||jsonb_build_object(m.user_id::text,m.revision);
    if not m.confirmed or b is null then bad_input:=true; continue; end if;
    if not coalesce(b->'windows' ? p_window::text,false) then bad_date:=true; end if;
    if lower(btrim(b->>'origin')) is distinct from cat->>'origin' then unknown_price:=true; end if;
    if coalesce((b->>'step_free')::boolean,false) and (not coalesce((cat->>'step_free_verified')::boolean,false) or (b->>'boat')::boolean) then bad_requirement:=true; end if;
    foodlo:=(cat->'food'->>0)::bigint; foodhi:=(cat->'food'->>1)::bigint;
    actlo:=(cat->'activities'->>0)::bigint; acthi:=(cat->'activities'->>1)::bigint;
    if p_option='easy' then foodlo:=foodlo-10000; foodhi:=foodhi-10000; actlo:=actlo-20000; acthi:=acthi-20000; end if;
    rows:=jsonb_build_array(
      jsonb_build_object('label','Return origin travel','range',cat->'return_travel'),
      jsonb_build_object('label','Stay · two nights','range',jsonb_build_array(planzo_private.money_share((cat->'room_night'->>0)::bigint*2*rooms,n,pos),planzo_private.money_share((cat->'room_night'->>1)::bigint*2*rooms,n,pos))),
      jsonb_build_object('label','Local transport','range',jsonb_build_array(planzo_private.money_share((cat->'vehicle'->>0)::bigint,n,pos),planzo_private.money_share((cat->'vehicle'->>1)::bigint,n,pos))),
      jsonb_build_object('label','Food','range',jsonb_build_array(foodlo,foodhi)),
      jsonb_build_object('label','Shared activities','range',jsonb_build_array(actlo,acthi)),
      jsonb_build_object('label','Fees and incidentals','range',cat->'fees'));
    select sum((value->'range'->>0)::bigint),sum((value->'range'->>1)::bigint) into sublo,subhi from jsonb_array_elements(rows);
    total_shared:=total_shared+subhi;
    if (b->>'boat')::boolean then rows:=rows||jsonb_build_array(jsonb_build_object('label','Your optional boat activity','range',cat->'boat')); sublo:=sublo+(cat->'boat'->>0)::bigint; subhi:=subhi+(cat->'boat'->>1)::bigint; end if;
    lo:=sublo/10; hi:=(subhi+9)/10;
    rows:=rows||jsonb_build_array(jsonb_build_object('label','Contingency · 10%','range',jsonb_build_array(lo,hi)));
    lo:=sublo+lo;hi:=subhi+hi;
    if hi>(b->>'ceiling_paise')::bigint then bad_budget:=true; end if;
    costs:=costs||jsonb_build_object(m.user_id::text,jsonb_build_object('rows',rows,'total',jsonb_build_array(lo,hi),'complete',not unknown_price,'boat',(b->>'boat')::boolean));
  end loop;
  if bad_input then blockers:=blockers||jsonb_build_array('Every included traveller needs current confirmed private input.'); end if;
  if bad_date then blockers:=blockers||jsonb_build_array('This window does not fit the included group. Try another window or revise the proposal.'); end if;
  if unknown_price then blockers:=blockers||jsonb_build_array('Complete costs are unavailable for these dates, origins or catalogue facts. The reference covers Bengaluru to Goa, three days and two nights.'); end if;
  if bad_requirement then blockers:=blockers||jsonb_build_array('A required accessibility fact is unverified. Confirm suitable arrangements before review.'); end if;
  if bad_budget then blockers:=blockers||jsonb_build_array('This arrangement does not fit the group’s private limits. Try a cheaper option or revise the proposal.'); end if;
  return jsonb_build_object('blockers',blockers,'roster',to_jsonb(roster),'inputs',inputs,'costs',costs,'upper_shared',total_shared,'catalogue',cat,'rooms',rooms,'complete',not unknown_price);
end $$;

create function planzo_private.invalidate_planning() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if new.revision<>old.revision then
    update planzo_private.plan_polls set status='stale' where trip_id=new.id and status in ('open','unresolved');
    if new.stage in ('reviewing','agreed') then new.stage:='revise'; end if;
  end if;
  return new;
end $$;
create trigger planzo_context_changed before update on public.planzo_trips for each row execute function planzo_private.invalidate_planning();

create function planzo_private.safe_option(p_id text,e jsonb,p_actor uuid) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_id,'title',case when p_id='common' then 'Coast & common ground' else 'Easy beach & local food' end,
    'description',case when p_id='common' then 'Coastal twin rooms, a heritage afternoon and vegetarian-friendly cafés.' else 'The same coastal base, a beach afternoon and local thali allowances.' end,
    'blockers',e->'blockers','own_cost',case when (e->>'complete')::boolean then e->'costs'->p_actor::text else null end,
    'rooms',e->'rooms','catalogue',e->'catalogue')
$$;
create function planzo_private.planning_state(p_trip uuid,p_actor uuid) returns jsonb
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

create function planzo_private.planning_api(p_action text,p_payload jsonb) returns jsonb
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
    if t.response_deadline<=now() then raise exception 'The response deadline passed. Extend, revise or postpone; silence is still pending.'; end if;
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

create function public.planzo_planning(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select planzo_private.planning_api(p_action,p_payload) $$;
do $$ declare name text; begin
  foreach name in array array['planning_catalogues','planning_drafts','plan_versions','plan_costs','plan_responses','plan_polls','poll_ballots','planning_events'] loop
    execute format('alter table planzo_private.%I enable row level security',name);
    execute format('revoke all on planzo_private.%I from public,anon,authenticated',name);
  end loop;
end $$;
revoke all on function planzo_private.money_share(bigint,integer,integer),planzo_private.immutable_plan(),planzo_private.evaluate_plan(uuid,text,uuid),planzo_private.invalidate_planning(),planzo_private.safe_option(text,jsonb,uuid),planzo_private.planning_state(uuid,uuid),planzo_private.planning_api(text,jsonb) from public,anon,authenticated;
grant execute on function planzo_private.planning_api(text,jsonb) to authenticated;
revoke all on function public.planzo_planning(text,jsonb) from public,anon,authenticated;
grant execute on function public.planzo_planning(text,jsonb) to authenticated;
create index planzo_draft_window_idx on planzo_private.planning_drafts(trip_id,window_id);
create index planzo_version_window_idx on planzo_private.plan_versions(trip_id,window_id);
create index planzo_costs_version_idx on planzo_private.plan_costs(trip_id,plan_id);
create index planzo_responses_version_idx on planzo_private.plan_responses(trip_id,plan_id);
create index planzo_ballots_poll_idx on planzo_private.poll_ballots(trip_id,poll_id);
