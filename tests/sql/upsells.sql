begin;
do $$ declare sid uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); sel jsonb:='{"name":"Upsell test","age":25,"personality":"Carinhosa","relationship":"Namorada"}'; before integer; s public.piskou_chat_sessions%rowtype; begin
 -- Upsells require the initial Baby/Pro purchase in the same conversation.
 perform public.piskou_store_set('charge:upsell-early',jsonb_build_object('chatId',other,'selection',sel,'planId','upsell-vip','amount',69,'addons','[]'::jsonb,'status','paid'));
 begin perform public.piskou_chat_grant(other,'upsell-early');raise exception 'Upsell before plan';exception when others then if sqlerrm='Upsell before plan' then raise;end if;end;
 perform public.piskou_store_set('charge:upsell-base',jsonb_build_object('chatId',sid,'selection',sel,'planId','premium-access','amount',99,'addons','[]'::jsonb,'status','paid'));
 perform public.piskou_chat_grant(sid,'upsell-base');
 select allowance into before from public.piskou_chat_sessions where id=sid;
 -- Video pack and WhatsApp add no message credits.
 perform public.piskou_store_set('charge:upsell-pack',jsonb_build_object('chatId',sid,'selection',sel,'planId','upsell-video-pack','amount',49,'addons','[]'::jsonb,'status','paid'));
 perform public.piskou_chat_grant(sid,'upsell-pack');
 if public.piskou_upsell_contact(sid,'11999998888') then raise exception 'Contact saved without WhatsApp purchase';end if;
 perform public.piskou_store_set('charge:upsell-whats',jsonb_build_object('chatId',sid,'selection',sel,'planId','upsell-whatsapp','amount',49,'addons','[]'::jsonb,'status','paid'));
 perform public.piskou_chat_grant(sid,'upsell-whats');
 select * into s from public.piskou_chat_sessions where id=sid;
 if s.allowance<>before or s.unlimited then raise exception 'Upsell changed message credits';end if;
 if public.piskou_upsell_contact(sid,'12-3') then raise exception 'Invalid phone accepted';end if;
 if not public.piskou_upsell_contact(sid,'11999998888') then raise exception 'WhatsApp contact rejected';end if;
 if not public.piskou_upsell_contact(sid,'21988887777') then raise exception 'WhatsApp contact update rejected';end if;
 if (select phone from public.piskou_upsell_contacts where chat_id=sid)<>'21988887777' then raise exception 'WhatsApp contact not updated';end if;
 -- Lifetime VIP: unlimited messages and a conversation that does not expire, even after later activity.
 perform public.piskou_store_set('charge:upsell-vip',jsonb_build_object('chatId',sid,'selection',sel,'planId','upsell-vip','amount',69,'addons','[]'::jsonb,'status','paid'));
 perform public.piskou_chat_grant(sid,'upsell-vip');perform public.piskou_chat_grant(sid,'upsell-vip');
 select * into s from public.piskou_chat_sessions where id=sid;
 if not s.unlimited then raise exception 'VIP must be unlimited';end if;
 if s.expires_at<timestamptz '2999-01-01' then raise exception 'VIP must not expire';end if;
 update public.piskou_chat_sessions set expires_at=now()+interval '90 days' where id=sid;
 if (select expires_at from public.piskou_chat_sessions where id=sid)<timestamptz '2999-01-01' then raise exception 'Activity shortened VIP';end if;
 if (select count(*) from public.piskou_chat_purchases where charge_id='upsell-vip')<>1 then raise exception 'VIP duplicated';end if;
 -- A refunded VIP returns to the normal limit and expiry.
 perform public.piskou_admin_transaction_update('upsell-vip','failed','refund test',0);
 update public.piskou_chat_sessions set expires_at=now()+interval '90 days' where id=sid;
 select * into s from public.piskou_chat_sessions where id=sid;
 if s.unlimited or s.expires_at>now()+interval '91 days' then raise exception 'Refund kept VIP';end if;
end $$;
rollback;
