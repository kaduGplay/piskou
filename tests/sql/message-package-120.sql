-- All fixtures are rolled back. Verify credits, historical orders and admin revocation.
begin;
do $$ declare sid uuid:=gen_random_uuid(); sel jsonb:='{"name":"Teste pacote","age":25}'; v jsonb; i integer; l uuid; begin
 perform public.piskou_store_set('charge:test-package-initial',jsonb_build_object('chatId',sid,'selection',sel,'planId','premium-access','status','paid'));
 perform public.piskou_chat_grant(sid,'test-package-initial');
 for i in 1..6 loop l:=gen_random_uuid();perform public.piskou_chat_claim(sid,sel,'test',l);perform public.piskou_chat_finish_media(sid,l,'Oi','Olá',null);end loop;
 perform public.piskou_store_set('charge:test-package-120',jsonb_build_object('chatId',sid,'selection',sel,'planId','messages-120','status','paid'));
 perform public.piskou_chat_grant(sid,'test-package-120');
 perform public.piskou_chat_grant(sid,'test-package-120');
 v:=public.piskou_chat_access(sid);
 if (v->>'remaining')::integer<>120 then raise exception 'Expected 120: %',v;end if;
 for i in 1..120 loop l:=gen_random_uuid();v:=public.piskou_chat_claim(sid,sel,'test',l);if v ? 'error' then raise exception 'Premature limit';end if;perform public.piskou_chat_finish_media(sid,l,'Oi','Olá',null);end loop;
 v:=public.piskou_chat_claim(sid,sel,'test',gen_random_uuid());if v->>'error'<>'limit' then raise exception 'Missing limit';end if;
 perform public.piskou_admin_transaction_update('test-package-120','pending','undo',0);
 if (select allowance from public.piskou_chat_sessions where id=sid)<>6 then raise exception 'Revocation incorrect';end if;
 perform public.piskou_admin_transaction_update('test-package-120','paid','restore',1);
 if (select allowance from public.piskou_chat_sessions where id=sid)<>126 then raise exception 'Restore incorrect';end if;
 perform public.piskou_store_set('charge:test-package-legacy',jsonb_build_object('chatId',sid,'selection',sel,'planId','messages-six','status','paid'));
 perform public.piskou_chat_grant(sid,'test-package-legacy');
 if (select allowance from public.piskou_chat_sessions where id=sid)<>132 then raise exception 'Legacy changed';end if;
 perform public.piskou_store_set('charge:test-package-unlimited',jsonb_build_object('chatId',sid,'selection',sel,'planId','messages-unlimited','status','paid'));
 perform public.piskou_chat_grant(sid,'test-package-unlimited');
 if not (select unlimited from public.piskou_chat_sessions where id=sid) then raise exception 'Unlimited lost';end if;
 if has_function_privilege('anon','public.piskou_chat_grant(uuid,text)','execute') then raise exception 'Public grant';end if;
end $$;
rollback;
