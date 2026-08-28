/**
 * Applies ONE migration file to the Supabase Postgres named by SUPABASE_DB_URL.
 *
 * The project lives in an org outside our Supabase MCP access and `psql` is not
 * installed on this machine, so `supabase db push` / the dashboard are the only
 * other routes. This runs a single file inside one transaction, which is what we
 * want for a hand-applied DDL change.
 *
 *   node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/0011_x.sql
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-migration.mjs <path-to-sql>");
  process.exit(1);
}
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`applied ${file}`);
} catch (err) {
  await client.query("rollback");
  console.error(`FAILED ${file}:`, err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
