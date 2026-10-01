import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

export async function createMigratedDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(`
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await database.exec(await readFile(new URL(migration, new URL(
      "../../supabase/migrations/",
      import.meta.url,
    )), "utf8"));
  }
  return database;
}

export async function seedPrincipalConversation(
  database: PGlite,
  discriminator: string,
): Promise<{ principalId: string; conversationId: string }> {
  const principal = await database.query<{ id: string }>(
    `insert into public.principals (external_ref_hash)
     values ($1)
     returning id`,
    [discriminator.repeat(64).slice(0, 64)],
  );
  const principalId = principal.rows[0]?.id;
  if (!principalId) throw new Error("Principal seed failed.");

  const conversation = await database.query<{ id: string }>(
    `insert into public.conversations (
       principal_id, provider, provider_conversation_ref_hash
     ) values ($1, 'photon', $2)
     returning id`,
    [principalId, discriminator.toUpperCase().repeat(64).slice(0, 64).toLowerCase()],
  );
  const conversationId = conversation.rows[0]?.id;
  if (!conversationId) throw new Error("Conversation seed failed.");
  return { principalId, conversationId };
}
