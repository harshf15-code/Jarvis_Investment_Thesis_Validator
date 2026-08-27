-- 0010_trade_plan_thesis_conditions.sql
-- US-15's "3-4 key measurable thesis conditions" — has no column anywhere in the
-- Task 1 schema. Added here, where it's first surfaced to the user, rather than
-- retrofitted into an already-applied migration.
alter table trade_plans add column thesis_conditions jsonb not null default '[]';
