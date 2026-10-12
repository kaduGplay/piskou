-- Fictional character tastes are independent from opt-in user memory and billing.
create table public.piskou_character_preferences (
 chat_id uuid primary key references public.piskou_chat_sessions(id) on delete cascade,
 configuration jsonb not null,
 preferences jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint character_preferences_size check (octet_length(preferences::text)<=5000 and octet_length(configuration::text)<=2000)
);
alter table public.piskou_character_preferences enable row level security;
revoke all on public.piskou_character_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.piskou_character_preferences to service_role;

create function public.piskou_character_preferences(p_id uuid,p_selection jsonb,p_configuration jsonb,p_preferences jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare stored_selection jsonb; saved jsonb;
begin
 if jsonb_typeof(p_configuration) is distinct from 'object' or jsonb_typeof(p_preferences) is distinct from 'object'
 or octet_length(p_preferences::text)>5000 or octet_length(p_configuration::text)>2000 then
  return jsonb_build_object('error','invalid');
 end if;
 select selection into stored_selection from public.piskou_chat_sessions where id=p_id for update;
 if not found or stored_selection is distinct from p_selection then return jsonb_build_object('error','selection_changed');end if;
 insert into public.piskou_character_preferences(chat_id,configuration,preferences)
 values(p_id,p_configuration,p_preferences)
 on conflict (chat_id) do update set configuration=excluded.configuration,preferences=excluded.preferences,updated_at=now()
 where public.piskou_character_preferences.configuration is distinct from excluded.configuration;
 select preferences into saved from public.piskou_character_preferences where chat_id=p_id;
 return jsonb_build_object('preferences',saved);
end $$;
revoke all on function public.piskou_character_preferences(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.piskou_character_preferences(uuid,jsonb,jsonb,jsonb) to service_role;
