-- ============================================================================
-- 011_assistant_conversations.sql — stored chat history for the dispatch
-- assistant. Written and read only by the assistant edge function (service
-- role); each user sees only their own conversations, enforced there.
-- ============================================================================

create table assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_name text,
  title text,
  messages jsonb not null default '[]',
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index assistant_conversations_user_idx
  on assistant_conversations (user_id, updated_date desc);

-- Service-role only: RLS on with no policies.
alter table assistant_conversations enable row level security;
