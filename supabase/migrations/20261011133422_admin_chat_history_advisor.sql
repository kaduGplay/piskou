create table public.piskou_chat_archive (
 id uuid primary key, analytics_id uuid, selection jsonb not null,
 messages jsonb not null default '[]', created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index piskou_chat_archive_created on public.piskou_chat_archive(created_at desc,id);
create table public.piskou_chat_activity (
 id uuid primary key, chat_id uuid not null references public.piskou_chat_archive(id) on delete cascade,
 kind text not null, text text not null, created_at timestamptz not null default now()
);
create index piskou_chat_activity_chat on public.piskou_chat_activity(chat_id,created_at);
create table public.piskou_advisor_turns (
 id uuid primary key, question text not null, reply text, context jsonb,
 created_at timestamptz not null default now(), lease_until timestamptz not null default now()+interval '90 seconds'
);
create index piskou_advisor_created on public.piskou_advisor_turns(created_at desc);
alter table public.piskou_chat_archive enable row level security;
alter table public.piskou_chat_activity enable row level security;
alter table public.piskou_advisor_turns enable row level security;
revoke all on public.piskou_chat_archive,public.piskou_chat_activity,public.piskou_advisor_turns from public,anon,authenticated;
grant select,insert,update,delete on public.piskou_chat_archive,public.piskou_chat_activity,public.piskou_advisor_turns to service_role;

create function public.piskou_archive_chat() returns trigger language plpgsql security invoker set search_path='' as $$
declare previous jsonb; cleaned jsonb;
begin
 if jsonb_array_length(new.messages)=0 then return new;end if;
 select messages into previous from public.piskou_chat_archive where id=new.id;
 select coalesce(jsonb_agg(jsonb_build_object('role',m->>'role','text',m->>'text','hasImage',m?'media','at',previous->(ord::integer-1)->>'at')||case when previous->(ord::integer-1)->>'at' is null then jsonb_build_object('at',now()) else '{}'::jsonb end order by ord),'[]') into cleaned from jsonb_array_elements(new.messages) with ordinality as t(m,ord);
 insert into public.piskou_chat_archive(id,selection,messages) values(new.id,new.selection,cleaned)
 on conflict(id) do update set selection=excluded.selection,messages=excluded.messages,updated_at=now();
 return new;
end $$;
create trigger piskou_archive_chat after insert or update of messages on public.piskou_chat_sessions for each row execute function public.piskou_archive_chat();
-- Backfill still available conversations. Original per-message times were not recorded.
insert into public.piskou_chat_archive(id,selection,messages,created_at,updated_at)
select id,selection,(select coalesce(jsonb_agg(jsonb_build_object('role',m->>'role','text',m->>'text','hasImage',m?'media')),'[]') from jsonb_array_elements(messages) m),expires_at-interval '2 days',now() from public.piskou_chat_sessions where jsonb_array_length(messages)>0;

create function public.piskou_chat_journal(p_id uuid,p_selection jsonb,p_analytics uuid,p_event uuid,p_kind text,p_text text) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.piskou_chat_archive(id,selection,analytics_id) values(p_id,p_selection,p_analytics)
 on conflict(id) do update set analytics_id=coalesce(piskou_chat_archive.analytics_id,excluded.analytics_id);
 if p_event is not null and p_kind in ('limit','photo','video') and length(p_text)<=500 then
  perform 1 from public.piskou_chat_archive where id=p_id for update;
  if (select count(*) from public.piskou_chat_activity where chat_id=p_id)<30 then
   insert into public.piskou_chat_activity(id,chat_id,kind,text) values(p_event,p_id,p_kind,p_text) on conflict do nothing;
   update public.piskou_chat_archive set updated_at=now() where id=p_id;
  end if;
 end if;
end $$;

create function public.piskou_admin_chats(p_days integer,p_offset integer,p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 delete from public.piskou_chat_archive where created_at<now()-interval '90 days';
 delete from public.piskou_advisor_turns where created_at<now()-interval '90 days';
 if p_id is not null then
  select to_jsonb(c)||jsonb_build_object('activity',coalesce((select jsonb_agg(a order by a.created_at) from public.piskou_chat_activity a where chat_id=c.id),'[]'),'journey',coalesce((select jsonb_agg(jsonb_build_object('event',e.event,'step',e.step,'at',e.created_at) order by e.created_at) from public.piskou_analytics_events e where e.session_id=c.analytics_id),'[]')) into result from public.piskou_chat_archive c where c.id=p_id;
  return result;
 end if;
 with filtered as(select c.* from public.piskou_chat_archive c where c.created_at >= (date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')-(greatest(1,least(p_days,90))-1)*interval '1 day'), page as(select id,selection,created_at,updated_at,jsonb_array_length(messages) as message_count,(messages->-1->>'text') as last_message,(select count(*) from public.piskou_chat_activity a where a.chat_id=c.id) as activity_count from filtered c order by created_at desc,id limit 25 offset greatest(0,least(p_offset,100000)))
 select jsonb_build_object('total',(select count(*) from filtered),'items',coalesce((select jsonb_agg(p) from page p),'[]')) into result;
 return result;
end $$;

create function public.piskou_advisor_claim(p_id uuid,p_question text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.piskou_advisor_turns%rowtype;
begin
 perform pg_advisory_xact_lock(793512821);
 select * into t from public.piskou_advisor_turns where id=p_id;
 if found then
  if t.question<>p_question then return jsonb_build_object('error','changed');end if;
  if t.reply is not null then return jsonb_build_object('cached',true,'reply',t.reply,'context',t.context);end if;
  if t.lease_until>now() then return jsonb_build_object('error','busy');end if;
 end if;
 if exists(select 1 from public.piskou_advisor_turns where reply is null and lease_until>now()) then return jsonb_build_object('error','busy');end if;
 insert into public.piskou_advisor_turns(id,question) values(p_id,p_question) on conflict(id) do update set lease_until=now()+interval '90 seconds';
 return jsonb_build_object('cached',false);
end $$;
create function public.piskou_advisor_finish(p_id uuid,p_reply text,p_context jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_reply is null then delete from public.piskou_advisor_turns where id=p_id and reply is null;
 else update public.piskou_advisor_turns set reply=p_reply,context=p_context,lease_until=now() where id=p_id and reply is null;end if;
end $$;
revoke all on function public.piskou_archive_chat(),public.piskou_chat_journal(uuid,jsonb,uuid,uuid,text,text),public.piskou_admin_chats(integer,integer,uuid),public.piskou_advisor_claim(uuid,text),public.piskou_advisor_finish(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.piskou_archive_chat(),public.piskou_chat_journal(uuid,jsonb,uuid,uuid,text,text),public.piskou_admin_chats(integer,integer,uuid),public.piskou_advisor_claim(uuid,text),public.piskou_advisor_finish(uuid,text,jsonb) to service_role;
