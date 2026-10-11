alter table public.piskou_chat_purchases add column active boolean not null default true;
grant update on public.piskou_chat_purchases to service_role;
alter table public.piskou_chat_sessions add column credit_base integer not null default 0;
update public.piskou_chat_sessions s set credit_base=greatest(0,allowance-coalesce((select sum(case when plan_id='messages-unlimited' then 0 else 6 end) from public.piskou_chat_purchases where chat_id=s.id),0));
create function public.piskou_chat_sync(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare initial boolean; credits integer; forever boolean;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id for update;
 select coalesce(bool_or(plan_id in ('premium-access','luxury-access')),false),coalesce(sum(case when plan_id='messages-unlimited' then 0 else 6 end),0),coalesce(bool_or(plan_id='messages-unlimited'),false)
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
 if plan not in ('premium-access','luxury-access','messages-six','messages-unlimited') then raise exception 'Unknown product'; end if;
 insert into public.piskou_chat_sessions(id,selection) values(p_id,v->'selection') on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>v->'selection' then raise exception 'Wrong character'; end if;
 if plan in ('premium-access','luxury-access') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id) then
  update public.piskou_chat_sessions set credit_base=greatest(credit_base,jsonb_array_length(messages)/2) where id=p_id;
 end if;
 if plan in ('messages-six','messages-unlimited') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id and active and plan_id in ('premium-access','luxury-access')) then raise exception 'Initial purchase required'; end if;
 insert into public.piskou_chat_purchases(charge_id,chat_id,plan_id,active) values(p_charge,p_id,plan,true)
 on conflict(charge_id) do update set active=true where not public.piskou_chat_purchases.active;
 get diagnostics changed=row_count;
 if changed>0 then perform public.piskou_chat_sync(p_id); end if;
 update public.piskou_chat_sessions set expires_at=greatest(expires_at,now()+interval '90 days') where id=p_id;
 select * into s from public.piskou_chat_sessions where id=p_id;
 return jsonb_build_object('allowance',s.allowance,'unlimited',s.unlimited);
