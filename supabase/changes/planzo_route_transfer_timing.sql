-- Validate scheduled journey duration, not a lower minimum hint; preserve the actual distance/buffer checks.
do $patch$declare definition text;body text;begin
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid='planzo_private.route_document(jsonb,jsonb)'::regprocedure;
 if md5(body)<>'232e26a02534d2daf6a6da87b2830110' then raise exception 'Unexpected route transfer baseline';end if;
 definition:=replace(definition,$from$i->>'mode'='none' or i->>'zone'=i->>'end_zone' or (i->>'minimum_minutes')::integer<planzo_private.route_minutes((select value from jsonb_array_elements(zones) z where z->>'id'=i->>'zone'),(select value from jsonb_array_elements(zones) z where z->>'id'=i->>'end_zone'),i->>'mode')$from$,$to$i->>'mode'='none' or (i->>'mode'='flight' and i->>'zone'=i->>'end_zone')$to$);
 if position($to$i->>'mode'='none' or (i->>'mode'='flight' and i->>'zone'=i->>'end_zone')$to$ in definition)=0 then raise exception 'Route transfer patch failed';end if;execute definition;end$patch$;
