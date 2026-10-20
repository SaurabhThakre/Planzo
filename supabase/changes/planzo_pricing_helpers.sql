-- Estimates only. Private invoker helpers; no table, row, grant or public API rewrite.
create function planzo_private.pricing_range(p jsonb,paid boolean default false) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p) k)<>array['assumptions','high_inr','low_inr'] or jsonb_typeof(p->'low_inr') is distinct from 'number' or jsonb_typeof(p->'high_inr') is distinct from 'number' or coalesce(p->>'low_inr','')!~'^[0-9]+$' or coalesce(p->>'high_inr','')!~'^[0-9]+$' then raise exception 'Missing or malformed INR estimate.';end if;
 if (p->>'low_inr')::numeric>1000000 or (p->>'high_inr')::numeric>1000000 or (p->>'high_inr')::numeric<(p->>'low_inr')::numeric or (paid and (p->>'high_inr')::numeric=0) or jsonb_typeof(p->'assumptions') is distinct from 'string' or length(btrim(p->>'assumptions')) not between 1 and 240 or (p->>'assumptions')~*'https?://' then raise exception 'Invalid price range or assumptions.';end if;
 return jsonb_build_object('low_paise',(p->>'low_inr')::bigint*100,'high_paise',(p->>'high_inr')::bigint*100,'assumptions',p->>'assumptions','source','gemini');
end$$;

create function planzo_private.priced_refs(ctx jsonb,choice jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb;plain jsonb:='[]';refs jsonb;result jsonb:='[]';e jsonb;pr jsonb;
begin
 if jsonb_typeof(choice) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(choice) k)<>array['conflicts','currency','essentials','items','version'] or choice->>'version'<>'2' or choice->>'currency'<>'INR' or jsonb_typeof(choice->'items') is distinct from 'array' or jsonb_array_length(choice->'items') not between 1 and 120 or jsonb_typeof(choice->'essentials') is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(choice->'essentials') k)<>array['fees','local_travel','meal','stay'] then raise exception 'Invalid priced proposal.';end if;
 for r in select value from jsonb_array_elements(choice->'items') loop
  if not r ? 'price' then raise exception 'Every item needs an estimate or explicit unpriced rule.';end if;
  pr:=planzo_private.pricing_range(r->'price',r->>'kind' in('food','stay'));
  if r->>'kind'='rule' and (r->'needs_confirmation' is distinct from 'true'::jsonb or pr->>'high_paise'<>'0') then raise exception 'Unpriced rules must remain unverified.';end if;
  plain:=plain||jsonb_build_array(r-'price');
 end loop;
 refs:=planzo_private.contextual_refs(ctx,jsonb_build_object('version',1,'items',plain,'conflicts',choice->'conflicts'));
 for r in select value from jsonb_array_elements(refs) loop
  select value->'price' into e from jsonb_array_elements(choice->'items') where value->>'id'=r->>'id';pr:=planzo_private.pricing_range(e,r->>'kind' in('food','stay'));
  result:=result||jsonb_build_array(r||jsonb_build_object('price',case when r->>'kind'='rule' then null else pr end,'cost_paise',case when r->>'kind'='rule' then 0 else (pr->>'high_paise')::bigint end));
 end loop;
 perform planzo_private.pricing_range(choice->'essentials'->'meal',true);perform planzo_private.pricing_range(choice->'essentials'->'stay',true);perform planzo_private.pricing_range(choice->'essentials'->'local_travel');perform planzo_private.pricing_range(choice->'essentials'->'fees');
 return result;
end$$;

create function planzo_private.priced_reconcile_document(doc jsonb,missing_reason text default 'group_decision',initial boolean default false) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare s jsonb;r jsonb;e jsonb;steps jsonb:='[]';lo bigint;hi bigint;tag text;manual boolean;
begin
 -- Keep contextual coverage/exclusion behaviour, but never use its fixed fee/total.
 doc:=planzo_private.contextual_reconcile_document(doc,missing_reason);
 lo:=(doc->'pricing'->'fees'->>'low_paise')::bigint+(doc->'pricing'->>'days')::integer*(doc->'pricing'->'local_travel'->>'low_paise')::bigint;
 hi:=(doc->'pricing'->'fees'->>'high_paise')::bigint+(doc->'pricing'->>'days')::integer*(doc->'pricing'->'local_travel'->>'high_paise')::bigint;
 if lo is null or hi is null then raise exception 'Pricing metadata is incomplete.';end if;
 for s in select value from jsonb_array_elements(doc->'steps') loop
  e:=null;r:=null;manual:=false;tag:=coalesce(s->>'ref','')||'|'||coalesce(s->>'detail_ref','');
  if s->>'kind'='activity' then
   select value into r from jsonb_array_elements(doc->'refs') where value->>'id'=s->>'ref';e:=r->'price';
   if e is null or e='null'::jsonb then
    if coalesce(r->>'id','')!~'^host_[0-9a-f]{32}$' then raise exception 'Activity price unavailable.';end if;manual:=true;
   end if;
  elsif s->>'kind' in('food','stay') then
   if s->>'ref'=s->>'kind' then select value into r from jsonb_array_elements(doc->'refs') where value->>'id'=s->>'detail_ref';e:=r->'price';end if;
   if e is null or e='null'::jsonb then e:=doc->'pricing'->(case when s->>'kind'='food' then 'meal' else 'stay' end);end if;
   manual:=not initial and ((not s ? 'estimate' and (s->>'cost_paise')::bigint<>(e->>'high_paise')::bigint) or (s->'estimate'->>'source'='host' and s->>'price_ref'=tag));
  end if;
  if s->>'kind'='rest' then s:=(s-'estimate'-'price_ref')||jsonb_build_object('cost_paise',0);
  else
   if manual then e:=jsonb_build_object('low_paise',(s->>'cost_paise')::bigint,'high_paise',(s->>'cost_paise')::bigint,'source','host','assumptions','Host-entered planning estimate; verify the actual price before booking.');end if;
   if e is null or jsonb_typeof(e)<>'object' then raise exception 'No complete price for this step.';end if;
   s:=s||jsonb_build_object('estimate',e,'price_ref',tag,'cost_paise',(e->>'high_paise')::bigint);
   lo:=lo+(e->>'low_paise')::bigint;hi:=hi+(e->>'high_paise')::bigint;
  end if;
  steps:=steps||jsonb_build_array(s);
 end loop;
 return doc||jsonb_build_object('steps',steps,'cost_low_paise',ceil(lo*1.1),'cost_paise',ceil(hi*1.1),'basis','gemini_estimate_v1','pricing_version',1);
