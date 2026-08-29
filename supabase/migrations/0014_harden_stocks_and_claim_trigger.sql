-- 0014_harden_stocks_and_claim_trigger.sql
--
-- Two corrections to 0013, both found in review.


-- 1. `stocks` was writable by every account -----------------------------------
--
-- 0013 gave `stocks` a blanket `for all ... using (true) with check (true)` so
-- that one client could serve every route. That is far more than the app
-- needs: it let any signed-in account UPDATE `last_price` on any ticker and
-- corrupt the price EVERY user sees, insert junk rows, or delete rows nothing
-- references (which silently nulls `thesis_candidates.stock_id`, declared
-- `on delete set null`).
--
-- Reads stay open — it is a shared market-data cache and that is the point.
-- Writes move back to the service-role client, which is the only caller that
-- legitimately maintains this table (see `lib/supabase/admin.ts`, and the
-- `poll-prices` Edge Function).
drop policy "stocks_shared_market_data" on stocks;

create policy "stocks_read_only" on stocks
  for select to authenticated
  using (true);


-- 2. The claim trigger counted every user, on every signup --------------------
--
-- `claim_orphan_rows()` asked `count(*) from auth.users` to decide whether the
-- inserted row was the first account. That is a full scan of the users table on
-- every registration, forever, to answer a question that stops changing after
-- the first one.
--
-- `exists (select 1 ... offset 1)` stops as soon as it finds a second row, so
-- the check is bounded regardless of how large `auth.users` grows.
--
-- This whole trigger is single-use. Once the first account has signed up and
-- the backfill is confirmed, drop it:
--
--   drop trigger claim_orphans_on_first_signup on auth.users;
--   drop function public.claim_orphan_rows();
create or replace function public.claim_orphan_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Anything other than "this is the only row" means a later signup, which must
  -- never sweep up rows it does not own.
  if exists (select 1 from auth.users offset 1) then
    return new;
  end if;

  update theses set user_id = new.id where user_id is null;
  update trade_plans set user_id = new.id where user_id is null;
  update positions set user_id = new.id where user_id is null;
  update entries set user_id = new.id where user_id is null;
  update exits set user_id = new.id where user_id is null;
  update jarvis_recommendations set user_id = new.id where user_id is null;
  update trade_journal_entries set user_id = new.id where user_id is null;
  update position_alerts set user_id = new.id where user_id is null;
  update intelligence_signals set user_id = new.id where user_id is null;
  update opportunities set user_id = new.id where user_id is null;
  update thesis_candidates set user_id = new.id where user_id is null;
  update thesis_memorandums set user_id = new.id where user_id is null;

  return new;
end;
$$;
