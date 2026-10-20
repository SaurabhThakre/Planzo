-- Additive manual booking handoff. Target: ewysgpuwvufbklesdhuj only.
-- No backfill, existing-function replacement, provider API, payment or reservation.
do $$ begin
 if md5((select prosrc from pg_proc where oid='planzo_private.planning_state(uuid,uuid)'::regprocedure))<>'eb0ddf4f12cbeda2215fe485e96fa0cb'
 or md5((select prosrc from pg_proc where oid='planzo_private.evaluate_plan(uuid,text,uuid)'::regprocedure))<>'f4e158dd22828d21ad771c3375b73a5c'
 then raise exception 'Planning baseline changed; review before applying booking extension.'; end if;
end $$;

create table planzo_private.booking_handoffs (
 trip_id uuid not null, plan_id uuid primary key, revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 foreign key(trip_id,plan_id) references planzo_private.plan_versions(trip_id,id)
);
create index booking_handoffs_trip_idx on planzo_private.booking_handoffs(trip_id,plan_id);
create table planzo_private.booking_tasks (
 trip_id uuid not null, plan_id uuid not null references planzo_private.booking_handoffs(plan_id),
 task_key text not null, revision integer not null check(revision>0),
 category text not null check(category in ('travel','stay','local','food','activities','personal')),
 personal_owner uuid, owner_id uuid, due_at timestamptz,
 provider_id text not null default 'unselected' check(provider_id in ('unselected','manual','irctc','booking','goamiles')),
 created_by uuid not null, created_at timestamptz not null default now(),
 primary key(plan_id,task_key,revision),
 foreign key(trip_id,plan_id) references planzo_private.plan_versions(trip_id,id),
 foreign key(trip_id,owner_id) references public.planzo_trip_members(trip_id,user_id),
 foreign key(trip_id,personal_owner) references public.planzo_trip_members(trip_id,user_id),
 check(personal_owner is null or owner_id=personal_owner)
);
create index booking_tasks_trip_idx on planzo_private.booking_tasks(trip_id,plan_id);
create index booking_tasks_owner_idx on planzo_private.booking_tasks(trip_id,owner_id);
create index booking_tasks_personal_idx on planzo_private.booking_tasks(trip_id,personal_owner);
create table planzo_private.booking_reports (
 trip_id uuid not null, plan_id uuid not null, task_key text not null,
 revision integer not null check(revision>0), task_revision integer not null,
 reporter uuid not null, status text not null check(status in ('pending','reported','not_needed','link_problem','changed_terms')),
 acknowledged boolean not null default false, created_at timestamptz not null default now(),
 primary key(plan_id,task_key,revision),
 foreign key(plan_id,task_key,task_revision) references planzo_private.booking_tasks(plan_id,task_key,revision),
 foreign key(trip_id,plan_id) references planzo_private.plan_versions(trip_id,id),
 foreign key(trip_id,reporter) references public.planzo_trip_members(trip_id,user_id),
 check(status not in ('reported','not_needed') or acknowledged)
);
create index booking_reports_trip_idx on planzo_private.booking_reports(trip_id,plan_id);
create index booking_reports_task_idx on planzo_private.booking_reports(plan_id,task_key,task_revision);
create index booking_reports_reporter_idx on planzo_private.booking_reports(trip_id,reporter);
create table planzo_private.milestone_events (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.planzo_trips(id),
 context_revision integer not null, states jsonb not null, created_at timestamptz not null default now()
);
create index milestone_events_trip_idx on planzo_private.milestone_events(trip_id,created_at desc,id desc);
alter table planzo_private.booking_handoffs enable row level security;
alter table planzo_private.booking_tasks enable row level security;
alter table planzo_private.booking_reports enable row level security;
alter table planzo_private.milestone_events enable row level security;
revoke all on planzo_private.booking_handoffs,planzo_private.booking_tasks,planzo_private.booking_reports,planzo_private.milestone_events from public,anon,authenticated;
create trigger booking_tasks_immutable before update or delete on planzo_private.booking_tasks for each row execute function planzo_private.immutable_plan();
create trigger booking_reports_immutable before update or delete on planzo_private.booking_reports for each row execute function planzo_private.immutable_plan();
create trigger milestone_events_immutable before update or delete on planzo_private.milestone_events for each row execute function planzo_private.immutable_plan();

