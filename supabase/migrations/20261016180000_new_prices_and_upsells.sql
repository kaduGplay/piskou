-- Baby R$ 14,90 and Pro R$ 27,90 (previous R$ 10,00 / R$ 19,90 stay valid for PIX generated before the change).
-- One-click upsells after the initial purchase: video pack, WhatsApp call, lifetime VIP.

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
      extra := 8.90*cardinality(new.addons);
      if not ((v->>'amount')::numeric - extra = any(case when new.plan_id='premium-access' then array[14.90,10.00] else array[27.90,19.90] end::numeric[])) then
        raise exception 'Wrong addon total';
      end if;
      new.character_slots := case when new.plan_id='luxury-access' then 40 when 'second-partner'=any(new.addons) then 2 else 1 end;
    elsif cardinality(new.addons)>0 then raise exception 'Addon requires initial plan'; end if;
  end if;
  return new;
end $$;
revoke all on function public.piskou_purchase_addons() from public,anon,authenticated;
grant execute on function public.piskou_purchase_addons() to service_role;

-- Upsells add no message credits; lifetime VIP removes the message limit.
create or replace function public.piskou_chat_sync(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare initial boolean; credits integer; forever boolean;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id for update;
 select coalesce(bool_or(plan_id in ('premium-access','luxury-access')),false),
  coalesce(sum(case when plan_id in ('messages-unlimited','upsell-video-pack','upsell-whatsapp','upsell-vip') then 0 when plan_id='messages-120' then 120 else 6 end),0),
  coalesce(bool_or(plan_id in ('messages-unlimited','upsell-vip')),false)
 into initial,credits,forever from public.piskou_chat_purchases where chat_id=p_id and active;
 update public.piskou_chat_sessions set allowance=case when initial then credit_base+credits else trial_allowance end,unlimited=initial and forever,lease=case when (case when initial then credit_base+credits else trial_allowance end)<=public.piskou_user_message_count(messages) and not (initial and forever) then null else lease end,lease_until=case when (case when initial then credit_base+credits else trial_allowance end)<=public.piskou_user_message_count(messages) and not (initial and forever) then null else lease_until end where id=p_id;
end $$;
revoke all on function public.piskou_chat_sync(uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_sync(uuid) to service_role;

create or replace function public.piskou_chat_grant(p_id uuid,p_charge text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; s public.piskou_chat_sessions%rowtype; plan text; changed integer;
begin
 select value into v from public.piskou_payment_store where key='charge:'||p_charge and expires_at>now() for update;
 if v is null or v->>'status'<>'paid' or v->>'chatId' is distinct from p_id::text then raise exception 'Payment not confirmed or wrong owner'; end if;
 plan:=v->>'planId';
 if plan not in ('premium-access','luxury-access','messages-six','messages-120','messages-unlimited','upsell-video-pack','upsell-whatsapp','upsell-vip') then raise exception 'Unknown product'; end if;
 insert into public.piskou_chat_sessions(id,selection) values(p_id,v->'selection') on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>v->'selection' then raise exception 'Wrong character'; end if;
 if plan in ('premium-access','luxury-access') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id) then
  update public.piskou_chat_sessions set credit_base=greatest(credit_base,trial_allowance,public.piskou_user_message_count(messages)) where id=p_id;
 end if;
 if plan not in ('premium-access','luxury-access') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id and active and plan_id in ('premium-access','luxury-access')) then raise exception 'Initial purchase required'; end if;
 insert into public.piskou_chat_purchases(charge_id,chat_id,plan_id,active) values(p_charge,p_id,plan,true)
 on conflict(charge_id) do update set active=true where not public.piskou_chat_purchases.active;
 get diagnostics changed=row_count;
 if changed>0 then perform public.piskou_chat_sync(p_id); end if;
 update public.piskou_chat_sessions set expires_at=greatest(expires_at,now()+interval '90 days') where id=p_id;
 select * into s from public.piskou_chat_sessions where id=p_id;
 return jsonb_build_object('allowance',s.allowance,'unlimited',s.unlimited);
end $$;
revoke all on function public.piskou_chat_grant(uuid,text) from public,anon,authenticated;
grant execute on function public.piskou_chat_grant(uuid,text) to service_role;

-- Lifetime VIP: the conversation never expires while the purchase is active.
create function public.piskou_vip_lifetime() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.piskou_chat_purchases where chat_id=new.id and active and plan_id='upsell-vip') then
    new.expires_at := timestamptz '2999-12-31 00:00:00+00';
  end if;
  return new;
end $$;
revoke all on function public.piskou_vip_lifetime() from public,anon,authenticated;
grant execute on function public.piskou_vip_lifetime() to service_role;
create trigger piskou_vip_lifetime before update of expires_at on public.piskou_chat_sessions
for each row execute function public.piskou_vip_lifetime();

-- WhatsApp number for the "ela te chama no WhatsApp" upsell, accepted only after that purchase.
create table public.piskou_upsell_contacts (
  chat_id uuid primary key references public.piskou_chat_sessions(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  updated_at timestamptz not null default now()
);
alter table public.piskou_upsell_contacts enable row level security;
revoke all on public.piskou_upsell_contacts from public,anon,authenticated;
grant select,insert,update on public.piskou_upsell_contacts to service_role;

create function public.piskou_upsell_contact(p_id uuid,p_phone text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if p_phone !~ '^[0-9]{10,13}$' then return false; end if;
  if not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id and active and plan_id='upsell-whatsapp') then return false; end if;
  insert into public.piskou_upsell_contacts(chat_id,phone) values(p_id,p_phone)
  on conflict(chat_id) do update set phone=excluded.phone,updated_at=now();
  return true;
end $$;
revoke all on function public.piskou_upsell_contact(uuid,text) from public,anon,authenticated;
grant execute on function public.piskou_upsell_contact(uuid,text) to service_role;
