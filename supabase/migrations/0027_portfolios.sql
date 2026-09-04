-- 0027_portfolios.sql
--
-- Part 1 of docs/prd-multi-portfolio-crypto-and-naming.md: a trader keeps more
-- than one book.
--
-- Since 0013 the ownership grain has been `user_id` and nothing finer, so a
-- trader who runs his own money and his mother's has no way to say so.
-- `app/api/cockpit/route.ts` selects every open position and sums them;
-- `portfolio_profiles` is `user_id primary key`, so there is exactly one "what
-- am I trying to do with this money" per human; and both the portfolio Council
-- (0023) and the Scratchpad pattern read (0025) judge one blended book against
-- that one objective.
--
-- The blending is not untidy, it is wrong output. A retirement book run for
-- someone else and a personal high-conviction book have different tolerances
-- for concentration and different correct answers to "should I trim this."
-- Averaged together, the verdict is wrong for both.
--
-- Nothing a trader holds today changes shape. Every existing row lands in a
-- book called "My Portfolio" and every existing screen reads the same numbers
-- it read yesterday.

create type portfolio_ownership as enum ('owned', 'managed');

-- A book.
--
-- `ownership` is not a badge. A managed book is capital held on behalf of
-- someone else, and it changes three things: how Jarvis is told to frame
-- advice about it, which disclaimer the output carries, and -- the one that
-- matters most -- that it is EXCLUDED from the aggregate P&L, so the trader's
-- own net-worth number means what it says.
--
-- `base_currency` is a label, not a conversion. This app holds no FX rate and
-- the cockpit still splits totals per currency (0021); this says what a book
-- is denominated in for the switcher to show, and nothing multiplies by it.
--
-- No `archived_at`. The PRD's Non-Goals rule out archiving in v1 and its P2
-- list names it as future work, so a column nothing would ever write would be
-- a claim about a feature that does not exist. It arrives with the flow that
-- needs it.
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  name text not null check (length(trim(name)) between 1 and 60),
  ownership portfolio_ownership not null default 'owned',
  -- Free text, and only meaningful when ownership = 'managed'. "Mom".
  beneficiary_name text,
  base_currency text not null default 'INR' check (base_currency ~ '^[A-Za-z]{3}$'),
  is_default boolean not null default false,

  -- Not redundant with the primary key. This is the target every child table's
  -- composite foreign key points at -- see the `portfolio_id` block below for
  -- why the pair, rather than the id alone, is what has to be referenced.
  unique (id, user_id)
);

create index idx_portfolios_user on portfolios (user_id);

-- One default per trader, enforced rather than assumed. The default is where a
-- bare URL lands and where the backfill below files every existing holding; two
-- of them would make "which book am I looking at" answerable two ways.
create unique index idx_portfolios_one_default on portfolios (user_id) where is_default;

alter table portfolios enable row level security;
create policy "portfolios_owner_all" on portfolios
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- The cap lives HERE, not only in the route -- the same reasoning as
-- `enforce_council_roster_cap()` (0017): an invariant belongs where a second
-- call site cannot bypass it. The route checks it too, so the trader gets a
-- sentence rather than a Postgres error.
--
-- Five is a product decision, not a technical limit, and raising it is a
-- one-line change here and in `lib/portfolio/limits.ts`.
create or replace function public.enforce_portfolio_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from portfolios where user_id = new.user_id) >= 5 then
    raise exception 'You already have 5 portfolios. Delete one before adding another.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger portfolios_cap
  before insert on portfolios
  for each row execute function public.enforce_portfolio_cap();


-- The backfill ------------------------------------------------------------
--
-- One default book per existing account, before any child column exists, so
-- every backfill below has a row to point at.
insert into portfolios (user_id, name, ownership, is_default)
select id, 'My Portfolio', 'owned', true from auth.users;


