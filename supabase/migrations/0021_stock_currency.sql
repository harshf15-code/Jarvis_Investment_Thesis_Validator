-- 0021_stock_currency.sql
--
-- Gives `stocks` a currency, and fixes the Cockpit total that needed one.
--
-- Why now: until 0020 a book was almost always single-currency, so deriving
-- currency from `exchange` (US -> USD, everything else -> INR) was wrong only
-- in principle. Importing a broker CSV is the fastest way to end up holding
-- INFY and AAPL at once, and `app/api/cockpit/route.ts` sums
-- (price - avgEntry) * qty across every open position with no conversion --
-- so that book's combined P&L was rupees plus dollars, and its percentage was
-- a ratio of two mixed-currency sums.
--
-- The column is also what `lib/markets.ts` has been naming since 0016 as the
-- reason China, Europe and Emerging Markets are not selectable. It is not the
-- whole of that work -- `exchange_code` still has no values for those
-- exchanges and `resolveYahooSymbol` has no suffixes for them -- but it is no
-- longer the missing piece, and the comments that say so are corrected in this
-- change.
--
-- Nothing here changes who may write `stocks`: it has been select-only for
-- `authenticated` since 0014, and all three insert paths already go through
-- the service-role client.

alter table stocks add column currency text;

-- Seeded from `exchange`, which needs no backfill job and no network call:
-- `exchange_code` is ('NSE','BSE','US') and nothing else, and both Indian
-- exchanges quote in rupees.
--
-- This is a good SEED and not a fact. A US-exchange row holds a bare Yahoo
-- ticker, and a bare ticker can resolve to a foreign listing quoting in
-- something else. So every price-write path -- the on-demand refresh, the
-- memorandum run and the `poll-prices` job -- re-asserts `currency` from the
-- quote it already has in hand, and a row seeded wrong corrects itself the
-- first time anything prices it rather than being trusted forever.
update stocks set currency = case when exchange = 'US' then 'USD' else 'INR' end;

-- `set not null` takes an ACCESS EXCLUSIVE lock and scans the table. That is
-- the right form HERE: `stocks` is a shared ticker cache holding tens of rows,
-- not a transaction log, so the scan is instant and the lock is held for
-- microseconds. The NOT VALID / VALIDATE CONSTRAINT dance exists for tables
-- where that is not true, and using it here would be ceremony that makes the
-- migration harder to read without making it safer.
alter table stocks alter column currency set not null;

-- Deliberately not '^[A-Z]{3}$'. Yahoo reports LSE listings in 'GBp' -- pence,
-- not pounds -- and a constraint that rejected it would block one of the very
-- markets this column exists to unblock. Shape only; this is a sanity check
-- against a null-ish or empty string reaching the column, not an ISO-4217
-- registry.
alter table stocks add constraint stocks_currency_iso check (currency ~ '^[A-Za-z]{3}$');
