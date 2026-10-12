begin;
do $$ declare a uuid:='22000000-0000-4000-8000-000000000001'; b uuid:='22000000-0000-4000-8000-000000000002'; sel jsonb:='{"name":"Lia","age":25}'; config jsonb:='{"personality":"Brava","musicTaste":"Rock"}'; result jsonb; before_allowance integer; begin
 insert into public.piskou_chat_sessions(id,selection,allowance,trial_allowance,credit_base) values(a,sel,7,7,7),(b,sel,7,7,7);
 result:=public.piskou_character_preferences(a,sel,config,'{"music":{"preferred":"Rock"}}');
 if result->'preferences'->'music'->>'preferred'<>'Rock' then raise exception 'Initial tastes missing';end if;
 -- A later call with newly generated defaults cannot replace saved tastes for an unchanged configuration.
 result:=public.piskou_character_preferences(a,sel,config,'{"music":{"preferred":"Sertanejo"}}');
 if result->'preferences'->'music'->>'preferred'<>'Rock' then raise exception 'Tastes regenerated';end if;
 if exists(select 1 from public.piskou_character_preferences where chat_id=b) then raise exception 'Session leak';end if;
 result:=public.piskou_character_preferences(a,'{"name":"Outra"}',config,'{}');
 if result->>'error'<>'selection_changed' then raise exception 'Cross-character update';end if;
 result:=public.piskou_character_preferences(a,sel,'{"personality":"Brava","musicTaste":"MPB"}','{"music":{"preferred":"MPB"}}');
 if result->'preferences'->'music'->>'preferred'<>'MPB' then raise exception 'Explicit edit ignored';end if;
 -- Clearing/disabling user memory has no effect on fictional preferences.
 perform public.piskou_memory_settings(a,sel,'toggle',null,false,0);
 if (select preferences->'music'->>'preferred' from public.piskou_character_preferences where chat_id=a)<>'MPB' then raise exception 'Memory changed tastes';end if;
 if (select allowance from public.piskou_chat_sessions where id=a)<>7 then raise exception 'Billing changed';end if;
 if has_table_privilege('anon','public.piskou_character_preferences','select') or has_table_privilege('authenticated','public.piskou_character_preferences','update') or has_function_privilege('anon','public.piskou_character_preferences(uuid,jsonb,jsonb,jsonb)','execute') then raise exception 'Public access';end if;
 if public.piskou_character_preferences(a,sel,'[]','{}')->>'error'<>'invalid' then raise exception 'Invalid configuration accepted';end if;
end $$;
rollback;
