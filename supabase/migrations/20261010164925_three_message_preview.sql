-- Três respostas gratuitas; o histórico e as permissões existentes são preservados.
create or replace function public.piskou_chat_claim(p_id uuid, p_selection jsonb, p_budget text, p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.piskou_chat_sessions%rowtype; n integer; k text; lim integer;
begin
  delete from public.piskou_chat_sessions where expires_at < now();
  delete from public.piskou_chat_budgets where expires_at < now();
  insert into public.piskou_chat_sessions(id, selection) values (p_id, p_selection) on conflict do nothing;
  select * into s from public.piskou_chat_sessions where id=p_id for update;
  if s.selection <> p_selection then return jsonb_build_object('error','selection_changed'); end if;
  if jsonb_array_length(s.messages) >= 6 then return jsonb_build_object('error','limit', 'messages',s.messages); end if;
  if s.lease_until > now() then return jsonb_build_object('error','busy'); end if;
  -- Teto diário global de 1000 chamadas e 12 por IP (IP armazenado somente como HMAC).
  foreach k in array array['global:' || current_date::text, p_budget || ':' || current_date::text] loop
    lim := case when k like 'global:%' then 1000 else 12 end;
    insert into public.piskou_chat_budgets(key,expires_at) values(k,now()+interval '2 days') on conflict do nothing;
    select requests into n from public.piskou_chat_budgets where key=k for update;
    if n >= lim then return jsonb_build_object('error','rate'); end if;
    update public.piskou_chat_budgets set requests=requests+1 where key=k;
  end loop;
  update public.piskou_chat_sessions set lease=p_lease,lease_until=now()+interval '90 seconds' where id=p_id;
  return jsonb_build_object('messages',s.messages,'turn',jsonb_array_length(s.messages)/2);
end;
$$;