end$$;

create function planzo_private.priced_document(ctx jsonb,choice jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare refs jsonb;doc jsonb;seq jsonb;steps jsonb:='[]';s jsonb;r jsonb;pricing jsonb;components jsonb:='[]';limit_paise bigint:=coalesce((ctx->>'spend_limit_paise')::bigint,10000000000);subtotal bigint;slot integer;cost bigint;reason text;days integer;
begin
 refs:=planzo_private.priced_refs(ctx,choice);
 select jsonb_agg(q.r->>'id' order by q.ord) into seq from jsonb_array_elements(refs) with ordinality q(r,ord);
 doc:=planzo_private.flow_legacy_document(ctx||jsonb_build_object('refs',refs),jsonb_build_object('sequence',seq,'conflicts',choice->'conflicts'));
 days:=((ctx->>'end')::timestamptz at time zone 'Asia/Kolkata')::date-((ctx->>'start')::timestamptz at time zone 'Asia/Kolkata')::date+1;
 pricing:=jsonb_build_object('currency','INR','estimated_at',transaction_timestamp(),'model','gemini-3.5-flash-lite','days',days,'meal',planzo_private.pricing_range(choice->'essentials'->'meal',true),'stay',planzo_private.pricing_range(choice->'essentials'->'stay',true),'local_travel',planzo_private.pricing_range(choice->'essentials'->'local_travel'),'fees',planzo_private.pricing_range(choice->'essentials'->'fees'));
 for s in select value from jsonb_array_elements(doc->'steps') loop
  if s->>'kind'='activity' or (s->>'kind'='stay' and extract(hour from (s->>'start')::timestamptz at time zone 'Asia/Kolkata')>=21 and ((s->>'start')::timestamptz at time zone 'Asia/Kolkata')::date=((s->>'end')::timestamptz at time zone 'Asia/Kolkata')::date) then s:=s||jsonb_build_object('kind','rest','ref','rest','cost_paise',0,'alternatives','[]'::jsonb);end if;
  steps:=steps||jsonb_build_array(s);
 end loop;
 doc:=doc||jsonb_build_object('steps',steps,'contextual_version',1,'source_refs',ctx->'refs','component_outcomes','[]'::jsonb,'pricing_version',1,'pricing',pricing);
 doc:=planzo_private.priced_reconcile_document(doc,'timing',true);steps:=doc->'steps';
 subtotal:=(pricing->'fees'->>'high_paise')::bigint+days*(pricing->'local_travel'->>'high_paise')::bigint+(select coalesce(sum((x->>'cost_paise')::bigint),0) from jsonb_array_elements(steps) x);
 for r in select rr from jsonb_array_elements(refs) with ordinality q(rr,ord) where rr->>'kind'='activity' order by case when rr->>'priority'='hard' then 0 else 1 end,ord loop
  cost:=(r->>'cost_paise')::bigint;reason:=null;slot:=null;
  if ceil((subtotal+cost)*1.1)>limit_paise then reason:='budget';else
   select ord::integer-1 into slot from jsonb_array_elements(steps) with ordinality q(value,ord) where value->>'kind'='rest' and (value->>'end')::timestamptz-(value->>'start')::timestamptz>=interval '1 hour' and extract(hour from (value->>'start')::timestamptz at time zone 'Asia/Kolkata') between 6 and 17 order by ord limit 1;
   if slot is null then reason:='timing';end if;
  end if;
  if reason is null then
   s:=(steps->slot)||jsonb_build_object('kind','activity','ref',r->>'id','cost_paise',cost,'alternatives',case when (ctx->>'traveller_count')::integer=1 then '[]'::jsonb else coalesce((select jsonb_build_array(c->>'b') from jsonb_array_elements(choice->'conflicts') c where c->>'a'=r->>'id'),'[]'::jsonb) end);
   steps:=jsonb_set(steps,array[slot::text],s);subtotal:=subtotal+cost;
  else components:=components||jsonb_build_array(jsonb_build_object('ref',r->>'id','status','excluded','reason',reason,'steps','[]'::jsonb));end if;
 end loop;
 return planzo_private.priced_reconcile_document(doc||jsonb_build_object('steps',steps,'component_outcomes',components),'timing',true);
end$$;

revoke all on function planzo_private.pricing_range(jsonb,boolean),planzo_private.priced_refs(jsonb,jsonb),planzo_private.priced_reconcile_document(jsonb,text,boolean),planzo_private.priced_document(jsonb,jsonb) from public,anon,authenticated;
