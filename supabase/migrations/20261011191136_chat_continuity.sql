-- Grouping changes interpretation only: one credit per actual user message.
create function public.piskou_user_message_count(p_messages jsonb) returns integer
language sql immutable security invoker set search_path='' as $$
 select count(*)::integer from jsonb_array_elements(p_messages) m where m->>'role'='user' and (not m ? 'charged' or (m->>'charged')::boolean);
$$;
revoke all on function public.piskou_user_message_count(jsonb) from public,anon,authenticated;
grant execute on function public.piskou_user_message_count(jsonb) to service_role;
create or replace function public.piskou_chat_claim(p_id uuid,p_selection jsonb,p_budget text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; n integer; k text; lim integer;
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,12,12,12) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection then return jsonb_build_object('error','selection_changed'); end if;
 if s.allowance=0 and not s.unlimited then return jsonb_build_object('error','payment_required','messages',s.messages);end if;
 if not s.unlimited and public.piskou_user_message_count(s.messages)>=s.allowance then return jsonb_build_object('error','limit','messages',s.messages); end if;
 if s.lease_until>now() or exists(select 1 from jsonb_array_elements(s.messages) m where m->>'responseState' in ('pending','generating') and not coalesce((m->>'deleted')::boolean,false)) then return jsonb_build_object('error','busy'); end if;
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
 return jsonb_build_object('messages',s.messages,'turn',public.piskou_user_message_count(s.messages),'allowance',s.allowance,'unlimited',s.unlimited);
