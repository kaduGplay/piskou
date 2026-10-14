-- Historical purchases retain their existing multi-character access.
alter table public.piskou_chat_purchases
  add column addons text[] not null default '{}',
  add column character_slots integer not null default 40 check (character_slots between 1 and 40);

create function public.piskou_purchase_addons() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v jsonb; expected numeric;
begin
  select value into v from public.piskou_payment_store where key='charge:'||new.charge_id;
  if v is not null and v ? 'addons' and v->>'status'='paid' and v->>'chatId'=new.chat_id::text then
    if jsonb_typeof(v->'addons') <> 'array' then raise exception 'Invalid addons'; end if;
    select coalesce(array_agg(id order by id),'{}') into new.addons from jsonb_array_elements_text(v->'addons') id;
    if cardinality(new.addons)>1 or not (new.addons <@ array['second-partner']::text[]) then raise exception 'Unknown or duplicate addon'; end if;
    if new.plan_id in ('premium-access','luxury-access') then
      if new.plan_id='luxury-access' and cardinality(new.addons)>0 then raise exception 'Addon already included'; end if;
      expected := case when new.plan_id='premium-access' then 10.00 else 19.90 end + 8.90*cardinality(new.addons);
      if (v->>'amount')::numeric is distinct from expected then raise exception 'Wrong addon total'; end if;
      new.character_slots := case when new.plan_id='luxury-access' then 40 else 1+cardinality(new.addons) end;
    elsif cardinality(new.addons)>0 then raise exception 'Addon requires initial plan'; end if;
  end if;
  return new;
end $$;
revoke all on function public.piskou_purchase_addons() from public,anon,authenticated;
grant execute on function public.piskou_purchase_addons() to service_role;
create trigger piskou_purchase_addons before insert or update of active on public.piskou_chat_purchases
for each row execute function public.piskou_purchase_addons();
