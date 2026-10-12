-- Seven free messages; retain credits already purchased by paid sessions.
alter table public.piskou_chat_sessions drop constraint piskou_chat_sessions_trial_allowance_check;
update public.piskou_chat_sessions s
set trial_allowance=7,
    allowance=case when not exists(select 1 from public.piskou_chat_purchases p where p.chat_id=s.id and p.active) then 7 else allowance end,
    credit_base=case when not exists(select 1 from public.piskou_chat_purchases p where p.chat_id=s.id and p.active) then 7 else credit_base end
where trial_allowance=12;
alter table public.piskou_chat_sessions add constraint piskou_chat_sessions_trial_allowance_check check(trial_allowance in (0,7));

create or replace function public.piskou_chat_claim(p_id uuid,p_selection jsonb,p_budget text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; n integer; k text; lim integer;
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,7,7,7) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection then return jsonb_build_object('error','selection_changed'); end if;
 if s.allowance=0 and not s.unlimited then return jsonb_build_object('error','payment_required','messages',s.messages);end if;
 if not s.unlimited and public.piskou_user_message_count(s.messages)>=s.allowance then return jsonb_build_object('error','limit','messages',s.messages); end if;
 if s.lease_until>now() or exists(select 1 from jsonb_array_elements(s.messages) m where m->>'responseState' in ('pending','generating') and not coalesce((m->>'deleted')::boolean,false)) then return jsonb_build_object('error','busy'); end if;
 if s.trial_allowance=7 and not s.budget_reserved then
  foreach k in array array['global:'||current_date::text,p_budget||':'||current_date::text] loop
   lim:=case when k like 'global:%' then 1000 else 120 end;
   insert into public.piskou_chat_budgets(key,expires_at) values(k,now()+interval '2 days') on conflict do nothing;
   select requests into n from public.piskou_chat_budgets where key=k for update;
   if n+7>lim then return jsonb_build_object('error','rate');end if;
  end loop;
  update public.piskou_chat_budgets set requests=requests+7 where key in ('global:'||current_date::text,p_budget||':'||current_date::text);
  update public.piskou_chat_sessions set budget_reserved=true where id=p_id;
 end if;
 update public.piskou_chat_sessions set expires_at=now()+interval '90 days',lease=p_lease,lease_until=now()+interval '90 seconds' where id=p_id;
 return jsonb_build_object('messages',s.messages,'turn',public.piskou_user_message_count(s.messages),'allowance',s.allowance,'unlimited',s.unlimited);
end $$;

