begin;
do $$ declare obj record; begin
 for obj in select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('piskou_chat_audio','piskou_chat_deleted_ids','piskou_chat_media_deletions') loop
  if not obj.relrowsecurity or has_table_privilege('anon',obj.oid,'select') or has_table_privilege('authenticated',obj.oid,'select') then raise exception 'Table exposed: %',obj.relname;end if;
 end loop;
 for obj in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('piskou_user_message_count','piskou_chat_snapshot','piskou_chat_enqueue','piskou_chat_process_claim','piskou_chat_generation_current','piskou_chat_process_finish','piskou_chat_process_fail','piskou_chat_retry','piskou_chat_delete_message','piskou_audio_reserve','piskou_audio_complete','piskou_audio_fail','piskou_chat_initialize','piskou_chat_cleanup','piskou_memory_commit','piskou_memory_settings') loop
  if obj.prosecdef or has_function_privilege('anon',obj.oid,'execute') or has_function_privilege('authenticated',obj.oid,'execute') then raise exception 'Function exposed: %',obj.proname;end if;
  if obj.proconfig is null then raise exception 'Missing fixed search_path: %',obj.proname;end if;
 end loop;
end $$;
rollback;
