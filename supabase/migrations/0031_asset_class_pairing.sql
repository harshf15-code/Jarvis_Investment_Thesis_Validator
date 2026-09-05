-- Make "a coin without a CoinGecko id" unrepresentable.
--
-- 0030 added `asset_class` and `coingecko_id` as two independent columns, and
-- nothing tied them together. That left two states the schema permitted and no
-- code ever intends:
--
--   asset_class = 'crypto' with coingecko_id null  -- a coin nothing can price
--   asset_class = 'equity' with coingecko_id set   -- a share sent to CoinGecko
--
-- Both are only reachable through a bug, and both fail QUIETLY. The first is
-- how a CSV-imported coin behaved before the fix in PR #15: written as an
-- equity with a null id, skipped by every poll thereafter, priced once and then
-- never again with no error anywhere. That bug was found by review, not by the
-- database, because the database had no opinion about it.
--
-- Every write path now sets both columns together. This constraint is what
-- makes that a property of the data rather than a habit of the four call sites
-- that happen to get it right today -- the same reasoning as 0027's composite
-- foreign key, which made "a position filed under the wrong owner's book"
-- unrepresentable rather than merely unlikely.
--
-- The routing branch in the Council still asks `asset_class = 'crypto'` rather
-- than trusting the id's presence. Defence in depth is deliberate: a constraint
-- says the state cannot arise, and the branch says what to do about the
-- question actually being asked. Neither makes the other redundant.
--
-- SAFE ON EXISTING DATA: every `stocks` row today is an equity with a null
-- `coingecko_id`, which satisfies the check. Written as NOT VALID then
-- validated so the table is not held under an ACCESS EXCLUSIVE lock for the
-- length of a full scan -- an empty-ish table makes that academic here, but the
-- pattern is the one to copy when it is not.

alter table stocks
  add constraint stocks_asset_class_matches_coingecko_id
  check ((asset_class = 'crypto') = (coingecko_id is not null))
  not valid;

alter table stocks validate constraint stocks_asset_class_matches_coingecko_id;
