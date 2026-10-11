-- Existing paid balances remain intact; new conversations receive one free trial.
alter table public.piskou_chat_sessions add column trial_allowance integer not null default 0 check(trial_allowance in (0,6));
update public.piskou_chat_sessions s set trial_allowance=6,allowance=6,credit_base=greatest(credit_base,6) where not exists(select 1 from public.piskou_chat_purchases p where p.chat_id=s.id);
-- New product preserves the value of historical six-message purchases.
create or replace function public.piskou_chat_sync(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare initial boolean; credits integer; forever boolean;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id for update;
 select coalesce(bool_or(plan_id in ('premium-access','luxury-access')),false),coalesce(sum(case when plan_id='messages-unlimited' then 0 when plan_id='messages-120' then 120 else 6 end),0),coalesce(bool_or(plan_id='messages-unlimited'),false)
 into initial,credits,forever from public.piskou_chat_purchases where chat_id=p_id and active;
 update public.piskou_chat_sessions set allowance=case when initial then credit_base+credits else trial_allowance end,unlimited=initial and forever,lease=case when (case when initial then credit_base+credits else trial_allowance end)<=jsonb_array_length(messages)/2 and not (initial and forever) then null else lease end,lease_until=case when (case when initial then credit_base+credits else trial_allowance end)<=jsonb_array_length(messages)/2 and not (initial and forever) then null else lease_until end where id=p_id;
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
  update public.piskou_chat_sessions set credit_base=greatest(credit_base,trial_allowance,jsonb_array_length(messages)/2) where id=p_id;
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

create or replace function public.piskou_chat_claim(p_id uuid,p_selection jsonb,p_budget text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; n integer; k text; lim integer;
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,6,6,6) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection then return jsonb_build_object('error','selection_changed'); end if;
 if s.allowance=0 and not s.unlimited then return jsonb_build_object('error','payment_required','messages',s.messages);end if;
 if not s.unlimited and jsonb_array_length(s.messages)/2>=s.allowance then return jsonb_build_object('error','limit','messages',s.messages); end if;
 if s.lease_until>now() then return jsonb_build_object('error','busy'); end if;
 if s.trial_allowance=6 and not s.budget_reserved then
  foreach k in array array['global:'||current_date::text,p_budget||':'||current_date::text] loop
   lim:=case when k like 'global:%' then 1000 else 120 end;
   insert into public.piskou_chat_budgets(key,expires_at) values(k,now()+interval '2 days') on conflict do nothing;
   select requests into n from public.piskou_chat_budgets where key=k for update;
   if n+6>lim then return jsonb_build_object('error','rate');end if;
  end loop;
  update public.piskou_chat_budgets set requests=requests+6 where key in ('global:'||current_date::text,p_budget||':'||current_date::text);
  update public.piskou_chat_sessions set budget_reserved=true where id=p_id;
 end if;
 update public.piskou_chat_sessions set expires_at=now()+interval '90 days',lease=p_lease,lease_until=now()+interval '90 seconds' where id=p_id;
 return jsonb_build_object('messages',s.messages,'turn',jsonb_array_length(s.messages)/2,'allowance',s.allowance,'unlimited',s.unlimited);
end $$;
create or replace function public.piskou_chat_access(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
select coalesce((select jsonb_build_object('remaining',case when unlimited then null else greatest(0,allowance-jsonb_array_length(messages)/2) end,'unlimited',unlimited,'requiresPayment',allowance=0 and not unlimited,'hasPaidAccess',unlimited or allowance>trial_allowance) from public.piskou_chat_sessions where id=p_id),jsonb_build_object('remaining',6,'unlimited',false,'requiresPayment',false,'hasPaidAccess',false));
$$;
revoke all on function public.piskou_chat_claim(uuid,jsonb,text,uuid),public.piskou_chat_access(uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_claim(uuid,jsonb,text,uuid),public.piskou_chat_access(uuid) to service_role;
create or replace function public.piskou_analytics_report(p_days integer) returns jsonb language sql security invoker set search_path='' as $$
with purge as (delete from public.piskou_analytics_sessions where started_at<now()-interval '90 days'), cleanup as (delete from public.piskou_admin_limits where expires_at<now()), cohort as (
 select * from public.piskou_analytics_sessions where started_at >= (date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - (greatest(1,least(p_days,90))-1)*interval '1 day'
), e as (select ev.* from public.piskou_analytics_events ev join cohort c on c.id=ev.session_id),
stages(rank,key,label) as (values
 (0,'page_view:/','Visitou o site'),(1,'Etapa do criador:style','Estilo'),(2,'Etapa do criador:general','Características'),(3,'Etapa do criador:face','Rosto'),(4,'Etapa do criador:body','Corpo'),(5,'Etapa do criador:details','Personalidade e vínculo'),(6,'Etapa do criador:generating','Revelação'),(7,'Clicou em Criar:','Concluiu o criador'),(9,'Visualizou a Oferta:','Viu os planos'),(10,'page_view:/checkout','Entrou no checkout'),(11,'pix_created:','Gerou PIX'),(12,'payment_paid:','Pagamento confirmado'),(8,'page_view:/chat','Entrou no chat')),
reached as (select s.rank,s.label,e.session_id,min(e.created_at) as reached_at from stages s join e on e.event||':'||e.step=s.key group by s.rank,s.label,e.session_id),
funnel as (select s.rank,s.label,count(r.session_id) as sessions,count(r.session_id) filter(where s.rank=0 or exists(select 1 from reached prev where prev.rank=s.rank-1 and prev.session_id=r.session_id and prev.reached_at<=r.reached_at)) as continued from stages s left join reached r on r.rank=s.rank group by s.rank,s.label),
pages as (select step as page,count(*) as sessions from e where event='page_view' group by step),
sources as (select source,count(*) as sessions from cohort group by source order by sessions desc limit 15),
devices as (select device,count(*) as sessions from cohort group by device),
daily as (select (started_at at time zone 'America/Sao_Paulo')::date as day,count(*) as sessions,count(distinct visitor) as visitors from cohort group by 1 order by 1),
live as (select page,step,count(distinct visitor) as visitors from public.piskou_analytics_sessions where last_seen>now()-interval '90 seconds' group by page,step)
select jsonb_build_object(
 'sessions',(select count(*) from cohort),'visitors',(select count(distinct visitor) from cohort),
 'online',(select count(distinct visitor) from public.piskou_analytics_sessions where last_seen>now()-interval '90 seconds'),
 'funnel',coalesce((select jsonb_agg(to_jsonb(f) order by rank) from funnel f),'[]'),
 'pages',coalesce((select jsonb_agg(p) from pages p),'[]'),
 'sources',coalesce((select jsonb_agg(s) from sources s),'[]'),
 'devices',coalesce((select jsonb_agg(d) from devices d),'[]'),
 'daily',coalesce((select jsonb_agg(d) from daily d),'[]'),
 'live',coalesce((select jsonb_agg(l) from live l),'[]'),
 'collectedSince',(select min(started_at) from public.piskou_analytics_sessions), 'updatedAt',now());
$$;
