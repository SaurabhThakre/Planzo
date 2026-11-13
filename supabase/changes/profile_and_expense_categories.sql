-- Add optional shared expense categories and propagate a user's explicit display-name edits.
alter table planzo_private.flow_payment_expenses
  add column category text,
  add constraint flow_payment_expenses_category_check
    check (category in ('travel','food','stay','activities','shopping','other'));

do $migration$
declare
  payment_definition text := pg_get_functiondef('planzo_private.payments_api(text,jsonb)'::regprocedure);
  profile_definition text := pg_get_functiondef('planzo_private.api(text,jsonb)'::regprocedure);
begin
  if md5(payment_definition) <> 'a2541e995b8987526dbec24b0048be69'
     or md5(profile_definition) <> 'd65d7b719fe38c279a824f327f50d97f' then
    raise exception 'Planzo payment or profile function differs from the reviewed baseline.';
  end if;

  payment_definition := replace(payment_definition,
    $old$array['title','amount_paise','payer_id','kind','split_mode','shares','paid_on','notes']$old$,
    $new$array['title','amount_paise','payer_id','kind','split_mode','shares','paid_on','notes','category']$new$);
  payment_definition := replace(payment_definition,
    $old$split_mode,shares,paid_on,notes,actor)
   values(eid::uuid,trip,title,amount,payer,kind,mode,shares,day,note,actor_id)$old$,
    $new$split_mode,shares,paid_on,notes,actor,category)
   values(eid::uuid,trip,title,amount,payer,kind,mode,shares,day,note,actor_id,
     case when p_payload ? 'category' then p_payload->>'category' else expense.category end)$new$);
  payment_definition := replace(payment_definition,
    $old$notes=excluded.notes,actor=actor_id,revision=$old$,
    $new$notes=excluded.notes,category=excluded.category,actor=actor_id,revision=$new$);
  if position($check$'notes','category']$check$ in payment_definition)=0
     or position('notes,actor,category)' in payment_definition)=0
     or position('category=excluded.category' in payment_definition)=0 then
    raise exception 'The expense category change did not match the expected write paths.';
  end if;
  execute payment_definition;

  profile_definition := replace(profile_definition,
    $old$    update public.planzo_profiles set display_name=actor_name where user_id=actor;
    return jsonb_build_object('id',actor,'name',actor_name);$old$,
    $new$    update public.planzo_profiles set display_name=actor_name where user_id=actor;
    update public.planzo_trip_members set display_name=actor_name
      where user_id=actor and display_name is distinct from actor_name;
    return jsonb_build_object('id',actor,'name',actor_name);$new$);
  if position('where user_id=actor and display_name is distinct from actor_name' in profile_definition)=0 then
    raise exception 'The profile change did not match the expected update path.';
  end if;
  execute profile_definition;
end;
$migration$;