end $$;
create or replace function public.piskou_store_set(p_key text,p_value jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare override_status text; v jsonb; sid uuid;
begin
 perform 1 from public.piskou_payment_store where key=p_key for update;
 select status into override_status from public.piskou_transaction_notes where charge_id=substring(p_key from 8) and p_key like 'charge:%';
 v:=p_value;
 if p_key like 'charge:%' then
  v:=v||jsonb_build_object('gatewayStatus',coalesce(p_value->>'gatewayStatus',p_value->>'status'),'status',coalesce(override_status,p_value->>'status'),'statusSource',case when override_status is null then 'gateway' else 'admin' end);
 end if;
 insert into public.piskou_payment_store(key,value,expires_at) values(p_key,v,now()+interval '90 days') on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at;
 if v->>'status'<>'paid' and v->>'chatId' is not null then
  sid:=(v->>'chatId')::uuid;
  perform 1 from public.piskou_chat_sessions where id=sid for update;
  update public.piskou_chat_purchases set active=false where charge_id=substring(p_key from 8) and active;
  if found then perform public.piskou_chat_sync(sid); end if;
 end if;
end $$;
create or replace function public.piskou_admin_transaction_update(p_id text,p_status text,p_note text,p_revision integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.piskou_transaction_notes%rowtype; v jsonb; effective text; sid uuid; access boolean:=false;
begin
 if p_status is not null and p_status not in ('pending','paid','failed','expired') then return jsonb_build_object('error','invalid'); end if;
 if p_note is null or length(p_note)>500 then return jsonb_build_object('error','invalid'); end if;
 select value into v from public.piskou_payment_store where key='charge:'||p_id and expires_at>now() for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 select * into previous from public.piskou_transaction_notes where charge_id=p_id for update;
 if coalesce(previous.revision,0)<>p_revision then return jsonb_build_object('error','conflict'); end if;
 insert into public.piskou_transaction_notes(charge_id,status,note) values(p_id,p_status,p_note)
 on conflict(charge_id) do update set status=excluded.status,note=excluded.note,revision=public.piskou_transaction_notes.revision+1,updated_at=now();
 effective:=coalesce(p_status,v->>'gatewayStatus',v->>'status');
 v:=v||jsonb_build_object('gatewayStatus',coalesce(v->>'gatewayStatus',v->>'status'),'status',effective,'statusSource',case when p_status is null then 'gateway' else 'admin' end,'updatedAt',now());
 update public.piskou_payment_store set value=v where key='charge:'||p_id;
 if v->>'chatId' is not null and v->'selection' is not null then
  sid:=(v->>'chatId')::uuid;
  if effective='paid' then perform public.piskou_chat_grant(sid,p_id);access:=true;
  else
   perform 1 from public.piskou_chat_sessions where id=sid for update;
   update public.piskou_chat_purchases set active=false where charge_id=p_id and active;
   if found then perform public.piskou_chat_sync(sid); end if;
  end if;
 end if;
 insert into public.piskou_transaction_audit(charge_id,previous_status,status,note) values(p_id,previous.status,p_status,p_note);
 return jsonb_build_object('ok',true,'accessGranted',access,'legacy',v->>'chatId' is null);
end $$;
-- Apply previously saved manual markings to the live status as part of the upgrade.
do $$ declare r record; begin
 for r in select n.* from public.piskou_transaction_notes n join public.piskou_payment_store s on s.key='charge:'||n.charge_id where n.status is not null and s.expires_at>now() loop
  perform public.piskou_admin_transaction_update(r.charge_id,r.status,r.note,r.revision);
 end loop;
end $$;

create or replace function public.piskou_admin_transactions(p_days integer,p_status text,p_offset integer) returns jsonb language sql security invoker set search_path='' as $$
with charges as (
 select substring(s.key from 8) as id,s.value->>'orderId' as order_id,s.value->>'planId' as plan_id,
  (s.value->>'amount')::numeric as amount,s.value->>'method' as method,coalesce(s.value->>'gatewayStatus',s.value->>'status') as gateway_status,
  (s.value->>'createdAt')::timestamptz as created_at,s.value->'selection'->>'name' as character_name,
  s.value->'customer'->>'name' as customer_name,s.value->'customer'->>'email' as customer_email,
  n.status as manual_status,coalesce(n.status,s.value->>'status') as status,coalesce(n.note,'') as note,coalesce(n.revision,0) as revision,n.updated_at
 from public.piskou_payment_store s left join public.piskou_transaction_notes n on n.charge_id=substring(s.key from 8)
 where s.key like 'charge:%' and s.expires_at>now() and (s.value->>'createdAt')::timestamptz>=(date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')-(greatest(1,least(p_days,90))-1)*interval '1 day'
), filtered as (select * from charges where p_status='all' or status=p_status), page as (
 select * from filtered order by created_at desc,id limit 50 offset greatest(0,least(p_offset,10000))
)
select jsonb_build_object(
 'total',(select count(*) from filtered),'updatedAt',now(),
 'summary',jsonb_build_object('generated',(select count(*) from charges),'gatewayPaid',(select count(*) from charges where gateway_status='paid'),
 'gatewayPaidAmount',coalesce((select sum(amount) from charges where gateway_status='paid'),0),
 'manualPaid',(select count(*) from charges where manual_status='paid' and gateway_status is distinct from 'paid')),
 'transactions',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('audit',coalesce((select jsonb_agg(a) from (select previous_status,status,note,created_at from public.piskou_transaction_audit where charge_id=p.id order by created_at desc,id desc limit 10) a),'[]'::jsonb)) order by p.created_at desc,p.id) from page p),'[]'::jsonb));
$$;

create function public.piskou_chat_access(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
select coalesce((select jsonb_build_object('remaining',case when unlimited then null else greatest(0,allowance-jsonb_array_length(messages)/2) end,'unlimited',unlimited,'requiresPayment',allowance=0 and not unlimited) from public.piskou_chat_sessions where id=p_id and expires_at>now()),jsonb_build_object('remaining',0,'unlimited',false,'requiresPayment',true));
$$;
revoke all on function public.piskou_chat_access(uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_access(uuid) to service_role;
