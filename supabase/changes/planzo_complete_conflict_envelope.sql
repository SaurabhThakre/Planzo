-- Complete PostgREST's error envelope, including its mandatory headers object.
-- Preserve original client code/message and unchanged invoker permissions.
create or replace function public.planzo_flow(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return planzo_private.flow_api(p_action,p_payload);
exception when sqlstate '40001' then
 raise sqlstate 'PGRST' using
  message=pg_catalog.jsonb_build_object('code','40001','message',sqlerrm,'details','The saved trip or response changed.','hint','Refresh before saving again.')::text,
  detail='{"status":409,"headers":{}}';
end
$$;

create or replace function public.planzo_journey(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return planzo_private.journey_api(p_action,p_payload);
exception when sqlstate '40001' then
 raise sqlstate 'PGRST' using
  message=pg_catalog.jsonb_build_object('code','40001','message',sqlerrm,'details','The saved trip or response changed.','hint','Refresh before saving again.')::text,
  detail='{"status":409,"headers":{}}';
end
$$;
