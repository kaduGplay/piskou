begin;
do $$ declare sid uuid:=gen_random_uuid(); sel jsonb:='{"name":"Teste grátis","age":25}'; v jsonb; i integer; l uuid; begin
 -- Isolate preview budgets without changing live counters after rollback.
 update public.piskou_chat_budgets set requests=0 where key='global:'||current_date::text;
 v:=public.piskou_chat_access(sid);
 if (v->>'remaining')::integer<>12 or (v->>'requiresPayment')::boolean then raise exception 'New chat blocked';end if;
 for i in 1..12 loop l:=gen_random_uuid();v:=public.piskou_chat_claim(sid,sel,'test-free-'||sid,l);if v ? 'error' then raise exception 'Free reply blocked: %',v;end if;perform public.piskou_chat_finish_media(sid,l,'Oi','Olá',null);end loop;
 v:=public.piskou_chat_access(sid);
 if (v->>'remaining')::integer<>0 or (v->>'hasPaidAccess')::boolean then raise exception 'Free access incorrect';end if;
 v:=public.piskou_chat_claim(sid,sel,'test-free-'||sid,gen_random_uuid());if v->>'error'<>'limit' then raise exception 'Thirteenth allowed';end if;
 perform public.piskou_store_set('charge:test-free-initial',jsonb_build_object('chatId',sid,'selection',sel,'planId','premium-access','status','pending'));
 perform public.piskou_admin_transaction_update('test-free-initial','paid','test',0);
 v:=public.piskou_chat_access(sid);
 if (v->>'remaining')::integer<>6 or not (v->>'hasPaidAccess')::boolean then raise exception 'Payment did not unlock';end if;
 perform public.piskou_chat_grant(sid,'test-free-initial');
 if (select allowance from public.piskou_chat_sessions where id=sid)<>18 then raise exception 'Duplicate credits';end if;
 perform public.piskou_admin_transaction_update('test-free-initial','pending','undo',1);
 if (select allowance from public.piskou_chat_sessions where id=sid)<>12 then raise exception 'Free credits lost';end if;
 perform public.piskou_admin_transaction_update('test-free-initial','paid','restore',2);
 perform public.piskou_store_set('charge:test-free-topup',jsonb_build_object('chatId',sid,'selection',sel,'planId','messages-120','status','paid'));
 perform public.piskou_chat_grant(sid,'test-free-topup');
 v:=public.piskou_chat_access(sid);if (v->>'remaining')::integer<>126 then raise exception 'Topup lost';end if;
 v:=public.piskou_analytics_report(1);if v->'funnel'->8->>'label'<>'Entrou no chat' then raise exception 'Wrong funnel order';end if;
end $$;
rollback;
