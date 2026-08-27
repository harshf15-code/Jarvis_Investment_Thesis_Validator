-- 0008_stocks_yahoo_symbol_unique.sql
-- 0006 (v2 schema replacement) dropped stocks.deleted_at, which cascade-dropped
-- 0005's partial unique index on (yahoo_symbol) where deleted_at is null
-- (Postgres auto-drops indexes referencing a dropped column). stocks.yahoo_symbol
-- has had no uniqueness guarantee since. Caught by the Tasks-1-19 final
-- whole-branch review. No partial predicate needed now — v2's stocks table has
-- no soft-delete column at all, so a plain unique index is correct.
create unique index uidx_stocks_yahoo_symbol on stocks (yahoo_symbol);
