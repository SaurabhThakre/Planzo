-- Forward-only setup controls and recoverable trip lifecycle; no existing rows rewritten.
alter table public.planzo_trips add column tentative_days integer not null default 3 check(tentative_days between 1 and 365);
alter table public.planzo_trips add column removal_kind text check(removal_kind in ('deleted_draft','archived'));
alter table public.planzo_trips add column removed_at timestamptz;
alter table public.planzo_trips add constraint planzo_removal_consistent check((removal_kind is null and removed_at is null) or (removal_kind is not null and removed_at is not null and stage='archived'));
alter table public.planzo_trips drop constraint planzo_trips_minimum_group_size_check;
alter table public.planzo_trips add constraint planzo_trips_minimum_group_size_check check(minimum_group_size between 1 and 100);
alter table planzo_private.plan_versions drop constraint plan_versions_roster_check;
alter table planzo_private.plan_versions add constraint plan_versions_roster_check check(cardinality(roster) between 1 and 100);
alter table planzo_private.plan_polls drop constraint plan_polls_roster_check;
alter table planzo_private.plan_polls add constraint plan_polls_roster_check check(cardinality(roster) between 1 and 100);
alter table planzo_private.itinerary_polls drop constraint itinerary_polls_roster_check;
alter table planzo_private.itinerary_polls add constraint itinerary_polls_roster_check check(cardinality(roster) between 1 and 100);

