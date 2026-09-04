-- Widen every quantity and price column ahead of crypto holdings.
--
-- See docs/superpowers/specs/2026-09-04-crypto-holdings-design.md. These are
-- separate from the crypto schema itself because they are safe on their own,
-- strictly better for equities too, and horrible to discover halfway through an
-- import that has already written half a batch.
--
-- The PRD's diagnosis was half right. `quantity` at numeric(18,6) holds 0.0043
-- BTC exactly, so widening it only matters for satoshi-level lots. The column
-- that actually BREAKS is `price`: numeric(14,4) rounds a sub-cent coin to
-- 0.0000, and `check (price > 0)` then rejects the row outright -- so the
-- failure is a refused insert, not a quiet rounding.
--
-- `stocks.last_price` is absent from the PRD's list entirely. Without it a
-- sub-cent coin still collapses to 0.0000 on the display and polling path, and
-- the widening would look done without being done.
--
-- All plain `alter column type` widenings: no data loss, and no rewrite risk at
-- this table size.

alter table entries alter column quantity type numeric(28,10);
alter table exits   alter column quantity type numeric(28,10);

alter table entries alter column price type numeric(20,10);
alter table exits   alter column price type numeric(20,10);

alter table stocks  alter column last_price type numeric(20,10);

alter table trade_plans alter column entry_zone_low   type numeric(20,10);
alter table trade_plans alter column entry_zone_high  type numeric(20,10);
alter table trade_plans alter column stop_loss        type numeric(20,10);
alter table trade_plans alter column target_1         type numeric(20,10);
alter table trade_plans alter column target_2         type numeric(20,10);
alter table trade_plans alter column add_tranche_low  type numeric(20,10);
alter table trade_plans alter column add_tranche_high type numeric(20,10);
