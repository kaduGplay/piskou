begin;
do $$ declare sid uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); sel jsonb:='{"name":"Lia","age":25}'; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); stale uuid; snap jsonb; job jsonb; gen integer; v jsonb; begin
 update public.piskou_chat_budgets set requests=0 where key='global:'||current_date::text;
 snap:=public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,a,'Tenho uma entrevista',null,'America/Sao_Paulo',1500);
 if snap->'messages'->0->>'state'<>'sent' or snap->'messages'->0 ? 'viewedAt' then raise exception 'Fake viewed event';end if;
 if snap->'messages'->0->>'sentAt' is null then raise exception 'No server confirmation time';end if;
 if (snap->>'remaining')::integer<>7 then raise exception 'Charged before answer';end if;
 if public.piskou_chat_process_claim(sid,l) is not null then raise exception 'Processing before deadline';end if;
 snap:=public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,a,'Duplicate',null,'America/Sao_Paulo',1500);
 if jsonb_array_length(snap->'messages')<>1 then raise exception 'Duplicate send';end if;
 perform public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,b,'Amanhã',a,'America/Sao_Paulo',1500);
 snap:=public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,c,'E estou preparando o currículo',null,'America/Sao_Paulo',1500);
 if (select queue_due>queue_first+interval '3 seconds' from public.piskou_chat_sessions where id=sid) then raise exception 'Unbounded window';end if;
 update public.piskou_chat_sessions set queue_due=clock_timestamp()-interval '1 second' where id=sid;
 job:=public.piskou_chat_process_claim(sid,l);gen:=(job->>'generation')::integer;
 if jsonb_array_length(job->'users')<>3 then raise exception 'Fragments not grouped';end if;
 snap:=public.piskou_chat_snapshot(sid);
 if snap->'messages'->0->>'viewedAt' is null or snap->>'preparing'<>'true' then raise exception 'Missing processing event';end if;
 if public.piskou_chat_process_claim(sid,gen_random_uuid()) is not null then raise exception 'Concurrent uncontrolled generation';end if;
 snap:=public.piskou_chat_process_finish(sid,l,gen,'Vamos considerar a entrevista de amanhã e o currículo.',null,null,null,null);
 if jsonb_array_length(snap->'messages')<>4 or (snap->>'remaining')::integer<>4 then raise exception 'Grouped accounting incorrect';end if;
 if public.piskou_chat_process_finish(sid,l,gen,'Duplicate',null,null,null,null)->>'canceled'<>'true' then raise exception 'Duplicate answer';end if;
 -- Delete after response: credit stays consumed; answer remains; citation only stores reference.
 snap:=public.piskou_chat_delete_message(sid,a);
 if (snap->>'remaining')::integer<>4 or snap->'messages'->0->>'text'<>'' or snap->'messages'->3->>'text' is null then raise exception 'Post-response deletion incorrect';end if;
 if exists(select 1 from public.piskou_chat_archive x,jsonb_array_elements(x.messages) m where x.id=sid and m->>'text'='Tenho uma entrevista') then raise exception 'Archive retained deleted text';end if;
 snap:=public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,a,'Resurrected',null,'America/Sao_Paulo',1500);
 if snap->'messages'->0->>'text'<>'' then raise exception 'Deleted id resurrected';end if;
 -- During generation deletion invalidates old lease; only surviving content may regenerate.
 perform public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,d,'Outro assunto',b,'America/Sao_Paulo',0);
 l:=gen_random_uuid();job:=public.piskou_chat_process_claim(sid,l);gen:=(job->>'generation')::integer;
 perform public.piskou_chat_delete_message(sid,d);
 if public.piskou_chat_process_finish(sid,l,gen,'Old forbidden reply',null,null,null,null)->>'canceled'<>'true' then raise exception 'Canceled response resurfaced';end if;
 if (public.piskou_chat_snapshot(sid)->>'remaining')::integer<>4 then raise exception 'Canceled generation charged';end if;
 -- A deletion that arrives before a delayed enqueue creates an id tombstone.
 d:=gen_random_uuid();perform public.piskou_chat_delete_message(sid,d);
 snap:=public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,d,'Late request',null,'America/Sao_Paulo',0);
 if exists(select 1 from jsonb_array_elements(snap->'messages') m where m->>'text'='Late request') then raise exception 'Late request resurrected deleted content';end if;
 -- Complementary send invalidates one candidate, then further sends are next turn.
 d:=gen_random_uuid();perform public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,d,'Primeira parte',null,'America/Sao_Paulo',0);
 l:=gen_random_uuid();job:=public.piskou_chat_process_claim(sid,l);gen:=(job->>'generation')::integer;
 a:=gen_random_uuid();perform public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,a,'Complemento',null,'America/Sao_Paulo',0);
 if public.piskou_chat_process_finish(sid,l,gen,'Stale incomplete answer',null,null,null,null)->>'canceled'<>'true' then raise exception 'Incomplete context answer committed';end if;
 l:=gen_random_uuid();job:=public.piskou_chat_process_claim(sid,l);gen:=(job->>'generation')::integer;
 if jsonb_array_length(job->'users')<>2 then raise exception 'Complement missing';end if;
 b:=gen_random_uuid();perform public.piskou_chat_enqueue(sid,sel,'continuity-'||sid,b,'Próximo turno',null,'America/Sao_Paulo',0);
 snap:=public.piskou_chat_process_finish(sid,l,gen,'Resposta às duas partes',null,null,null,null);
 if (snap->>'remaining')::integer<>2 or snap->'messages'->-1->>'text'<>'Próximo turno' then raise exception 'Following message lost or charged too soon';end if;
 l:=gen_random_uuid();job:=public.piskou_chat_process_claim(sid,l);gen:=(job->>'generation')::integer;
 perform public.piskou_chat_process_fail(sid,l,gen);
 snap:=public.piskou_chat_snapshot(sid);
 if snap->'messages'->-1->>'state'<>'viewed' or snap->'messages'->-1->>'responseState'<>'failed' or (snap->>'remaining')::integer<>2 then raise exception 'Generation error mislabeled send failure/charged';end if;
 perform public.piskou_chat_retry(sid,b);l:=gen_random_uuid();job:=public.piskou_chat_process_claim(sid,l);
 snap:=public.piskou_chat_process_finish(sid,l,(job->>'generation')::integer,'Recovered answer',null,null,null,null);
 if (snap->>'remaining')::integer<>1 then raise exception 'Retry accounting incorrect';end if;
 -- Account isolation and security.
 perform public.piskou_chat_initialize(other,sel);
 if jsonb_array_length(public.piskou_chat_snapshot(other)->'messages')<>0 then raise exception 'Cross-session leak';end if;
 if has_table_privilege('anon','public.piskou_chat_deleted_ids','select') or has_function_privilege('authenticated','public.piskou_chat_delete_message(uuid,uuid)','execute') then raise exception 'Private state exposed';end if;
end $$;
rollback;
