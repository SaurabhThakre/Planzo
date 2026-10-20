-- A stale UI revision is an HTTP conflict, not a retryable database failure.
-- Keep the existing 40001 client code and message; PostgREST's PGRST envelope
-- supplies HTTP409 explicitly. Only the two SECURITY INVOKER wrappers change.
-- Private authorisation, mutation/revision checks, grants and stored history stay intact.
create or replace function public.planzo_flow(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return planzo_private.flow_api(p_action,p_payload);
exception when sqlstate '40001' then
 raise sqlstate 'PGRST' using
  message=pg_catalog.jsonb_build_object('code','40001','message',sqlerrm)::text,
  detail='{"status":409}';
end
$$;

create or replace function public.planzo_journey(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return planzo_private.journey_api(p_action,p_payload);
exception when sqlstate '40001' then
 raise sqlstate 'PGRST' using
  message=pg_catalog.jsonb_build_object('code','40001','message',sqlerrm)::text,
  detail='{"status":409}';
end
$$;
