begin;
do $$ declare sid uuid:=gen_random_uuid();sel jsonb:='{"name":"Lia","age":25}';a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();l uuid:=gen_random_uuid();gen integer;mem_state jsonb;snap jsonb;job jsonb;audio_key text; begin
 update public.piskou_chat_budgets set requests=0 where key='global:'||current_date::text;
 perform public.piskou_chat_initialize(sid,sel);
 mem_state:=public.piskou_memory_settings(sid,sel,'toggle',null,true,0)->'state';
 perform public.piskou_chat_enqueue(sid,sel,'memory-audio-'||sid,a,'Tenho uma entrevista amanhã.',null,'America/Sao_Paulo',0);
 job:=public.piskou_chat_process_claim(sid,l);gen:=(job->>'generation')::integer;
 mem_state:=mem_state||jsonb_build_object('processedThrough',1,'facts',jsonb_build_array(jsonb_build_object('key','topic:interview','kind','open_topic','value','Entrevista','source',jsonb_build_object('turn',1),'reported',jsonb_build_object('sourceTurn',1),'status','open','revisit','allowed')));
 perform public.piskou_chat_process_finish(sid,l,gen,'Entendi.',null,null,jsonb_build_object('enabled',true,'revision',1),mem_state);
 if jsonb_array_length((select state->'facts' from public.piskou_character_memory where chat_id=sid))<>1 then raise exception 'Topic not committed';end if;
 snap:=public.piskou_chat_delete_message(sid,a);
 if jsonb_array_length(snap->'memoryState'->'facts')<>0 then raise exception 'Deletion left derived topic';end if;
 if public.piskou_memory_commit(sid,1,mem_state) then raise exception 'Late topic restored after deletion';end if;
 -- Delete exactly before/after the claim boundary: only one can own valid generation.
 perform public.piskou_chat_enqueue(sid,sel,'memory-audio-'||sid,b,'Apagar no início.',null,'America/Sao_Paulo',0);
 perform public.piskou_chat_delete_message(sid,b);
 if public.piskou_chat_process_claim(sid,gen_random_uuid()) is not null then raise exception 'Deleted content dispatched';end if;
 b:=gen_random_uuid();audio_key:=sid||'/'||b||'.webm';l:=gen_random_uuid();
 perform public.piskou_audio_reserve(sid,sel,b,audio_key,'audio/webm',l);
 if not public.piskou_audio_complete(sid,b,l,'Áudio transcrito.') then raise exception 'Audio not saved';end if;
 snap:=public.piskou_chat_enqueue(sid,sel,'memory-audio-'||sid,b,'Wrong client transcript',null,'America/Sao_Paulo',0);
 if snap->'messages'->-1->>'text'<>'Áudio transcrito.' then raise exception 'Audio transcript detached from message';end if;
 snap:=public.piskou_chat_delete_message(sid,b);
 if exists(select 1 from public.piskou_chat_audio where chat_id=sid and message_id=b) then raise exception 'Deleted audio transcript retained';end if;
 if not exists(select 1 from public.piskou_chat_media_deletions where object_key=audio_key) then raise exception 'File deletion not durable';end if;
 if public.piskou_audio_complete(sid,b,l,'Late transcript') then raise exception 'Canceled audio resurrected';end if;
 -- Clearing/disable keep the user's deletion watermark and reject stale generations.
 mem_state:=(select state from public.piskou_character_memory where chat_id=sid);
 perform public.piskou_memory_settings(sid,sel,'clear',null,null,(mem_state->>'revision')::integer);
 if public.piskou_memory_commit(sid,(mem_state->>'revision')::integer,mem_state) then raise exception 'Clear allowed stale restoration';end if;
end $$;
rollback;
