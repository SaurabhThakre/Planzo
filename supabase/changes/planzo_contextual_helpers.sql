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
