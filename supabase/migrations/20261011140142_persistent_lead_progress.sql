-- Preserve visitor sessions for 90 days; keep daily abuse budgets unchanged.
alter table public.piskou_chat_sessions alter column expires_at set default (now() + interval '90 days');
update public.piskou_chat_sessions set expires_at = greatest(expires_at, now() + interval '90 days') where expires_at > now();
