-- New product preserves the value of historical six-message purchases.
create or replace function public.piskou_chat_sync(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare initial boolean; credits integer; forever boolean;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id for update;
 select coalesce(bool_or(plan_id in ('premium-access','luxury-access')),false),coalesce(sum(case when plan_id='messages-unlimited' then 0 when plan_id='messages-120' then 120 else 6 end),0),coalesce(bool_or(plan_id='messages-unlimited'),false)
 into initial,credits,forever from public.piskou_chat_purchases where chat_id=p_id and active;
 update public.piskou_chat_sessions set allowance=case when initial then credit_base+credits else 0 end,unlimited=initial and forever,lease=case when not initial or (not forever and credit_base+credits<=jsonb_array_length(messages)/2) then null else lease end,lease_until=case when not initial or (not forever and credit_base+credits<=jsonb_array_length(messages)/2) then null else lease_until end where id=p_id;
end $$;
revoke all on function public.piskou_chat_sync(uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_sync(uuid) to service_role;
create or replace function public.piskou_chat_grant(p_id uuid,p_charge text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; s public.piskou_chat_sessions%rowtype; plan text; changed integer;
begin
 select value into v from public.piskou_payment_store where key='charge:'||p_charge and expires_at>now() for update;
 if v is null or v->>'status'<>'paid' or v->>'chatId' is distinct from p_id::text then raise exception 'Payment not confirmed or wrong owner'; end if;
 plan:=v->>'planId';
 if plan not in ('premium-access','luxury-access','messages-six','messages-120','messages-unlimited') then raise exception 'Unknown product'; end if;
 insert into public.piskou_chat_sessions(id,selection) values(p_id,v->'selection') on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>v->'selection' then raise exception 'Wrong character'; end if;
 if plan in ('premium-access','luxury-access') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id) then
  update public.piskou_chat_sessions set credit_base=greatest(credit_base,jsonb_array_length(messages)/2) where id=p_id;
 end if;
 if plan in ('messages-six','messages-120','messages-unlimited') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id and active and plan_id in ('premium-access','luxury-access')) then raise exception 'Initial purchase required'; end if;
 insert into public.piskou_chat_purchases(charge_id,chat_id,plan_id,active) values(p_charge,p_id,plan,true)
 on conflict(charge_id) do update set active=true where not public.piskou_chat_purchases.active;
 get diagnostics changed=row_count;
 if changed>0 then perform public.piskou_chat_sync(p_id); end if;
 update public.piskou_chat_sessions set expires_at=greatest(expires_at,now()+interval '90 days') where id=p_id;
 select * into s from public.piskou_chat_sessions where id=p_id;
 return jsonb_build_object('allowance',s.allowance,'unlimited',s.unlimited);
end $$;
