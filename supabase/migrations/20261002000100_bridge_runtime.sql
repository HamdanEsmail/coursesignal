-- Photon bridge runtime persistence.
--
-- The bridge supplies only HMAC-SHA256 event and conversation keys. This
-- migration keeps those opaque values at the database boundary, maps bridge
-- conversations into the normalized principal/conversation model, and leaves
-- research, evidence, budgets, and outbound delivery in their existing
-- authoritative tables.

create table public.bridge_runtime_state (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  memory jsonb not null
    check (jsonb_typeof(memory) = 'object')
    check (octet_length(memory::text) <= 131072),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bridge_inbound_claims (
  event_key text primary key
    check (event_key ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null,
  leased_at timestamptz not null,
  lease_token uuid,
  state text not null
    check (state in ('processing', 'complete')),
  attempt_count integer not null default 1
    check (attempt_count >= 1),
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'processing' and lease_token is not null and completed_at is null)
    or (state = 'complete' and lease_token is null and completed_at is not null)
  )
);

create index bridge_inbound_claims_expiry_idx
  on public.bridge_inbound_claims(expires_at);

create trigger bridge_runtime_state_set_updated_at
before update on public.bridge_runtime_state
for each row execute function public.set_updated_at();

create trigger bridge_inbound_claims_set_updated_at
before update on public.bridge_inbound_claims
for each row execute function public.set_updated_at();

