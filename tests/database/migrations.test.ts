import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase, seedPrincipalConversation } from "./harness.js";

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("CourseSignal core migration", () => {
  it("creates every durable core table", async () => {
    database = await createMigratedDatabase();
    const result = await database.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "bridge_inbound_claims",
      "bridge_runtime_state",
      "budget_guard",
      "conversations",
      "course_memory",
      "evidence_items",
      "inbound_events",
      "outbox_messages",
      "principals",
      "provider_operations",
      "research_runs",
      "watch_subscriptions",
    ]);

    const rls = await database.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
    `);
    expect(rls.rows).toHaveLength(12);
    expect(
      rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity),
    ).toBe(true);
  });

  it("leases bridge events atomically and requires the current lease token", async () => {
    database = await createMigratedDatabase();
    const eventKey = "a".repeat(64);
    const first = await database.query<{ claim_token: string | null }>(
      `select public.claim_bridge_inbound($1, now(), 300, 604800) as claim_token`,
      [eventKey],
    );
    const duplicate = await database.query<{ claim_token: string | null }>(
      `select public.claim_bridge_inbound($1, now(), 300, 604800) as claim_token`,
      [eventKey],
    );
    expect(first.rows[0]?.claim_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(duplicate.rows[0]?.claim_token).toBeNull();

    const wrong = await database.query<{ completed: boolean }>(
      `select public.complete_bridge_inbound($1, gen_random_uuid()) as completed`,
      [eventKey],
    );
    expect(wrong.rows[0]?.completed).toBe(false);
    const completed = await database.query<{ completed: boolean }>(
      `select public.complete_bridge_inbound($1, $2) as completed`,
      [eventKey, first.rows[0]?.claim_token],
    );
    expect(completed.rows[0]?.completed).toBe(true);

    const afterCompletion = await database.query<{ claim_token: string | null }>(
      `select public.claim_bridge_inbound($1, now(), 300, 604800) as claim_token`,
      [eventKey],
    );
    expect(afterCompletion.rows[0]?.claim_token).toBeNull();

    const releasableKey = "b".repeat(64);
    const releasable = await database.query<{ claim_token: string }>(
      `select public.claim_bridge_inbound($1, now(), 300, 604800) as claim_token`,
      [releasableKey],
    );
    const released = await database.query<{ released: boolean }>(
      `select public.release_bridge_inbound($1, $2) as released`,
      [releasableKey, releasable.rows[0]?.claim_token],
    );
    expect(released.rows[0]?.released).toBe(true);
    const reclaimed = await database.query<{ claim_token: string | null }>(
      `select public.claim_bridge_inbound($1, now(), 300, 604800) as claim_token`,
      [releasableKey],
    );
    expect(reclaimed.rows[0]?.claim_token).toMatch(/^[0-9a-f-]{36}$/);

    const oldEventKey = "f".repeat(64);
    const oldClaim = await database.query<{ claim_token: string | null }>(
      `select public.claim_bridge_inbound(
         $1, now() - interval '8 days', 300, 604800
       ) as claim_token`,
      [oldEventKey],
    );
    const oldDuplicate = await database.query<{ claim_token: string | null }>(
      `select public.claim_bridge_inbound(
         $1, now() - interval '8 days', 300, 604800
       ) as claim_token`,
      [oldEventKey],
    );
    expect(oldClaim.rows[0]?.claim_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(oldDuplicate.rows[0]?.claim_token).toBeNull();
  });

  it("maps opaque conversations to runtime state and the canonical outbox", async () => {
    database = await createMigratedDatabase();
    const conversationKey = "c".repeat(64);
    const state = {
      consentedAt: "2026-10-01T18:00:00.000Z",
      consentVersion: 3,
      courses: ["STAT 210"],
      activeCourse: "STAT 210",
      watches: [],
      updatedAt: "2026-10-01T18:00:00.000Z",
    };
    await database.query(
      `select public.put_bridge_runtime_state($1, $2::jsonb)`,
      [conversationKey, JSON.stringify(state)],
    );
    const loaded = await database.query<{ memory: typeof state }>(
      `select public.get_bridge_runtime_state($1) as memory`,
      [conversationKey],
    );
    expect(loaded.rows[0]?.memory).toEqual(state);

    const mapping = await database.query<{
      external_ref_hash: string;
      provider_conversation_ref_hash: string;
    }>(
      `select p.external_ref_hash, c.provider_conversation_ref_hash
       from public.principals p
       join public.conversations c on c.principal_id = p.id`,
    );
    expect(mapping.rows).toEqual([{
      external_ref_hash: conversationKey,
      provider_conversation_ref_hash: conversationKey,
    }]);

    const queued = await database.query<{ message_id: string; disposition: string }>(
      `select * from public.enqueue_bridge_outbox_message(
         $1, 'event:reply', $2, 'Verified reply'
       )`,
      [conversationKey, "d".repeat(64)],
    );
    const duplicate = await database.query<{ message_id: string; disposition: string }>(
      `select * from public.enqueue_bridge_outbox_message(
         $1, 'event:reply', $2, 'Verified reply'
       )`,
      [conversationKey, "d".repeat(64)],
    );
    expect(queued.rows[0]?.disposition).toBe("queued");
    expect(duplicate.rows[0]).toEqual({
      message_id: queued.rows[0]?.message_id,
      disposition: "duplicate",
    });
    const outboxCount = await database.query<{ count: number }>(
      `select count(*)::int as count from public.outbox_messages`,
    );
    expect(outboxCount.rows[0]?.count).toBe(1);

    const deleted = await database.query<{ deleted: boolean }>(
      `select public.delete_bridge_runtime_state($1) as deleted`,
      [conversationKey],
    );
    expect(deleted.rows[0]?.deleted).toBe(true);
    const remaining = await database.query<{
      principals: number;
      conversations: number;
      runtime_state: number;
      outbox: number;
    }>(`
      select
        (select count(*)::int from public.principals) as principals,
        (select count(*)::int from public.conversations) as conversations,
        (select count(*)::int from public.bridge_runtime_state) as runtime_state,
        (select count(*)::int from public.outbox_messages) as outbox
    `);
    expect(remaining.rows[0]).toEqual({
      principals: 0,
      conversations: 0,
      runtime_state: 0,
      outbox: 0,
    });
  });

  it("keeps bridge runtime tables and RPCs server-only", async () => {
    database = await createMigratedDatabase();
    await database.exec(`set role authenticated`);
    await expect(
      database.query(`select * from public.bridge_runtime_state`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      database.query(
        `select public.get_bridge_runtime_state($1)`,
        ["e".repeat(64)],
      ),
    ).rejects.toThrow(/permission denied/i);
    await database.exec(`reset role`);
  });

  it("deduplicates identical inbound events and rejects a mismatched payload", async () => {
    database = await createMigratedDatabase();
    const { conversationId } = await seedPrincipalConversation(database, "a");
    const accepted = await database.query<{ disposition: string; event_id: string }>(
      `select * from public.ingest_inbound_event($1, 'photon', 'evt-1', $2, now())`,
      [conversationId, "1".repeat(64)],
    );
    const duplicate = await database.query<{ disposition: string; event_id: string }>(
      `select * from public.ingest_inbound_event($1, 'photon', 'evt-1', $2, now())`,
      [conversationId, "1".repeat(64)],
    );

    expect(accepted.rows[0]?.disposition).toBe("accepted");
    expect(duplicate.rows[0]).toEqual({
      disposition: "duplicate",
      event_id: accepted.rows[0]?.event_id,
    });
    await expect(
      database.query(
        `select * from public.ingest_inbound_event($1, 'photon', 'evt-1', $2, now())`,
        [conversationId, "2".repeat(64)],
      ),
    ).rejects.toThrow(/different payload hash/i);

    const other = await seedPrincipalConversation(database, "f");
    const independent = await database.query<{ disposition: string }>(
      `select disposition
       from public.ingest_inbound_event($1, 'photon', 'evt-1', $2, now())`,
      [other.conversationId, "2".repeat(64)],
    );
    expect(independent.rows[0]?.disposition).toBe("accepted");

    const count = await database.query<{ count: number }>(
      `select count(*)::int as count from public.inbound_events`,
    );
    expect(count.rows[0]?.count).toBe(2);
  });

  it("keeps course memory isolated and deletes only the selected principal's memory", async () => {
    database = await createMigratedDatabase();
    const first = await seedPrincipalConversation(database, "b");
    const second = await seedPrincipalConversation(database, "c");
    const firstAuthId = "10000000-0000-4000-8000-000000000001";
    const secondAuthId = "20000000-0000-4000-8000-000000000002";
    await database.query(
      `update public.principals
       set auth_user_id = case
         when id = $1 then $3::uuid
         when id = $2 then $4::uuid
       end
       where id in ($1, $2)`,
      [first.principalId, second.principalId, firstAuthId, secondAuthId],
    );

    await database.query(
      `insert into public.course_memory (
         principal_id, course_key, memory_key, memory_value, provenance
       ) values
         ($1, 'STAT-210', 'assessment', '{"quiz":"Thursday"}'::jsonb, 'user_explicit'),
         ($2, 'STAT-210', 'assessment', '{"quiz":"Sunday"}'::jsonb, 'user_explicit')`,
      [first.principalId, second.principalId],
    );
    await database.exec(`set role authenticated`);
    await database.exec(`set request.jwt.claim.sub = '${firstAuthId}'`);
    const visible = await database.query<{ principal_id: string }>(
      `select principal_id from public.course_memory`,
    );
    expect(visible.rows).toEqual([{ principal_id: first.principalId }]);
    await expect(
      database.query(
        `insert into public.course_memory (
           principal_id, course_key, memory_key, memory_value, provenance
         ) values ($1, 'STAT-210', 'forged', '{}', 'verified_source')`,
        [first.principalId],
      ),
    ).rejects.toThrow(/row-level security/i);
    await database.query(
      `delete from public.course_memory where course_key = 'STAT-210'`,
    );
    await database.exec(`reset role`);

    const remaining = await database.query<{
      principal_id: string;
      memory_value: { quiz: string };
    }>(`select principal_id, memory_value from public.course_memory`);
    expect(remaining.rows).toEqual([
      {
        principal_id: second.principalId,
        memory_value: { quiz: "Sunday" },
      },
    ]);
  });

  it("claims distinct outbox messages and requires the claim token to mark sent", async () => {
    database = await createMigratedDatabase();
    const { conversationId } = await seedPrincipalConversation(database, "d");
    const queued = await database.query<{ disposition: string }>(
      `select disposition
       from public.enqueue_outbox_message($1, 'reply-1', $2, 'First reply')`,
      [conversationId, "3".repeat(64)],
    );
    const duplicate = await database.query<{ disposition: string }>(
      `select disposition
       from public.enqueue_outbox_message($1, 'reply-1', $2, 'First reply')`,
      [conversationId, "3".repeat(64)],
    );
    await database.query(
      `select *
       from public.enqueue_outbox_message($1, 'reply-2', $2, 'Second reply')`,
      [conversationId, "4".repeat(64)],
    );
    expect(queued.rows[0]?.disposition).toBe("queued");
    expect(duplicate.rows[0]?.disposition).toBe("duplicate");
    await expect(
      database.query(
        `select *
         from public.enqueue_outbox_message($1, 'reply-1', $2, 'Changed reply')`,
        [conversationId, "9".repeat(64)],
      ),
    ).rejects.toThrow(/different payload/i);

    const first = await database.query<{ message_id: string; claim_token: string }>(
      `select message_id, claim_token
       from public.claim_outbox_messages('worker-a', 1, 60)`,
    );
    const second = await database.query<{ message_id: string; claim_token: string }>(
      `select message_id, claim_token
       from public.claim_outbox_messages('worker-b', 1, 60)`,
    );
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.message_id).not.toBe(first.rows[0]?.message_id);

    const wrongToken = await database.query<{ marked: boolean }>(
      `select public.mark_outbox_sent($1, gen_random_uuid(), 'provider-1') as marked`,
      [first.rows[0]?.message_id],
    );
    expect(wrongToken.rows[0]?.marked).toBe(false);

    const correctToken = await database.query<{ marked: boolean }>(
      `select public.mark_outbox_sent($1, $2, 'provider-1') as marked`,
      [first.rows[0]?.message_id, first.rows[0]?.claim_token],
    );
    expect(correctToken.rows[0]?.marked).toBe(true);

    const uncertain = await database.query<{ marked: boolean }>(
      `select public.mark_outbox_uncertain($1, $2, 'PROVIDER_TIMEOUT') as marked`,
      [second.rows[0]?.message_id, second.rows[0]?.claim_token],
    );
    expect(uncertain.rows[0]?.marked).toBe(true);
    const noBlindRetry = await database.query<{ message_id: string }>(
      `select message_id from public.claim_outbox_messages('worker-c', 10, 60)`,
    );
    expect(noBlindRetry.rows).toEqual([]);
  });

  it("reserves provider spend once, rejects hash reuse, and settles the budget", async () => {
    database = await createMigratedDatabase();
    const { principalId, conversationId } = await seedPrincipalConversation(database, "e");
    const budget = await database.query<{ id: string }>(
      `insert into public.budget_guard (
         principal_id, endpoint, window_start, window_end, limit_units
       ) values ($1, 'agent', now() - interval '1 hour', now() + interval '1 day', 20)
       returning id`,
      [principalId],
    );
    const budgetId = budget.rows[0]?.id;

    const reserved = await database.query<{
      operation_id: string;
      disposition: string;
      lease_token: string;
    }>(
      `select operation_id, disposition, lease_token
       from public.reserve_provider_operation(
         $1, 'tinyfish', 'agent', 'run-1:agent', $2, 8, 120, $3, null
       )`,
      [budgetId, "5".repeat(64), conversationId],
    );
    const duplicate = await database.query<{ disposition: string }>(
      `select disposition
       from public.reserve_provider_operation(
         $1, 'tinyfish', 'agent', 'run-1:agent', $2, 8, 120, $3, null
       )`,
      [budgetId, "5".repeat(64), conversationId],
    );
    expect(reserved.rows[0]?.disposition).toBe("reserved");
    expect(duplicate.rows[0]?.disposition).toBe("duplicate");

    await expect(
      database.query(
        `select * from public.reserve_provider_operation(
           $1, 'tinyfish', 'agent', 'run-1:agent', $2, 8, 120, $3, null
         )`,
        [budgetId, "6".repeat(64), conversationId],
      ),
    ).rejects.toThrow(/different provider payload/i);

    await database.query(
      `select public.finalize_provider_operation($1, $2, 'succeeded', 6)`,
      [reserved.rows[0]?.operation_id, reserved.rows[0]?.lease_token],
    );
    const settled = await database.query<{
      reserved_units: number;
      consumed_units: number;
    }>(
      `select reserved_units, consumed_units
       from public.budget_guard where id = $1`,
      [budgetId],
    );
    expect(settled.rows[0]).toEqual({ reserved_units: 0, consumed_units: 6 });
  });
});
