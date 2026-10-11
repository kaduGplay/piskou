-- Record real gateway outcomes in the existing payment write, with no extra API latency.
create function public.piskou_analytics_payment_trigger() returns trigger language plpgsql security invoker set search_path='' as $$
declare sid uuid;
begin
 if new.key not like 'charge:%' or coalesce(new.value->>'analyticsSession','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then return new; end if;
 sid:=(new.value->>'analyticsSession')::uuid;
 if not exists(select 1 from public.piskou_analytics_sessions where id=sid) then return new; end if;
 if new.value->>'method'='pix' and new.value->>'status' in ('pending','paid') then
  insert into public.piskou_analytics_events(session_id,event,step) values(sid,'pix_created','') on conflict do nothing;
 end if;
 if new.value->>'status'='paid' then
  insert into public.piskou_analytics_events(session_id,event,step) values(sid,'payment_paid','') on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.piskou_analytics_payment_trigger() from public,anon,authenticated;
grant execute on function public.piskou_analytics_payment_trigger() to service_role;
create trigger piskou_analytics_payment after insert or update on public.piskou_payment_store for each row execute function public.piskou_analytics_payment_trigger();

create function public.piskou_admin_report(p_days integer) returns jsonb language sql security invoker set search_path='' as $$
with e as (select e.* from public.piskou_analytics_events e join public.piskou_analytics_sessions s on s.id=e.session_id where s.started_at >= (date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')-(greatest(1,least(p_days,90))-1)*interval '1 day'),
actions(label,event,step) as(values ('Tentou a 1ª mensagem','ChatMensagemEnviada','1'),('Tentou a 2ª mensagem','ChatMensagemEnviada','2'),('Tentou a 3ª mensagem','ChatMensagemEnviada','3'),('Recebeu resposta no chat','ChatRespostaRecebida',''),('Viu o limite grátis','ChatLimiteExibido',''),('Pediu uma foto','ChatFotoSolicitada',''),('Pediu um vídeo','ChatVideoSolicitado',''),('Teve erro no chat','ChatErro',''),('Teve erro no checkout','CheckoutErro','')),
counts as (select a.label,count(distinct e.session_id) as sessions from actions a left join e on e.event=a.event and e.step=a.step group by a.label)
select public.piskou_analytics_report(p_days)||jsonb_build_object('actions',coalesce((select jsonb_agg(c) from counts c),'[]'));
$$;
revoke all on function public.piskou_admin_report(integer) from public,anon,authenticated;
grant execute on function public.piskou_admin_report(integer) to service_role;
