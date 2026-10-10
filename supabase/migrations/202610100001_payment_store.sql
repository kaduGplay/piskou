-- Apenas as funções da Vercel, usando uma chave secreta, acessam as cobranças.
create table public.piskou_payment_store (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null default (now() + interval '2 days')
);

create index piskou_payment_store_expiry_idx
  on public.piskou_payment_store (expires_at);

alter table public.piskou_payment_store enable row level security;
revoke all on public.piskou_payment_store from public, anon, authenticated;
grant select, insert, update, delete on public.piskou_payment_store to service_role;

-- Mantém o prazo de dois dias do Redis e limpa registros vencidos a cada escrita.
create function public.piskou_store_set(p_key text, p_value jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.piskou_payment_store where expires_at <= now();
  insert into public.piskou_payment_store (key, value, expires_at)
  values (p_key, p_value, now() + interval '2 days')
  on conflict (key) do update
  set value = excluded.value, expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.piskou_store_set(text, jsonb) from public, anon, authenticated;
grant execute on function public.piskou_store_set(text, jsonb) to service_role;
