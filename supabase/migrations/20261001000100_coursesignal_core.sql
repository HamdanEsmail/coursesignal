-- CourseSignal durable core.
-- Provider identifiers are stored as one-way hashes; secrets never belong here.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.principals (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  external_ref_hash text not null unique
    check (external_ref_hash ~ '^[0-9a-f]{64}$'),
  timezone text not null default 'Asia/Dubai'
    check (length(timezone) between 1 and 64),
  locale text not null default 'en'
    check (length(locale) between 2 and 12),
  status text not null default 'active'
    check (status in ('active', 'deleted')),
  retention_days integer not null default 30
    check (retention_days between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'deleted') = (deleted_at is not null))
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.principals(id) on delete cascade,
  provider text not null check (length(provider) between 1 and 40),
  provider_conversation_ref_hash text not null
    check (provider_conversation_ref_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'active'
    check (state in ('active', 'paused', 'closed')),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_conversation_ref_hash),
  unique (id, principal_id),
  unique (id, provider)
);

create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null,
  conversation_id uuid not null,
  provider text not null check (length(provider) between 1 and 40),
  provider_event_id text not null check (length(provider_event_id) between 1 and 256),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload_ciphertext bytea,
  payload_version smallint not null default 1 check (payload_version > 0),
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text check (error_code is null or length(error_code) <= 80),
  received_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, provider_event_id),
  unique (id, principal_id),
  foreign key (conversation_id, principal_id)
    references public.conversations(id, principal_id) on delete cascade,
  foreign key (conversation_id, provider)
    references public.conversations(id, provider) on delete cascade,
  check ((status = 'processed') = (processed_at is not null))
);

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null,
  conversation_id uuid not null,
  inbound_event_id uuid not null unique,
  query_hash text not null check (query_hash ~ '^[0-9a-f]{64}$'),
  query_ciphertext bytea,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'uncertain')),
  endpoint_plan text[] not null default '{}'::text[],
  failure_code text check (failure_code is null or length(failure_code) <= 80),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, principal_id),
  foreign key (conversation_id, principal_id)
    references public.conversations(id, principal_id) on delete cascade,
  foreign key (inbound_event_id, principal_id)
    references public.inbound_events(id, principal_id) on delete cascade,
  check (endpoint_plan <@ array['search', 'fetch', 'agent']::text[]),
  check (
    (status in ('succeeded', 'failed', 'cancelled', 'uncertain')) =
    (completed_at is not null)
  )
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null,
  research_run_id uuid not null,
  endpoint text not null check (endpoint in ('search', 'fetch', 'agent')),
  source_url text not null check (source_url ~ '^https?://'),
  title text not null check (length(title) between 1 and 500),
  publisher text,
  excerpt text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  claim_state text not null default 'verified'
    check (claim_state in ('verified', 'inferred', 'unknown', 'conflicting')),
  checked_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (research_run_id, principal_id)
    references public.research_runs(id, principal_id) on delete cascade,
  unique (research_run_id, source_url, content_hash)
);

create table public.course_memory (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.principals(id) on delete cascade,
  course_key text not null check (length(course_key) between 1 and 120),
  memory_key text not null check (length(memory_key) between 1 and 120),
  memory_value jsonb not null,
  provenance text not null check (provenance in ('user_explicit', 'verified_source')),
  source_run_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (principal_id, course_key, memory_key),
  foreign key (source_run_id, principal_id)
    references public.research_runs(id, principal_id)
    on delete set null (source_run_id)
);

create table public.watch_subscriptions (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null,
  conversation_id uuid not null,
  course_key text not null check (length(course_key) between 1 and 120),
  label text not null check (length(label) between 1 and 160),
  target_url text not null check (target_url ~ '^https?://'),
  status text not null default 'active'
    check (status in ('active', 'paused', 'expired', 'deleted')),
  timezone text not null default 'Asia/Dubai'
    check (length(timezone) between 1 and 64),
  quiet_start time not null default time '22:00',
  quiet_end time not null default time '08:00',
  cadence_minutes integer not null default 360
    check (cadence_minutes between 15 and 10080),
  next_check_at timestamptz not null default now(),
  last_content_hash text
    check (last_content_hash is null or last_content_hash ~ '^[0-9a-f]{64}$'),
  last_checked_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, principal_id)
    references public.conversations(id, principal_id) on delete cascade
);