create or replace function public.piskou_chat_finish_media(p_id uuid, p_lease uuid, p_user text, p_reply text, p_media jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.piskou_chat_sessions%rowtype;
begin
  select * into s from public.piskou_chat_sessions where id=p_id for update;
  if not found or s.lease is distinct from p_lease then raise exception 'Chat lease invalid'; end if;
  if p_media is not null and (length(p_media::text) > 6000100 or p_media->>'src' not like 'data:image/jpeg;base64,%') then
    raise exception 'Invalid media';
  end if;
  s.messages := s.messages || jsonb_build_array(jsonb_build_object('role','user','text',p_user),jsonb_strip_nulls(jsonb_build_object('role','character','text',p_reply,'media',p_media)));
  update public.piskou_chat_sessions set messages=s.messages,lease=null,lease_until=null where id=p_id;
  return s.messages;
end;
$$;

create or replace function public.piskou_chat_access(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
select coalesce((select jsonb_build_object('remaining',case when unlimited then null else greatest(0,allowance-public.piskou_user_message_count(messages)) end,'unlimited',unlimited,'requiresPayment',allowance=0 and not unlimited,'hasPaidAccess',unlimited or allowance>trial_allowance) from public.piskou_chat_sessions where id=p_id),jsonb_build_object('remaining',7,'unlimited',false,'requiresPayment',false,'hasPaidAccess',false));
$$;

create or replace function public.piskou_memory_settings(p_id uuid,p_selection jsonb,p_action text,p_key text,p_enabled boolean,p_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; m jsonb; next_facts jsonb; rev integer;
begin
 if p_action not in ('toggle','clear','delete') or p_revision is null or p_revision<0 then return jsonb_build_object('error','invalid');end if;
 if p_action='toggle' and p_enabled is null then return jsonb_build_object('error','invalid');end if;
 if p_action='delete' and (p_key is null or length(p_key)>80) then return jsonb_build_object('error','invalid');end if;
 -- Consent can be set before the first message; free rounds are still budgeted by chat_claim.
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base)
 values(p_id,p_selection,7,7,7) on conflict do nothing;
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

create or replace function public.piskou_chat_snapshot(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce((select jsonb_build_object('deletedIds',(select coalesce(jsonb_agg(message_id),'[]') from public.piskou_chat_deleted_ids where chat_id=p_id),'messages',messages,'conversationId',p_id,'selection',selection,'revision',queue_revision,
 'remaining',case when unlimited then null else greatest(0,allowance-public.piskou_user_message_count(messages)) end,
 'requiresPayment',allowance=0 and not unlimited,'hasPaidAccess',unlimited or allowance>trial_allowance,
 'preparing',lease_until>now(),'dueAt',queue_due,'serverTime',clock_timestamp())
 from public.piskou_chat_sessions where id=p_id),jsonb_build_object('messages','[]'::jsonb,'conversationId',p_id,'remaining',7,'revision',0,'preparing',false,'serverTime',clock_timestamp()));
$$;

create or replace function public.piskou_chat_enqueue(p_id uuid,p_selection jsonb,p_budget text,p_message uuid,p_text text,p_reply_to uuid,p_timezone text,p_window_ms integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.piskou_chat_sessions%rowtype; c jsonb; first_at timestamptz; due timestamptz; new_message jsonb; aud public.piskou_chat_audio%rowtype; queued integer;
begin
 if p_message is null or p_text is null or length(trim(p_text)) not between 1 and 500 then return jsonb_build_object('error','invalid');end if;
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,7,7,7) on conflict do nothing;
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

create or replace function public.piskou_chat_process_finish(p_id uuid,p_lease uuid,p_generation integer,p_reply text,p_media jsonb,p_offer text,p_memory_before jsonb,p_memory_next jsonb) returns jsonb
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
 if p_media is not null and (length(p_media::text)>6000100 or p_media->>'src' not like 'data:image/jpeg;base64,%') then raise exception 'Invalid media';end if;
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

create or replace function public.piskou_audio_reserve(p_id uuid,p_selection jsonb,p_message uuid,p_key text,p_mime text,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.piskou_chat_audio%rowtype; s public.piskou_chat_sessions%rowtype;
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,7,7,7) on conflict do nothing;
 select * into s from public.piskou_chat_sessions where id=p_id for update;
 if s.selection<>p_selection or exists(select 1 from public.piskou_chat_deleted_ids where chat_id=p_id and message_id=p_message) or exists(select 1 from jsonb_array_elements(s.messages) m where m->>'id'=p_message::text and m->>'deleted'='true') then return jsonb_build_object('error','unavailable');end if;
 insert into public.piskou_chat_audio(chat_id,message_id,object_key,mime) values(p_id,p_message,p_key,p_mime) on conflict do nothing;
 select * into a from public.piskou_chat_audio where chat_id=p_id and message_id=p_message for update;
 if a.ready then return jsonb_build_object('ready',true,'transcript',a.transcript);end if;
 if a.lease_until>now() then return jsonb_build_object('error','busy');end if;
 update public.piskou_chat_audio set lease=p_lease,lease_until=now()+interval '60 seconds' where chat_id=p_id and message_id=p_message;
 return jsonb_build_object('ready',false);
end $$;

create or replace function public.piskou_chat_initialize(p_id uuid,p_selection jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(p_id,p_selection,7,7,7) on conflict do nothing;
 return public.piskou_chat_snapshot(p_id);
end $$;