create function planzo_private.booking_providers() returns jsonb
language sql immutable security invoker set search_path='' as $$
 select '[{"id":"unselected","label":"Choose a handoff method","type":"unselected","url":null},
 {"id":"manual","label":"Verify directly with a provider","type":"manual","url":null},
 {"id":"irctc","label":"IRCTC","type":"generic_search","url":"https://www.irctc.co.in/"},
 {"id":"booking","label":"Booking.com","type":"generic_search","url":"https://www.booking.com/"},
 {"id":"goamiles","label":"GoaMiles","type":"generic_search","url":"https://www.goamiles.com/"}]'::jsonb
$$;

-- Internal only: evaluates private constraints, emits five safe statuses and no costs.
create function planzo_private.booking_milestones(p_trip uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.planzo_trips%rowtype; s jsonb; i jsonb; p jsonb; inputs boolean; feasible boolean; choices boolean;
 agreed boolean; prepared boolean:=false; had_inputs boolean; had_plan boolean; expected_count integer; actual_count integer; configured integer; issues integer;
begin
 select * into t from public.planzo_trips where id=p_trip;
 s:=planzo_private.planning_state(p_trip,null); i:=planzo_private.itinerary_state(p_trip,null); p:=s->'plan';
 select count(*)>=t.minimum_group_size and coalesce(bool_and(coalesce(b.confirmed and b.revision=b.confirmed_revision,false)),false),coalesce(bool_or(b.revision>0),false)
 into inputs,had_inputs from public.planzo_trip_members m left join public.planzo_brief_status b on b.trip_id=m.trip_id and b.user_id=m.user_id where m.trip_id=p_trip and m.included;
 had_plan:=p is not null and p<>'null'::jsonb;
 feasible:=coalesce((p->>'current')::boolean,false) or
  (coalesce((i#>>'{draft,current}')::boolean,false) and jsonb_array_length(i#>'{draft,blockers}')=0) or
  (coalesce((s#>>'{draft,current}')::boolean,false) and exists(select 1 from jsonb_array_elements(s#>'{draft,options}') o where jsonb_array_length(o->'blockers')=0));
 choices:=coalesce((p->>'current')::boolean,false) or
  (coalesce((i#>>'{draft,current}')::boolean,false) and jsonb_array_length(i#>'{draft,blockers}')=0) or
  (coalesce((s#>>'{draft,current}')::boolean,false) and s#>>'{draft,selected_option}' is not null and feasible);
 if exists(select 1 from planzo_private.itinerary_polls where trip_id=p_trip and status in ('open','unresolved')) or
 exists(select 1 from planzo_private.plan_polls where trip_id=p_trip and status in ('open','unresolved')) then choices:=false; end if;
 agreed:=t.stage='agreed' and coalesce((p->>'current')::boolean,false) and
  (select count(*) from jsonb_array_elements(p->'responses') r where r->>'status'='ready')=jsonb_array_length(p->'roster');
 if agreed and exists(select 1 from planzo_private.booking_handoffs where plan_id=(p->>'id')::uuid) then
  expected_count:=jsonb_array_length(p->'roster')*2+4;
  with latest as (select distinct on(task_key) * from planzo_private.booking_tasks where plan_id=(p->>'id')::uuid order by task_key,revision desc)
  select count(*),count(*) filter(where owner_id is not null and due_at is not null and provider_id<>'unselected'),
   count(*) filter(where (select r.status from planzo_private.booking_reports r where r.plan_id=x.plan_id and r.task_key=x.task_key and r.task_revision=x.revision order by r.revision desc limit 1) in ('link_problem','changed_terms'))
  into actual_count,configured,issues from latest x;
  prepared:=actual_count=expected_count and configured=expected_count and issues=0;
 end if;
 return jsonb_build_array(
  jsonb_build_object('id','inputs','label','Inputs received','status',case when inputs then 'complete' when had_inputs then 'needs_review' else 'pending' end),
  jsonb_build_object('id','feasible','label','Itinerary feasible','status',case when feasible then 'complete' when had_plan or i->'draft'<>'null'::jsonb or s->'draft'<>'null'::jsonb then 'needs_review' else 'pending' end),
  jsonb_build_object('id','choices','label','Shared choices resolved','status',case when choices then 'complete' when had_plan then 'needs_review' else 'pending' end),
  jsonb_build_object('id','decision','label','Decision recorded','status',case when t.stage in ('agreed','revise','postponed') then 'complete' when had_plan then 'needs_review' else 'pending' end),
  jsonb_build_object('id','handoff','label','Booking handoff prepared','status',case when t.stage in ('postponed','archived') then 'not_applicable' when prepared then 'complete' when not agreed and exists(select 1 from planzo_private.booking_handoffs where trip_id=p_trip) then 'needs_review' else 'pending' end));
end $$;

create function planzo_private.record_booking_milestones() returns trigger
language plpgsql security definer set search_path='' as $$
declare trip uuid; states jsonb; previous jsonb;
begin
 if tg_table_name='planzo_trips' then trip:=new.id; else trip:=new.trip_id; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-milestones:'||trip::text,0));
 states:=planzo_private.booking_milestones(trip);
 select e.states into previous from planzo_private.milestone_events e where e.trip_id=trip order by e.created_at desc,e.id desc limit 1;
 if previous is distinct from states then
  insert into planzo_private.milestone_events(trip_id,context_revision,states) select trip,revision,states from public.planzo_trips where id=trip;
 end if;
 return null;
end $$;
-- Deferred until drafts/plans/tasks and trip stage have all been saved atomically.
create constraint trigger planzo_trip_milestones after insert or update on public.planzo_trips deferrable initially deferred for each row execute function planzo_private.record_booking_milestones();
create constraint trigger planzo_handoff_milestones after insert or update on planzo_private.booking_handoffs deferrable initially deferred for each row execute function planzo_private.record_booking_milestones();

create function planzo_private.booking_state(p_trip uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s jsonb; p jsonb; v_plan_id uuid; current boolean; agreed boolean; h planzo_private.booking_handoffs%rowtype; tasks jsonb; old jsonb; history jsonb;
begin
 s:=planzo_private.planning_state(p_trip,p_actor); p:=s->'plan'; v_plan_id:=(p->>'id')::uuid;
 current:=coalesce((p->>'current')::boolean,false); agreed:=s->>'stage'='agreed' and current;
 select * into h from planzo_private.booking_handoffs where booking_handoffs.plan_id=v_plan_id;
 select coalesce(jsonb_agg(jsonb_build_object('key',x.task_key,'revision',x.revision,'category',x.category,'personal',x.personal_owner is not null,
  'owner_id',x.owner_id,'due_at',x.due_at,'provider_id',x.provider_id,'saved_at',x.created_at,
  'report',case when r.revision is null then null else jsonb_build_object('revision',r.revision,'task_revision',r.task_revision,'status',r.status,'reporter',r.reporter,'at',r.created_at,'current_task',r.task_revision=x.revision) end) order by x.task_key),'[]') into tasks
 from (select distinct on(task_key) * from planzo_private.booking_tasks b where b.plan_id=v_plan_id and (personal_owner is null or personal_owner=p_actor) order by task_key,revision desc) x
 left join lateral (select * from planzo_private.booking_reports b where b.plan_id=x.plan_id and b.task_key=x.task_key order by revision desc limit 1) r on true;
 select coalesce(jsonb_agg(z order by z->>'at' desc),'[]') into history from (
  select jsonb_build_object('plan_id',b.plan_id,'version',v.version,'task_key',b.task_key,'task_revision',b.task_revision,'status',b.status,'reporter',b.reporter,'at',b.created_at) z
  from planzo_private.booking_reports b join planzo_private.booking_tasks k on k.plan_id=b.plan_id and k.task_key=b.task_key and k.revision=b.task_revision
  join planzo_private.plan_versions v on v.id=b.plan_id where b.trip_id=p_trip and (k.personal_owner is null or k.personal_owner=p_actor)
  order by b.created_at desc,b.revision desc limit 60) reports;
 select coalesce(jsonb_agg(jsonb_build_object('plan_id',v.id,'version',v.version,'created_at',b.created_at) order by v.version desc),'[]') into old
 from planzo_private.booking_handoffs b join planzo_private.plan_versions v on v.id=b.plan_id where b.trip_id=p_trip and b.plan_id is distinct from v_plan_id;
 return jsonb_build_object('revision',s->'revision','stage',s->'stage','plan',case when v_plan_id is null then null else jsonb_build_object('id',v_plan_id,'version',p->'version','current',current,'agreed',agreed,'roster',p->'roster','created_at',p->'created_at') end,
  'handoff_revision',coalesce(h.revision,0),'tasks',tasks,'providers',planzo_private.booking_providers(),'earlier_handoffs',old,'report_history',history,
  'milestones',planzo_private.booking_milestones(p_trip),
  'milestone_history',coalesce((select jsonb_agg(x order by x->>'at' desc) from (select jsonb_build_object('id',id,'revision',context_revision,'states',states,'at',created_at) x from planzo_private.milestone_events where trip_id=p_trip order by created_at desc,id desc limit 30) e),'[]'));
end $$;

-- Narrow private definer: identity, membership, role, exact version, revision and
-- ownership are checked here; no raw brief, private note, group costs or receipts leave it.
create function planzo_private.booking_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); trip uuid; role_name text; t public.planzo_trips%rowtype; s jsonb; p jsonb; v_plan_id uuid;
 h planzo_private.booking_handoffs%rowtype; k planzo_private.booking_tasks%rowtype; req uuid; request_hash text; receipt planzo_private.operation_receipts%rowtype;
 key text; owner uuid; due timestamptz; provider text; member uuid; report_status text; report_revision integer; result jsonb;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception using errcode='42501',message='Sign in with a verified email to continue.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid request.'; end if;
 for key in select jsonb_object_keys(p_payload) loop
  if key not in ('trip_id','plan_id','request_id','expected_revision','expected_handoff_revision','task_key','expected_task_revision','owner_id','due_at','provider_id','status','expected_report_revision','acknowledged') then raise exception 'Unsupported request field.'; end if;
 end loop;
 trip:=(p_payload->>'trip_id')::uuid;
 select role into role_name from public.planzo_trip_members where trip_id=trip and user_id=actor;
 if role_name is null then raise exception using errcode='42501',message='You do not have access to this trip.'; end if;
 select * into t from public.planzo_trips where id=trip for update;
 if p_action='get' then return planzo_private.booking_state(trip,actor); end if;
 if p_action not in ('prepare','save_task','report','flag_change') then raise exception 'Unknown booking action.'; end if;
 req:=(p_payload->>'request_id')::uuid;
 if req is null then raise exception 'A request identifier is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
 request_hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
 if found then
  if receipt.action<>'booking:'||p_action or receipt.request_hash is distinct from request_hash then raise exception 'This request identifier was already used for different input.'; end if;
  return receipt.result;
 end if;
 if (p_payload->>'expected_revision')::integer is distinct from t.revision then raise exception using errcode='40001',message='This trip changed. Refresh before updating the handoff.'; end if;
 s:=planzo_private.planning_state(trip,actor); p:=s->'plan'; v_plan_id:=(p->>'id')::uuid;
 if v_plan_id is null or v_plan_id is distinct from (p_payload->>'plan_id')::uuid or not coalesce((p->>'current')::boolean,false) or t.stage<>'agreed' then raise exception 'Booking updates require the current agreed plan. Earlier handoffs stay historical.'; end if;
 if (select count(*) from jsonb_array_elements(p->'responses') r where r->>'status'='ready')<>jsonb_array_length(p->'roster') then raise exception 'Everyone included must still be ready for this agreed version.'; end if;
 select * into h from planzo_private.booking_handoffs b where b.plan_id=v_plan_id for update;
 if (p_payload->>'expected_handoff_revision')::integer is distinct from coalesce(h.revision,0) then raise exception using errcode='40001',message='The booking handoff changed. Refresh before saving.'; end if;
 if p_action='prepare' then
  if role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser prepares the booking handoff.'; end if;
  if h.plan_id is not null then result:=jsonb_build_object('prepared',true);
  else
   insert into planzo_private.booking_handoffs(trip_id,plan_id) values(trip,v_plan_id);
   foreach key in array array['stay','local','food','activities'] loop
    insert into planzo_private.booking_tasks(trip_id,plan_id,task_key,revision,category,created_by) values(trip,v_plan_id,key,1,key,actor);
   end loop;
   for member in select value::uuid from jsonb_array_elements_text(p->'roster') loop
    foreach key in array array['travel','personal'] loop
     insert into planzo_private.booking_tasks(trip_id,plan_id,task_key,revision,category,personal_owner,owner_id,created_by) values(trip,v_plan_id,key||':'||member,1,key,member,member,actor);
    end loop;
   end loop;
   insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'booking:'||req,'Booking responsibilities opened for Plan v'||(p->>'version')||'. Tasks are pending; no reservation was made.');
   result:=jsonb_build_object('prepared',true);
  end if;
 else
  if h.plan_id is null then raise exception 'Prepare this version’s booking handoff first.'; end if;
  key:=p_payload->>'task_key';
  select * into k from planzo_private.booking_tasks b where b.plan_id=v_plan_id and b.task_key=key order by b.revision desc limit 1;
  if k.plan_id is null or (k.personal_owner is not null and k.personal_owner<>actor) then raise exception using errcode='42501',message='This task is unavailable to you in this handoff.'; end if;
  if (p_payload->>'expected_task_revision')::integer is distinct from k.revision then raise exception 'The task changed. Refresh before saving.'; end if;
  if p_action='save_task' then
   owner:=(p_payload->>'owner_id')::uuid; due:=(p_payload->>'due_at')::timestamptz; provider:=p_payload->>'provider_id';
   if k.personal_owner is not null then
    if actor<>k.personal_owner or owner is distinct from actor then raise exception using errcode='42501',message='Only you can manage your personal task.'; end if;
   elsif role_name<>'organiser' and (k.owner_id is distinct from actor or owner is distinct from actor) then raise exception using errcode='42501',message='Only the organiser assigns shared tasks; an assigned owner can update their own details.'; end if;
   if owner is not null and (not exists(select 1 from public.planzo_trip_members m where m.trip_id=trip and m.user_id=owner and m.included) or not exists(select 1 from jsonb_array_elements_text(p->'roster') v where v.value=owner::text)) then raise exception 'Choose an included owner from this agreed plan.'; end if;
   if due is not null and (due<=now() or due>(select starts_at from public.planzo_trip_windows where trip_id=trip and id=(select window_id from planzo_private.plan_versions where id=v_plan_id))) then raise exception 'Choose a future due time no later than departure.'; end if;
   if provider is null or not exists(select 1 from jsonb_array_elements(planzo_private.booking_providers()) v where v->>'id'=provider) or
    (provider='irctc' and k.category<>'travel') or (provider='booking' and k.category<>'stay') or (provider='goamiles' and k.category<>'local') then raise exception 'Choose a supported handoff method for this category.'; end if;
   insert into planzo_private.booking_tasks(trip_id,plan_id,task_key,revision,category,personal_owner,owner_id,due_at,provider_id,created_by)
    values(trip,v_plan_id,key,k.revision+1,k.category,k.personal_owner,owner,due,provider,actor);
   result:=jsonb_build_object('saved',true);
  else
   if k.owner_id is distinct from actor then raise exception using errcode='42501',message='Only the assigned task owner can record its status.'; end if;
   report_status:=case when p_action='flag_change' then 'changed_terms' else p_payload->>'status' end;
   if report_status is null or report_status not in ('pending','reported','not_needed','link_problem','changed_terms') or (p_action='report' and report_status='changed_terms') then raise exception 'Choose a supported task status.'; end if;
   if report_status in ('reported','not_needed','changed_terms') and not coalesce((p_payload->>'acknowledged')::boolean,false) then raise exception 'Explicitly acknowledge your provider check and its effect on the current plan.'; end if;
   if report_status in ('reported','not_needed') and (k.due_at is null or k.provider_id='unselected') then raise exception 'Save the owner, due time and handoff method before reporting completion.'; end if;
   select coalesce(max(b.revision),0) into report_revision from planzo_private.booking_reports b where b.plan_id=v_plan_id and b.task_key=key;
   if (p_payload->>'expected_report_revision')::integer is distinct from report_revision then raise exception 'The task report changed. Refresh before replacing it.'; end if;
   insert into planzo_private.booking_reports(trip_id,plan_id,task_key,revision,task_revision,reporter,status,acknowledged)
    values(trip,v_plan_id,key,report_revision+1,k.revision,actor,report_status,coalesce((p_payload->>'acknowledged')::boolean,false));
   if p_action='flag_change' then
    update public.planzo_trips set revision=revision+1,stage='revise',updated_at=now() where id=trip;
    insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'booking:'||req,'A provider check found changed plan terms. Earlier agreement and booking reports remain historical; a new plan and fresh responses are required.');
   end if;
   result:=jsonb_build_object('saved',true,'needs_review',p_action='flag_change');
  end if;
  update planzo_private.booking_handoffs b set revision=revision+1 where b.plan_id=v_plan_id;
 end if;
 insert into planzo_private.operation_receipts(user_id,request_id,action,request_hash,result) values(actor,req,'booking:'||p_action,request_hash,result);
 return result;
end $$;
create function public.planzo_booking(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select planzo_private.booking_api(p_action,p_payload) $$;
revoke all on function planzo_private.booking_providers(),planzo_private.booking_milestones(uuid),planzo_private.record_booking_milestones(),planzo_private.booking_state(uuid,uuid),planzo_private.booking_api(text,jsonb),public.planzo_booking(text,jsonb) from public,anon,authenticated;
grant execute on function planzo_private.booking_api(text,jsonb),public.planzo_booking(text,jsonb) to authenticated;
