alter table public.piskou_chat_sessions drop constraint piskou_chat_sessions_trial_allowance_check;
update public.piskou_chat_sessions set allowance=allowance+6,credit_base=credit_base+6,trial_allowance=12 where trial_allowance=6;
alter table public.piskou_chat_sessions add constraint piskou_chat_sessions_trial_allowance_check check(trial_allowance in (0,12));
create or replace function public.piskou_chat_claim(p_id uuid,p_selection jsonb,p_budget text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; n integer; k text; lim integer;
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,12,12,12) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection then return jsonb_build_object('error','selection_changed'); end if;
 if s.allowance=0 and not s.unlimited then return jsonb_build_object('error','payment_required','messages',s.messages);end if;
 if not s.unlimited and jsonb_array_length(s.messages)/2>=s.allowance then return jsonb_build_object('error','limit','messages',s.messages); end if;
 if s.lease_until>now() then return jsonb_build_object('error','busy'); end if;
 if s.trial_allowance=12 and not s.budget_reserved then
  foreach k in array array['global:'||current_date::text,p_budget||':'||current_date::text] loop
   lim:=case when k like 'global:%' then 1000 else 120 end;
   insert into public.piskou_chat_budgets(key,expires_at) values(k,now()+interval '2 days') on conflict do nothing;
   select requests into n from public.piskou_chat_budgets where key=k for update;
   if n+12>lim then return jsonb_build_object('error','rate');end if;
  end loop;
  update public.piskou_chat_budgets set requests=requests+12 where key in ('global:'||current_date::text,p_budget||':'||current_date::text);
  update public.piskou_chat_sessions set budget_reserved=true where id=p_id;
 end if;
 update public.piskou_chat_sessions set expires_at=now()+interval '90 days',lease=p_lease,lease_until=now()+interval '90 seconds' where id=p_id;
 return jsonb_build_object('messages',s.messages,'turn',jsonb_array_length(s.messages)/2,'allowance',s.allowance,'unlimited',s.unlimited);
end $$;
create or replace function public.piskou_chat_access(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
select coalesce((select jsonb_build_object('remaining',case when unlimited then null else greatest(0,allowance-jsonb_array_length(messages)/2) end,'unlimited',unlimited,'requiresPayment',allowance=0 and not unlimited,'hasPaidAccess',unlimited or allowance>trial_allowance) from public.piskou_chat_sessions where id=p_id),jsonb_build_object('remaining',12,'unlimited',false,'requiresPayment',false,'hasPaidAccess',false));
$$;
revoke all on function public.piskou_chat_claim(uuid,jsonb,text,uuid),public.piskou_chat_access(uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_claim(uuid,jsonb,text,uuid),public.piskou_chat_access(uuid) to service_role;
create or replace function public.piskou_admin_report(p_days integer) returns jsonb language sql security invoker set search_path='' as $$
with e as (select e.* from public.piskou_analytics_events e join public.piskou_analytics_sessions s on s.id=e.session_id where s.started_at >= (date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')-(greatest(1,least(p_days,90))-1)*interval '1 day'),
actions(label,event,step) as(values ('Tentou a 1ª mensagem','ChatMensagemEnviada','1'),('Tentou a 2ª mensagem','ChatMensagemEnviada','2'),('Tentou a 3ª mensagem','ChatMensagemEnviada','3'),('Tentou a 4ª mensagem','ChatMensagemEnviada','4'),('Tentou a 5ª mensagem','ChatMensagemEnviada','5'),('Tentou a 6ª mensagem','ChatMensagemEnviada','6'),('Tentou a 7ª mensagem','ChatMensagemEnviada','7'),('Tentou a 8ª mensagem','ChatMensagemEnviada','8'),('Tentou a 9ª mensagem','ChatMensagemEnviada','9'),('Tentou a 10ª mensagem','ChatMensagemEnviada','10'),('Tentou a 11ª mensagem','ChatMensagemEnviada','11'),('Tentou a 12ª mensagem','ChatMensagemEnviada','12'),('Recebeu resposta no chat','ChatRespostaRecebida',''),('Viu o limite grátis','ChatLimiteExibido',''),('Pediu uma foto','ChatFotoSolicitada',''),('Pediu um vídeo','ChatVideoSolicitado',''),('Teve erro no chat','ChatErro',''),('Teve erro no checkout','CheckoutErro','')),
counts as (select a.label,count(distinct e.session_id) as sessions from actions a left join e on e.event=a.event and e.step=a.step group by a.label)
select public.piskou_analytics_report(p_days)||jsonb_build_object('actions',coalesce((select jsonb_agg(c) from counts c),'[]'));
$$;
revoke all on function public.piskou_admin_report(integer) from public,anon,authenticated;
grant execute on function public.piskou_admin_report(integer) to service_role;
