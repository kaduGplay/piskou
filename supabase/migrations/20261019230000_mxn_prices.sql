-- Mexico: prices in MXN, paid by SPEI or OXXO. Baby MX$ 99, Pro MX$ 179, each order bump MX$ 29.
-- The BRL prices (PIX) are no longer accepted.

create or replace function public.piskou_purchase_addons() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v jsonb; extra numeric;
begin
  select value into v from public.piskou_payment_store where key='charge:'||new.charge_id;
  if v is not null and v ? 'addons' and v->>'status'='paid' and v->>'chatId'=new.chat_id::text then
    if jsonb_typeof(v->'addons') <> 'array' then raise exception 'Invalid addons'; end if;
    select coalesce(array_agg(id order by id),'{}') into new.addons from jsonb_array_elements_text(v->'addons') id;
    if cardinality(new.addons) <> (select count(distinct id) from unnest(new.addons) id)
      or not (new.addons <@ array['second-partner','voice-call']::text[]) then raise exception 'Unknown or duplicate addon'; end if;
    if new.plan_id in ('premium-access','luxury-access') then
      if new.plan_id='luxury-access' and 'second-partner'=any(new.addons) then raise exception 'Addon already included'; end if;
      extra := 29*cardinality(new.addons);
      if (v->>'amount')::numeric - extra <> (case when new.plan_id='premium-access' then 99 else 179 end) then
        raise exception 'Wrong addon total';
      end if;
      new.character_slots := case when new.plan_id='luxury-access' then 40 when 'second-partner'=any(new.addons) then 2 else 1 end;
    elsif cardinality(new.addons)>0 then raise exception 'Addon requires initial plan'; end if;
  end if;
  return new;
end $$;
revoke all on function public.piskou_purchase_addons() from public,anon,authenticated;
grant execute on function public.piskou_purchase_addons() to service_role;
