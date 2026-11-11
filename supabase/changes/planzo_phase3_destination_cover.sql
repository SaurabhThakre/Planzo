-- Only the destination-cover Edge Function can reserve and complete generation.
create table planzo_private.destination_covers (
 destination_key text primary key,
 lease_id uuid not null,
 attempted_at timestamptz not null default now(),
 scene jsonb check (scene is null or jsonb_typeof(scene) = 'object')
);
alter table planzo_private.destination_covers enable row level security;
revoke all on planzo_private.destination_covers from public,anon,authenticated,service_role;

create table planzo_private.destination_cover_attempts (
 lease_id uuid primary key,
 attempted_at timestamptz not null default now()
);
alter table planzo_private.destination_cover_attempts enable row level security;
revoke all on planzo_private.destination_cover_attempts from public,anon,authenticated,service_role;

create function public.planzo_cover_reserve(p_actor uuid,p_trip uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 destination text;
 cache_key text;
 cached planzo_private.destination_covers%rowtype;
begin
 select t.destination into destination from public.planzo_trips t
 join public.planzo_trip_members m on m.trip_id=t.id and m.user_id=p_actor
 where t.id=p_trip and t.removal_kind is distinct from 'deleted_trip' and t.removal_kind is distinct from 'deleted_draft';
 if not found then raise exception using errcode='42501',message='Trip unavailable.';end if;
 cache_key:=encode(sha256(convert_to(lower(regexp_replace(btrim(destination),'[[:space:]]+',' ','g')),'UTF8')),'hex');

 perform pg_advisory_xact_lock(hashtextextended('planzo destination covers',0));
 delete from planzo_private.destination_covers where attempted_at<now()-interval '90 days';
 select * into cached from planzo_private.destination_covers where destination_key=cache_key;
 if cached.scene is not null then return jsonb_build_object('scene',cached.scene);end if;
 if cached.attempted_at>now()-interval '5 minutes' then return '{}'::jsonb;end if;
 delete from planzo_private.destination_cover_attempts where attempted_at<=now()-interval '24 hours';
 if (select count(*) from planzo_private.destination_cover_attempts)>=8 then
  return '{}'::jsonb;
 end if;

 insert into planzo_private.destination_covers(destination_key,lease_id)
 values(cache_key,gen_random_uuid())
 on conflict(destination_key) do update set lease_id=excluded.lease_id,attempted_at=excluded.attempted_at
 returning * into cached;
 insert into planzo_private.destination_cover_attempts(lease_id) values(cached.lease_id);
 return jsonb_build_object('destination',destination,'key',cache_key,'lease_id',cached.lease_id);
end
$$;

create function public.planzo_cover_finish(p_key text,p_lease uuid,p_scene jsonb)
returns void language sql security definer set search_path='' as $$
 update planzo_private.destination_covers set scene=p_scene
 where destination_key=p_key and lease_id=p_lease and scene is null;
$$;
revoke all on function public.planzo_cover_reserve(uuid,uuid),public.planzo_cover_finish(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.planzo_cover_reserve(uuid,uuid),public.planzo_cover_finish(text,uuid,jsonb) to service_role;
