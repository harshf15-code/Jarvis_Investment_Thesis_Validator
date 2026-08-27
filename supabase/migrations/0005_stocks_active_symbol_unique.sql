-- 0005_stocks_active_symbol_unique.sql
--
-- Important fix (final whole-branch review): `0001_init.sql` declared
-- `unique (yahoo_symbol)` on `stocks` as a table-level constraint with no
-- predicate excluding soft-deleted rows. `DELETE /api/stocks/[id]`
-- (`app/api/stocks/[id]/route.ts`) only ever sets `deleted_at` -- it never
-- issues a real `DELETE` -- so a previously-removed ticker's row still
-- occupies the unique constraint forever. Re-adding that same ticker later
-- (`POST /api/stocks`, `app/api/stocks/route.ts`) hits the unique
-- constraint and returns a confusing "already being tracked" 409 for an
-- entry the user can no longer see anywhere, since every list query filters
-- `deleted_at is null`.
--
-- Fix: replace the table-level unique constraint with a partial unique
-- index that only enforces uniqueness among non-deleted rows, so a
-- soft-deleted row's `yahoo_symbol` no longer blocks re-adding the same
-- ticker.
--
-- ASSUMPTION FLAGGED FOR REVIEW: `0001_init.sql`'s `unique (yahoo_symbol)`
-- is an inline table constraint with no explicit name, so Postgres assigns
-- it the default auto-generated name following its documented convention
-- for single-column unique constraints: `<table>_<column>_key`, i.e.
-- `stocks_yahoo_symbol_key`. This is standard, well-documented Postgres
-- behavior (unchanged across the versions Supabase runs) and there is only
-- one `unique (...)` constraint on `yahoo_symbol` in `0001_init.sql` to
-- collide with, so this should be reliable -- but this environment has no
-- live Postgres to run `\d stocks` / query `information_schema.table_constraints`
-- against to confirm the exact name before this migration is ever applied
-- to a real database. Verify the actual constraint name (e.g. via
-- `select conname from pg_constraint where conrelid = 'stocks'::regclass
-- and contype = 'u';`) before running this against a real project, and
-- adjust the `drop constraint` line below if it differs.

alter table stocks drop constraint stocks_yahoo_symbol_key;

create unique index uidx_stocks_active_symbol
  on stocks (yahoo_symbol)
  where deleted_at is null;
