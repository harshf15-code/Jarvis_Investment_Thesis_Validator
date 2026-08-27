-- 0007_thesis_cockpit_indexes.sql
create index idx_theses_ticker on theses (ticker) where ticker is not null;
create index idx_theses_status on theses (status);
create index idx_trade_plans_thesis on trade_plans (thesis_id);
create index idx_positions_thesis on positions (thesis_id);
create index idx_positions_status on positions (status);
create index idx_entries_position on entries (position_id, date);
create index idx_exits_position on exits (position_id, date);
create index idx_jarvis_recs_status on jarvis_recommendations (status);
create index idx_jarvis_recs_ticker on jarvis_recommendations (ticker);
create index idx_journal_position on trade_journal_entries (position_id);
create index idx_position_alerts_unemailed on position_alerts (triggered_at) where emailed_at is null;
create index idx_intelligence_signals_active on intelligence_signals (priority, created_at desc) where archived_at is null;
create index idx_opportunities_tier on opportunities (conviction_tier);