-- portfolio_id --------------------------------------------------------------
--
-- Added to the five tables that hold something a book owns. Deliberately NOT
-- added to `entries`, `exits`, `holding_reviews`, `holding_watch_state`,
-- `position_alerts` or `trade_journal_entries`: they all hang off
-- `position_id`, and a position's book is the answer. A second column would be
-- a second answer, and the two would eventually disagree.
--
-- Also deliberately NOT added to the research layer -- `theses`,
-- `trade_plans`, `jarvis_recommendations`, `thesis_memorandums`,
-- `thesis_candidates`. A thesis is an argument about the world. It is not
-- owned by a book, and the same one can back holdings in two.
--
-- THE FOREIGN KEY IS COMPOSITE, ON (portfolio_id, user_id), AND THAT IS THE
-- POINT. A plain `references portfolios(id)` would let a row carry my
-- `user_id` and someone else's `portfolio_id`: RLS constrains `user_id`,
-- nothing would constrain the pair, and the mismatch would be invisible
-- because RLS would then hide the row from both of us. Referencing the pair
-- makes "this book belongs to this row's owner" structural rather than a thing
-- every query has to remember.
--
-- `no action deferrable initially deferred` rather than `restrict` on the two
-- tables holding what the TRADER wrote. Both refuse to let a book be deleted
-- out from under its contents -- history must never vanish quietly with the
-- book that held it -- but `restrict` fires immediately and would also break a
-- legitimate `delete from auth.users`, where the portfolio and its positions
-- are being removed together in one transaction and the cascade order between
-- them is not defined. Deferring the check to commit accepts that case and
-- still refuses the one that matters.
--
-- The other three cascade: an import batch, a Council report and a pattern
-- read are all statements ABOUT a book, and a report on a book that no longer
-- exists is not history, it is a dangling reference. Restrict guards what the
-- trader wrote; cascade clears what was generated about it.

alter table positions                add column portfolio_id uuid;
alter table scratchpad_notes         add column portfolio_id uuid;
alter table portfolio_imports        add column portfolio_id uuid;
alter table portfolio_council_reports add column portfolio_id uuid;
alter table portfolio_pattern_reads  add column portfolio_id uuid;

update positions                p set portfolio_id = d.id from portfolios d where d.user_id = p.user_id and d.is_default;
update scratchpad_notes         n set portfolio_id = d.id from portfolios d where d.user_id = n.user_id and d.is_default;
update portfolio_imports        i set portfolio_id = d.id from portfolios d where d.user_id = i.user_id and d.is_default;
update portfolio_council_reports r set portfolio_id = d.id from portfolios d where d.user_id = r.user_id and d.is_default;
update portfolio_pattern_reads  p set portfolio_id = d.id from portfolios d where d.user_id = p.user_id and d.is_default;

alter table positions                alter column portfolio_id set not null;
alter table scratchpad_notes         alter column portfolio_id set not null;
alter table portfolio_imports        alter column portfolio_id set not null;
alter table portfolio_council_reports alter column portfolio_id set not null;
alter table portfolio_pattern_reads  alter column portfolio_id set not null;

alter table positions add constraint positions_portfolio_fk
  foreign key (portfolio_id, user_id) references portfolios (id, user_id)
  on delete no action deferrable initially deferred;
alter table scratchpad_notes add constraint scratchpad_notes_portfolio_fk
  foreign key (portfolio_id, user_id) references portfolios (id, user_id)
  on delete no action deferrable initially deferred;
alter table portfolio_imports add constraint portfolio_imports_portfolio_fk
  foreign key (portfolio_id, user_id) references portfolios (id, user_id) on delete cascade;
alter table portfolio_council_reports add constraint portfolio_council_reports_portfolio_fk
  foreign key (portfolio_id, user_id) references portfolios (id, user_id) on delete cascade;
alter table portfolio_pattern_reads add constraint portfolio_pattern_reads_portfolio_fk
  foreign key (portfolio_id, user_id) references portfolios (id, user_id) on delete cascade;

-- Every list read is now "this book's rows, newest first", so the existing
-- (user_id, created_at desc) indexes from 0023/0025 no longer lead with the
-- column being filtered on.
create index idx_positions_portfolio on positions (portfolio_id);
create index idx_scratchpad_notes_portfolio_created on scratchpad_notes (portfolio_id, created_at desc);
create index idx_portfolio_imports_portfolio on portfolio_imports (portfolio_id);
create index idx_portfolio_council_reports_portfolio_created on portfolio_council_reports (portfolio_id, created_at desc);
create index idx_portfolio_pattern_reads_portfolio_created on portfolio_pattern_reads (portfolio_id, created_at desc);


-- portfolio_profiles --------------------------------------------------------
--
-- Re-keyed from the user to the book. The objective -- "what am I trying to do
-- with this money" -- is a property of a book, not of a person: the whole
-- reason a managed book gets different advice is that it is being run toward a
-- different goal.
--
-- `user_id` stays. It is what the RLS policy reads and what the composite
-- foreign key needs, and dropping it would mean rebuilding both to gain
-- nothing.
alter table portfolio_profiles add column portfolio_id uuid;

update portfolio_profiles p set portfolio_id = d.id
  from portfolios d where d.user_id = p.user_id and d.is_default;

alter table portfolio_profiles alter column portfolio_id set not null;
alter table portfolio_profiles drop constraint portfolio_profiles_pkey;
alter table portfolio_profiles add primary key (portfolio_id);
alter table portfolio_profiles add constraint portfolio_profiles_portfolio_fk
  foreign key (portfolio_id, user_id) references portfolios (id, user_id) on delete cascade;