end $$;
create or replace function public.piskou_chat_access(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
select coalesce((select jsonb_build_object('remaining',case when unlimited then null else greatest(0,allowance-public.piskou_user_message_count(messages)) end,'unlimited',unlimited,'requiresPayment',allowance=0 and not unlimited,'hasPaidAccess',unlimited or allowance>trial_allowance) from public.piskou_chat_sessions where id=p_id),jsonb_build_object('remaining',12,'unlimited',false,'requiresPayment',false,'hasPaidAccess',false));
$$;
revoke all on function public.piskou_chat_claim(uuid,jsonb,text,uuid),public.piskou_chat_access(uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_claim(uuid,jsonb,text,uuid),public.piskou_chat_access(uuid) to service_role;

create or replace function public.piskou_chat_sync(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare initial boolean; credits integer; forever boolean;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id for update;
 select coalesce(bool_or(plan_id in ('premium-access','luxury-access')),false),coalesce(sum(case when plan_id='messages-unlimited' then 0 when plan_id='messages-120' then 120 else 6 end),0),coalesce(bool_or(plan_id='messages-unlimited'),false)
 into initial,credits,forever from public.piskou_chat_purchases where chat_id=p_id and active;
 update public.piskou_chat_sessions set allowance=case when initial then credit_base+credits else trial_allowance end,unlimited=initial and forever,lease=case when (case when initial then credit_base+credits else trial_allowance end)<=public.piskou_user_message_count(messages) and not (initial and forever) then null else lease end,lease_until=case when (case when initial then credit_base+credits else trial_allowance end)<=public.piskou_user_message_count(messages) and not (initial and forever) then null else lease_until end where id=p_id;
end $$;
revoke all on function public.piskou_chat_sync(uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_sync(uuid) to service_role;
create or replace function public.piskou_chat_grant(p_id uuid,p_charge text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; s public.piskou_chat_sessions%rowtype; plan text; changed integer;
begin
 select value into v from public.piskou_payment_store where key='charge:'||p_charge and expires_at>now() for update;
 if v is null or v->>'status'<>'paid' or v->>'chatId' is distinct from p_id::text then raise exception 'Payment not confirmed or wrong owner'; end if;
 plan:=v->>'planId';
 if plan not in ('premium-access','luxury-access','messages-six','messages-120','messages-unlimited') then raise exception 'Unknown product'; end if;
 insert into public.piskou_chat_sessions(id,selection) values(p_id,v->'selection') on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>v->'selection' then raise exception 'Wrong character'; end if;
 if plan in ('premium-access','luxury-access') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id) then
  update public.piskou_chat_sessions set credit_base=greatest(credit_base,trial_allowance,public.piskou_user_message_count(messages)) where id=p_id;
 end if;
 if plan in ('messages-six','messages-120','messages-unlimited') and not exists(select 1 from public.piskou_chat_purchases where chat_id=p_id and active and plan_id in ('premium-access','luxury-access')) then raise exception 'Initial purchase required'; end if;
 insert into public.piskou_chat_purchases(charge_id,chat_id,plan_id,active) values(p_charge,p_id,plan,true)
 on conflict(charge_id) do update set active=true where not public.piskou_chat_purchases.active;
 get diagnostics changed=row_count;
 if changed>0 then perform public.piskou_chat_sync(p_id); end if;
 update public.piskou_chat_sessions set expires_at=greatest(expires_at,now()+interval '90 days') where id=p_id;
 select * into s from public.piskou_chat_sessions where id=p_id;
 return jsonb_build_object('allowance',s.allowance,'unlimited',s.unlimited);
end $$;


create or replace function public.piskou_memory_settings(p_id uuid,p_selection jsonb,p_action text,p_key text,p_enabled boolean,p_revision integer)
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
 m:=m||jsonb_build_object('facts',next_facts,'revision',rev+1,'processedThrough',(select count(*) from jsonb_array_elements(s.messages) u where u->>'role'='user'));
 if p_action='toggle' then m:=m||jsonb_build_object('enabled',p_enabled,'consentedAfter',(m->>'processedThrough')::integer,'forgottenAfter','{}'::jsonb);end if;
 if p_action='clear' then m:=m||jsonb_build_object('consentedAfter',(m->>'processedThrough')::integer,'forgottenAfter','{}'::jsonb);end if;
 if p_action='delete' then m:=m||jsonb_build_object('forgottenAfter',coalesce(m->'forgottenAfter','{}'::jsonb)||jsonb_build_object(p_key,(m->>'processedThrough')::integer));end if;
 if p_action<>'delete' then m:=m||jsonb_build_object('roleplayActive',false);end if;
 update public.piskou_character_memory set state=m,updated_at=now() where chat_id=p_id;
 return jsonb_build_object('state',m);
end $$;
create or replace function public.piskou_memory_commit(p_id uuid,p_revision integer,p_state jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if octet_length(p_state::text)>20000 or jsonb_typeof(p_state->'facts')<>'array' or jsonb_array_length(p_state->'facts')>24 then return false;end if;
 update public.piskou_character_memory m set state=p_state||jsonb_build_object('revision',p_revision+1),updated_at=now()
 where m.chat_id=p_id and (m.state->>'enabled')::boolean and (m.state->>'revision')::integer=p_revision
 and (p_state->>'enabled')::boolean and (p_state->>'processedThrough')::integer>=(m.state->>'processedThrough')::integer
 and (p_state->>'processedThrough')::integer<=(select count(*) from public.piskou_chat_sessions s,jsonb_array_elements(s.messages) m where s.id=p_id and m->>'role'='user');
 return found;
end $$;
revoke all on function public.piskou_memory_settings(uuid,jsonb,text,text,boolean,integer),public.piskou_memory_commit(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.piskou_memory_settings(uuid,jsonb,text,text,boolean,integer),public.piskou_memory_commit(uuid,integer,jsonb) to service_role;


-- Durable scheduling and real lifecycle events. Historical times remain unknown.
alter table public.piskou_chat_sessions add column queue_due timestamptz,
 add column queue_first timestamptz, add column queue_generation integer not null default 0,
 add column queue_regenerations integer not null default 0,
 add column queue_revision integer not null default 0;
create index piskou_queue_due on public.piskou_chat_sessions(queue_due) where queue_due is not null;
update public.piskou_chat_sessions s set messages=(select coalesce(jsonb_agg(m||jsonb_build_object('id',gen_random_uuid()) order by ord),'[]') from jsonb_array_elements(s.messages) with ordinality t(m,ord));

create table public.piskou_chat_audio (
 chat_id uuid not null references public.piskou_chat_sessions(id) on delete cascade,
 message_id uuid not null, object_key text not null, transcript text not null default '',
 mime text not null, ready boolean not null default false,
 created_at timestamptz not null default now(), primary key(chat_id,message_id)
);
create table public.piskou_chat_media_deletions (
 object_key text primary key, created_at timestamptz not null default now()
);
alter table public.piskou_chat_audio enable row level security;
alter table public.piskou_chat_media_deletions enable row level security;
revoke all on public.piskou_chat_audio,public.piskou_chat_media_deletions from public,anon,authenticated;
grant select,insert,update,delete on public.piskou_chat_audio,public.piskou_chat_media_deletions to service_role;

create table public.piskou_chat_deleted_ids (
 chat_id uuid not null references public.piskou_chat_sessions(id) on delete cascade,
 message_id uuid not null, primary key(chat_id,message_id)
);
alter table public.piskou_chat_deleted_ids enable row level security;
revoke all on public.piskou_chat_deleted_ids from public,anon,authenticated;
grant select,insert,delete on public.piskou_chat_deleted_ids to service_role;

create function public.piskou_chat_snapshot(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce((select jsonb_build_object('deletedIds',(select coalesce(jsonb_agg(message_id),'[]') from public.piskou_chat_deleted_ids where chat_id=p_id),'messages',messages,'conversationId',p_id,'selection',selection,'revision',queue_revision,
 'remaining',case when unlimited then null else greatest(0,allowance-public.piskou_user_message_count(messages)) end,
 'requiresPayment',allowance=0 and not unlimited,'hasPaidAccess',unlimited or allowance>trial_allowance,
 'preparing',lease_until>now(),'dueAt',queue_due,'serverTime',clock_timestamp())
 from public.piskou_chat_sessions where id=p_id),jsonb_build_object('messages','[]'::jsonb,'conversationId',p_id,'remaining',12,'revision',0,'preparing',false,'serverTime',clock_timestamp()));
$$;

create function public.piskou_chat_enqueue(p_id uuid,p_selection jsonb,p_budget text,p_message uuid,p_text text,p_reply_to uuid,p_timezone text,p_window_ms integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; c jsonb; first_at timestamptz; due timestamptz; new_message jsonb; aud public.piskou_chat_audio%rowtype; queued integer;
begin
 if p_message is null or p_text is null or length(trim(p_text)) not between 1 and 500 then return jsonb_build_object('error','invalid');end if;
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,12,12,12) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection then return jsonb_build_object('error','selection_changed');end if;
 if exists(select 1 from jsonb_array_elements(s.messages) m where m->>'id'=p_message::text) or exists(select 1 from public.piskou_chat_deleted_ids where chat_id=p_id and message_id=p_message) then return public.piskou_chat_snapshot(p_id);end if;
 select count(*) into queued from jsonb_array_elements(s.messages) m where m->>'role'='user' and m->>'charged'='false' and not coalesce((m->>'deleted')::boolean,false);
 if not s.unlimited and public.piskou_user_message_count(s.messages)+queued>=s.allowance then return jsonb_build_object('error','limit');end if;
 if not s.budget_reserved then
  c:=public.piskou_chat_claim(p_id,p_selection,p_budget,p_message);
  if c ? 'error' then return c;end if;
  update public.piskou_chat_sessions set lease=null,lease_until=null where id=p_id;
 end if;
 if p_reply_to is not null and not exists(select 1 from jsonb_array_elements(s.messages) m where m->>'id'=p_reply_to::text and not coalesce((m->>'deleted')::boolean,false)) then p_reply_to:=null;end if;
 select * into aud from public.piskou_chat_audio where chat_id=p_id and message_id=p_message and ready;
 new_message:=jsonb_strip_nulls(jsonb_build_object('id',p_message,'role','user','text',case when aud.ready then aud.transcript else trim(p_text) end,'sentAt',clock_timestamp(),'state','sent','responseState','pending','charged',false,'replyTo',p_reply_to,'timeZone',p_timezone,'audio',case when aud.ready then jsonb_build_object('mime',aud.mime) else null end));
 first_at:=coalesce(s.queue_first,clock_timestamp());
 due:=least(first_at+interval '3 seconds',clock_timestamp()+greatest(0,least(coalesce(p_window_ms,1500),3000))*interval '1 millisecond');
 -- One automatic regeneration for a complementary send; further sends remain a following turn.
 if s.lease_until>now() and s.queue_regenerations=0 then
  select coalesce(jsonb_agg(case when x->>'responseState'='generating' then (x-'generation')||jsonb_build_object('responseState','pending') else x end order by ord),'[]') into s.messages from jsonb_array_elements(s.messages) with ordinality t(x,ord);
  update public.piskou_chat_sessions set lease=null,lease_until=null,queue_generation=queue_generation+1,queue_regenerations=1 where id=p_id;
 end if;
 update public.piskou_chat_sessions set messages=s.messages||jsonb_build_array(new_message),queue_first=first_at,queue_due=due,queue_revision=queue_revision+1,expires_at=now()+interval '90 days' where id=p_id;
 return public.piskou_chat_snapshot(p_id);
end $$;

create function public.piskou_chat_process_claim(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; users jsonb; history jsonb; gen integer;
begin
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if not found or s.queue_due is null or s.queue_due>clock_timestamp() or s.lease_until>clock_timestamp() then return null;end if;
 -- Recover abandoned leases: do not charge or lose persisted messages.
 gen:=s.queue_generation+1;
 select coalesce(jsonb_agg(m order by ord),'[]') into users from jsonb_array_elements(s.messages) with ordinality t(m,ord)
 where m->>'role'='user' and m->>'responseState' in ('pending','generating') and not coalesce((m->>'deleted')::boolean,false);
 if jsonb_array_length(users)=0 then update public.piskou_chat_sessions set queue_due=null,queue_first=null,lease=null,lease_until=null where id=p_id;return null;end if;
 if not s.unlimited and public.piskou_user_message_count(s.messages)+jsonb_array_length(users)>s.allowance then
  select jsonb_agg(case when m->>'responseState' in ('pending','generating') then m||jsonb_build_object('responseState','failed','generation',gen,'responseError','É necessário liberar acesso para continuar.') else m end order by ord) into s.messages from jsonb_array_elements(s.messages) with ordinality t(m,ord);
  update public.piskou_chat_sessions set messages=s.messages,queue_due=null,queue_first=null,lease=null,lease_until=null,queue_revision=queue_revision+1 where id=p_id;
  return null;
 end if;

 select coalesce(jsonb_agg(m order by ord),'[]') into history from jsonb_array_elements(s.messages) with ordinality t(m,ord)
 where not coalesce((m->>'deleted')::boolean,false) and not coalesce((m->>'contextInvalidated')::boolean,false) and (m->>'role'='character' or not m ? 'charged' or m->>'charged'='true');
 select coalesce(jsonb_agg(case when m->>'role'='user' and m->>'responseState' in ('pending','generating') and not coalesce((m->>'deleted')::boolean,false) then (m-'responseError')||jsonb_build_object('state','viewed','viewedAt',coalesce(m->'viewedAt',to_jsonb(clock_timestamp())),'responseState','generating','generation',gen) else m end order by ord),'[]') into s.messages from jsonb_array_elements(s.messages) with ordinality t(m,ord);
 update public.piskou_chat_sessions set messages=s.messages,lease=p_lease,lease_until=now()+interval '90 seconds',queue_generation=gen,queue_due=now()+interval '90 seconds',queue_revision=queue_revision+1 where id=p_id;
 return jsonb_build_object('selection',s.selection,'history',history,'users',users,'generation',gen,'turn',public.piskou_user_message_count(s.messages),'sourceHistory',s.messages);
end $$;
create function public.piskou_chat_generation_current(p_id uuid,p_lease uuid,p_generation integer) returns boolean
language sql security invoker set search_path='' as $$
 select exists(select 1 from public.piskou_chat_sessions where id=p_id and lease=p_lease and queue_generation=p_generation and lease_until>now());
$$;

create function public.piskou_chat_process_finish(p_id uuid,p_lease uuid,p_generation integer,p_reply text,p_media jsonb,p_offer text,p_memory_before jsonb,p_memory_next jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; pending boolean; answer jsonb;
begin
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if not found or s.lease is distinct from p_lease or s.queue_generation<>p_generation or s.lease_until<=now() then return jsonb_build_object('canceled',true);end if;
 if not s.unlimited and public.piskou_user_message_count(s.messages)+(select count(*) from jsonb_array_elements(s.messages) m where m->>'generation'=p_generation::text and m->>'responseState'='generating')>s.allowance then
  perform public.piskou_chat_process_fail(p_id,p_lease,p_generation);
  return jsonb_build_object('canceled',true);
 end if;
 if p_reply is null or length(trim(p_reply))=0 then raise exception 'Empty response';end if;
 if p_media is not null and (length(p_media::text)>1500100 or p_media->>'src' not like 'data:image/jpeg;base64,%') then raise exception 'Invalid media';end if;
 select coalesce(jsonb_agg(case when m->>'generation'=p_generation::text and m->>'responseState'='generating' then (m-'responseError')||jsonb_build_object('responseState','answered','charged',true) else m end order by ord),'[]') into s.messages from jsonb_array_elements(s.messages) with ordinality t(m,ord);
 answer:=jsonb_strip_nulls(jsonb_build_object('id',p_lease,'role','character','text',p_reply,'sentAt',clock_timestamp(),'generation',p_generation,'media',p_media,'mediaRequest',p_offer));
 -- Insert the answer before messages that belong to the following turn.
 select coalesce(jsonb_agg(m order by sort),'[]') into s.messages from (
  select m,ord::numeric as sort from jsonb_array_elements(s.messages) with ordinality t(m,ord)
  union all select answer,coalesce((select max(ord) from jsonb_array_elements(s.messages) with ordinality t(m,ord) where m->>'generation'=p_generation::text),jsonb_array_length(s.messages))+.5
 ) t;
 select exists(select 1 from jsonb_array_elements(s.messages) m where m->>'responseState'='pending' and not coalesce((m->>'deleted')::boolean,false)) into pending;
 update public.piskou_chat_sessions set messages=s.messages,lease=null,lease_until=null,queue_due=case when pending then clock_timestamp() else null end,queue_first=case when pending then queue_first else null end,queue_regenerations=case when pending then queue_regenerations else 0 end,queue_revision=queue_revision+1 where id=p_id;
 if p_memory_before->>'enabled'='true' and p_memory_next->>'enabled'='true' then
  perform public.piskou_memory_commit(p_id,(p_memory_before->>'revision')::integer,p_memory_next);
 end if;
 return public.piskou_chat_snapshot(p_id);
end $$;
create function public.piskou_chat_process_fail(p_id uuid,p_lease uuid,p_generation integer) returns void
language plpgsql security invoker set search_path='' as $$
declare msgs jsonb;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id and lease=p_lease and queue_generation=p_generation for update;
 if not found then return;end if;
 select jsonb_agg(case when m->>'generation'=p_generation::text and m->>'responseState'='generating' then m||jsonb_build_object('responseState','failed','responseError','Não foi possível gerar a resposta') else m end order by ord) into msgs from public.piskou_chat_sessions s,jsonb_array_elements(s.messages) with ordinality t(m,ord) where s.id=p_id;
 update public.piskou_chat_sessions set messages=msgs,lease=null,lease_until=null,queue_due=case when exists(select 1 from jsonb_array_elements(msgs) m where m->>'responseState'='pending') then clock_timestamp() else null end,queue_first=case when exists(select 1 from jsonb_array_elements(msgs) m where m->>'responseState'='pending') then queue_first else null end,queue_revision=queue_revision+1 where id=p_id;
end $$;
create function public.piskou_chat_retry(p_id uuid,p_message uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare msgs jsonb; gen text;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id for update;
 if exists(select 1 from public.piskou_chat_sessions where id=p_id and lease_until>now()) then return public.piskou_chat_snapshot(p_id);end if;
 select m->>'generation' into gen from public.piskou_chat_sessions s,jsonb_array_elements(s.messages) m where s.id=p_id and m->>'id'=p_message::text and m->>'responseState'='failed' and not coalesce((m->>'deleted')::boolean,false);
 if gen is not null then
  select jsonb_agg(case when m->>'generation'=gen and m->>'responseState'='failed' and not coalesce((m->>'deleted')::boolean,false) then (m-'responseError')||jsonb_build_object('responseState','pending') else m end order by ord) into msgs from public.piskou_chat_sessions s,jsonb_array_elements(s.messages) with ordinality t(m,ord) where s.id=p_id;
  update public.piskou_chat_sessions set messages=msgs,queue_due=clock_timestamp(),queue_first=clock_timestamp(),queue_revision=queue_revision+1 where id=p_id;
 end if;
 return public.piskou_chat_snapshot(p_id);
end $$;

create function public.piskou_chat_delete_message(p_id uuid,p_message uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; target jsonb; msgs jsonb; source_turn integer; gen text; affected jsonb; mem jsonb; pending boolean;
begin
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.id is null then return public.piskou_chat_snapshot(p_id);end if;
 insert into public.piskou_chat_deleted_ids(chat_id,message_id) values(p_id,p_message) on conflict do nothing;
 insert into public.piskou_chat_media_deletions(object_key) select object_key from public.piskou_chat_audio where chat_id=p_id and message_id=p_message on conflict do nothing;
 delete from public.piskou_chat_audio where chat_id=p_id and message_id=p_message;
 select m into target from jsonb_array_elements(s.messages) m where m->>'id'=p_message::text;
 if target is null or target->>'deleted'='true' then return public.piskou_chat_snapshot(p_id);end if;
 gen:=target->>'generation';
 select count(*)::integer into source_turn from jsonb_array_elements(s.messages) with ordinality t(m,ord) where m->>'role'='user' and ord<=(select ord from jsonb_array_elements(s.messages) with ordinality t(m,ord) where m->>'id'=p_message::text);
 select jsonb_agg(case
  when m->>'id'=p_message::text then jsonb_build_object('id',m->'id','role',m->'role','text','','deleted',true,'sentAt',m->'sentAt','viewedAt',m->'viewedAt','state',m->'state','charged',coalesce(m->'charged',to_jsonb(m->>'role'='user')),'generation',m->'generation')
  when (gen is not null and m->>'generation'=gen or gen is null and target->>'role'='user' and ord=(select ord+1 from jsonb_array_elements(s.messages) with ordinality t2(x,ord) where x->>'id'=p_message::text)) and m->>'role'='character' then m||jsonb_build_object('contextInvalidated',true)
  when s.lease is not null and (target->>'role'='user' or target->>'responseState'='generating') and m->>'responseState'='generating' then (m-'generation')||jsonb_build_object('responseState','pending')
  else m end order by ord) into msgs from jsonb_array_elements(s.messages) with ordinality t(m,ord);
 -- Any context deletion invalidates a generation that may have read it, including an old quoted message.
 if s.lease is not null then
  select jsonb_agg(case when m->>'responseState'='generating' then (m-'generation')||jsonb_build_object('responseState','pending') else m end order by ord) into msgs from jsonb_array_elements(msgs) with ordinality t(m,ord);
 end if;
 select exists(select 1 from jsonb_array_elements(msgs) m where m->>'responseState'='pending' and not coalesce((m->>'deleted')::boolean,false)) into pending;
 update public.piskou_chat_sessions set messages=msgs,lease=null,lease_until=null,queue_generation=queue_generation+1,queue_due=case when pending then coalesce(queue_due,clock_timestamp()) else null end,queue_first=case when pending then queue_first else null end,queue_revision=queue_revision+1 where id=p_id;
 insert into public.piskou_chat_media_deletions(object_key) select object_key from public.piskou_chat_audio where chat_id=p_id and message_id=p_message on conflict do nothing;
 delete from public.piskou_chat_audio where chat_id=p_id and message_id=p_message;
 select state into mem from public.piskou_character_memory where chat_id=p_id for update;
 if mem is not null and target->>'role'='user' then
  select coalesce(jsonb_agg(f),'[]') into affected from jsonb_array_elements(mem->'facts') f where (f->'source'->>'turn')::integer=source_turn or (f->'reported'->>'sourceTurn')::integer=source_turn or (f->'eventDateSource'->>'turn')::integer=source_turn;
  mem:=mem||jsonb_build_object('facts',(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements(mem->'facts') f where (f->'source'->>'turn')::integer<>source_turn and coalesce((f->'reported'->>'sourceTurn')::integer,-1)<>source_turn and coalesce((f->'eventDateSource'->>'turn')::integer,-1)<>source_turn),'revision',(mem->>'revision')::integer+1);
  update public.piskou_character_memory set state=mem,updated_at=now() where chat_id=p_id;
 end if;
 -- Remove copies kept for commercial chat actions and advisor context that referenced this chat.
 delete from public.piskou_chat_activity where chat_id=p_id and text=target->>'text';
 update public.piskou_advisor_turns set context=null,reply=null where context::text like '%'||p_id::text||'%';
 return public.piskou_chat_snapshot(p_id)||jsonb_build_object('affectedMemory',coalesce(affected,'[]'),'memoryState',mem);
end $$;

-- Archive keeps the deletion marker, never the erased text/transcription.
create or replace function public.piskou_archive_chat() returns trigger language plpgsql security invoker set search_path='' as $$
declare cleaned jsonb;
begin
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',m->'id','role',m->'role','text',m->'text','deleted',m->'deleted','hasImage',m?'media','at',m->'sentAt','state',m->'state')) order by ord),'[]') into cleaned from jsonb_array_elements(new.messages) with ordinality t(m,ord);
 insert into public.piskou_chat_archive(id,selection,messages) values(new.id,new.selection,cleaned)
 on conflict(id) do update set selection=excluded.selection,messages=excluded.messages,updated_at=now();
 return new;
end $$;

revoke all on function public.piskou_chat_snapshot(uuid),public.piskou_chat_enqueue(uuid,jsonb,text,uuid,text,uuid,text,integer),public.piskou_chat_process_claim(uuid,uuid),public.piskou_chat_generation_current(uuid,uuid,integer),public.piskou_chat_process_finish(uuid,uuid,integer,text,jsonb,text,jsonb,jsonb),public.piskou_chat_process_fail(uuid,uuid,integer),public.piskou_chat_retry(uuid,uuid),public.piskou_chat_delete_message(uuid,uuid) from public,anon,authenticated;
grant execute on function public.piskou_chat_snapshot(uuid),public.piskou_chat_enqueue(uuid,jsonb,text,uuid,text,uuid,text,integer),public.piskou_chat_process_claim(uuid,uuid),public.piskou_chat_generation_current(uuid,uuid,integer),public.piskou_chat_process_finish(uuid,uuid,integer,text,jsonb,text,jsonb,jsonb),public.piskou_chat_process_fail(uuid,uuid,integer),public.piskou_chat_retry(uuid,uuid),public.piskou_chat_delete_message(uuid,uuid) to service_role;

alter table public.piskou_chat_audio add column lease uuid, add column lease_until timestamptz;
create function public.piskou_audio_reserve(p_id uuid,p_selection jsonb,p_message uuid,p_key text,p_mime text,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.piskou_chat_audio%rowtype; s public.piskou_chat_sessions%rowtype;
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,12,12,12) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection or exists(select 1 from public.piskou_chat_deleted_ids where chat_id=p_id and message_id=p_message) or exists(select 1 from jsonb_array_elements(s.messages) m where m->>'id'=p_message::text and m->>'deleted'='true') then return jsonb_build_object('error','unavailable');end if;
 insert into public.piskou_chat_audio(chat_id,message_id,object_key,mime) values(p_id,p_message,p_key,p_mime) on conflict do nothing;
 select * into a from public.piskou_chat_audio where chat_id=p_id and message_id=p_message for update;
 if a.ready then return jsonb_build_object('ready',true,'transcript',a.transcript);end if;
 if a.lease_until>now() then return jsonb_build_object('error','busy');end if;
 update public.piskou_chat_audio set lease=p_lease,lease_until=now()+interval '60 seconds' where chat_id=p_id and message_id=p_message;
 return jsonb_build_object('ready',false);
end $$;
create function public.piskou_audio_complete(p_id uuid,p_message uuid,p_lease uuid,p_transcript text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare mime text; msgs jsonb;
begin
 perform 1 from public.piskou_chat_sessions where id=p_id for update;
 if exists(select 1 from public.piskou_chat_sessions s,jsonb_array_elements(s.messages) m where s.id=p_id and m->>'id'=p_message::text and m->>'deleted'='true') then return false;end if;
 update public.piskou_chat_audio set ready=true,transcript=p_transcript,lease=null,lease_until=null where chat_id=p_id and message_id=p_message and lease=p_lease returning piskou_chat_audio.mime into mime;
 if not found then return false;end if;
 select jsonb_agg(case when m->>'id'=p_message::text then m||jsonb_build_object('audio',jsonb_build_object('mime',mime)) else m end order by ord) into msgs from public.piskou_chat_sessions s,jsonb_array_elements(s.messages) with ordinality t(m,ord) where s.id=p_id;
 if msgs is not null then update public.piskou_chat_sessions set messages=msgs,queue_revision=queue_revision+1 where id=p_id;end if;
 return true;
end $$;
create function public.piskou_audio_fail(p_id uuid,p_message uuid,p_lease uuid) returns void
language sql security invoker set search_path='' as $$
 update public.piskou_chat_audio set lease=null,lease_until=null where chat_id=p_id and message_id=p_message and lease=p_lease;
$$;
create function public.piskou_audio_remove() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.piskou_chat_media_deletions(object_key) values(old.object_key) on conflict do nothing;
 return old;
end $$;
create trigger piskou_audio_remove before delete on public.piskou_chat_audio for each row execute function public.piskou_audio_remove();
revoke all on function public.piskou_audio_reserve(uuid,jsonb,uuid,text,text,uuid),public.piskou_audio_complete(uuid,uuid,uuid,text),public.piskou_audio_fail(uuid,uuid,uuid),public.piskou_audio_remove() from public,anon,authenticated;
grant execute on function public.piskou_audio_reserve(uuid,jsonb,uuid,text,text,uuid),public.piskou_audio_complete(uuid,uuid,uuid,text),public.piskou_audio_fail(uuid,uuid,uuid),public.piskou_audio_remove() to service_role;
-- Storage is present on Supabase; absent in the isolated SQL test database.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $bucket$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chat-audio','chat-audio',false,2097152,array['audio/webm','audio/mp4','audio/ogg','audio/mpeg']) on conflict(id) do nothing$bucket$;
 end if;
end $$;
create function public.piskou_media_deletion_done(p_key text) returns void language sql security invoker set search_path='' as $$
 delete from public.piskou_chat_media_deletions where object_key=p_key and created_at<now()-interval '5 minutes';
$$;
revoke all on function public.piskou_media_deletion_done(text) from public,anon,authenticated;
grant execute on function public.piskou_media_deletion_done(text) to service_role;

create function public.piskou_chat_initialize(p_id uuid,p_selection jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,12,12,12) on conflict do nothing;
 return public.piskou_chat_snapshot(p_id);
end $$;
revoke all on function public.piskou_chat_initialize(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.piskou_chat_initialize(uuid,jsonb) to service_role;

create index piskou_audio_created on public.piskou_chat_audio(created_at);
create function public.piskou_chat_cleanup() returns void language plpgsql security invoker set search_path='' as $$
begin
 delete from public.piskou_chat_audio a where a.created_at<now()-interval '24 hours'
 and not exists(select 1 from public.piskou_chat_sessions s,jsonb_array_elements(s.messages) m where s.id=a.chat_id and m->>'id'=a.message_id::text and not coalesce((m->>'deleted')::boolean,false));
 delete from public.piskou_chat_sessions where expires_at<now();
 delete from public.piskou_chat_budgets where expires_at<now();
end $$;
revoke all on function public.piskou_chat_cleanup() from public,anon,authenticated;
grant execute on function public.piskou_chat_cleanup() to service_role;
