# Jarvis Watchlist Tracker

A single-user Next.js app for tracking a stock watchlist/holdings, running an
LLM ("Jarvis") thesis/stress-test/trade-plan analysis per ticker, and getting
alerted (dashboard status + a daily email digest) when price crosses an
entry zone, stop loss, trim target, or a reassessment/earnings date comes
due.

## Tech stack

- **Next.js 16** (App Router) + React 19, TypeScript, Tailwind CSS v4
- **Supabase** (Postgres) for storage, accessed server-side only via a
  service-role client (`lib/supabase/admin.ts`) — RLS is enabled with no
  policies on every table, so the anon key has no direct table access
- **Supabase Edge Functions** (Deno) for scheduled background work:
  `poll-prices` (refreshes prices, evaluates alert triggers) and
  `daily-digest` (emails unsent alerts via AgentMail), both meant to run on
  `pg_cron`
- **OpenRouter** (via the [Vercel AI SDK](https://ai-sdk.dev)) for the
  Jarvis LLM analysis
- **yahoo-finance2** for quotes, OHLCV history, and fundamentals
- A single shared-password session (no per-user accounts), signed with
  `jose` (HS256 JWT) — see `middleware.ts` and `app/(auth)/`
- `vitest` for unit/integration tests

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.local.example` to `.env.local` and fill in the values:

   ```bash
   cp .env.local.example .env.local
   ```

   This covers the Next.js app's own env vars (Supabase project URL/keys,
   `OPENROUTER_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`). Note the two
   Supabase Edge Function secrets documented at the bottom of that file
   (`AGENTMAIL_API_KEY`, `DIGEST_RECIPIENT_EMAIL`) are **not** read from
   `.env.local` — they're set on the Supabase project itself (see
   Deployment below).

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

4. Run the test suite:

   ```bash
   npm run test
   ```

   Other useful commands: `npm run build`, `npm run lint`,
   `npx tsc --noEmit`.

## Deployment

This repo's Next.js app deploys like any other Next.js app (e.g. to
Vercel), but the Supabase side needs a few manual, one-time steps against a
real Supabase project:

1. **Apply the database migrations** — run every `supabase/migrations/*.sql`
   file (in order) against the project, either via the Supabase CLI
   (`supabase db push`) or the SQL editor. This creates the schema and
   enables RLS on every table.
2. **Deploy the Edge Functions** — `supabase functions deploy poll-prices`
   and `supabase functions deploy daily-digest`, then set their secrets:

   ```bash
   supabase secrets set AGENTMAIL_API_KEY=... DIGEST_RECIPIENT_EMAIL=...
   ```

3. **Register the cron schedules** — copy
   `supabase/migrations/0003_pg_cron_jobs.sql.example` to
   `0003_pg_cron_jobs.sql`, fill in the `<PROJECT_REF>`/`<SERVICE_ROLE_KEY>`
   placeholders (read that file's own comments first — it flags a real
   security tradeoff around embedding the service-role key in a cron job
   body), and apply it to schedule `poll-prices`/`daily-digest` via
   `pg_cron`.
