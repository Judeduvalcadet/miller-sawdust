create table if not exists public.assistant_dev_conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.drivers(id),
  user_name text, title text, messages jsonb not null default '[]',
  created_date timestamptz not null default now(), updated_date timestamptz not null default now()
);
create index if not exists assistant_dev_conversations_user_time on public.assistant_dev_conversations(user_id,updated_date desc);
alter table public.assistant_dev_conversations enable row level security;
revoke all on public.assistant_dev_conversations from anon, authenticated;
grant all on public.assistant_dev_conversations to service_role;
-- Dev-only learning records. The live assistant never reads these tables.
create table if not exists public.assistant_dev_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.drivers(id),
  conversation_id uuid references public.assistant_dev_conversations(id) on delete set null,
  prompt text not null,
  reply text not null,
  results jsonb,
  checks jsonb not null default '[]',
  signals jsonb not null default '[]',
  tools jsonb not null default '[]',
  elapsed_ms integer not null,
  created_at timestamptz not null default now()
);
create index if not exists assistant_dev_runs_user_time on public.assistant_dev_runs(user_id,created_at desc);
create table if not exists public.assistant_dev_feedback (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.assistant_dev_runs(id) on delete cascade,
  user_id uuid not null references public.drivers(id),
  rating text not null check (rating in ('helpful','incorrect')),
  correction text not null default '',
  status text not null default 'pending' check (status in ('pending','resolved','rejected','verified')),
  reviewed_by uuid references public.drivers(id),
  verification_notes text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(run_id,user_id)
);
create table if not exists public.assistant_dev_rules (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null unique references public.assistant_dev_feedback(id),
  rule_text text not null check (length(rule_text) between 10 and 1000),
  kind text not null check (kind in ('terminology','presentation','lookup')),
  verification_notes text not null check (length(trim(verification_notes)) >= 20),
  verified_by uuid not null references public.drivers(id),
  verified_at timestamptz not null default now(),
  active boolean not null default true
);
alter table public.assistant_dev_runs enable row level security;
alter table public.assistant_dev_feedback enable row level security;
alter table public.assistant_dev_rules enable row level security;
revoke all on public.assistant_dev_runs, public.assistant_dev_feedback, public.assistant_dev_rules from anon, authenticated;
grant all on public.assistant_dev_runs, public.assistant_dev_feedback, public.assistant_dev_rules to service_role;
