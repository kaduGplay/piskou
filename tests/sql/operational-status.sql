-- Run after migrations in a test database; all fixture changes are rolled back.
begin;

do $$ declare sid uuid:=gen_random_uuid(); sel jsonb:='{"name":"Teste status","age":25,"personality":"Carinhosa","relationship":"Namorada"}'; v jsonb; l uuid; i integer; begin
 perform public.piskou_store_set('charge:test-operational',jsonb_build_object('chatId',sid,'selection',sel,'planId','premium-access','amount',23.85,'status','pending','createdAt',now()));
 v:=public.piskou_admin_transaction_update('test-operational','paid','pago',0);
 if (select value->>'status' from public.piskou_payment_store where key='charge:test-operational')<>'paid' then raise exception 'Checkout not paid'; end if;
 if (select allowance from public.piskou_chat_sessions where id=sid)<>6 then raise exception 'No credits'; end if;
 perform public.piskou_chat_grant(sid,'test-operational');
 perform public.piskou_admin_transaction_update('test-operational','paid','repeat',1);
 if (select allowance from public.piskou_chat_sessions where id=sid)<>6 then raise exception 'Duplicated'; end if;
 for i in 1..2 loop l:=gen_random_uuid();perform public.piskou_chat_claim(sid,sel,'test',l);perform public.piskou_chat_finish_media(sid,l,'Oi','Olá',null);end loop;
 select value into v from public.piskou_payment_store where key='charge:test-operational';
 perform public.piskou_store_set('charge:test-operational',v||jsonb_build_object('status','pending','gatewayStatus','pending'));
 if (select value->>'status' from public.piskou_payment_store where key='charge:test-operational')<>'paid' then raise exception 'Gateway overwrote admin'; end if;
 perform public.piskou_admin_transaction_update('test-operational','pending','undo',2);
 v:=public.piskou_chat_claim(sid,sel,'test',gen_random_uuid());if v->>'error'<>'payment_required' then raise exception 'Access not revoked';end if;
 select value into v from public.piskou_payment_store where key='charge:test-operational';
 perform public.piskou_store_set('charge:test-operational',v||jsonb_build_object('status','paid','gatewayStatus','paid'));
 if (select value->>'status' from public.piskou_payment_store where key='charge:test-operational')<>'pending' then raise exception 'Override lost';end if;
 perform public.piskou_admin_transaction_update('test-operational',null,'gateway',3);
 if (select allowance-jsonb_array_length(messages)/2 from public.piskou_chat_sessions where id=sid)<>4 then raise exception 'Used credits lost';end if;
 if (select count(*) from public.piskou_transaction_audit where charge_id='test-operational')<>4 then raise exception 'Audit lost';end if;
 perform public.piskou_admin_transaction_update('test-operational','expired','expire',4);
 if (select allowance from public.piskou_chat_sessions where id=sid)<>0 then raise exception 'Expired still allowed';end if;
 if has_function_privilege('anon','public.piskou_chat_sync(uuid)','execute') then raise exception 'Public access';end if;
end $$;

rollback;
