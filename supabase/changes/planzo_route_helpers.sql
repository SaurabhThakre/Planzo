-- New route documents only; immutable saved versions remain unchanged.
create function planzo_private.route_minutes(a jsonb,b jsonb,mode text) returns integer language sql immutable security invoker set search_path='' as $$
 select greatest(1,ceil(12742*asin(least(1,sqrt(power(sin(radians((b->>'latitude')::numeric-(a->>'latitude')::numeric)/2),2)+cos(radians((a->>'latitude')::numeric))*cos(radians((b->>'latitude')::numeric))*power(sin(radians((b->>'longitude')::numeric-(a->>'longitude')::numeric)/2),2))))/case mode when 'walk' then 5 when 'local_transit' then 60 when 'rail' then 300 when 'bus' then 100 when 'taxi' then 120 when 'ferry' then 80 when 'flight' then 900 else 1 end*60+case mode when 'flight' then 150 when 'walk' then 0 when 'rail' then 20 else 10 end))::integer
$$;

create function planzo_private.route_reconcile_document(doc jsonb,missing_reason text default 'group_decision',initial boolean default false) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
#variable_conflict use_column
declare steps jsonb:='[]';components jsonb:='[]';outcomes jsonb:='[]';s jsonb;r jsonb;meta jsonb;e jsonb;source jsonb;o jsonb;ids jsonb;all_ids jsonb;included boolean;reason text;zone text:=doc->'route'->>'entry_zone';tz text:=doc->'route'->>'time_zone';cursor_at timestamptz:=(doc->>'start')::timestamptz;lo bigint:=(doc->'pricing'->'fees'->>'low_paise')::bigint;hi bigint:=(doc->'pricing'->'fees'->>'high_paise')::bigint;from_at timestamptz;to_at timestamptz;duration numeric;day date;first_day date;last_day date;visits integer;meals integer;travel numeric;sleep numeric;manual boolean;tag text;z1 jsonb;z2 jsonb;
begin
 if doc->>'route_version'<>'1' or tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) or lo is null or hi is null then raise exception 'Route metadata is incomplete.';end if;
 for s in select value from jsonb_array_elements(doc->'steps') loop
  if s->>'ref' in('rest','rest_alternative') then s:=s||jsonb_build_object('kind','rest');end if;
  r:=null;select value into r from jsonb_array_elements(doc->'refs') where value->>'id'=case when s->>'kind'='activity' then s->>'ref' else s->>'route_ref' end;
  meta:=r->'route_item';
  if meta is null and r->>'id'~'^host_[0-9a-f]{32}$' then
   select value->'route_item' into meta from jsonb_array_elements(doc->'refs') where value->>'id'=s->>'route_ref';
   meta:=meta||jsonb_build_object('category','visit','end_zone',meta->>'zone','mode','none','minimum_minutes',20,'best_time','any');
  end if;
  if meta is null then raise exception 'Retain the location reference for each route step.';end if;
  from_at:=(s->>'start')::timestamptz;to_at:=(s->>'end')::timestamptz;duration:=extract(epoch from to_at-from_at)/60;
  if from_at<>cursor_at or to_at<=from_at or to_at>(doc->>'end')::timestamptz or meta->>'zone'<>zone then raise exception 'The route has a gap, overlap or missing transfer. Keep each stop in the current area or add the required transfer.';end if;
  if s->>'kind'<>'rest' then
   if duration<(meta->>'minimum_minutes')::integer or (case meta->>'category' when 'visit' then 'activity' when 'transfer' then 'activity' when 'meal' then 'food' when 'stay' then 'stay' else 'rest' end)<>s->>'kind' then raise exception 'The step type or duration does not match its route arrangement.';end if;
   if meta->>'best_time'='evening' and extract(hour from from_at at time zone tz) not between 17 and 23 or meta->>'best_time'='daytime' and (extract(hour from from_at at time zone tz)<6 or extract(hour from to_at at time zone tz)>21 or (from_at at time zone tz)::date<>(to_at at time zone tz)::date) then raise exception 'This activity is scheduled at the wrong destination-local time.';end if;
   if meta->>'category'='transfer' then
    select value into z1 from jsonb_array_elements(doc->'route'->'zones') where value->>'id'=meta->>'zone';select value into z2 from jsonb_array_elements(doc->'route'->'zones') where value->>'id'=meta->>'end_zone';
    if duration<planzo_private.route_minutes(z1,z2,meta->>'mode') then raise exception 'Allow realistic journey time and transfer buffers.';end if;zone:=meta->>'end_zone';
   end if;
   e:=r->'price';manual:=false;tag:=coalesce(s->>'ref','')||'|'||coalesce(s->>'route_ref','');
   if r->>'id'~'^host_[0-9a-f]{32}$' then manual:=true;
   elsif s->>'kind' in('food','stay') then
    if s->>'ref'<>s->>'kind' then e:=doc->'pricing'->case when s->>'kind'='food' then 'meal' else 'stay' end;end if;
    manual:=not initial and ((not s ? 'estimate' and (s->>'cost_paise')::bigint<>(e->>'high_paise')::bigint) or (s->'estimate'->>'source'='host' and s->>'price_ref'=tag));
   end if;
   if manual then e:=jsonb_build_object('low_paise',(s->>'cost_paise')::bigint,'high_paise',(s->>'cost_paise')::bigint,'source','host','assumptions','Host-entered estimate for this area; verify details before booking.');end if;
   if e is null then raise exception 'A route step has no price estimate.';end if;
   s:=s||jsonb_build_object('cost_paise',(e->>'high_paise')::bigint,'estimate',e,'price_ref',tag,'detail_ref',r->>'id');lo:=lo+(e->>'low_paise')::bigint;hi:=hi+(e->>'high_paise')::bigint;
  else s:=(s-'estimate'-'price_ref')||jsonb_build_object('cost_paise',0);end if;
  s:=s||jsonb_build_object('time_zone',tz,'route_ref',case when r->'route_item' is not null then r->>'id' else s->>'route_ref' end);steps:=steps||jsonb_build_array(s);cursor_at:=to_at;
 end loop;
 if cursor_at<>(doc->>'end')::timestamptz or zone<>doc->'route'->>'exit_zone' then raise exception 'The route must finish in its declared departure area at the shared end time.';end if;
 if initial and exists(select 1 from jsonb_array_elements(steps) x join lateral jsonb_array_elements(doc->'refs') r on r->>'id'=x->>'ref' where x->>'kind'='activity' and r->'route_item'->>'category'='visit' group by x->>'ref' having count(*)>1) then raise exception 'Repeated attractions cannot fill later days.';end if;
 first_day:=((doc->>'start')::timestamptz at time zone tz)::date;last_day:=((doc->>'end')::timestamptz at time zone tz)::date;
  if last_day-first_day>13 then raise exception 'Complete AI itineraries currently support up to fourteen destination days.';end if;
  for day in select generate_series(first_day,last_day,interval '1 day')::date loop
   select count(*) filter(where x->>'kind'='activity' and r->'route_item'->>'category'='visit'),count(*) filter(where x->>'kind'='food'),coalesce(sum(extract(epoch from (x->>'end')::timestamptz-(x->>'start')::timestamptz)/60) filter(where r->'route_item'->>'category'='transfer'),0) into visits,meals,travel from jsonb_array_elements(steps) x join lateral jsonb_array_elements(doc->'refs') r on r->>'id'=x->>'route_ref' where ((x->>'start')::timestamptz at time zone tz)::date=day;
   if initial and (day>first_day or extract(hour from (doc->>'start')::timestamptz at time zone tz)<=9) and (day<last_day or extract(hour from (doc->>'end')::timestamptz at time zone tz)>=18) and (visits<case when travel>=120 then 1 else 2 end or meals<2) then raise exception 'A usable destination day has too few planned activities or local meals.';end if;
   if day<last_day then
    select coalesce(sum(greatest(0,extract(epoch from least((x->>'end')::timestamptz,((day+1)+time '07:00') at time zone tz)-greatest((x->>'start')::timestamptz,(day+time '21:00') at time zone tz)))/60),0) into sleep from jsonb_array_elements(steps) x join lateral jsonb_array_elements(doc->'refs') r on r->>'id'=x->>'route_ref' where x->>'kind'='stay' or (r->'route_item'->>'category'='transfer' and r->'route_item'->>'best_time'='overnight');
    if sleep<360 and (doc->>'start')::timestamptz<=(day+time '23:00') at time zone tz and (doc->>'end')::timestamptz>=((day+1)+time '06:00') at time zone tz then raise exception 'Plan an overnight base and at least six hours for sleep.';end if;
   end if;
  end loop;
 for r in select value from jsonb_array_elements(doc->'refs') loop
  select coalesce(jsonb_agg(x->>'id'),'[]') into ids from jsonb_array_elements(steps) x where (x->>'kind'='activity' and x->>'ref'=r->>'id') or (x->>'kind' in('food','stay') and x->>'route_ref'=r->>'id' and x->>'ref'=x->>'kind');
  reason:=case when r->>'kind'='rule' or coalesce((r->>'needs_confirmation')::boolean,false) then 'unverified' when jsonb_array_length(ids)>0 then 'scheduled' else coalesce((select x->>'reason' from jsonb_array_elements(coalesce(doc->'component_outcomes','[]')) x where x->>'ref'=r->>'id' and x->>'status'='excluded'),missing_reason) end;
  components:=components||jsonb_build_array(jsonb_build_object('ref',r->>'id','status',case when reason='scheduled' then 'included' else 'excluded' end,'reason',reason,'steps',ids));
 end loop;
 for source in select value from jsonb_array_elements(doc->'source_refs') loop
  included:=true;reason:='scheduled';all_ids:='[]';
  for o in select x from jsonb_array_elements(components) x join lateral jsonb_array_elements(doc->'refs') r on r->>'id'=x->>'ref' where r->'sources' ? (source->>'id') loop all_ids:=all_ids||(o->'steps');if o->>'status'<>'included' then included:=false;reason:=o->>'reason';end if;end loop;
  select coalesce(jsonb_agg(x),'[]') into ids from(select distinct value x from jsonb_array_elements(all_ids)) q;
  outcomes:=outcomes||jsonb_build_array(jsonb_build_object('ref',source->>'id','status',case when included then 'included' else 'excluded' end,'reason',reason,'steps',ids));
 end loop;
 return doc||jsonb_build_object('steps',steps,'component_outcomes',components,'outcomes',outcomes,'cost_low_paise',ceil(lo*1.1),'cost_paise',ceil(hi*1.1),'basis','gemini_estimate_v1','pricing_version',1,'requirements_version',1);
