-- Internal reconciliation is separate from gateway confirmation and chat entitlements.
create table public.piskou_transaction_notes (
 charge_id text primary key,
 status text check(status in ('pending','paid','failed','expired')),
 note text not null default '' check(length(note)<=500),
 revision integer not null default 1,
 updated_at timestamptz not null default now()
);
create table public.piskou_transaction_audit (
 id bigint generated always as identity primary key,
 charge_id text not null references public.piskou_transaction_notes(charge_id),
 previous_status text,
 status text,
 note text not null,
 created_at timestamptz not null default now()
);
create index piskou_transaction_audit_charge_idx on public.piskou_transaction_audit(charge_id,created_at desc);
alter table public.piskou_transaction_notes enable row level security;
alter table public.piskou_transaction_audit enable row level security;
revoke all on public.piskou_transaction_notes,public.piskou_transaction_audit from public,anon,authenticated;
grant select,insert,update on public.piskou_transaction_notes to service_role;
grant select,insert on public.piskou_transaction_audit to service_role;
grant usage,select on sequence public.piskou_transaction_audit_id_seq to service_role;
create function public.piskou_admin_transaction_update(p_id text,p_status text,p_note text,p_revision integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.piskou_transaction_notes%rowtype;
begin
 if p_status is not null and p_status not in ('pending','paid','failed','expired') then return jsonb_build_object('error','invalid'); end if;
 if p_note is null or length(p_note)>500 then return jsonb_build_object('error','invalid'); end if;
 perform 1 from public.piskou_payment_store where key='charge:'||p_id and expires_at>now() for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 select * into previous from public.piskou_transaction_notes where charge_id=p_id for update;
 if coalesce(previous.revision,0)<>p_revision then return jsonb_build_object('error','conflict'); end if;
 insert into public.piskou_transaction_notes(charge_id,status,note) values(p_id,p_status,p_note)
 on conflict(charge_id) do update set status=excluded.status,note=excluded.note,revision=public.piskou_transaction_notes.revision+1,updated_at=now();
 insert into public.piskou_transaction_audit(charge_id,previous_status,status,note) values(p_id,previous.status,p_status,p_note);
 return jsonb_build_object('ok',true);
end $$;
create function public.piskou_admin_transactions(p_days integer,p_status text,p_offset integer) returns jsonb language sql security invoker set search_path='' as $$
with charges as (
 select substring(s.key from 8) as id,s.value->>'orderId' as order_id,s.value->>'planId' as plan_id,
  (s.value->>'amount')::numeric as amount,s.value->>'method' as method,s.value->>'status' as gateway_status,
  (s.value->>'createdAt')::timestamptz as created_at,s.value->'selection'->>'name' as character_name,
  s.value->'customer'->>'name' as customer_name,s.value->'customer'->>'email' as customer_email,
  n.status as manual_status,coalesce(n.status,s.value->>'status') as status,coalesce(n.note,'') as note,coalesce(n.revision,0) as revision,n.updated_at
 from public.piskou_payment_store s left join public.piskou_transaction_notes n on n.charge_id=substring(s.key from 8)
 where s.key like 'charge:%' and s.expires_at>now() and (s.value->>'createdAt')::timestamptz>=(date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')-(greatest(1,least(p_days,90))-1)*interval '1 day'
), filtered as (select * from charges where p_status='all' or status=p_status), page as (
 select * from filtered order by created_at desc,id limit 50 offset greatest(0,least(p_offset,10000))
)
select jsonb_build_object(
 'total',(select count(*) from filtered),'updatedAt',now(),
 'summary',jsonb_build_object('generated',(select count(*) from charges),'gatewayPaid',(select count(*) from charges where gateway_status='paid'),
 'gatewayPaidAmount',coalesce((select sum(amount) from charges where gateway_status='paid'),0),
 'manualPaid',(select count(*) from charges where manual_status='paid' and gateway_status is distinct from 'paid')),
 'transactions',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('audit',coalesce((select jsonb_agg(a) from (select previous_status,status,note,created_at from public.piskou_transaction_audit where charge_id=p.id order by created_at desc,id desc limit 10) a),'[]'::jsonb)) order by p.created_at desc,p.id) from page p),'[]'::jsonb));
$$;
revoke all on function public.piskou_admin_transaction_update(text,text,text,integer),public.piskou_admin_transactions(integer,text,integer) from public,anon,authenticated;
grant execute on function public.piskou_admin_transaction_update(text,text,text,integer),public.piskou_admin_transactions(integer,text,integer) to service_role;