create function planzo_private.unused_trip(p_trip uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select t.stage='collecting' and t.removal_kind is null
 and (select count(*) from public.planzo_trip_members where trip_id=p_trip)=1
 and not exists(select 1 from planzo_private.trip_invites where trip_id=p_trip)
 and not exists(select 1 from public.planzo_brief_status where trip_id=p_trip and revision>0)
 and not exists(select 1 from planzo_private.planning_drafts where trip_id=p_trip)
 and not exists(select 1 from planzo_private.itinerary_drafts where trip_id=p_trip)
 and not exists(select 1 from planzo_private.plan_versions where trip_id=p_trip)
 and not exists(select 1 from planzo_private.plan_polls where trip_id=p_trip)
 and not exists(select 1 from planzo_private.itinerary_polls where trip_id=p_trip)
 from public.planzo_trips t where t.id=p_trip
$$;
revoke all on function planzo_private.unused_trip(uuid) from public,anon,authenticated;

do $patch$
declare body text;definition text;
begin
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid='planzo_private.api(text,jsonb)'::regprocedure;
 if md5(body)<>'c64b24df7b43fbef4685494391237a6f' then raise exception 'Unexpected core API baseline';end if;
 definition:=replace(definition,'''role'',m.role,''stage'',t.stage,''created_at'',t.created_at)',
 '''role'',m.role,''stage'',t.stage,''created_at'',t.created_at,''tentative_days'',t.tentative_days,''removal_kind'',t.removal_kind,''can_delete'',m.role=''organiser'' and planzo_private.unused_trip(t.id))');
 definition:=replace(definition,'insert into public.planzo_trips(created_by,name,destination,minimum_group_size,response_deadline)',
 'insert into public.planzo_trips(created_by,name,destination,minimum_group_size,response_deadline,tentative_days)');
 definition:=replace(definition,'(p_payload->>''minimum'')::integer,deadline)',
 '(p_payload->>''minimum'')::integer,deadline,coalesce((p_payload->>''tentative_days'')::integer,3))');
 definition:=replace(definition,'where trip_id=trip)>=8 then raise exception ''This trip already has eight members.''',
 'where trip_id=trip)>=100 then raise exception ''This trip already has 100 members.''');
 if definition=pg_get_functiondef('planzo_private.api(text,jsonb)'::regprocedure) or position('''can_delete''' in definition)=0 or position('tentative_days)' in definition)=0 or position('>=100' in definition)=0 then raise exception 'Core API patch failed';end if;
 execute definition;
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid='planzo_private.evaluate_itinerary(uuid,uuid,jsonb)'::regprocedure;
 if md5(body)<>'215755c4192cffd28c5c7cc6f0048134' then raise exception 'Unexpected itinerary evaluation baseline';end if;
 execute replace(definition,'Confirm an included roster that meets the trip minimum (four to eight).','Confirm a roster meeting the trip minimum. The current price reference supports up to eight travellers.');
end $patch$;

create function planzo_private.manage_trip(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();trip uuid;role_name text;t public.planzo_trips%rowtype;req uuid;key text;receipt record;digest text;result jsonb;has_plan boolean;
begin
 if actor is null or not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then raise exception using errcode='42501',message='Sign in with a verified email to continue.';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid trip management request.';end if;
 for key in select jsonb_object_keys(p_payload) loop
  if key not in ('trip_id','request_id','expected_revision','acknowledged') then raise exception 'Unsupported trip management field.';end if;
 end loop;
 trip:=(p_payload->>'trip_id')::uuid;
 select role into role_name from public.planzo_trip_members where trip_id=trip and user_id=actor;
 if role_name is null then raise exception using errcode='42501',message='You do not have access to this trip.';end if;
 select * into t from public.planzo_trips where id=trip for update;
 if p_action='get' then return jsonb_build_object('can_delete',role_name='organiser' and planzo_private.unused_trip(trip),'removal_kind',t.removal_kind,'revision',t.revision);end if;
 if p_action not in ('delete_unused','archive','restore') then raise exception 'Unknown trip management action.';end if;
 if role_name<>'organiser' or t.created_by<>actor then raise exception using errcode='42501',message='Only the organiser can remove or restore this trip.';end if;
 if p_payload->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Confirm this trip management action.';end if;
 req:=(p_payload->>'request_id')::uuid;if req is null then raise exception 'A request identifier is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
 digest:=encode(extensions.digest(p_action||p_payload::text,'sha256'),'hex');
 select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
 if found then
  if receipt.action<>'trip:'||p_action or receipt.request_hash is distinct from digest then raise exception 'This request identifier was already used for different input.';end if;
  return receipt.result;
 end if;
 if jsonb_typeof(p_payload->'expected_revision') is distinct from 'number' or (p_payload->>'expected_revision') !~ '^[1-9][0-9]{0,8}$' or (p_payload->>'expected_revision')::integer<>t.revision then raise exception using errcode='40001',message='This trip changed. Refresh before removing or restoring it.';end if;
 if p_action='delete_unused' then
  if not coalesce(planzo_private.unused_trip(trip),false) then raise exception 'This trip has been used or shared. Archive it to keep everyone’s history.';end if;
  update public.planzo_trips set removal_kind='deleted_draft',removed_at=now(),stage='archived',revision=revision+1,updated_at=now() where id=trip;
 elsif p_action='archive' then
  if t.stage='archived' then raise exception 'This trip is already removed or archived.';end if;
  update public.planzo_trips set removal_kind='archived',removed_at=now(),stage='archived',revision=revision+1,updated_at=now() where id=trip;
 else
  if t.removal_kind is null and t.stage<>'archived' then raise exception 'This trip has not been removed.';end if;
  select exists(select 1 from planzo_private.plan_versions where trip_id=trip) or exists(select 1 from planzo_private.itinerary_drafts where trip_id=trip) or exists(select 1 from planzo_private.planning_drafts where trip_id=trip) into has_plan;
  update public.planzo_trips set removal_kind=null,removed_at=null,stage=case when has_plan then 'revise' else 'collecting' end,revision=revision+1,updated_at=now() where id=trip;
 end if;
 insert into planzo_private.planning_events(trip_id,event_key,message) values(trip,'trip:'||req,
 case p_action when 'delete_unused' then 'Unused draft moved to Deleted trips. It can be restored; saved records were retained.'
 when 'archive' then 'The organiser archived this trip. Saved decisions and history remain available.'
 else 'The organiser restored this trip. Any earlier plan needs fresh review before agreement.' end);
 result:=jsonb_build_object('trip_id',trip,'action',p_action,'recoverable',true);
 insert into planzo_private.operation_receipts(user_id,request_id,action,result,request_hash) values(actor,req,'trip:'||p_action,result,digest);
 return result;
end $$;
create function public.planzo_manage_trip(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select planzo_private.manage_trip(p_action,p_payload)$$;
revoke all on function planzo_private.manage_trip(text,jsonb),public.planzo_manage_trip(text,jsonb) from public,anon,authenticated;
grant execute on function planzo_private.manage_trip(text,jsonb),public.planzo_manage_trip(text,jsonb) to authenticated;
