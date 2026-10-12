begin;
do $$ declare a uuid:='11000000-0000-4000-8000-000000000001'; b uuid:='11000000-0000-4000-8000-000000000002'; sel jsonb:='{"name":"Lia","age":25}'; v jsonb; ok boolean; begin
 v:=public.piskou_memory_settings(a,sel,'toggle',null,true,0);
 if not (v->'state'->>'enabled')::boolean then raise exception 'Consent failed';end if;
 if (select allowance from public.piskou_chat_sessions where id=a)<>7 then raise exception 'Business rule changed';end if;
 -- A stale generation cannot restore a deleted memory.
 perform public.piskou_memory_settings(a,sel,'clear',null,null,1);
 ok:=public.piskou_memory_commit(a,1,jsonb_build_object('enabled',true,'facts','[]'::jsonb,'processedThrough',0));
 if ok then raise exception 'Stale commit accepted';end if;
 v:=public.piskou_memory_settings(a,'{"name":"Outra","age":25}'::jsonb,'clear',null,null,2);
 if v->>'error'<>'selection_changed' then raise exception 'Cross-character access';end if;
 perform public.piskou_memory_settings(b,sel,'toggle',null,true,0);
 ok:=public.piskou_memory_commit(a,2,'{"version":1,"enabled":true,"processedThrough":0,"facts":[{"key":"user:name","kind":"user_fact","value":"Bruno","source":{"role":"user","turn":1,"quote":"Me chamo Bruno"}}]}'::jsonb);
 if not ok then raise exception 'Commit failed';end if;
 if jsonb_array_length((select state->'facts' from public.piskou_character_memory where chat_id=b))<>0 then raise exception 'Cross-session leak';end if;
 perform public.piskou_memory_settings(a,sel,'delete','user:name',null,3);
 if jsonb_array_length((select state->'facts' from public.piskou_character_memory where chat_id=a))<>0 then raise exception 'Delete failed';end if;
 perform public.piskou_memory_settings(a,sel,'toggle',null,false,4);
 ok:=public.piskou_memory_commit(a,5,'{"enabled":true,"facts":[],"processedThrough":0}'::jsonb);
 if ok then raise exception 'Disabled memory wrote facts';end if;
 if has_table_privilege('anon','public.piskou_character_memory','select') or has_function_privilege('authenticated','public.piskou_memory_settings(uuid,jsonb,text,text,boolean,integer)','execute') then raise exception 'Public access';end if;
end $$;
rollback;
