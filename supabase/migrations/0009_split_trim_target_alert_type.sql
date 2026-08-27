-- 0009_split_trim_target_alert_type.sql
-- Splits the single 'trim_target_reached' alert type into
-- 'trim_target_1_reached'/'trim_target_2_reached' so poll-prices' dedup
-- (keyed on (position_id, alert_type)) no longer collapses a T1 alert and a
-- later T2 alert into the same suppression window. No existing rows use the
-- old value (position_alerts is empty in production) so no backfill needed.
alter type position_alert_type add value if not exists 'trim_target_1_reached';
alter type position_alert_type add value if not exists 'trim_target_2_reached';
