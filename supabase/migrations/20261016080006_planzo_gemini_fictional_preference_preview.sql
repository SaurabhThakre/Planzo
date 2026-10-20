-- Trip Pact ewysgpuwvufbklesdhuj only. Forward provider change; preserve applied SQL and receipts.
-- Google unpaid services: only explicitly fictional input on labelled AI test trips.
do $$begin
  if (select md5(prosrc) from pg_proc where oid='planzo_private.ai_api(text,jsonb)'::regprocedure) is distinct from '57e342ebe19cce44b1ded2b333a4eed6' then
    raise exception 'Unexpected AI admission baseline. Review before applying.';
  end if;
end $$;
create index planzo_gemini_receipt_budget_idx on planzo_private.operation_receipts(created_at,user_id) where action='ai:gemini';

create or replace function planzo_private.ai_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();trip uuid;req uuid;t public.planzo_trips%rowtype;
  key text;brief_revision integer;request_hash text;receipt record;result jsonb;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then
    raise exception using errcode='42501',message='Sign in with a verified email to use the AI preview.';
  end if;
  if p_action not in ('reserve','check') or p_action is null then raise exception 'Unknown AI action.';end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid AI request.';end if;
  for key in select jsonb_object_keys(p_payload) loop
    if key not in ('trip_id','request_id','expected_trip_revision','expected_brief_revision','text_sha256','consent','fictional_input','consent_policy') then
      raise exception 'Unsupported AI request field.';
    end if;
  end loop;
  if p_payload->'consent' is distinct from 'true'::jsonb or p_payload->'fictional_input' is distinct from 'true'::jsonb or p_payload->>'consent_policy' is distinct from 'planzo-ai-gemini-2026-10-16' then
    raise exception 'Confirm fictional test input and allow Gemini to interpret it, or use the manual form.';
  end if;
  if coalesce(p_payload->>'text_sha256','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_payload->'expected_trip_revision') is distinct from 'number'
    or coalesce(p_payload->>'expected_trip_revision','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_payload->'expected_brief_revision') is distinct from 'number'
    or coalesce(p_payload->>'expected_brief_revision','') !~ '^[0-9]{1,9}$' then raise exception 'Invalid AI request context.';end if;
  trip:=(p_payload->>'trip_id')::uuid;req:=(p_payload->>'request_id')::uuid;
  if trip is null or req is null then raise exception 'Trip and request identifiers are required.';end if;
  select * into t from public.planzo_trips where id=trip for update;
  if not found or not exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=actor) then
    raise exception using errcode='42501',message='You do not have access to this trip.';
  end if;
  if t.stage in ('postponed','archived') then raise exception 'This trip is postponed or archived. Manual input and history remain available.';end if;
  if t.name not like 'TEST · AI%' then raise exception 'Gemini previews are limited to labelled fictional AI test trips. Enter real preferences manually.';end if;
  select revision into brief_revision from public.planzo_brief_status where trip_id=trip and user_id=actor;
  brief_revision:=coalesce(brief_revision,0);
  if (p_payload->>'expected_trip_revision')::integer<>t.revision
    or (p_payload->>'expected_brief_revision')::integer<>brief_revision then
    raise exception using errcode='40001',message='Your trip or saved input changed. Refresh before requesting another AI preview.';
  end if;
  -- A single lock serializes the small prototype allowance across all users/trips.
  perform pg_advisory_xact_lock(hashtextextended('planzo:ai:gemini:prototype:2026-10-16',0));
  request_hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
  select * into receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
  if p_action='check' then
    if not found or receipt.action<>'ai:gemini' or receipt.request_hash is distinct from request_hash then
      raise exception using errcode='42501',message='This AI request is unavailable.';
    end if;
    return receipt.result;
  end if;
  if found then raise exception 'This preview attempt was already used. Request a new preview if needed; nothing was saved to your brief.';end if;
  if (select count(*) from planzo_private.operation_receipts where action='ai:gemini')>=8 then
    raise exception 'The prototype AI allowance is used up. You can still enter all preferences manually.';
  end if;
  if (select count(*) from planzo_private.operation_receipts where action='ai:gemini' and user_id=actor and created_at>now()-interval '24 hours')>=4 then
    raise exception 'Your AI preview limit is reached for today. Manual entry still works.';
  end if;
  if exists(select 1 from planzo_private.operation_receipts where action='ai:gemini' and user_id=actor and created_at>now()-interval '3 seconds') then
    raise exception 'Please wait a moment before requesting another AI preview.';
  end if;
  result:=jsonb_build_object('trip_id',trip,'trip_revision',t.revision,'brief_revision',brief_revision,
    'consent_policy','planzo-ai-gemini-2026-10-16','consented',true,'fictional_input',true,'provider','gemini','admitted_at',now(),
    'windows',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'start',w.starts_at,'end',w.ends_at) order by w.starts_at),'[]'::jsonb)
      from public.planzo_trip_windows w where w.trip_id=trip));
  insert into planzo_private.operation_receipts(user_id,request_id,action,result,request_hash)
    values(actor,req,'ai:gemini',result,request_hash);
  return result;
end $$;

