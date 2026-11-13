-- Preserve guarded private APIs and existing function ACLs. Translate optimistic
-- concurrency failures into HTTP 409 so PostgREST does not retry as server errors.
create or replace function public.planzo_booking_tracker(p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $function$
begin
 return planzo_private.booking_tracker_api(p_action,p_payload);
exception when sqlstate '40001' then
 raise sqlstate 'PGRST' using
  message=pg_catalog.jsonb_build_object('code','40001','message',sqlerrm,'details','The booking changed.','hint','Refresh bookings and review before saving again.')::text,
  detail='{"status":409,"headers":{}}';
end
$function$;
create or replace function public.planzo_payments(p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $function$
begin
 return planzo_private.payments_api(p_action,p_payload);
exception when sqlstate '40001' then
 raise sqlstate 'PGRST' using
  message=pg_catalog.jsonb_build_object('code','40001','message',sqlerrm,'details','The shared ledger changed.','hint','Refresh payments and review before saving again.')::text,
  detail='{"status":409,"headers":{}}';
end
$function$;
