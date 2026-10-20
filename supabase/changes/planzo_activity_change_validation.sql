-- Reject non-activity references in activity replacement requests. No saved rows change.
do $patch$
declare definition text;needle text:='exists(select 1 from jsonb_array_elements(ctx->''refs'') r where r->>''id''=ref)';
begin
 select pg_get_functiondef(oid) into definition from pg_proc where oid='planzo_private.flow_api(text,jsonb)'::regprocedure and md5(prosrc)='6ddf3ffdfa507cb1c32aaea46a76ce1e';
 if definition is null or position(needle in definition)=0 then raise exception 'Unexpected requirement API baseline';end if;
 definition:=replace(definition,needle,'exists(select 1 from jsonb_array_elements(ctx->''refs'') r where r->>''id''=ref and coalesce(r->>''kind'',''activity'')=''activity'')');
 execute definition;
end$patch$;
