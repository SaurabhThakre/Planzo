-- Planzo first live slice. Target: ewysgpuwvufbklesdhuj only.
-- Additive migration; Supabase Auth owns passwords and sessions.
create schema if not exists planzo_private;
revoke all on schema planzo_private from public, anon, authenticated;
grant usage on schema planzo_private to anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table public.planzo_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 50),
  created_at timestamptz not null default now()
);
create table public.planzo_trips (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  destination text not null check (length(btrim(destination)) between 1 and 80),
  timezone text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  minimum_group_size integer not null check (minimum_group_size between 4 and 8),
  response_deadline timestamptz not null,
  revision integer not null default 1 check (revision > 0),
  stage text not null default 'collecting' check (stage in ('collecting','planning','reviewing','agreed','revise','postponed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planzo_trips_creator_idx on public.planzo_trips(created_by);
create table public.planzo_trip_windows (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.planzo_trips(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  unique (trip_id,id), unique (trip_id,starts_at,ends_at)
);
create table public.planzo_trip_members (
  trip_id uuid not null references public.planzo_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 50),
  role text not null check (role in ('organiser','member')),
  included boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (trip_id,user_id)
);
create index planzo_members_user_idx on public.planzo_trip_members(user_id,trip_id);
create unique index planzo_one_organiser_idx on public.planzo_trip_members(trip_id) where role='organiser';
create table public.planzo_brief_status (
  trip_id uuid not null,
  user_id uuid not null,
  revision integer not null default 0 check (revision >= 0),
  confirmed boolean not null default false,
  confirmed_revision integer,
  updated_at timestamptz not null default now(),
  primary key(trip_id,user_id),
  foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id) on delete cascade,
  check (not confirmed or confirmed_revision = revision)
);
create index planzo_brief_status_user_idx on public.planzo_brief_status(user_id,trip_id);
create table planzo_private.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.planzo_trips(id) on delete cascade,
  created_by uuid not null,
  token_hash text not null unique check (length(token_hash)=64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(trip_id,created_by) references public.planzo_trip_members(trip_id,user_id)
);
create index planzo_invites_trip_idx on planzo_private.trip_invites(trip_id);
create index planzo_invites_creator_idx on planzo_private.trip_invites(created_by);
create table planzo_private.member_brief_drafts (
  trip_id uuid not null,
  user_id uuid not null,
  revision integer not null check (revision > 0),
  content jsonb not null check (jsonb_typeof(content)='object'),
  updated_at timestamptz not null default now(),
  primary key(trip_id,user_id),
  foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id) on delete cascade
);
create index planzo_draft_user_idx on planzo_private.member_brief_drafts(user_id,trip_id);
create table planzo_private.member_brief_revisions (
  trip_id uuid not null,
  user_id uuid not null,
  revision integer not null check (revision > 0),
  content jsonb not null check (jsonb_typeof(content)='object'),
  confirmed_at timestamptz not null default now(),
  primary key(trip_id,user_id,revision),
  foreign key(trip_id,user_id) references public.planzo_trip_members(trip_id,user_id) on delete cascade
);
create index planzo_revisions_user_idx on planzo_private.member_brief_revisions(user_id,trip_id);
create table planzo_private.operation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  action text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);

