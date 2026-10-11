create table public.piskou_analytics_sessions (
 id uuid primary key, visitor uuid not null, started_at timestamptz not null default now(),
 last_seen timestamptz not null default now(), page text not null, step text not null default '',
 source text not null, device text not null
);
create index piskou_analytics_started on public.piskou_analytics_sessions(started_at);
create index piskou_analytics_live on public.piskou_analytics_sessions(last_seen);
create table public.piskou_analytics_events (
 session_id uuid not null references public.piskou_analytics_sessions(id) on delete cascade,
 event text not null, step text not null default '', created_at timestamptz not null default now(),
 primary key(session_id,event,step)
);
create table public.piskou_admin_limits(key text primary key, attempts integer not null, expires_at timestamptz not null);
create index piskou_admin_limit_expiry on public.piskou_admin_limits(expires_at);
alter table public.piskou_analytics_sessions enable row level security;
alter table public.piskou_analytics_events enable row level security;
alter table public.piskou_admin_limits enable row level security;
revoke all on public.piskou_analytics_sessions,public.piskou_analytics_events,public.piskou_admin_limits from public,anon,authenticated;
grant select,insert,update,delete on public.piskou_analytics_sessions,public.piskou_analytics_events,public.piskou_admin_limits to service_role;

create function public.piskou_analytics_limit(p_key text, p_max integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.piskou_admin_limits(key,attempts,expires_at) values(p_key,1,now()+interval '15 minutes')
 on conflict(key) do update set attempts=case when piskou_admin_limits.expires_at<now() then 1 else piskou_admin_limits.attempts+1 end,
 expires_at=case when piskou_admin_limits.expires_at<now() then now()+interval '15 minutes' else piskou_admin_limits.expires_at end returning attempts into n;
 return n<=p_max;
end $$;

create function public.piskou_analytics_record(p_id uuid,p_visitor uuid,p_page text,p_event text,p_step text,p_source text,p_device text) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.piskou_analytics_sessions(id,visitor,page,step,source,device) values(p_id,p_visitor,p_page,p_step,p_source,p_device)
 on conflict(id) do update set last_seen=now(),page=excluded.page,step=case when excluded.step<>'' then excluded.step else piskou_analytics_sessions.step end;
 insert into public.piskou_analytics_events(session_id,event,step) values(p_id,'page_view',p_page) on conflict do nothing;
 if p_event<>'heartbeat' then
 insert into public.piskou_analytics_events(session_id,event,step) values(p_id,p_event,case when p_event='page_view' then p_page else p_step end) on conflict do nothing;
 end if;
end $$;

create function public.piskou_analytics_report(p_days integer) returns jsonb language sql security invoker set search_path='' as $$
with purge as (delete from public.piskou_analytics_sessions where started_at<now()-interval '90 days'), cleanup as (delete from public.piskou_admin_limits where expires_at<now()), cohort as (
 select * from public.piskou_analytics_sessions where started_at >= (date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - (greatest(1,least(p_days,90))-1)*interval '1 day'
), e as (select ev.* from public.piskou_analytics_events ev join cohort c on c.id=ev.session_id),
stages(rank,key,label) as (values
 (0,'page_view:/','Visitou o site'),(1,'Etapa do criador:style','Estilo'),(2,'Etapa do criador:general','Características'),(3,'Etapa do criador:face','Rosto'),(4,'Etapa do criador:body','Corpo'),(5,'Etapa do criador:details','Personalidade e vínculo'),(6,'Etapa do criador:generating','Revelação'),(7,'Clicou em Criar:','Concluiu o criador'),(8,'page_view:/chat','Entrou no chat'),(9,'Visualizou a Oferta:','Viu os planos'),(10,'page_view:/checkout','Entrou no checkout'),(11,'pix_created:','Gerou PIX'),(12,'payment_paid:','Pagamento confirmado')),
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
revoke all on function public.piskou_analytics_limit(text,integer),public.piskou_analytics_record(uuid,uuid,text,text,text,text,text),public.piskou_analytics_report(integer) from public,anon,authenticated;
grant execute on function public.piskou_analytics_limit(text,integer),public.piskou_analytics_record(uuid,uuid,text,text,text,text,text),public.piskou_analytics_report(integer) to service_role;
