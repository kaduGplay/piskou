-- Additive migration. No existing messages, balances or purchases are changed.
create table public.piskou_character_memory (
 chat_id uuid primary key references public.piskou_chat_sessions(id) on delete cascade,
 state jsonb not null default '{"version":1,"enabled":false,"revision":0,"processedThrough":0,"facts":[],"roleplayActive":false}'::jsonb,
 updated_at timestamptz not null default now(),
 constraint memory_state_size check(octet_length(state::text)<=20000)
);
alter table public.piskou_character_memory enable row level security;
revoke all on public.piskou_character_memory from public,anon,authenticated;
grant select,insert,update,delete on public.piskou_character_memory to service_role;

create function public.piskou_memory_settings(p_id uuid,p_selection jsonb,p_action text,p_key text,p_enabled boolean,p_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; m jsonb; next_facts jsonb; rev integer;
begin
 if p_action not in ('toggle','clear','delete') or p_revision is null or p_revision<0 then return jsonb_build_object('error','invalid');end if;
 if p_action='toggle' and p_enabled is null then return jsonb_build_object('error','invalid');end if;
 if p_action='delete' and (p_key is null or length(p_key)>80) then return jsonb_build_object('error','invalid');end if;
 -- Consent can be set before the first message; free rounds are still budgeted by chat_claim.
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base)
 values(p_id,p_selection,12,12,12) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection then return jsonb_build_object('error','selection_changed');end if;
 insert into public.piskou_character_memory(chat_id) values(p_id) on conflict do nothing;
 select state into m from public.piskou_character_memory where chat_id=p_id for update;
 rev:=(m->>'revision')::integer;
 if rev<>p_revision then return jsonb_build_object('error','conflict');end if;
 if p_action='delete' then
  select coalesce(jsonb_agg(f),'[]'::jsonb) into next_facts from jsonb_array_elements(m->'facts') f where f->>'key'<>p_key;
 else next_facts:='[]'::jsonb;end if;
 m:=m||jsonb_build_object('facts',next_facts,'revision',rev+1,'processedThrough',jsonb_array_length(s.messages)/2);
 if p_action='toggle' then m:=m||jsonb_build_object('enabled',p_enabled);end if;
 if p_action<>'delete' then m:=m||jsonb_build_object('roleplayActive',false);end if;
 update public.piskou_character_memory set state=m,updated_at=now() where chat_id=p_id;
 return jsonb_build_object('state',m);
end $$;
create function public.piskou_memory_commit(p_id uuid,p_revision integer,p_state jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if octet_length(p_state::text)>20000 or jsonb_typeof(p_state->'facts')<>'array' or jsonb_array_length(p_state->'facts')>24 then return false;end if;
 update public.piskou_character_memory m set state=p_state||jsonb_build_object('revision',p_revision+1),updated_at=now()
 where m.chat_id=p_id and (m.state->>'enabled')::boolean and (m.state->>'revision')::integer=p_revision
 and (p_state->>'enabled')::boolean and (p_state->>'processedThrough')::integer=(select jsonb_array_length(messages)/2 from public.piskou_chat_sessions where id=p_id);
 return found;
end $$;
revoke all on function public.piskou_memory_settings(uuid,jsonb,text,text,boolean,integer),public.piskou_memory_commit(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.piskou_memory_settings(uuid,jsonb,text,text,boolean,integer),public.piskou_memory_commit(uuid,integer,jsonb) to service_role;