create table public.budget_guard (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.principals(id) on delete cascade,
  endpoint text not null check (endpoint in ('search', 'fetch', 'agent', 'photon')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  limit_units integer not null check (limit_units >= 0),
  reserved_units integer not null default 0 check (reserved_units >= 0),
  consumed_units integer not null default 0 check (consumed_units >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (principal_id, endpoint, window_start, window_end),
  check (window_end > window_start),
  check (reserved_units + consumed_units <= limit_units)
);

create table public.provider_operations (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.principals(id) on delete cascade,
  conversation_id uuid,
  research_run_id uuid,
  budget_guard_id uuid not null references public.budget_guard(id) on delete restrict,
  provider text not null check (length(provider) between 1 and 40),
  operation_type text not null check (length(operation_type) between 1 and 80),
  idempotency_key text not null check (length(idempotency_key) between 1 and 256),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'reserved'
    check (state in ('reserved', 'started', 'succeeded', 'failed', 'uncertain')),
  reserved_units integer not null check (reserved_units > 0),
  actual_units integer check (actual_units is null or actual_units >= 0),
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,
  provider_request_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text check (error_code is null or length(error_code) <= 80),
  reserved_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (principal_id, provider, idempotency_key),
  foreign key (conversation_id, principal_id)
    references public.conversations(id, principal_id) on delete cascade,
  foreign key (research_run_id, principal_id)
    references public.research_runs(id, principal_id) on delete cascade,
  check (
    (state in ('succeeded', 'failed', 'uncertain')) =
    (completed_at is not null)
  )
);

create table public.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null,
  conversation_id uuid not null,
  logical_key text not null check (length(logical_key) between 1 and 256),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  body text not null check (length(body) between 1 and 4000),
  state text not null default 'pending'
    check (state in ('pending', 'claimed', 'sent', 'uncertain', 'failed')),
  available_at timestamptz not null default now(),
  claim_token uuid,
  claimed_by text,
  claim_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  provider_message_id text,
  error_code text check (error_code is null or length(error_code) <= 80),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (conversation_id, logical_key),
  unique (provider_message_id),
  foreign key (conversation_id, principal_id)
    references public.conversations(id, principal_id) on delete cascade,
  check (
    (state = 'claimed') =
    (claim_token is not null and claimed_by is not null and claim_expires_at is not null)
  ),
  check ((state = 'sent') = (sent_at is not null))
);

-- Foreign keys and queue filters are explicit: PostgreSQL does not create
-- indexes for foreign keys, and workers should scan only actionable rows.
create index conversations_principal_id_idx on public.conversations(principal_id);
create index inbound_events_principal_id_idx on public.inbound_events(principal_id);
create index inbound_events_conversation_id_idx on public.inbound_events(conversation_id);
create index inbound_events_received_idx
  on public.inbound_events(received_at)
  where status in ('received', 'processing');
create index research_runs_principal_id_idx on public.research_runs(principal_id);
create index research_runs_conversation_id_idx on public.research_runs(conversation_id);
create index research_runs_active_idx
  on public.research_runs(created_at)
  where status in ('queued', 'running');
create index evidence_items_principal_id_idx on public.evidence_items(principal_id);
create index evidence_items_research_run_id_idx on public.evidence_items(research_run_id);
create index course_memory_principal_id_idx on public.course_memory(principal_id);
create index course_memory_source_run_id_idx on public.course_memory(source_run_id);
create index watch_subscriptions_principal_id_idx on public.watch_subscriptions(principal_id);
create index watch_subscriptions_conversation_id_idx on public.watch_subscriptions(conversation_id);
create index watch_subscriptions_due_idx
  on public.watch_subscriptions(next_check_at)
  where status = 'active';
create index budget_guard_principal_id_idx on public.budget_guard(principal_id);
create index provider_operations_principal_id_idx on public.provider_operations(principal_id);
create index provider_operations_conversation_id_idx on public.provider_operations(conversation_id);
create index provider_operations_research_run_id_idx on public.provider_operations(research_run_id);
create index provider_operations_budget_guard_id_idx on public.provider_operations(budget_guard_id);
create index provider_operations_lease_idx
  on public.provider_operations(lease_expires_at)
  where state in ('reserved', 'started');
create index outbox_messages_principal_id_idx on public.outbox_messages(principal_id);
create index outbox_messages_conversation_id_idx on public.outbox_messages(conversation_id);
create index outbox_messages_claim_idx
  on public.outbox_messages(available_at, created_at)
  where state in ('pending', 'claimed');

create trigger principals_set_updated_at
before update on public.principals
for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();
create trigger research_runs_set_updated_at
before update on public.research_runs
for each row execute function public.set_updated_at();
create trigger course_memory_set_updated_at
before update on public.course_memory
for each row execute function public.set_updated_at();
create trigger watch_subscriptions_set_updated_at
before update on public.watch_subscriptions
for each row execute function public.set_updated_at();
create trigger budget_guard_set_updated_at
before update on public.budget_guard
for each row execute function public.set_updated_at();
create trigger provider_operations_set_updated_at
before update on public.provider_operations
for each row execute function public.set_updated_at();
create trigger outbox_messages_set_updated_at
before update on public.outbox_messages
for each row execute function public.set_updated_at();

create or replace function public.ingest_inbound_event(
  p_conversation_id uuid,
  p_provider text,
  p_provider_event_id text,
  p_payload_hash text,
  p_received_at timestamptz,
  p_payload_ciphertext bytea default null
)
returns table (event_id uuid, disposition text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal_id uuid;
  v_event_id uuid;
  v_existing_hash text;
begin
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid payload hash';
  end if;

  select c.principal_id
  into v_principal_id
  from public.conversations c
  where c.id = p_conversation_id and c.provider = p_provider;

  if v_principal_id is null then
    raise exception using errcode = '23503', message = 'conversation/provider pair not found';
  end if;

  insert into public.inbound_events (
    principal_id,
    conversation_id,
    provider,
    provider_event_id,
    payload_hash,
    payload_ciphertext,
    received_at
  ) values (
    v_principal_id,
    p_conversation_id,
    p_provider,
    p_provider_event_id,
    p_payload_hash,
    p_payload_ciphertext,
    p_received_at
  )
  on conflict (conversation_id, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    update public.conversations
    set last_inbound_at = greatest(coalesce(last_inbound_at, p_received_at), p_received_at)
    where id = p_conversation_id;
    return query select v_event_id, 'accepted'::text;
    return;
  end if;

  select e.id, e.payload_hash
  into v_event_id, v_existing_hash
  from public.inbound_events e
  where e.conversation_id = p_conversation_id
    and e.provider_event_id = p_provider_event_id;

  if v_existing_hash <> p_payload_hash then
    raise exception using
      errcode = '23514',
      message = 'provider event id reused with a different payload hash';
  end if;

  return query select v_event_id, 'duplicate'::text;
end;
$$;

create or replace function public.reserve_provider_operation(
  p_budget_guard_id uuid,
  p_provider text,
  p_operation_type text,
  p_idempotency_key text,
  p_payload_hash text,
  p_reserved_units integer,
  p_lease_seconds integer default 120,
  p_conversation_id uuid default null,
  p_research_run_id uuid default null
)
returns table (
  operation_id uuid,
  disposition text,
  operation_state text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget public.budget_guard%rowtype;
  v_operation public.provider_operations%rowtype;
begin
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid payload hash';
  end if;
  if p_reserved_units is null
     or p_reserved_units <= 0
     or p_lease_seconds is null
     or p_lease_seconds not between 10 and 3600 then
    raise exception using errcode = '22023', message = 'invalid reservation size or lease';
  end if;

  select * into v_budget
  from public.budget_guard b
  where b.id = p_budget_guard_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'budget guard not found';
  end if;
  if v_budget.window_start > now() or v_budget.window_end <= now() then
    raise exception using errcode = '22023', message = 'budget window is not active';
  end if;

  select * into v_operation
  from public.provider_operations o
  where o.principal_id = v_budget.principal_id
    and o.provider = p_provider
    and o.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.payload_hash <> p_payload_hash
       or v_operation.operation_type <> p_operation_type then
      raise exception using
        errcode = '23514',
        message = 'idempotency key reused with a different provider payload';
    end if;
    return query
      select v_operation.id, 'duplicate'::text, v_operation.state, v_operation.lease_token;
    return;
  end if;

  if v_budget.reserved_units + v_budget.consumed_units + p_reserved_units > v_budget.limit_units then
    raise exception using errcode = '22003', message = 'provider budget exceeded';
  end if;

  insert into public.provider_operations (
    principal_id,
    conversation_id,
    research_run_id,
    budget_guard_id,
    provider,
    operation_type,
    idempotency_key,
    payload_hash,
    reserved_units,
    lease_expires_at
  ) values (
    v_budget.principal_id,
    p_conversation_id,
    p_research_run_id,
    p_budget_guard_id,
    p_provider,
    p_operation_type,
    p_idempotency_key,
    p_payload_hash,
    p_reserved_units,
    now() + make_interval(secs => p_lease_seconds)
  ) returning * into v_operation;

  update public.budget_guard
  set reserved_units = reserved_units + p_reserved_units
  where id = p_budget_guard_id;

  return query
    select v_operation.id, 'reserved'::text, v_operation.state, v_operation.lease_token;
end;
$$;

create or replace function public.finalize_provider_operation(
  p_operation_id uuid,
  p_lease_token uuid,
  p_final_state text,
  p_actual_units integer,
  p_provider_request_id text default null,
  p_error_code text default null
)
returns public.provider_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.provider_operations%rowtype;
begin
  if p_final_state is null
     or p_final_state not in ('succeeded', 'failed', 'uncertain')
     or p_actual_units is null
     or p_actual_units < 0 then
    raise exception using errcode = '22023', message = 'invalid provider operation finalization';
  end if;

  select * into v_operation
  from public.provider_operations o
  where o.id = p_operation_id
  for update;

  if not found or v_operation.lease_token <> p_lease_token then
    raise exception using errcode = '42501', message = 'provider operation lease does not match';
  end if;
  if v_operation.state in ('succeeded', 'failed', 'uncertain') then
    if v_operation.state = p_final_state and v_operation.actual_units = p_actual_units then
      return v_operation;
    end if;
    raise exception using errcode = '55000', message = 'provider operation is already final';
  end if;
  if p_actual_units > v_operation.reserved_units then
    raise exception using errcode = '22003', message = 'actual units exceed reservation';
  end if;

  update public.budget_guard
  set reserved_units = reserved_units - v_operation.reserved_units,
      consumed_units = consumed_units + p_actual_units
  where id = v_operation.budget_guard_id;

  update public.provider_operations
  set state = p_final_state,
      actual_units = p_actual_units,
      provider_request_id = p_provider_request_id,
      error_code = p_error_code,
      completed_at = now()
  where id = p_operation_id
  returning * into v_operation;

  return v_operation;
end;
$$;

create or replace function public.enqueue_outbox_message(
  p_conversation_id uuid,
  p_logical_key text,
  p_payload_hash text,
  p_body text,
  p_available_at timestamptz default now()
)
returns table (message_id uuid, disposition text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal_id uuid;
  v_message_id uuid;
  v_existing_hash text;
  v_existing_body text;
begin
  if p_payload_hash is null
     or p_payload_hash !~ '^[0-9a-f]{64}$'
     or p_logical_key is null
     or length(p_logical_key) not between 1 and 256
     or p_body is null
     or length(p_body) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'invalid outbox message';
  end if;

  select c.principal_id into v_principal_id
  from public.conversations c
  where c.id = p_conversation_id and c.state = 'active';

  if v_principal_id is null then
    raise exception using errcode = '23503', message = 'active conversation not found';
  end if;

  insert into public.outbox_messages (
    principal_id,
    conversation_id,
    logical_key,
    payload_hash,
    body,
    available_at
  ) values (
    v_principal_id,
    p_conversation_id,
    p_logical_key,
    p_payload_hash,
    p_body,
    p_available_at
  )
  on conflict (conversation_id, logical_key) do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    return query select v_message_id, 'queued'::text;
    return;
  end if;

  select o.id, o.payload_hash, o.body
  into v_message_id, v_existing_hash, v_existing_body
  from public.outbox_messages o
  where o.conversation_id = p_conversation_id and o.logical_key = p_logical_key;

  if v_existing_hash <> p_payload_hash or v_existing_body <> p_body then
    raise exception using
      errcode = '23514',
      message = 'outbox logical key reused with a different payload';
  end if;

  return query select v_message_id, 'duplicate'::text;
end;
$$;

create or replace function public.claim_outbox_messages(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns table (
  message_id uuid,
  principal_id uuid,
  conversation_id uuid,
  logical_key text,
  payload_hash text,
  body text,
  claim_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null
     or length(p_worker_id) not between 1 and 120
     or p_limit is null
     or p_limit not between 1 and 100
     or p_lease_seconds is null
     or p_lease_seconds not between 10 and 3600 then
    raise exception using errcode = '22023', message = 'invalid outbox claim request';
  end if;

  return query
  with candidates as (
    select o.id
    from public.outbox_messages o
    where o.available_at <= now()
      and o.expires_at > now()
      and o.attempt_count < 20
      and (
        o.state = 'pending'
        or (o.state = 'claimed' and o.claim_expires_at <= now())
      )
    order by o.available_at, o.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.outbox_messages o
    set state = 'claimed',
        claim_token = gen_random_uuid(),
        claimed_by = p_worker_id,
        claim_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = o.attempt_count + 1
    from candidates c
    where o.id = c.id
    returning o.*
  )
  select
    c.id,
    c.principal_id,
    c.conversation_id,
    c.logical_key,
    c.payload_hash,
    c.body,
    c.claim_token,
    c.attempt_count
  from claimed c
  order by c.available_at, c.created_at;
end;
$$;

create or replace function public.mark_outbox_sent(
  p_message_id uuid,
  p_claim_token uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.outbox_messages
  set state = 'sent',
      provider_message_id = p_provider_message_id,
      sent_at = now(),
      claim_token = null,
      claimed_by = null,
      claim_expires_at = null
  where id = p_message_id
    and state = 'claimed'
    and claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.mark_outbox_uncertain(
  p_message_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.outbox_messages
  set state = 'uncertain',
      error_code = left(p_error_code, 80),
      claim_token = null,
      claimed_by = null,
      claim_expires_at = null
  where id = p_message_id
    and state = 'claimed'
    and claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- Authenticated users can see and delete only their own data. Service workers
-- use Supabase's service role, which bypasses RLS and calls the queue functions.
alter table public.principals enable row level security;
alter table public.principals force row level security;
create policy principals_owner_policy on public.principals
for all to authenticated
using (auth_user_id = (select auth.uid()))
with check (auth_user_id = (select auth.uid()));

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.inbound_events enable row level security;
alter table public.inbound_events force row level security;
alter table public.research_runs enable row level security;
alter table public.research_runs force row level security;
alter table public.evidence_items enable row level security;
alter table public.evidence_items force row level security;
alter table public.course_memory enable row level security;
alter table public.course_memory force row level security;
alter table public.watch_subscriptions enable row level security;
alter table public.watch_subscriptions force row level security;
alter table public.budget_guard enable row level security;
alter table public.budget_guard force row level security;
alter table public.provider_operations enable row level security;
alter table public.provider_operations force row level security;
alter table public.outbox_messages enable row level security;
alter table public.outbox_messages force row level security;

create policy conversations_owner_policy on public.conversations
for all to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())))
with check (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy inbound_events_owner_policy on public.inbound_events
for all to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())))
with check (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy research_runs_owner_policy on public.research_runs
for all to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())))
with check (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy evidence_items_owner_policy on public.evidence_items
for all to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())))
with check (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy course_memory_owner_select on public.course_memory
for select to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy course_memory_owner_insert on public.course_memory
for insert to authenticated
with check (
  principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid()))
  and provenance = 'user_explicit'
  and source_run_id is null
);
create policy course_memory_owner_update on public.course_memory
for update to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())))
with check (
  principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid()))
  and provenance = 'user_explicit'
  and source_run_id is null
);
create policy course_memory_owner_delete on public.course_memory
for delete to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy watch_subscriptions_owner_policy on public.watch_subscriptions
for all to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())))
with check (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy budget_guard_owner_policy on public.budget_guard
for select to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy provider_operations_owner_policy on public.provider_operations
for select to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));
create policy outbox_messages_owner_policy on public.outbox_messages
for select to authenticated
using (principal_id in (select p.id from public.principals p where p.auth_user_id = (select auth.uid())));

