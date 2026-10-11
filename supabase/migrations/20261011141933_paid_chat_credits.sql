alter table public.piskou_chat_sessions add column allowance integer not null default 0 check (allowance >= 0), add column unlimited boolean not null default false;
create table public.piskou_chat_purchases (charge_id text primary key, chat_id uuid not null references public.piskou_chat_sessions(id), plan_id text not null, created_at timestamptz not null default now());
create index piskou_chat_purchases_chat_idx on public.piskou_chat_purchases(chat_id);
alter table public.piskou_chat_purchases enable row level security;
revoke all on public.piskou_chat_purchases from public,anon,authenticated;
grant select,insert on public.piskou_chat_purchases to service_role;
create function public.piskou_chat_grant(p_id uuid,p_charge text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; s public.piskou_chat_sessions%rowtype; added integer; plan text;
begin
 select value into v from public.piskou_payment_store where key='charge:'||p_charge and expires_at>now() for update;
 if v is null or v->>'status'<>'paid' or v->>'chatId' is distinct from p_id::text then raise exception 'Payment not confirmed or wrong owner'; end if;
 plan:=v->>'planId';
 if plan not in ('premium-access','luxury-access','messages-six','messages-unlimited') then raise exception 'Unknown product'; end if;
 insert into public.piskou_chat_sessions(id,selection) values(p_id,v->'selection') on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>v->'selection' then raise exception 'Wrong character'; end if;
 if plan in ('messages-six','messages-unlimited') and s.allowance=0 then raise exception 'Initial purchase required'; end if;
 insert into public.piskou_chat_purchases(charge_id,chat_id,plan_id) values(p_charge,p_id,plan) on conflict do nothing;
 get diagnostics added=row_count;
 if added=1 then
   update public.piskou_chat_sessions set allowance=greatest(allowance,jsonb_array_length(messages)/2)+case when plan='messages-unlimited' then 0 else 6 end,
     unlimited=unlimited or plan='messages-unlimited',expires_at=greatest(expires_at,now()+interval '90 days') where id=p_id;
 end if;
 select * into s from public.piskou_chat_sessions where id=p_id;
 return jsonb_build_object('allowance',s.allowance,'unlimited',s.unlimited);
end; $$;
revoke all on function public.piskou_chat_grant(uuid,text) from public,anon,authenticated;
grant execute on function public.piskou_chat_grant(uuid,text) to service_role;
create or replace function public.piskou_chat_claim(p_id uuid,p_selection jsonb,p_budget text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype;
begin
 select * into s from public.piskou_chat_sessions where id=p_id and expires_at>now() for update;
 if not found or (s.allowance=0 and not s.unlimited) then return jsonb_build_object('error','payment_required','messages',coalesce(s.messages,'[]'::jsonb)); end if;
 if s.selection<>p_selection then return jsonb_build_object('error','selection_changed'); end if;
 if not s.unlimited and jsonb_array_length(s.messages)/2>=s.allowance then return jsonb_build_object('error','limit','messages',s.messages); end if;
 if s.lease_until>now() then return jsonb_build_object('error','busy'); end if;
 update public.piskou_chat_sessions set expires_at=now()+interval '90 days',lease=p_lease,lease_until=now()+interval '90 seconds' where id=p_id;
 return jsonb_build_object('messages',s.messages,'turn',jsonb_array_length(s.messages)/2,'allowance',s.allowance,'unlimited',s.unlimited);
end; $$;

-- Keep confirmed purchases available when a visitor closes checkout before returning.
create or replace function public.piskou_store_set(p_key text,p_value jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 delete from public.piskou_payment_store where expires_at<=now();
 insert into public.piskou_payment_store(key,value,expires_at) values(p_key,p_value,now()+interval '90 days') on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at;
end; $$;

-- New funnel order: purchase before chat. Historical free-chat visits remain historical.
create or replace function public.piskou_analytics_report(p_days integer) returns jsonb language sql security invoker set search_path='' as $$
with purge as (delete from public.piskou_analytics_sessions where started_at<now()-interval '90 days'), cleanup as (delete from public.piskou_admin_limits where expires_at<now()), cohort as (
 select * from public.piskou_analytics_sessions where started_at >= (date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - (greatest(1,least(p_days,90))-1)*interval '1 day'
), e as (select ev.* from public.piskou_analytics_events ev join cohort c on c.id=ev.session_id),
stages(rank,key,label) as (values
 (0,'page_view:/','Visitou o site'),(1,'Etapa do criador:style','Estilo'),(2,'Etapa do criador:general','Características'),(3,'Etapa do criador:face','Rosto'),(4,'Etapa do criador:body','Corpo'),(5,'Etapa do criador:details','Personalidade e vínculo'),(6,'Etapa do criador:generating','Revelação'),(7,'Clicou em Criar:','Concluiu o criador'),(8,'Visualizou a Oferta:','Viu os planos'),(9,'page_view:/checkout','Entrou no checkout'),(10,'pix_created:','Gerou PIX'),(11,'payment_paid:','Pagamento confirmado'),(12,'page_view:/chat','Entrou no chat')),
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