end$$;

create function planzo_private.route_document(ctx jsonb,choice jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
#variable_conflict use_column
declare plain jsonb:='[]';refs jsonb;result_refs jsonb:='[]';r jsonb;i jsonb;t jsonb;z jsonb;c jsonb;doc jsonb;steps jsonb:='[]';priority text;kind text;idx integer:=0;zones jsonb:=choice->'route'->'zones';used jsonb:='[]';known text;key text;slot integer;
begin
 if jsonb_typeof(choice) is distinct from 'object' or (select count(*) from jsonb_object_keys(choice))<>7 or exists(select 1 from jsonb_object_keys(choice) k where k not in('version','currency','route','items','timeline','conflicts','essentials')) or choice->>'version'<>'3' or choice->>'currency'<>'INR' or jsonb_typeof(choice->'items') is distinct from 'array' or jsonb_array_length(choice->'items') not between 1 and 120 or jsonb_typeof(choice->'timeline') is distinct from 'array' or jsonb_array_length(choice->'timeline') not between 1 and 240 then raise exception 'Invalid complete itinerary.';end if;
 if jsonb_typeof(choice->'route') is distinct from 'object' or (select count(*) from jsonb_object_keys(choice->'route'))<>6 or exists(select 1 from jsonb_object_keys(choice->'route') k where k not in('time_zone','summary','assumptions','zones','entry_zone','exit_zone')) or jsonb_typeof(zones) is distinct from 'array' or jsonb_array_length(zones) not between 1 and 40 or jsonb_typeof(choice->'route'->'assumptions') is distinct from 'array' or jsonb_array_length(choice->'route'->'assumptions') not between 1 and 10 or jsonb_typeof(choice->'route'->'summary') is distinct from 'string' or jsonb_typeof(choice->'route'->'summary') is distinct from 'string' or length(btrim(choice->'route'->>'summary')) not between 1 and 700 then raise exception 'Complete route assumptions and areas are required.';end if;
 if exists(select 1 from jsonb_array_elements(choice->'route'->'assumptions') x where jsonb_typeof(x) is distinct from 'string' or coalesce(length(btrim(x#>>'{}')),0) not between 1 and 240 or (x#>>'{}')~*'https?://') then raise exception 'Invalid route assumption.';end if;
 for z in select value from jsonb_array_elements(zones) loop
 idx:=idx+1;if jsonb_typeof(z)<>'object' or (select count(*) from jsonb_object_keys(z))<>5 or exists(select 1 from jsonb_object_keys(z) k where k not in('id','city','name','latitude','longitude')) or coalesce(z->>'id','')<>'zone_'||idx or jsonb_typeof(z->'city') is distinct from 'string' or jsonb_typeof(z->'name') is distinct from 'string' or jsonb_typeof(z->'city') is distinct from 'string' or jsonb_typeof(z->'name') is distinct from 'string' or length(btrim(z->>'city')) not between 1 and 80 or length(btrim(z->>'name')) not between 1 and 100 or jsonb_typeof(z->'latitude') is distinct from 'number' or jsonb_typeof(z->'longitude') is distinct from 'number' or abs((z->>'latitude')::numeric)>90 or abs((z->>'longitude')::numeric)>180 then raise exception 'Invalid route area.';end if;end loop;
 if not exists(select 1 from jsonb_array_elements(zones) z where z->>'id'=choice->'route'->>'entry_zone') or not exists(select 1 from jsonb_array_elements(zones) z where z->>'id'=choice->'route'->>'exit_zone') then raise exception 'Declare valid arrival and departure areas.';end if;
 idx:=0;
 for i in select value from jsonb_array_elements(choice->'items') loop
  idx:=idx+1;if jsonb_typeof(i)<>'object' or (select count(*) from jsonb_object_keys(i))<>14 or exists(select 1 from jsonb_object_keys(i) k where k not in('id','sources','title','kind','location','description','needs_confirmation','price','category','zone','end_zone','mode','minimum_minutes','best_time')) or coalesce(i->>'id','')<>'idea_'||idx or coalesce(i->>'category','') not in('visit','transfer','meal','stay','rest','rule') or coalesce(i->>'kind','')<>(case i->>'category' when 'meal' then 'food' when 'stay' then 'stay' when 'rule' then 'rule' else 'activity' end) or jsonb_typeof(i->'minimum_minutes') is distinct from 'number' or jsonb_typeof(i->'minimum_minutes') is distinct from 'number' or coalesce(i->>'minimum_minutes','')!~'^[0-9]+$' or (i->>'minimum_minutes')::integer not between 1 and 1440 or coalesce(i->>'best_time','') not in('any','daytime','evening','overnight') or coalesce(i->>'mode','') not in('none','walk','local_transit','rail','bus','taxi','ferry','flight') then raise exception 'Invalid route item.';end if;
  if not exists(select 1 from jsonb_array_elements(zones) z where z->>'id'=i->>'zone') or not exists(select 1 from jsonb_array_elements(zones) z where z->>'id'=i->>'end_zone') then raise exception 'Unknown stop area.';end if;
  if i->>'category'='transfer' then
   if i->>'mode'='none' or i->>'zone'=i->>'end_zone' or (i->>'minimum_minutes')::integer<planzo_private.route_minutes((select value from jsonb_array_elements(zones) z where z->>'id'=i->>'zone'),(select value from jsonb_array_elements(zones) z where z->>'id'=i->>'end_zone'),i->>'mode') then raise exception 'The proposed transfer needs realistic duration and buffers.';end if;
  elsif i->>'zone'<>i->>'end_zone' or i->>'mode'<>'none' then raise exception 'A location change requires a transfer.';end if;
  if i->>'category' in('rest','rule') and i->'price'->>'high_inr'<>'0' then raise exception 'Rest and unpriced conditions cannot carry a paid activity cost.';end if;
  if jsonb_typeof(i->'sources')<>'array' or jsonb_array_length(i->'sources')>80 or (select count(distinct value) from jsonb_array_elements(i->'sources'))<>jsonb_array_length(i->'sources') or exists(select 1 from jsonb_array_elements_text(i->'sources') s where not exists(select 1 from jsonb_array_elements(ctx->'refs') x where x->>'id'=s)) then raise exception 'Invalid shared source.';end if;
  plain:=plain||jsonb_build_array(jsonb_build_object('id',i->>'id','sources',case when i->'sources'='[]'::jsonb then jsonb_build_array(ctx->'refs'->0->>'id') else i->'sources' end,'title',i->>'title','kind',i->>'kind','location',i->>'location','description',i->>'description','needs_confirmation',i->'needs_confirmation','price',i->'price'));
 end loop;
 if exists(select 1 from jsonb_array_elements(ctx->'refs') x where not exists(select 1 from jsonb_array_elements(choice->'items') i where i->'sources' ? (x->>'id'))) then raise exception 'Every reviewed request needs an outcome.';end if;
 refs:=planzo_private.priced_refs(ctx,jsonb_build_object('version',2,'currency','INR','items',plain,'conflicts',choice->'conflicts','essentials',choice->'essentials'));
 if choice->'essentials'->'local_travel'->>'high_inr'<>'0' then raise exception 'Explicit transfers must not be charged again per day.';end if;
 for r in select value from jsonb_array_elements(refs) loop select value into i from jsonb_array_elements(choice->'items') where value->>'id'=r->>'id';select case when exists(select 1 from jsonb_array_elements(ctx->'refs') s where i->'sources' ? (s->>'id') and s->>'priority'='hard') then 'hard' else 'soft' end into priority;result_refs:=result_refs||jsonb_build_array(r||jsonb_build_object('sources',i->'sources','priority',priority,'route_item',i));end loop;
 idx:=0;
 for t in select value from jsonb_array_elements(choice->'timeline') loop
  idx:=idx+1;r:=null;select value into r from jsonb_array_elements(result_refs) where value->>'id'=t->>'ref';i:=r->'route_item';
  if r is null or jsonb_typeof(t)<>'object' or (select count(*) from jsonb_object_keys(t))<>3 or i->>'category'='rule' or coalesce(t->>'start','')!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:00(Z|[+-]\d\d:\d\d)$' or coalesce(t->>'end','')!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:00(Z|[+-]\d\d:\d\d)$' then raise exception 'Invalid route timetable.';end if;
  kind:=case i->>'category' when 'rest' then 'rest' else r->>'kind' end;
  steps:=steps||jsonb_build_array(jsonb_build_object('id','step_'||idx,'start',t->>'start','end',t->>'end','kind',kind,'ref',case when kind in('food','stay','rest') then kind else r->>'id' end,'route_ref',r->>'id','cost_paise',coalesce((r->>'cost_paise')::bigint,0),'alternatives',case when (ctx->>'traveller_count')::integer=1 then '[]'::jsonb else coalesce((select jsonb_build_array(c->>'b') from jsonb_array_elements(choice->'conflicts') c where c->>'a'=r->>'id'),'[]'::jsonb) end));used:=used||jsonb_build_array(r->>'id');
 end loop;
 for c in select value from jsonb_array_elements(choice->'conflicts') loop
  select value into i from jsonb_array_elements(result_refs) where value->>'id'=c->>'a';select value into r from jsonb_array_elements(result_refs) where value->>'id'=c->>'b';
  if i->'route_item'->>'category'<>'visit' or r->'route_item'->>'category'<>'visit' or i->'route_item'->>'zone'<>r->'route_item'->>'zone' or not used ? (c->>'a') or used ? (c->>'b') then raise exception 'Vote alternatives must fit the same location.';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(result_refs) r where r->>'kind'<>'rule' and not used ? (r->>'id') and not exists(select 1 from jsonb_array_elements(choice->'conflicts') c where c->>'b'=r->>'id')) then raise exception 'Every recommendation needs a scheduled stop or clarification.';end if;
 doc:=jsonb_build_object('start',ctx->>'start','end',ctx->>'end','route_version',1,'route',choice->'route','contextual_version',1,'source_refs',ctx->'refs','refs',result_refs,'steps',steps,'unplaced','[]'::jsonb,'pricing',jsonb_build_object('currency','INR','estimated_at',transaction_timestamp(),'model','gemini-3.5-flash-lite','days',((ctx->>'end')::timestamptz at time zone (choice->'route'->>'time_zone'))::date-((ctx->>'start')::timestamptz at time zone (choice->'route'->>'time_zone'))::date+1,'meal',planzo_private.pricing_range(choice->'essentials'->'meal',true),'stay',planzo_private.pricing_range(choice->'essentials'->'stay',true),'local_travel',planzo_private.pricing_range(choice->'essentials'->'local_travel'),'fees',planzo_private.pricing_range(choice->'essentials'->'fees')));
 doc:=planzo_private.route_reconcile_document(doc,'timing',true);
 -- Privately remove unaffordable visits without deleting transfers or accommodation.
 for r in select value from jsonb_array_elements(result_refs) where value->'route_item'->>'category'='visit' order by case when value->>'priority'='soft' then 0 else 1 end,(value->>'cost_paise')::bigint desc loop
  exit when (doc->>'cost_paise')::bigint<=coalesce((ctx->>'spend_limit_paise')::bigint,10000000000);
  steps:='[]';for t in select value from jsonb_array_elements(doc->'steps') loop if t->>'kind'='activity' and t->>'ref'=r->>'id' then t:=t||jsonb_build_object('kind','rest','ref','rest','cost_paise',0,'alternatives','[]'::jsonb);end if;steps:=steps||jsonb_build_array(t);end loop;
  doc:=planzo_private.route_reconcile_document(doc||jsonb_build_object('steps',steps),'budget');
 end loop;
 if (doc->>'cost_paise')::bigint>coalesce((ctx->>'spend_limit_paise')::bigint,10000000000) then raise exception 'The route, meals and overnight bases exceed an included private ceiling even without optional visits. Reduce the trip scope or revise private input; no itinerary was saved.';end if;
 return doc;
end$$;
revoke all on function planzo_private.route_minutes(jsonb,jsonb,text),planzo_private.route_reconcile_document(jsonb,text,boolean),planzo_private.route_document(jsonb,jsonb) from public,anon,authenticated;
