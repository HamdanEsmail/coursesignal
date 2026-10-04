-- Lodge fields on the existing Photon bridge runtime row.
-- Additive JSON keys and columns only. Live table and RPC names stay.
-- Fail closed: unknown keys and malformed Lodge fields are rejected.
-- Consent 2 and 3 payloads without Lodge keys remain valid.

create or replace function public.bridge_runtime_iso_timestamptz(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
    and p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'
$$;

create or replace function public.bridge_runtime_json_keys_allowed(
  p_value jsonb,
  p_allowed text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
    and jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(p_value) as k
      where not (k = any (p_allowed))
    )
$$;

create or replace function public.bridge_runtime_memory_is_valid(p_memory jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_clock_re constant text := '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$';
  v_https_re constant text := '^https://[^[:space:]]+$';
  v_hex64_re constant text := '^[0-9a-f]{64}$';
  v_item jsonb;
  v_step jsonb;
  v_kind text;
  v_status text;
  v_cipher text;
  v_url text;
begin
  if p_memory is null or jsonb_typeof(p_memory) <> 'object' then
    return false;
  end if;

  if not public.bridge_runtime_json_keys_allowed(
    p_memory,
    ARRAY[
      'consentedAt',
      'consentVersion',
      'courses',
      'activeCourse',
      'lastResearch',
      'watches',
      'forgetRequestedAt',
      'updatedAt',
      'school',
      'timezone',
      'quietHours',
      'savedLinks',
      'notebook',
      'pendingReminders',
      'lastTrace',
      'encryptedSpaceHandle',
      'pendingRememberPage',
      'rolesCity',
      'rolesOptIn',
      'checkInStep',
      'checkInCompletedAt',
      'checkInSkippedAt',
      'lastRolesWatchAt'
    ]
  ) then
    return false;
  end if;

  if jsonb_typeof(p_memory->'updatedAt') is distinct from 'string'
     or not public.bridge_runtime_iso_timestamptz(p_memory->>'updatedAt') then
    return false;
  end if;

  if jsonb_typeof(p_memory->'courses') is distinct from 'array'
     or jsonb_array_length(p_memory->'courses') > 8 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_memory->'courses')
  loop
    if jsonb_typeof(v_item) is distinct from 'string'
       or char_length(v_item #>> '{}') not between 1 and 80 then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_memory->'watches') is distinct from 'array'
     or jsonb_array_length(p_memory->'watches') > 5 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_memory->'watches')
  loop
    if not public.bridge_runtime_json_keys_allowed(
         v_item, ARRAY['id', 'target', 'course', 'createdAt', 'active']
       )
       or jsonb_typeof(v_item->'id') is distinct from 'string'
       or (v_item->>'id') !~ v_uuid_re
       or jsonb_typeof(v_item->'target') is distinct from 'string'
       or char_length(v_item->>'target') not between 1 and 500
       or jsonb_typeof(v_item->'createdAt') is distinct from 'string'
       or not public.bridge_runtime_iso_timestamptz(v_item->>'createdAt')
       or jsonb_typeof(v_item->'active') is distinct from 'boolean' then
      return false;
    end if;
    if v_item ? 'course'
       and (
         jsonb_typeof(v_item->'course') <> 'string'
         or char_length(v_item->>'course') not between 1 and 80
       ) then
      return false;
    end if;
  end loop;

  if p_memory ? 'consentedAt'
     and (
       jsonb_typeof(p_memory->'consentedAt') <> 'string'
       or not public.bridge_runtime_iso_timestamptz(p_memory->>'consentedAt')
     ) then
    return false;
  end if;

  if p_memory ? 'consentVersion'
     and p_memory->'consentVersion' not in ('2'::jsonb, '3'::jsonb, '4'::jsonb) then
    return false;
  end if;

  if p_memory ? 'activeCourse'
     and (
       jsonb_typeof(p_memory->'activeCourse') <> 'string'
       or char_length(p_memory->>'activeCourse') not between 1 and 80
     ) then
    return false;
  end if;

  if p_memory ? 'forgetRequestedAt'
     and (
       jsonb_typeof(p_memory->'forgetRequestedAt') <> 'string'
       or not public.bridge_runtime_iso_timestamptz(p_memory->>'forgetRequestedAt')
     ) then
    return false;
  end if;

  if p_memory ? 'lastResearch' then
    if not public.bridge_runtime_json_keys_allowed(
         p_memory->'lastResearch',
         ARRAY['query', 'topic', 'mode', 'course', 'checkedAt', 'endpoints', 'sources']
       )
       or jsonb_typeof(p_memory->'lastResearch'->'query') is distinct from 'string'
       or char_length(p_memory #>> '{lastResearch,query}') not between 1 and 1200
       or jsonb_typeof(p_memory->'lastResearch'->'mode') is distinct from 'string'
       or p_memory #>> '{lastResearch,mode}' not in ('answer', 'plan')
       or jsonb_typeof(p_memory->'lastResearch'->'checkedAt') is distinct from 'string'
       or not public.bridge_runtime_iso_timestamptz(p_memory #>> '{lastResearch,checkedAt}')
       or jsonb_typeof(p_memory->'lastResearch'->'endpoints') is distinct from 'array'
       or jsonb_array_length(p_memory->'lastResearch'->'endpoints') > 8
       or jsonb_typeof(p_memory->'lastResearch'->'sources') is distinct from 'array'
       or jsonb_array_length(p_memory->'lastResearch'->'sources') > 5 then
      return false;
    end if;
    if (p_memory->'lastResearch') ? 'topic'
       and (
         jsonb_typeof(p_memory->'lastResearch'->'topic') <> 'string'
         or char_length(p_memory #>> '{lastResearch,topic}') not between 1 and 240
       ) then
      return false;
    end if;
    if (p_memory->'lastResearch') ? 'course'
       and (
         jsonb_typeof(p_memory->'lastResearch'->'course') <> 'string'
         or char_length(p_memory #>> '{lastResearch,course}') not between 1 and 80
       ) then
      return false;
    end if;
    for v_item in select value from jsonb_array_elements(p_memory->'lastResearch'->'endpoints')
    loop
      if jsonb_typeof(v_item) is distinct from 'string'
         or v_item #>> '{}' not in ('search', 'fetch', 'agent') then
        return false;
      end if;
    end loop;
    for v_item in select value from jsonb_array_elements(p_memory->'lastResearch'->'sources')
    loop
      if not public.bridge_runtime_json_keys_allowed(
           v_item, ARRAY['title', 'url', 'excerpt', 'endpoint']
         )
         or jsonb_typeof(v_item->'title') is distinct from 'string'
         or char_length(v_item->>'title') not between 1 and 500
         or jsonb_typeof(v_item->'url') is distinct from 'string'
         or char_length(v_item->>'url') not between 1 and 2048
         or jsonb_typeof(v_item->'excerpt') is distinct from 'string'
         or char_length(v_item->>'excerpt') > 10000
         or v_item->>'endpoint' not in ('search', 'fetch', 'agent') then
        return false;
      end if;
    end loop;
  end if;

  if p_memory ? 'school'
     and (
       jsonb_typeof(p_memory->'school') <> 'string'
       or char_length(p_memory->>'school') not between 1 and 120
     ) then
    return false;
  end if;

  if p_memory ? 'timezone'
     and (
       jsonb_typeof(p_memory->'timezone') <> 'string'
       or char_length(p_memory->>'timezone') not between 1 and 64
     ) then
    return false;
  end if;

  if p_memory ? 'rolesCity'
     and (
       jsonb_typeof(p_memory->'rolesCity') <> 'string'
       or char_length(p_memory->>'rolesCity') not between 1 and 80
     ) then
    return false;
  end if;

  if p_memory ? 'rolesOptIn' and jsonb_typeof(p_memory->'rolesOptIn') <> 'boolean' then
    return false;
  end if;

  if p_memory ? 'checkInStep'
     and p_memory->'checkInStep' not in (
       '"school"'::jsonb,
       '"course_page"'::jsonb,
       '"events_page"'::jsonb,
       '"roles"'::jsonb,
       '"done"'::jsonb
     ) then
    return false;
  end if;

  if p_memory ? 'checkInCompletedAt'
     and (
       jsonb_typeof(p_memory->'checkInCompletedAt') <> 'string'
       or not public.bridge_runtime_iso_timestamptz(p_memory->>'checkInCompletedAt')
     ) then
    return false;
  end if;

  if p_memory ? 'checkInSkippedAt'
     and (
       jsonb_typeof(p_memory->'checkInSkippedAt') <> 'string'
       or not public.bridge_runtime_iso_timestamptz(p_memory->>'checkInSkippedAt')
     ) then
    return false;
  end if;

  if p_memory ? 'lastRolesWatchAt'
     and (
       jsonb_typeof(p_memory->'lastRolesWatchAt') <> 'string'
       or not public.bridge_runtime_iso_timestamptz(p_memory->>'lastRolesWatchAt')
     ) then
    return false;
  end if;

  if p_memory ? 'quietHours' then
    if not public.bridge_runtime_json_keys_allowed(
         p_memory->'quietHours', ARRAY['start', 'end', 'enabled']
       )
       or jsonb_typeof(p_memory->'quietHours'->'start') is distinct from 'string'
       or (p_memory #>> '{quietHours,start}') !~ v_clock_re
       or jsonb_typeof(p_memory->'quietHours'->'end') is distinct from 'string'
       or (p_memory #>> '{quietHours,end}') !~ v_clock_re
       or jsonb_typeof(p_memory->'quietHours'->'enabled') is distinct from 'boolean' then
      return false;
    end if;
  end if;

  if p_memory ? 'savedLinks' then
    if jsonb_typeof(p_memory->'savedLinks') is distinct from 'array'
       or jsonb_array_length(p_memory->'savedLinks') > 20 then
      return false;
    end if;
    for v_item in select value from jsonb_array_elements(p_memory->'savedLinks')
    loop
      v_url := v_item->>'url';
      if not public.bridge_runtime_json_keys_allowed(
           v_item,
           ARRAY[
             'id', 'kind', 'url', 'title', 'createdAt',
             'contentHash', 'lastFetchedAt', 'lastChangedAt', 'watchEnabled'
           ]
         )
         or jsonb_typeof(v_item->'id') is distinct from 'string'
         or (v_item->>'id') !~ v_uuid_re
         or v_item->>'kind' not in ('course', 'events', 'opportunity', 'other')
         or jsonb_typeof(v_item->'url') is distinct from 'string'
         or v_url is null
         or char_length(v_url) > 2048
         or v_url !~ v_https_re
         or jsonb_typeof(v_item->'createdAt') is distinct from 'string'
         or not public.bridge_runtime_iso_timestamptz(v_item->>'createdAt') then
        return false;
      end if;
      if v_item ? 'title'
         and (
           jsonb_typeof(v_item->'title') <> 'string'
           or char_length(v_item->>'title') not between 1 and 200
         ) then
        return false;
      end if;
      if v_item ? 'contentHash'
         and (
           jsonb_typeof(v_item->'contentHash') <> 'string'
           or (v_item->>'contentHash') !~ v_hex64_re
         ) then
        return false;
      end if;
      if v_item ? 'lastFetchedAt'
         and (
           jsonb_typeof(v_item->'lastFetchedAt') <> 'string'
           or not public.bridge_runtime_iso_timestamptz(v_item->>'lastFetchedAt')
         ) then
        return false;
      end if;
      if v_item ? 'lastChangedAt'
         and (
           jsonb_typeof(v_item->'lastChangedAt') <> 'string'
           or not public.bridge_runtime_iso_timestamptz(v_item->>'lastChangedAt')
         ) then
        return false;
      end if;
      if v_item ? 'watchEnabled' and jsonb_typeof(v_item->'watchEnabled') <> 'boolean' then
        return false;
      end if;
    end loop;
  end if;

  if p_memory ? 'notebook' then
    if jsonb_typeof(p_memory->'notebook') is distinct from 'array'
       or jsonb_array_length(p_memory->'notebook') > 30 then
      return false;
    end if;
    for v_item in select value from jsonb_array_elements(p_memory->'notebook')
    loop
      v_kind := v_item->>'kind';
      if jsonb_typeof(v_item->'id') is distinct from 'string'
         or (v_item->>'id') !~ v_uuid_re
         or jsonb_typeof(v_item->'text') is distinct from 'string'
         or char_length(v_item->>'text') not between 1 and 500
         or jsonb_typeof(v_item->'createdAt') is distinct from 'string'
         or not public.bridge_runtime_iso_timestamptz(v_item->>'createdAt') then
        return false;
      end if;
      if v_item ? 'url' then
        v_url := v_item->>'url';
        if jsonb_typeof(v_item->'url') <> 'string'
           or v_url is null
           or char_length(v_url) > 2048
           or v_url !~ v_https_re then
          return false;
        end if;
      end if;
      if v_kind = 'deadline' then
        if not public.bridge_runtime_json_keys_allowed(
             v_item, ARRAY['id', 'kind', 'text', 'createdAt', 'url', 'dueAt']
           ) then
          return false;
        end if;
        if v_item ? 'dueAt'
           and (
             jsonb_typeof(v_item->'dueAt') <> 'string'
             or not public.bridge_runtime_iso_timestamptz(v_item->>'dueAt')
           ) then
          return false;
        end if;
      elsif v_kind = 'event' then
        if not public.bridge_runtime_json_keys_allowed(
             v_item, ARRAY['id', 'kind', 'text', 'createdAt', 'url', 'startsAt', 'endsAt', 'where']
           ) then
          return false;
        end if;
        if v_item ? 'startsAt'
           and (
             jsonb_typeof(v_item->'startsAt') <> 'string'
             or not public.bridge_runtime_iso_timestamptz(v_item->>'startsAt')
           ) then
          return false;
        end if;
        if v_item ? 'endsAt'
           and (
             jsonb_typeof(v_item->'endsAt') <> 'string'
             or not public.bridge_runtime_iso_timestamptz(v_item->>'endsAt')
           ) then
          return false;
        end if;
        if v_item ? 'where'
           and (
             jsonb_typeof(v_item->'where') <> 'string'
             or char_length(v_item->>'where') not between 1 and 200
           ) then
          return false;
        end if;
      elsif v_kind = 'opportunity' then
        if not public.bridge_runtime_json_keys_allowed(
             v_item,
             ARRAY[
               'id', 'kind', 'text', 'createdAt', 'url',
               'company', 'listingTitle', 'applied', 'appliedAt'
             ]
           )
           or jsonb_typeof(v_item->'applied') is distinct from 'boolean' then
          return false;
        end if;
        if v_item ? 'company'
           and (
             jsonb_typeof(v_item->'company') <> 'string'
             or char_length(v_item->>'company') not between 1 and 120
           ) then
          return false;
        end if;
        if v_item ? 'listingTitle'
           and (
             jsonb_typeof(v_item->'listingTitle') <> 'string'
             or char_length(v_item->>'listingTitle') not between 1 and 200
           ) then
          return false;
        end if;
        if v_item ? 'appliedAt'
           and (
             v_item->'applied' <> 'true'::jsonb
             or jsonb_typeof(v_item->'appliedAt') <> 'string'
             or not public.bridge_runtime_iso_timestamptz(v_item->>'appliedAt')
           ) then
          return false;
        end if;
      elsif v_kind = 'reminder' then
        if not public.bridge_runtime_json_keys_allowed(
             v_item, ARRAY['id', 'kind', 'text', 'createdAt', 'url', 'remindAt']
           ) then
          return false;
        end if;
        if v_item ? 'remindAt'
           and (
             jsonb_typeof(v_item->'remindAt') <> 'string'
             or not public.bridge_runtime_iso_timestamptz(v_item->>'remindAt')
           ) then
          return false;
        end if;
      elsif v_kind = 'freeform' then
        if not public.bridge_runtime_json_keys_allowed(
             v_item, ARRAY['id', 'kind', 'text', 'createdAt', 'url']
           ) then
          return false;
        end if;
      else
        return false;
      end if;
    end loop;
  end if;

  if p_memory ? 'pendingReminders' then
    if jsonb_typeof(p_memory->'pendingReminders') is distinct from 'array'
       or jsonb_array_length(p_memory->'pendingReminders') > 20 then
      return false;
    end if;
    for v_item in select value from jsonb_array_elements(p_memory->'pendingReminders')
    loop
      v_status := v_item->>'status';
      if not public.bridge_runtime_json_keys_allowed(
           v_item,
           ARRAY[
             'id', 'text', 'fireAt', 'createdAt', 'status',
             'ignoreQuietHours', 'localFireLabel', 'snoozeUntil', 'confirmedAt'
           ]
         )
         or jsonb_typeof(v_item->'id') is distinct from 'string'
         or (v_item->>'id') !~ v_uuid_re
         or jsonb_typeof(v_item->'text') is distinct from 'string'
         or char_length(v_item->>'text') not between 1 and 500
         or jsonb_typeof(v_item->'fireAt') is distinct from 'string'
         or not public.bridge_runtime_iso_timestamptz(v_item->>'fireAt')
         or jsonb_typeof(v_item->'createdAt') is distinct from 'string'
         or not public.bridge_runtime_iso_timestamptz(v_item->>'createdAt')
         or v_status not in (
           'pending_confirm', 'scheduled', 'fired', 'done', 'snoozed', 'cancelled'
         )
         or jsonb_typeof(v_item->'ignoreQuietHours') is distinct from 'boolean' then
        return false;
      end if;
      if v_item ? 'localFireLabel'
         and (
           jsonb_typeof(v_item->'localFireLabel') <> 'string'
           or char_length(v_item->>'localFireLabel') not between 1 and 80
         ) then
        return false;
      end if;
      if v_item ? 'snoozeUntil'
         and (
           jsonb_typeof(v_item->'snoozeUntil') <> 'string'
           or not public.bridge_runtime_iso_timestamptz(v_item->>'snoozeUntil')
         ) then
        return false;
      end if;
      if v_item ? 'confirmedAt'
         and (
           jsonb_typeof(v_item->'confirmedAt') <> 'string'
           or not public.bridge_runtime_iso_timestamptz(v_item->>'confirmedAt')
         ) then
        return false;
      end if;
    end loop;
  end if;

  if p_memory ? 'lastTrace' then
    if not public.bridge_runtime_json_keys_allowed(
         p_memory->'lastTrace', ARRAY['at', 'steps', 'checkedLive']
       )
       or jsonb_typeof(p_memory->'lastTrace'->'at') is distinct from 'string'
       or not public.bridge_runtime_iso_timestamptz(p_memory #>> '{lastTrace,at}')
       or jsonb_typeof(p_memory->'lastTrace'->'checkedLive') is distinct from 'boolean'
       or jsonb_typeof(p_memory->'lastTrace'->'steps') is distinct from 'array'
       or jsonb_array_length(p_memory->'lastTrace'->'steps') > 12 then
      return false;
    end if;
    for v_step in select value from jsonb_array_elements(p_memory->'lastTrace'->'steps')
    loop
      if not public.bridge_runtime_json_keys_allowed(
           v_step, ARRAY['tool', 'label', 'url', 'durationMs', 'outcome', 'failure']
         )
         or v_step->>'tool' not in ('search', 'fetch', 'agent')
         or v_step->>'outcome' not in ('ok', 'named_failure') then
        return false;
      end if;
      if v_step ? 'label'
         and (
           jsonb_typeof(v_step->'label') <> 'string'
           or char_length(v_step->>'label') not between 1 and 80
         ) then
        return false;
      end if;
      if v_step ? 'url' then
        v_url := v_step->>'url';
        if jsonb_typeof(v_step->'url') <> 'string'
           or v_url is null
           or char_length(v_url) > 2048
           or v_url !~ v_https_re then
          return false;
        end if;
      end if;
      if v_step ? 'durationMs'
         and (
           jsonb_typeof(v_step->'durationMs') <> 'number'
           or (v_step->>'durationMs') !~ '^[0-9]+$'
           or (v_step->>'durationMs')::integer not between 0 and 120000
         ) then
        return false;
      end if;
      if v_step ? 'failure'
         and (
           jsonb_typeof(v_step->'failure') <> 'string'
           or char_length(v_step->>'failure') not between 1 and 200
         ) then
        return false;
      end if;
    end loop;
  end if;

  if p_memory ? 'encryptedSpaceHandle' then
    v_cipher := p_memory #>> '{encryptedSpaceHandle,ciphertext}';
    if not public.bridge_runtime_json_keys_allowed(
         p_memory->'encryptedSpaceHandle',
         ARRAY['version', 'ciphertext', 'wrappedAt']
       )
       or p_memory->'encryptedSpaceHandle'->'version' <> '1'::jsonb
       or jsonb_typeof(p_memory->'encryptedSpaceHandle'->'ciphertext') is distinct from 'string'
       or v_cipher is null
       or v_cipher !~ '^[0-9a-f]+$'
       or length(v_cipher) not between 64 and 8192
       or length(v_cipher) % 2 <> 0
       or jsonb_typeof(p_memory->'encryptedSpaceHandle'->'wrappedAt') is distinct from 'string'
       or not public.bridge_runtime_iso_timestamptz(
         p_memory #>> '{encryptedSpaceHandle,wrappedAt}'
       ) then
      return false;
    end if;
  end if;

  if p_memory ? 'pendingRememberPage' then
    v_url := p_memory #>> '{pendingRememberPage,url}';
    if not public.bridge_runtime_json_keys_allowed(
         p_memory->'pendingRememberPage',
         ARRAY['url', 'kind', 'title', 'excerpt', 'offeredAt']
       )
       or jsonb_typeof(p_memory->'pendingRememberPage'->'url') is distinct from 'string'
       or v_url is null
       or char_length(v_url) > 2048
       or v_url !~ v_https_re
       or jsonb_typeof(p_memory->'pendingRememberPage'->'offeredAt') is distinct from 'string'
       or not public.bridge_runtime_iso_timestamptz(
         p_memory #>> '{pendingRememberPage,offeredAt}'
       ) then
      return false;
    end if;
    if (p_memory->'pendingRememberPage') ? 'kind'
       and p_memory->'pendingRememberPage'->'kind' not in (
         '"course"'::jsonb, '"events"'::jsonb, '"opportunity"'::jsonb, '"other"'::jsonb
       ) then
      return false;
    end if;
    if (p_memory->'pendingRememberPage') ? 'title'
       and (
         jsonb_typeof(p_memory->'pendingRememberPage'->'title') <> 'string'
         or char_length(p_memory #>> '{pendingRememberPage,title}') not between 1 and 200
       ) then
      return false;
    end if;
    if (p_memory->'pendingRememberPage') ? 'excerpt'
       and (
         jsonb_typeof(p_memory->'pendingRememberPage'->'excerpt') <> 'string'
         or char_length(p_memory #>> '{pendingRememberPage,excerpt}') not between 1 and 500
       ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

alter table public.bridge_runtime_state
  add column if not exists encrypted_space_handle bytea
    check (
      encrypted_space_handle is null
      or octet_length(encrypted_space_handle) between 32 and 4096
    );

alter table public.bridge_runtime_state
  add column if not exists next_reminder_at timestamptz;

comment on column public.bridge_runtime_state.encrypted_space_handle is
  'Decoded Lodge Photon space-handle ciphertext. Never a raw space id.';

comment on column public.bridge_runtime_state.next_reminder_at is
  'Earliest scheduled or snoozed Lodge reminder, derived from memory JSON.';

alter table public.bridge_runtime_state
  add constraint bridge_runtime_state_memory_shape_check
  check (public.bridge_runtime_memory_is_valid(memory));

create index if not exists bridge_runtime_state_next_reminder_idx
  on public.bridge_runtime_state (next_reminder_at)
  where next_reminder_at is not null;

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
  v_encrypted_space_handle bytea;
  v_next_reminder_at timestamptz;
begin
  if p_conversation_key is null
     or p_conversation_key !~ '^[0-9a-f]{64}$'
     or p_memory is null
     or jsonb_typeof(p_memory) <> 'object'
     or octet_length(p_memory::text) > 131072
     or not public.bridge_runtime_memory_is_valid(p_memory) then
    raise exception using errcode = '22023', message = 'invalid bridge runtime state';
  end if;

  if p_memory ? 'encryptedSpaceHandle' then
    v_encrypted_space_handle := decode(
      p_memory #>> '{encryptedSpaceHandle,ciphertext}',
      'hex'
    );
  end if;

  if jsonb_typeof(p_memory->'pendingReminders') = 'array' then
    select min(
      case
        when elem->>'status' = 'snoozed'
          then coalesce(elem->>'snoozeUntil', elem->>'fireAt')::timestamptz
        else (elem->>'fireAt')::timestamptz
      end
    )
    into v_next_reminder_at
    from jsonb_array_elements(p_memory->'pendingReminders') as elem
    where elem->>'status' in ('scheduled', 'snoozed');
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

  insert into public.bridge_runtime_state (
    conversation_id,
    memory,
    encrypted_space_handle,
    next_reminder_at
  )
  values (
    v_conversation_id,
    p_memory,
    v_encrypted_space_handle,
    v_next_reminder_at
  )
  on conflict (conversation_id) do update
    set memory = excluded.memory,
        encrypted_space_handle = excluded.encrypted_space_handle,
        next_reminder_at = excluded.next_reminder_at;
end;
$$;

revoke all on function public.bridge_runtime_iso_timestamptz(text) from public, authenticated;
revoke all on function public.bridge_runtime_json_keys_allowed(jsonb, text[]) from public, authenticated;
revoke all on function public.bridge_runtime_memory_is_valid(jsonb) from public, authenticated;

grant execute on function public.bridge_runtime_iso_timestamptz(text) to service_role;
grant execute on function public.bridge_runtime_json_keys_allowed(jsonb, text[]) to service_role;
grant execute on function public.bridge_runtime_memory_is_valid(jsonb) to service_role;
grant execute on function public.put_bridge_runtime_state(text, jsonb) to service_role;
