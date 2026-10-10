create table public.piskou_chat_sessions (
  id uuid primary key,
  selection jsonb not null,
  messages jsonb not null default '[]'::jsonb,
  lease uuid,
  lease_until timestamptz,
  expires_at timestamptz not null default (now() + interval '2 days')
);
create index piskou_chat_expiry_idx on public.piskou_chat_sessions(expires_at);
create table public.piskou_chat_budgets (
  key text primary key,
  requests integer not null default 0,
  expires_at timestamptz not null
);
create index piskou_chat_budget_expiry_idx on public.piskou_chat_budgets(expires_at);
alter table public.piskou_chat_sessions enable row level security;
alter table public.piskou_chat_budgets enable row level security;
revoke all on public.piskou_chat_sessions, public.piskou_chat_budgets from public, anon, authenticated;
grant select, insert, update, delete on public.piskou_chat_sessions, public.piskou_chat_budgets to service_role;

-- Reserva uma resposta atomicamente; requisições simultâneas não ultrapassam as três rodadas.
create function public.piskou_chat_claim(p_id uuid, p_selection jsonb, p_budget text, p_lease uuid)
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

create function public.piskou_chat_finish(p_id uuid, p_lease uuid, p_user text, p_reply text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.piskou_chat_sessions%rowtype;
begin
  select * into s from public.piskou_chat_sessions where id=p_id for update;
  if not found or s.lease is distinct from p_lease then raise exception 'Chat lease invalid'; end if;
  if p_reply is not null then
    s.messages := s.messages || jsonb_build_array(jsonb_build_object('role','user','text',p_user),jsonb_build_object('role','character','text',p_reply));
  end if;
  update public.piskou_chat_sessions set messages=s.messages,lease=null,lease_until=null where id=p_id;
  return s.messages;
end;
$$;
revoke all on function public.piskou_chat_claim(uuid,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.piskou_chat_finish(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.piskou_chat_claim(uuid,jsonb,text,uuid) to service_role;
grant execute on function public.piskou_chat_finish(uuid,uuid,text,text) to service_role;
