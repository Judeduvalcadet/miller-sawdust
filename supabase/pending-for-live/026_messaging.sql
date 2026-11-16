-- Applied to the isolated local sandbox on 2026-10-01, after 025.
-- Still pending for production; do not replay on the already-migrated sandbox.
begin;

create table public.messaging_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms','email')),
  address text not null,
  business_address text not null,
  customer_id uuid references customers(id) on delete set null,
  display_name text not null default '',
  archived boolean not null default false,
  blocked boolean not null default false,
  opted_out boolean not null default false,
  last_message_at timestamptz not null default now(),
  last_preview text not null default '',
  last_inbound_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel, address, business_address)
);
create index messaging_conversations_recent on messaging_conversations(last_message_at desc);

-- Match inbound contacts only when exactly one customer has this address.
-- Ambiguous/shared numbers remain unlinked rather than picking arbitrarily.
create function public.messaging_find_customer(p_channel text,p_address text) returns uuid
language sql stable security definer set search_path = public as $$
  with matches as (
    select id from customers where
      (p_channel = 'email' and lower(trim(email)) = p_address)
      or (p_channel = 'sms' and (
        case
          when left(trim(phone),1) = '+' then '+' || regexp_replace(phone,'[^0-9]','','g')
          when length(regexp_replace(phone,'[^0-9]','','g')) = 10 then '+1' || regexp_replace(phone,'[^0-9]','','g')
          when length(regexp_replace(phone,'[^0-9]','','g')) = 11 and left(regexp_replace(phone,'[^0-9]','','g'),1) = '1' then '+' || regexp_replace(phone,'[^0-9]','','g')
          else null
        end = p_address))
  ) select case when count(*) = 1 then (array_agg(id))[1] else null end from matches;
$$;
revoke all on function messaging_find_customer(text,text) from public,anon,authenticated;
grant execute on function messaging_find_customer(text,text) to service_role;

create table public.messaging_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references messaging_conversations(id),
  invoice_id uuid references invoices(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null check (channel in ('sms','email')),
  body text not null default '',
  subject text not null default '',
  attachments jsonb not null default '[]',
  status text not null check (status in ('preparing','queued','sending','sent','delivered','failed','undelivered','bounced','complained','unknown','simulated','received')),
  provider text not null check (provider in ('twilio','resend')),
  provider_id text,
  request_id uuid,
  request_hash text,
  sent_by uuid,
  sent_by_name text,
  error text,
  dry_run boolean not null default false,
  status_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider, provider_id),
  unique(sent_by, request_id)
);
create index messaging_messages_thread on messaging_messages(conversation_id, created_at desc);
create index messaging_messages_invoice on messaging_messages(invoice_id) where invoice_id is not null;

-- Durable callback inbox handles callbacks arriving before the send response.
create table public.messaging_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  provider_id text not null,
  status text not null,
  error text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider, event_id)
);
create index messaging_events_provider on messaging_events(provider, provider_id);

alter table messaging_conversations enable row level security;
alter table messaging_messages enable row level security;
alter table messaging_events enable row level security;
-- Browser reads only. Every mutation goes through an authenticated, gated function.
create policy messaging_office_read on messaging_conversations for select to authenticated
  using (app_role() in ('admin','assistant') and auth.jwt()->>'amr' = 'password');
create policy messaging_office_read on messaging_messages for select to authenticated
  using (app_role() in ('admin','assistant') and auth.jwt()->>'amr' = 'password');
revoke all on messaging_conversations, messaging_messages, messaging_events from anon, authenticated;
grant select on messaging_conversations, messaging_messages to authenticated;
grant all on messaging_conversations, messaging_messages, messaging_events to service_role;

insert into storage.buckets(id,name,public,file_size_limit)
values ('message-attachments','message-attachments',false,5242880)
on conflict (id) do nothing;

alter table invoice_sends add column message_id uuid unique references messaging_messages(id);
alter table invoice_sends add column delivery_status text;
alter table invoice_sends add column provider_id text;
alter table invoice_sends add column delivery_error text;

create function public.messaging_record_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update messaging_conversations set
    last_message_at = greatest(last_message_at, new.created_at),
    last_preview = case when new.created_at >= last_message_at then left(coalesce(nullif(new.body,''), 'Attachment'),120) else last_preview end,
    last_inbound_at = case when new.direction = 'inbound' then greatest(last_inbound_at, new.created_at) else last_inbound_at end,
    archived = case when new.direction = 'inbound' and not blocked then false else archived end
  where id = new.conversation_id;
  if new.invoice_id is not null and new.direction = 'outbound' then
    insert into invoice_sends(invoice_id, mode, recipient, storage_path, dry_run, sent_by, message_id, delivery_status)
    select new.invoice_id, case when new.channel = 'email' then 'email' else 'mms' end,
      c.address, new.attachments->0->>'path', new.dry_run, new.sent_by_name, new.id, new.status
    from messaging_conversations c where c.id = new.conversation_id;
  end if;
  return new;
end $$;
create trigger messaging_record_message after insert on messaging_messages
for each row execute function messaging_record_message();

create function public.messaging_sync_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update invoice_sends set delivery_status = new.status, provider_id = new.provider_id,
    delivery_error = new.error, storage_path = new.attachments->0->>'path' where message_id = new.id;
  if new.invoice_id is not null and not new.dry_run and new.status in ('queued','sending','sent','delivered') then
    update invoices set sent_at = greatest(sent_at,new.created_at),
      emailed_at = case when new.channel = 'email' then greatest(emailed_at,new.created_at) else emailed_at end,
      texted_at = case when new.channel = 'sms' then greatest(texted_at,new.created_at) else texted_at end
    where id = new.invoice_id;
  end if;
  return new;
end $$;
create trigger messaging_sync_invoice after update on messaging_messages
for each row execute function messaging_sync_invoice();

-- Row lock + ordered progress prevents duplicate/out-of-order callbacks from
-- turning delivered messages back into queued/sent. Negative receipts win.
create function public.messaging_reconcile(p_provider text, p_provider_id text) returns void
language plpgsql security definer set search_path = public as $$
declare m messaging_messages; e messaging_events; old_rank int; new_rank int;
begin
  select * into m from messaging_messages where provider = p_provider and provider_id = p_provider_id for update;
  if not found then return; end if;
  for e in select * from messaging_events where provider = p_provider and provider_id = p_provider_id order by occurred_at, created_at loop
    old_rank := case m.status when 'preparing' then 0 when 'unknown' then 0 when 'queued' then 1 when 'sending' then 2 when 'sent' then 3 when 'delivered' then 4 else 5 end;
    new_rank := case e.status when 'queued' then 1 when 'sending' then 2 when 'sent' then 3 when 'delivered' then 4 else 5 end;
    if new_rank > old_rank or (new_rank = old_rank and e.occurred_at > m.status_at) then
      update messaging_messages set status = e.status, status_at = e.occurred_at, error = e.error where id = m.id returning * into m;
    end if;
  end loop;
end $$;
revoke all on function messaging_reconcile(text,text) from public, anon, authenticated;
grant execute on function messaging_reconcile(text,text) to service_role;
revoke all on function messaging_record_message(), messaging_sync_invoice() from public, anon, authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table messaging_conversations, messaging_messages;
  end if;
end $$;
commit;
