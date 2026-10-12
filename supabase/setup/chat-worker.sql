-- Run only after an authorized deployment and setting Vault secrets:
-- piskou_worker_url = https://your-domain/api/chat-worker
-- piskou_worker_secret = same CHAT_WORKER_SECRET configured on Vercel.
-- No secrets are embedded in this file. Requires Postgres supporting second schedules.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('piskou-chat-worker','1 second',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='piskou_worker_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='piskou_worker_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=120000
 ) where exists(select 1 from public.piskou_chat_sessions where queue_due<=now() and (lease_until is null or lease_until<=now()))
    or exists(select 1 from public.piskou_chat_media_deletions);
$job$);

-- Also clean abandoned uploads/expired active sessions even when nobody opens the chat.
select cron.schedule('piskou-chat-housekeeping','0 3 * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='piskou_worker_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='piskou_worker_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=120000
 );
$job$);
