-- 0017_investment_council.sql
--
-- The Investment Council: a per-user roster of investing personas, and one
-- persisted council report per (thesis, market).
--
-- Why: every memorandum today is one model call presented with total
-- confidence -- one winner, one verdict, one trade plan. Nothing pressure-tests
-- it before capital goes in. The Council is that second opinion, and it is
-- deliberately several opinions rather than one, so DISAGREEMENT is visible
-- instead of averaged away.
--
-- Two tables, both following the 0013 template exactly: `user_id` defaulting to
-- auth.uid(), an index on it (RLS turns the policy predicate into a WHERE
-- clause on every read), and a single owner_all policy.

create type council_member_source as enum ('builtin', 'custom');


-- council_members -----------------------------------------------------------
--
-- One roster per user. `source` is a LABEL, not a lock: a built-in is an
-- ordinary row the user owns and may edit or delete. The roster caps at 7
-- total, so a trader who wants four custom voices must be able to free the
-- slot; a hidden-but-present state would be a second thing to model for no
-- benefit.
create table council_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  -- What actually grounds the system prompt. A bare name gives the model
  -- nothing to imitate, so this is NOT NULL and carries a floor as well as a
  -- ceiling.
  philosophy text not null check (char_length(trim(philosophy)) between 40 and 600),
  source council_member_source not null default 'custom',
  -- Display order. Built-ins seed at 1-3; custom members land after them.
  sort_order int not null default 100
);

create index idx_council_members_user_id on council_members (user_id);

alter table council_members enable row level security;

create policy "council_members_owner_all" on council_members
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- The 7-member cap lives HERE, not only in the route.
--
-- A consult costs N+1 model calls billed to the trader's own OpenRouter key,
-- so the cap is a spend ceiling as much as a UI constraint. The route checks it
-- too, to return a clean 400 rather than a Postgres error -- but the invariant
-- belongs where it cannot be bypassed by a second call site.
create or replace function public.enforce_council_roster_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from council_members where user_id = new.user_id) >= 7 then
    raise exception 'Council roster is full (7 members). Remove one before adding another.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger council_members_cap
  before insert on council_members
  for each row execute function public.enforce_council_roster_cap();


-- thesis_council_reports ----------------------------------------------------
--
-- One report per (thesis, market), mirroring how 0016 made the memorandum
-- per-market: "the best robotics name in India" and "...in the US" are
-- different questions, so they get different councils reading different fields.
--
-- ONE validated jsonb blob, replaced whole -- the same discipline as
-- `thesis_memorandums.document`, and not an opinions table plus a report table.
-- Re-running a consult must replace the prior report atomically; as one row
-- that is a single upsert, where two tables would need a transaction to avoid
-- leaving a synthesis pointing at opinions that no longer exist.
create table thesis_council_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  thesis_id uuid not null references theses(id) on delete cascade,
  market market_code not null,
  -- WHICH memorandum was reviewed. The memo is replaced on every re-run, so
  -- without this a council report would silently read as a verdict on the
  -- current memo when it may have judged an entirely different pick. The UI
  -- compares this to the live memorandum id and shows the report as stale.
  -- `on delete set null` rather than cascade: losing the memo makes the report
  -- unanchored, not meaningless.
  memorandum_id uuid references thesis_memorandums(id) on delete set null,
  document jsonb not null,
  raw_llm_response text,
  unique (thesis_id, market)
);

create index idx_thesis_council_reports_user_id on thesis_council_reports (user_id);
create index idx_thesis_council_reports_thesis_market
  on thesis_council_reports (thesis_id, market);

alter table thesis_council_reports enable row level security;

create policy "thesis_council_reports_owner_all" on thesis_council_reports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- Seeding the built-in roster -----------------------------------------------
--
-- Three personas so the feature works with zero setup -- a consult needs a
-- minimum of 3 members, so seeding fewer would ship a feature nobody can run.
--
-- The `philosophy` text is what the system prompt is built from. It describes a
-- publicly known investing STYLE; the app labels every surface that renders one
-- of these as an AI simulation, not the real person's opinion.
create or replace function public.builtin_council_members()
returns table (name text, philosophy text, ord int)
language sql
immutable
as $$
  select * from (values
    (
      'Warren Buffett',
      'Judges a business, not a ticker: durable competitive advantage, owner earnings, and '
      || 'management that thinks like an owner. Demands a margin of safety between price and '
      || 'intrinsic value and would rather hold cash than overpay for a good story. Deeply '
      || 'sceptical of anything that needs a rising multiple to work.',
      1
    ),
    (
      'Howard Marks',
      'Starts with where we are in the credit and sentiment cycle, not with the company. Thinks '
      || 'in probabilities and asymmetry: what is the downside, who else already owns this, and '
      || 'what is priced in. Treats a widely loved name at a full multiple as risk rather than '
      || 'quality, and says plainly when the honest answer is that you cannot know.',
      2
    ),
    (
      'Stanley Druckenmiller',
      'Trades the macro backdrop -- liquidity, rates, currencies and positioning -- and treats '
      || 'individual names as expressions of it. Concentrates hard when conviction and the '
      || 'setup align, and cuts fast and without ego when the thesis stops working. Cares '
      || 'intensely about whether a position can actually be sized and exited.',
      3
    )
  ) as t(name, philosophy, ord);
$$;

create or replace function public.seed_council_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into council_members (user_id, name, philosophy, source, sort_order)
  select new.id, b.name, b.philosophy, 'builtin', b.ord
    from public.builtin_council_members() b;
  return new;
end;
$$;

-- 0015 deliberately dropped a trigger on auth.users, so this one needs a word:
-- that trigger was single-use (it handed pre-account rows to the first signup)
-- and became dead code the moment a second account existed. This one does real
-- work for every account created, forever. Different thing.
create trigger seed_council_on_signup
  after insert on auth.users
  for each row execute function public.seed_council_roster();

-- Backfill for accounts that already exist. The `not exists` guard makes this
-- idempotent AND makes deletion permanent: a user who removes all three
-- built-ins does not get them resurrected by a re-run of this migration.
insert into council_members (user_id, name, philosophy, source, sort_order)
select u.id, b.name, b.philosophy, 'builtin', b.ord
  from auth.users u
 cross join public.builtin_council_members() b
 where not exists (select 1 from council_members c where c.user_id = u.id);