create or replace function public.get_bridge_runtime_state(
  p_conversation_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.memory
  from public.conversations c
  join public.bridge_runtime_state s on s.conversation_id = c.id
  where c.provider = 'photon'
    and c.provider_conversation_ref_hash = p_conversation_key
$$;

create or replace function public.put_bridge_runtime_state(
  p_conversation_key text,
  p_memory jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal_id uuid;
  v_conversation_id uuid;
begin
  if p_conversation_key is null
     or p_conversation_key !~ '^[0-9a-f]{64}$'
     or p_memory is null
     or jsonb_typeof(p_memory) <> 'object'
     or octet_length(p_memory::text) > 131072 then
    raise exception using errcode = '22023', message = 'invalid bridge runtime state';
  end if;

  insert into public.principals (external_ref_hash)
  values (p_conversation_key)
  on conflict (external_ref_hash) do update
    set updated_at = now()
  returning id into v_principal_id;

  insert into public.conversations (
    principal_id,
    provider,
    provider_conversation_ref_hash
  ) values (
    v_principal_id,
    'photon',
    p_conversation_key
  )
  on conflict (provider, provider_conversation_ref_hash) do update
    set state = 'active',
        updated_at = now()
    where public.conversations.principal_id = excluded.principal_id
  returning id into v_conversation_id;

  if v_conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'bridge conversation key belongs to a different principal';
  end if;

  insert into public.bridge_runtime_state (conversation_id, memory)
  values (v_conversation_id, p_memory)
  on conflict (conversation_id) do update
    set memory = excluded.memory;
end;
$$;

create or replace function public.delete_bridge_runtime_state(
  p_conversation_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_principal_id uuid;
begin
  if p_conversation_key is null
     or p_conversation_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid bridge conversation key';
  end if;

  select c.id, c.principal_id
  into v_conversation_id, v_principal_id
  from public.conversations c
  where c.provider = 'photon'
    and c.provider_conversation_ref_hash = p_conversation_key;

  if v_conversation_id is null then
    return false;
  end if;

  -- The conversation owns runtime state, research runs, watches, and queued
  -- replies. Their existing foreign keys provide the deletion boundary.
  delete from public.conversations c where c.id = v_conversation_id;

  -- Bridge-created principals are one-per-opaque-conversation today. Keep this
  -- conditional so a future multi-conversation principal is never over-deleted.
  delete from public.principals p
  where p.id = v_principal_id
    and not exists (
      select 1 from public.conversations c where c.principal_id = p.id
    );

  return true;
end;
$$;

create or replace function public.claim_bridge_inbound(
  p_event_key text,
  p_received_at timestamptz,
  p_lease_seconds integer default 300,
  p_retention_seconds integer default 604800
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease_token uuid;
begin
  if p_event_key is null
     or p_event_key !~ '^[0-9a-f]{64}$'
     or p_received_at is null
     or p_lease_seconds is null
     or p_lease_seconds not between 10 and 3600
     or p_retention_seconds is null
     or p_retention_seconds not between 60 and 31536000 then
    raise exception using errcode = '22023', message = 'invalid bridge inbound claim';
  end if;

  -- Match the file store's opportunistic retention without making every claim
  -- pay for an unbounded delete. The expiry index keeps this bounded cleanup
  -- cheap; a deployment may additionally schedule a larger maintenance delete.
  delete from public.bridge_inbound_claims b
  where b.event_key in (
    select expired.event_key
    from public.bridge_inbound_claims expired
    where expired.expires_at <= now()
      and (
        expired.state = 'complete'
        or expired.leased_at <= now() - make_interval(secs => p_lease_seconds)
      )
    order by expired.expires_at
    limit 100
    for update skip locked
  );

  insert into public.bridge_inbound_claims (
    event_key,
    received_at,
    leased_at,
    lease_token,
    state,
    expires_at
  ) values (
    p_event_key,
    p_received_at,
    now(),
    gen_random_uuid(),
    'processing',
    p_received_at + make_interval(secs => p_retention_seconds)
  )
  on conflict (event_key) do update
    set received_at = excluded.received_at,
        leased_at = now(),
        lease_token = gen_random_uuid(),
        state = 'processing',
        attempt_count = public.bridge_inbound_claims.attempt_count + 1,
        completed_at = null,
        expires_at = excluded.expires_at
    where (
         public.bridge_inbound_claims.state = 'complete'
         and public.bridge_inbound_claims.expires_at <= now()
       ) or (
         public.bridge_inbound_claims.state = 'processing'
         and public.bridge_inbound_claims.leased_at
           <= now() - make_interval(secs => p_lease_seconds)
       )
  returning lease_token into v_lease_token;

  return v_lease_token;
end;
$$;

create or replace function public.complete_bridge_inbound(
  p_event_key text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.bridge_inbound_claims
  set state = 'complete',
      lease_token = null,
      completed_at = now()
  where event_key = p_event_key
    and state = 'processing'
    and lease_token = p_lease_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.release_bridge_inbound(
  p_event_key text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.bridge_inbound_claims
  where event_key = p_event_key
    and state = 'processing'
    and lease_token = p_lease_token;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

-- Resolve the opaque bridge key, then delegate to the canonical normalized
-- outbox function. This is a facade, not a second queue or delivery authority.
create or replace function public.enqueue_bridge_outbox_message(
  p_conversation_key text,
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
  v_conversation_id uuid;
begin
  if p_conversation_key is null
     or p_conversation_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid bridge conversation key';
  end if;

  select c.id into v_conversation_id
  from public.conversations c
  where c.provider = 'photon'
    and c.provider_conversation_ref_hash = p_conversation_key
    and c.state = 'active';

  if v_conversation_id is null then
    raise exception using errcode = '23503', message = 'active bridge conversation not found';
  end if;

  return query
  select queued.message_id, queued.disposition
  from public.enqueue_outbox_message(
    v_conversation_id,
    p_logical_key,
    p_payload_hash,
    p_body,
    p_available_at
  ) queued;
end;
$$;

-- Runtime state is server-owned. No browser/authenticated policy is provided;
-- service workers use the service role and these narrowly granted functions.
alter table public.bridge_runtime_state enable row level security;
alter table public.bridge_runtime_state force row level security;
alter table public.bridge_inbound_claims enable row level security;
alter table public.bridge_inbound_claims force row level security;

revoke all on table public.bridge_runtime_state from public;
revoke all on table public.bridge_inbound_claims from public;

revoke all on function public.get_bridge_runtime_state(text) from public;
revoke all on function public.put_bridge_runtime_state(text, jsonb) from public;
revoke all on function public.delete_bridge_runtime_state(text) from public;
revoke all on function public.claim_bridge_inbound(text, timestamptz, integer, integer) from public;
revoke all on function public.complete_bridge_inbound(text, uuid) from public;
revoke all on function public.release_bridge_inbound(text, uuid) from public;
revoke all on function public.enqueue_bridge_outbox_message(text, text, text, text, timestamptz) from public;

grant execute on function public.get_bridge_runtime_state(text) to service_role;
grant execute on function public.put_bridge_runtime_state(text, jsonb) to service_role;
grant execute on function public.delete_bridge_runtime_state(text) to service_role;
grant execute on function public.claim_bridge_inbound(text, timestamptz, integer, integer) to service_role;
grant execute on function public.complete_bridge_inbound(text, uuid) to service_role;
grant execute on function public.release_bridge_inbound(text, uuid) to service_role;
grant execute on function public.enqueue_bridge_outbox_message(text, text, text, text, timestamptz) to service_role;
