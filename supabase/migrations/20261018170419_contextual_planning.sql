-- Forward change for contextual requests. No saved rows or historical plans are rewritten.
do $guard$begin
if (select md5(prosrc) from pg_proc where oid='planzo_private.flow_document(jsonb,jsonb)'::regprocedure)<>'407c68a51752db2953da71dff204c679' then raise exception 'Unexpected flow_document baseline';end if;
if (select md5(prosrc) from pg_proc where oid='planzo_private.flow_reconcile_document(jsonb,text)'::regprocedure)<>'1f20a44c882de65a530fdb379840567b' then raise exception 'Unexpected flow_reconcile_document baseline';end if;
if (select md5(prosrc) from pg_proc where oid='planzo_private.flow_requirement_checks(jsonb,jsonb)'::regprocedure)<>'27528908a04de4dfb28b7e4bea24c897' then raise exception 'Unexpected flow_requirement_checks baseline';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='planzo_private' and p.proname in ('flow_literal_document','flow_literal_reconcile_document','contextual_refs','contextual_reconcile_document','contextual_document')) then raise exception 'Contextual helpers already exist';end if;
end$guard$;
CREATE OR REPLACE FUNCTION planzo_private.flow_literal_document(ctx jsonb, choice jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare doc jsonb;steps jsonb:='[]';s jsonb;r jsonb;refs jsonb:=ctx->'refs';reasons jsonb:='{}';total bigint:=5000;limit_paise bigint:=coalesce((ctx->>'spend_limit_paise')::bigint,10000000000);slot integer;cost bigint;ix integer;
begin
 if ctx->>'requirements_version' is distinct from '1' then return planzo_private.flow_legacy_document(ctx,choice);end if;
 doc:=planzo_private.flow_legacy_document(ctx,choice);
 for s in select value from jsonb_array_elements(doc->'steps') loop
 if s->>'kind'='activity' then s:=s||jsonb_build_object('kind','rest','ref','rest','cost_paise',0,'alternatives','[]'::jsonb);end if;
 total:=total+(s->>'cost_paise')::bigint;steps:=steps||jsonb_build_array(s);
 end loop;
 -- Prioritise every hard request, including for a roster of one. Each paid request is scheduled once.
 for r in select rr.value from jsonb_array_elements(refs) rr order by case when rr.value->>'priority'='hard' then 0 else 1 end,(select ord from jsonb_array_elements_text(choice->'sequence') with ordinality q(id,ord) where q.id=rr.value->>'id') loop
 if r->>'kind'<>'activity' then continue;end if;
 cost:=(r->>'cost_paise')::bigint;
 if ceil((total+cost)*1.1)>limit_paise then reasons:=reasons||jsonb_build_object(r->>'id','budget');continue;end if;
 select ord::integer-1 into slot from jsonb_array_elements(steps) with ordinality q(value,ord) where value->>'kind'='rest' and (value->>'end')::timestamptz-(value->>'start')::timestamptz>=interval '1 hour' order by ord limit 1;
 if slot is null then reasons:=reasons||jsonb_build_object(r->>'id','timing');continue;end if;
 s:=steps->slot;s:=s||jsonb_build_object('kind','activity','ref',r->>'id','cost_paise',cost);
 s:=s||jsonb_build_object('alternatives',case when (ctx->>'traveller_count')::integer=1 then '[]'::jsonb else coalesce((select jsonb_build_array(c->>'b') from jsonb_array_elements(choice->'conflicts') c join lateral jsonb_array_elements(refs) b on b->>'id'=c->>'b' where c->>'a'=r->>'id' and b->>'kind'='activity'),'[]'::jsonb) end);
 steps:=jsonb_set(steps,array[slot::text],s);total:=total+cost;
 end loop;
 doc:=doc||jsonb_build_object('steps',steps,'exclusion_reasons',reasons);
 return planzo_private.flow_reconcile_document(doc,'timing');
end$function$;
CREATE OR REPLACE FUNCTION planzo_private.flow_literal_reconcile_document(doc jsonb, missing_reason text DEFAULT 'group_decision'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare steps jsonb:='[]';outcomes jsonb:='[]';r jsonb;s jsonb;ids jsonb;total bigint:=5000;reason text;
begin
 for s in select value from jsonb_array_elements(doc->'steps') loop
 if s->>'kind'='activity' then
 select value into r from jsonb_array_elements(doc->'refs') where value->>'id'=s->>'ref';
 if r is null or s->>'ref'='rest' then s:=s||jsonb_build_object('kind','rest','cost_paise',0);
 else s:=s||jsonb_build_object('cost_paise',(r->>'cost_paise')::bigint);end if;
 end if;
 total:=total+(s->>'cost_paise')::bigint;steps:=steps||jsonb_build_array(s);
 end loop;
 for r in select value from jsonb_array_elements(doc->'refs') loop
 select coalesce(jsonb_agg(st.value->>'id'),'[]') into ids from jsonb_array_elements(steps) st where
 case r->>'kind' when 'activity' then st.value->>'kind'='activity' and st.value->>'ref'=r->>'id' when 'food' then st.value->>'kind'='food' when 'stay' then st.value->>'kind'='stay' else false end;
 reason:=case when jsonb_array_length(ids)>0 then 'scheduled' when r->>'kind'='rule' then 'unverified' else coalesce(doc->'exclusion_reasons'->>(r->>'id'),(select value->>'reason' from jsonb_array_elements(coalesce(doc->'outcomes','[]')) where value->>'ref'=r->>'id' and value->>'status'='excluded'),missing_reason) end;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('ref',r->>'id','status',case when jsonb_array_length(ids)>0 then 'included' else 'excluded' end,'reason',reason,'steps',ids));
 end loop;
 return (doc-'exclusion_reasons')||jsonb_build_object('steps',steps,'outcomes',outcomes,'cost_paise',ceil(total*1.1),'unplaced','[]'::jsonb,'requirements_version',1);
end$function$;
-- Private invoker helpers; reached only through the existing verified planning gate.
create function planzo_private.contextual_refs(ctx jsonb,choice jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb;c jsonb;refs jsonb:='[]';n integer:=0;priority text;
begin
 if jsonb_typeof(choice) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(choice) k)<>array['conflicts','items','version'] or choice->>'version'<>'1' or jsonb_typeof(choice->'items') is distinct from 'array' or jsonb_array_length(choice->'items') not between 1 and 120 or jsonb_typeof(choice->'conflicts') is distinct from 'array' or jsonb_array_length(choice->'conflicts')>12 then raise exception 'Invalid contextual proposal.';end if;
 for r in select value from jsonb_array_elements(choice->'items') loop
 n:=n+1;
 if jsonb_typeof(r) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(r) k)<>array['description','id','kind','location','needs_confirmation','sources','title'] or r->>'id'<>'idea_'||n or r->>'kind' not in ('activity','food','stay','rule') or jsonb_typeof(r->'needs_confirmation') is distinct from 'boolean' or jsonb_typeof(r->'sources') is distinct from 'array' or jsonb_array_length(r->'sources') not between 1 and 80 then raise exception 'Invalid contextual item.';end if;
 if exists(select 1 from jsonb_each(r) x where x.key in ('title','location','description') and (jsonb_typeof(x.value)<>'string' or length(btrim(x.value#>>'{}'))<1 or length(x.value#>>'{}')>case x.key when 'description' then 480 else 120 end or (x.value#>>'{}')~*'https?://')) then raise exception 'Invalid place or activity details.';end if;
 if (select count(distinct value) from jsonb_array_elements(r->'sources'))<>jsonb_array_length(r->'sources') or exists(select 1 from jsonb_array_elements(r->'sources') x where jsonb_typeof(x)<>'string' or not exists(select 1 from jsonb_array_elements(ctx->'refs') s where s->>'id'=x#>>'{}')) then raise exception 'Unknown or repeated request source.';end if;
 if exists(select 1 from jsonb_array_elements(refs) x where x->>'kind'=r->>'kind' and lower(btrim(x->>'title'))=lower(btrim(r->>'title')) and lower(btrim(x->>'location'))=lower(btrim(r->>'location'))) then raise exception 'Combine duplicate contextual items.';end if;
 select case when exists(select 1 from jsonb_array_elements(ctx->'refs') s where r->'sources' ? (s->>'id') and s->>'priority'='hard') then 'hard' else 'soft' end into priority;
 refs:=refs||jsonb_build_array(r||jsonb_build_object('priority',priority,'cost_paise',planzo_private.flow_reference_cost(r->>'title',r->>'kind')));
 end loop;
 if exists(select 1 from jsonb_array_elements(ctx->'refs') s where not exists(select 1 from jsonb_array_elements(refs) rr where rr->'sources' ? (s->>'id'))) then raise exception 'Every shared request needs an interpretation or clarification.';end if;
 for c in select value from jsonb_array_elements(choice->'conflicts') loop
 if jsonb_typeof(c)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(c) k)<>array['a','b'] or c->>'a'=c->>'b' or not exists(select 1 from jsonb_array_elements(refs) rr where rr->>'id'=c->>'a' and rr->>'kind'='activity') or not exists(select 1 from jsonb_array_elements(refs) rr where rr->>'id'=c->>'b' and rr->>'kind'='activity') then raise exception 'Invalid contextual alternative.';end if;
 end loop;
 if (select count(distinct value->>'a') from jsonb_array_elements(choice->'conflicts'))<>jsonb_array_length(choice->'conflicts') then raise exception 'Repeated contextual alternatives.';end if;
 return refs;
end$$;

create function planzo_private.contextual_reconcile_document(doc jsonb,missing_reason text default 'group_decision') returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare steps jsonb:='[]';components jsonb:='[]';outcomes jsonb:='[]';s jsonb;r jsonb;source jsonb;o jsonb;ids jsonb;all_ids jsonb;detail jsonb;total bigint:=5000;meal integer:=0;amount integer;reason text;included boolean;
begin
 for s in select value from jsonb_array_elements(doc->'steps') loop
 if s->>'kind'='activity' then
 select value into r from jsonb_array_elements(doc->'refs') where value->>'id'=s->>'ref' and value->>'kind'='activity';
 if r is null then s:=s||jsonb_build_object('kind','rest','ref','rest','cost_paise',0);else s:=s||jsonb_build_object('cost_paise',(r->>'cost_paise')::bigint);end if;
 elsif s->>'kind' in ('food','stay') then
 detail:=null;
 if s->>'ref'=s->>'kind' then
 select count(*) into amount from jsonb_array_elements(doc->'refs') x where x->>'kind'=s->>'kind';
 if amount>0 then
 select value into detail from jsonb_array_elements(doc->'refs') with ordinality q(value,ord) where value->>'kind'=s->>'kind' order by case when value->>'priority'='hard' then 0 else 1 end,ord offset case when s->>'kind'='stay' then 0 else meal%amount end limit 1;
 if s->>'kind'='food' then meal:=meal+1;end if;
 end if;end if;
 if detail is null then s:=s-'detail_ref';else s:=s||jsonb_build_object('detail_ref',detail->>'id');end if;
 end if;
 total:=total+(s->>'cost_paise')::bigint;steps:=steps||jsonb_build_array(s);
 end loop;
 for r in select value from jsonb_array_elements(doc->'refs') loop
 select coalesce(jsonb_agg(x->>'id'),'[]') into ids from jsonb_array_elements(steps) x where (x->>'kind'='activity' and x->>'ref'=r->>'id') or (x->>'kind' in ('food','stay') and x->>'detail_ref'=r->>'id' and x->>'ref'=x->>'kind');
 reason:=case when r->>'kind'='rule' or (r->>'needs_confirmation')::boolean then 'unverified' when jsonb_array_length(ids)>0 then 'scheduled' else coalesce((select x->>'reason' from jsonb_array_elements(coalesce(doc->'component_outcomes','[]')) x where x->>'ref'=r->>'id' and x->>'status'='excluded'),missing_reason) end;
 components:=components||jsonb_build_array(jsonb_build_object('ref',r->>'id','status',case when reason='scheduled' then 'included' else 'excluded' end,'reason',reason,'steps',ids));
 end loop;
 for source in select value from jsonb_array_elements(doc->'source_refs') loop
 included:=true;reason:='scheduled';all_ids:='[]';
 for o in select x from jsonb_array_elements(components) x join lateral jsonb_array_elements(doc->'refs') rr on rr->>'id'=x->>'ref' where rr->'sources' ? (source->>'id') loop
 all_ids:=all_ids||(o->'steps');if o->>'status'<>'included' then included:=false;if reason='scheduled' or o->>'reason'='budget' then reason:=o->>'reason';end if;end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(doc->'refs') rr where rr->'sources' ? (source->>'id')) then included:=false;reason:='unverified';end if;
 select coalesce(jsonb_agg(x),'[]') into ids from(select distinct value x from jsonb_array_elements(all_ids)) q;
 outcomes:=outcomes||jsonb_build_array(jsonb_build_object('ref',source->>'id','status',case when included then 'included' else 'excluded' end,'reason',reason,'steps',ids));
 end loop;
 return doc||jsonb_build_object('steps',steps,'component_outcomes',components,'outcomes',outcomes,'cost_paise',ceil(total*1.1),'unplaced','[]'::jsonb,'requirements_version',1);
end$$;

create function planzo_private.contextual_document(ctx jsonb,choice jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare refs jsonb;doc jsonb;seq jsonb;
begin
 refs:=planzo_private.contextual_refs(ctx,choice);
 select jsonb_agg(r->>'id' order by ord) into seq from jsonb_array_elements(refs) with ordinality q(r,ord);
 doc:=planzo_private.flow_literal_document(ctx||jsonb_build_object('refs',refs),jsonb_build_object('sequence',seq,'conflicts',choice->'conflicts'));
 doc:=doc||jsonb_build_object('contextual_version',1,'source_refs',ctx->'refs','component_outcomes',doc->'outcomes');
 return planzo_private.contextual_reconcile_document(doc,'timing');
end$$;

create or replace function planzo_private.flow_document(ctx jsonb,choice jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
begin
 if choice->>'version'='1' and choice ? 'items' then return planzo_private.contextual_document(ctx,choice);end if;
 return planzo_private.flow_literal_document(ctx,choice);
end$$;
create or replace function planzo_private.flow_reconcile_document(doc jsonb,missing_reason text default 'group_decision') returns jsonb language plpgsql immutable security invoker set search_path='' as $$
begin
 if doc->>'contextual_version'='1' then return planzo_private.contextual_reconcile_document(doc,missing_reason);end if;
 return planzo_private.flow_literal_reconcile_document(doc,missing_reason);
end$$;
create or replace function planzo_private.flow_requirement_checks(content jsonb,doc jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('title',r->>'title','kind',r->>'kind','priority',r->>'priority','status',coalesce(o->>'status','excluded'),'reason',coalesce(o->>'reason','unverified'),'steps',coalesce(o->'steps','[]'::jsonb),'interpretations',case when doc->>'contextual_version'='1' then coalesce((select jsonb_agg(x) from jsonb_array_elements(doc->'refs') x where x->'sources' ? (rf.value->>'id')),'[]') else '[]'::jsonb end) order by n),'[]')
 from jsonb_array_elements(coalesce(content->'requests','[]')) with ordinality q(r,n)
 left join lateral (select value from jsonb_array_elements(coalesce(doc->'source_refs',doc->'refs','[]')) where value->>'kind'=r->>'kind' and lower(btrim(value->>'title'))=lower(btrim(r->>'title')) limit 1) rf on true
 left join lateral (select value o from jsonb_array_elements(coalesce(doc->'outcomes','[]')) where value->>'ref'=rf.value->>'id') outcome on true
$$;
revoke all on function planzo_private.flow_literal_document(jsonb,jsonb),planzo_private.flow_literal_reconcile_document(jsonb,text),planzo_private.contextual_refs(jsonb,jsonb),planzo_private.contextual_reconcile_document(jsonb,text),planzo_private.contextual_document(jsonb,jsonb) from public,anon,authenticated;