-- A small non-exposed helper avoids recursive membership RLS.
create function planzo_private.is_member(p_trip uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and exists (
  select 1 from public.planzo_trip_members m where m.trip_id=p_trip and m.user_id=auth.uid()
) $$;

alter table public.planzo_profiles enable row level security;
alter table public.planzo_trips enable row level security;
alter table public.planzo_trip_windows enable row level security;
alter table public.planzo_trip_members enable row level security;
alter table public.planzo_brief_status enable row level security;
alter table planzo_private.trip_invites enable row level security;
alter table planzo_private.member_brief_drafts enable row level security;
alter table planzo_private.member_brief_revisions enable row level security;
alter table planzo_private.operation_receipts enable row level security;
create policy planzo_own_profile on public.planzo_profiles for select to authenticated using (user_id=(select auth.uid()));
create policy planzo_member_trip on public.planzo_trips for select to authenticated using (planzo_private.is_member(id));
create policy planzo_member_windows on public.planzo_trip_windows for select to authenticated using (planzo_private.is_member(trip_id));
create policy planzo_member_roster on public.planzo_trip_members for select to authenticated using (planzo_private.is_member(trip_id));
create policy planzo_member_status on public.planzo_brief_status for select to authenticated using (planzo_private.is_member(trip_id));
revoke all on public.planzo_profiles, public.planzo_trips, public.planzo_trip_windows, public.planzo_trip_members, public.planzo_brief_status from public,anon,authenticated;
grant select on public.planzo_profiles, public.planzo_trips, public.planzo_trip_windows, public.planzo_trip_members, public.planzo_brief_status to authenticated;
revoke all on all tables in schema planzo_private from public,anon,authenticated;

create function planzo_private.invite_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='This invitation is invalid, expired or revoked.';
  end if;
  select jsonb_build_object('name',t.name,'destination',t.destination,'expires_at',i.expires_at)
  into result from planzo_private.trip_invites i join public.planzo_trips t on t.id=i.trip_id
  where i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and i.revoked_at is null
    and i.expires_at>now() and t.stage <> 'archived';
  if result is null then
    raise exception using errcode='22023', message='This invitation is invalid, expired or revoked.';
  end if;
  return result;
end $$;

create function planzo_private.api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  trip uuid;
  role_name text;
  item jsonb;
  result jsonb;
  req uuid;
  existing_receipt record;
  invite planzo_private.trip_invites%rowtype;
  status_row public.planzo_brief_status%rowtype;
  trip_row public.planzo_trips%rowtype;
  b jsonb;
  token text;
  ceiling bigint;
  n integer;
  star_total integer;
  key_name text;
  start_time timestamptz;
  end_time timestamptz;
  deadline timestamptz;
  confirm_input boolean;
begin
  if actor is null or not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    raise exception using errcode='42501', message='Sign in with a verified email to continue.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023', message='Invalid request.';
  end if;
  select display_name into actor_name from public.planzo_profiles where user_id=actor;
  if actor_name is null then
    actor_name := 'Traveller';
    insert into public.planzo_profiles(user_id,display_name) values(actor,actor_name) on conflict do nothing;
  end if;

  if p_action='profile' then
    actor_name := btrim(coalesce(p_payload->>'name',''));
    if length(actor_name) not between 1 and 50 then raise exception 'Enter a name between 1 and 50 characters.'; end if;
    update public.planzo_profiles set display_name=actor_name where user_id=actor;
    return jsonb_build_object('id',actor,'name',actor_name);
  elsif p_action='list' then
    return jsonb_build_object('profile',jsonb_build_object('id',actor,'name',actor_name),'trips',coalesce((
      select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'destination',t.destination,'revision',t.revision,
      'role',m.role,'stage',t.stage,'created_at',t.created_at) order by t.created_at desc)
      from public.planzo_trips t join public.planzo_trip_members m on m.trip_id=t.id where m.user_id=actor
    ),'[]'::jsonb));
  elsif p_action='create_trip' then
    req := (p_payload->>'request_id')::uuid;
    if req is null then raise exception 'A request identifier is required.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text||req::text,0));
    select * into existing_receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
    if found then
      if existing_receipt.action<>p_action then raise exception 'This request identifier was already used.'; end if;
      return existing_receipt.result;
    end if;
    if jsonb_typeof(p_payload->'windows') is distinct from 'array' or jsonb_array_length(p_payload->'windows') not between 1 and 3 then
      raise exception 'Choose one to three travel windows.';
    end if;
    deadline := (p_payload->>'deadline')::timestamptz;
    if deadline is null or deadline<=now() then raise exception 'Choose a future response deadline.'; end if;
    insert into public.planzo_trips(created_by,name,destination,minimum_group_size,response_deadline)
    values(actor,btrim(p_payload->>'name'),btrim(p_payload->>'destination'),(p_payload->>'minimum')::integer,deadline)
    returning id into trip;
    for item in select value from jsonb_array_elements(p_payload->'windows') loop
      start_time := (item->>'start')::timestamptz;
      end_time := (item->>'end')::timestamptz;
      if start_time is null or end_time is null or start_time<=now() or end_time<=start_time or deadline>=start_time then
        raise exception 'Travel windows must be in the future, after the response deadline, with return after departure.';
      end if;
      insert into public.planzo_trip_windows(id,trip_id,starts_at,ends_at) values((item->>'id')::uuid,trip,start_time,end_time);
    end loop;
    insert into public.planzo_trip_members(trip_id,user_id,display_name,role) values(trip,actor,actor_name,'organiser');
    insert into public.planzo_brief_status(trip_id,user_id) values(trip,actor);
    result := jsonb_build_object('trip_id',trip);
    insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,p_action,result);
    return result;
  elsif p_action='join' then
    token := p_payload->>'token';
    perform planzo_private.invite_preview(token);
    select * into invite from planzo_private.trip_invites where token_hash=encode(extensions.digest(token,'sha256'),'hex') for share;
    if invite.revoked_at is not null or invite.expires_at<=now() then raise exception 'This invitation is invalid, expired or revoked.'; end if;
    trip := invite.trip_id;
    select * into trip_row from public.planzo_trips where id=trip for update;
    if exists(select 1 from public.planzo_trip_members where trip_id=trip and user_id=actor) then
      return jsonb_build_object('trip_id',trip);
    end if;
    if trip_row.stage<>'collecting' then raise exception 'This trip is not accepting new members.'; end if;
    if (select count(*) from public.planzo_trip_members where trip_id=trip)>=8 then raise exception 'This trip already has eight members.'; end if;
    actor_name := btrim(coalesce(p_payload->>'name',''));
    if length(actor_name) not between 1 and 50 then raise exception 'Enter your name to join.'; end if;
    update public.planzo_profiles set display_name=actor_name where user_id=actor;
    insert into public.planzo_trip_members(trip_id,user_id,display_name,role) values(trip,actor,actor_name,'member');
    insert into public.planzo_brief_status(trip_id,user_id) values(trip,actor);
    update public.planzo_trips set revision=revision+1,updated_at=now() where id=trip;
    return jsonb_build_object('trip_id',trip);
  end if;

  trip := (p_payload->>'trip_id')::uuid;
  select role into role_name from public.planzo_trip_members where trip_id=trip and user_id=actor;
  if role_name is null then raise exception using errcode='42501',message='You do not have access to this trip.'; end if;

  if p_action='workspace' then
    select * into trip_row from public.planzo_trips where id=trip;
    return jsonb_build_object('trip',to_jsonb(trip_row),
      'windows',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,
        'start',to_char(w.starts_at at time zone 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI'),
        'end',to_char(w.ends_at at time zone 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI')) order by starts_at)
        from public.planzo_trip_windows w where w.trip_id=trip),'[]'::jsonb),
      'members',(select jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.display_name,'role',m.role,'included',m.included,
        'confirmed',s.confirmed,'revision',s.revision) order by joined_at)
        from public.planzo_trip_members m join public.planzo_brief_status s using(trip_id,user_id) where m.trip_id=trip),
      'own_brief',(select jsonb_build_object('content',d.content,'revision',d.revision,'confirmed',s.confirmed)
        from planzo_private.member_brief_drafts d join public.planzo_brief_status s using(trip_id,user_id)
        where d.trip_id=trip and d.user_id=actor));
  elsif p_action='create_invite' then
    if role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can create invitations.'; end if;
    select * into trip_row from public.planzo_trips where id=trip for update;
    if trip_row.stage<>'collecting' then raise exception 'This trip is not accepting new members.'; end if;
    if trip_row.response_deadline<=now() then raise exception 'The response deadline has passed. A new invitation cannot be issued.'; end if;
    if (select count(*) from planzo_private.trip_invites where trip_id=trip and revoked_at is null and expires_at>now())>=10 then
      raise exception 'Revoke an existing invitation before creating another.';
    end if;
    token := encode(extensions.gen_random_bytes(32),'hex');
    insert into planzo_private.trip_invites(trip_id,created_by,token_hash,expires_at)
    values(trip,actor,encode(extensions.digest(token,'sha256'),'hex'),least(now()+interval '7 days',trip_row.response_deadline))
    returning jsonb_build_object('id',id,'token',token,'expires_at',expires_at) into result;
    return result;
  elsif p_action='list_invites' then
    if role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can manage invitations.'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id',id,'expires_at',expires_at,'revoked_at',revoked_at,'created_at',created_at)
      order by created_at desc) from planzo_private.trip_invites where trip_id=trip),'[]'::jsonb);
  elsif p_action='revoke_invite' then
    if role_name<>'organiser' then raise exception using errcode='42501',message='Only the organiser can revoke invitations.'; end if;
    update planzo_private.trip_invites set revoked_at=coalesce(revoked_at,now()) where id=(p_payload->>'invite_id')::uuid and trip_id=trip;
    if not found then raise exception 'Invitation not found.'; end if;
    return jsonb_build_object('revoked',true);
  elsif p_action='save_brief' then
    select * into trip_row from public.planzo_trips where id=trip for update;
    if trip_row.stage='archived' then raise exception 'This trip is archived.'; end if;
    select * into status_row from public.planzo_brief_status where trip_id=trip and user_id=actor for update;
    req := (p_payload->>'request_id')::uuid;
    if req is null then raise exception 'A request identifier is required.'; end if;
    select * into existing_receipt from planzo_private.operation_receipts where user_id=actor and request_id=req;
    if found then
      if existing_receipt.action<>p_action or existing_receipt.result->>'trip_id'<>trip::text then raise exception 'This request identifier was already used.'; end if;
      return existing_receipt.result;
    end if;
    if (p_payload->>'expected_revision')::integer is distinct from status_row.revision then
      raise exception using errcode='40001',message='Your saved brief changed in another tab. Reload the latest saved version before saving again.';
    end if;
    b := p_payload->'brief';
    confirm_input := coalesce((p_payload->>'confirm')::boolean,false);
    if jsonb_typeof(b) is distinct from 'object' then raise exception 'Invalid brief.'; end if;
    for key_name in select jsonb_object_keys(b) loop
      if key_name not in ('origin','ceiling_paise','windows','vegetarian','step_free','stars','text','boat') then raise exception 'Unsupported brief field.'; end if;
    end loop;
    if jsonb_typeof(b->'origin') is distinct from 'string' or length(b->>'origin')>80
       or jsonb_typeof(b->'text') is distinct from 'string' or length(b->>'text')>2000
       or jsonb_typeof(b->'windows') is distinct from 'array' or jsonb_array_length(b->'windows')>3
       or jsonb_typeof(b->'stars') is distinct from 'object'
       or jsonb_typeof(b->'vegetarian') is distinct from 'boolean'
       or jsonb_typeof(b->'step_free') is distinct from 'boolean'
       or jsonb_typeof(b->'boat') is distinct from 'boolean' then raise exception 'Check the brief fields.'; end if;
    ceiling := null;
    if b->'ceiling_paise' is distinct from 'null'::jsonb then
      if jsonb_typeof(b->'ceiling_paise') is distinct from 'number' or (b->>'ceiling_paise') !~ '^[0-9]+$' then raise exception 'Enter a valid whole-trip ceiling.'; end if;
      ceiling := (b->>'ceiling_paise')::bigint;
      if ceiling not between 1 and 100000000 then raise exception 'Enter a ceiling between INR 0.01 and INR 1,000,000.'; end if;
    end if;
    star_total := 0;
    for key_name,item in select key,value from jsonb_each(b->'stars') loop
      if key_name not in ('Relaxation','Food','Beach','Culture','Adventure') or jsonb_typeof(item)<>'number'
         or item::text !~ '^[0-2]$' then raise exception 'Use at most two stars per interest.'; end if;
      star_total := star_total + item::text::integer;
    end loop;
    if star_total>3 then raise exception 'Use at most three priority stars.'; end if;
    for item in select value from jsonb_array_elements(b->'windows') loop
      if jsonb_typeof(item)<>'string' or not exists(select 1 from public.planzo_trip_windows where trip_id=trip and id::text=item#>>'{}') then
        raise exception 'Choose travel windows belonging to this trip.';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(b->'windows'))<>(select count(distinct value) from jsonb_array_elements(b->'windows')) then
      raise exception 'Choose each travel window once.';
    end if;
    if confirm_input and (not coalesce((p_payload->>'acknowledged')::boolean,false) or ceiling is null
      or length(btrim(b->>'origin'))=0 or jsonb_array_length(b->'windows')=0) then
      raise exception 'Check and acknowledge your origin, dates, whole-trip ceiling and requirements before confirming.';
    end if;
    n := status_row.revision+1;
    insert into planzo_private.member_brief_drafts(trip_id,user_id,revision,content) values(trip,actor,n,b)
      on conflict(trip_id,user_id) do update set revision=excluded.revision,content=excluded.content,updated_at=now();
    if confirm_input then insert into planzo_private.member_brief_revisions(trip_id,user_id,revision,content) values(trip,actor,n,b); end if;
    update public.planzo_brief_status set revision=n,confirmed=confirm_input,
      confirmed_revision=case when confirm_input then n else confirmed_revision end,updated_at=now() where trip_id=trip and user_id=actor;
    update public.planzo_trips set revision=revision+1,updated_at=now(),
      stage=case when stage in ('reviewing','agreed') then 'revise' else stage end where id=trip;
    result := jsonb_build_object('trip_id',trip,'revision',n,'confirmed',confirm_input);
    insert into planzo_private.operation_receipts(user_id,request_id,action,result) values(actor,req,p_action,result);
    return result;
  end if;
  raise exception using errcode='22023',message='This action is not available in the connected slice.';
end $$;

-- Exposed entry points execute as callers; privileged work stays in the unexposed schema.
create function public.planzo_api(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select planzo_private.api(p_action,p_payload) $$;
create function public.planzo_invite_preview(p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$ select planzo_private.invite_preview(p_token) $$;
revoke all on all functions in schema planzo_private from public,anon,authenticated;
grant execute on function planzo_private.is_member(uuid),planzo_private.api(text,jsonb) to authenticated;
grant execute on function planzo_private.invite_preview(text) to anon,authenticated;
revoke all on function public.planzo_api(text,jsonb),public.planzo_invite_preview(text) from public,anon,authenticated;
grant execute on function public.planzo_api(text,jsonb) to authenticated;
grant execute on function public.planzo_invite_preview(text) to anon,authenticated;
-- Preserve automatic RLS while removing unnecessary public invocation privileges.
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