grant select on public.principals to authenticated;
grant select on public.conversations to authenticated;
grant select on public.research_runs to authenticated;
grant select on public.evidence_items to authenticated;
grant select, insert, update, delete on public.course_memory to authenticated;
grant select, insert, update, delete on public.watch_subscriptions to authenticated;
grant select on public.budget_guard to authenticated;
grant select on public.provider_operations to authenticated;
grant select on public.outbox_messages to authenticated;

revoke all on function public.ingest_inbound_event(uuid, text, text, text, timestamptz, bytea) from public;
revoke all on function public.reserve_provider_operation(uuid, text, text, text, text, integer, integer, uuid, uuid) from public;
revoke all on function public.finalize_provider_operation(uuid, uuid, text, integer, text, text) from public;
revoke all on function public.enqueue_outbox_message(uuid, text, text, text, timestamptz) from public;
revoke all on function public.claim_outbox_messages(text, integer, integer) from public;
revoke all on function public.mark_outbox_sent(uuid, uuid, text) from public;
revoke all on function public.mark_outbox_uncertain(uuid, uuid, text) from public;
grant execute on function public.ingest_inbound_event(uuid, text, text, text, timestamptz, bytea) to service_role;
grant execute on function public.reserve_provider_operation(uuid, text, text, text, text, integer, integer, uuid, uuid) to service_role;
grant execute on function public.finalize_provider_operation(uuid, uuid, text, integer, text, text) to service_role;
grant execute on function public.enqueue_outbox_message(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.claim_outbox_messages(text, integer, integer) to service_role;
grant execute on function public.mark_outbox_sent(uuid, uuid, text) to service_role;
grant execute on function public.mark_outbox_uncertain(uuid, uuid, text) to service_role;
