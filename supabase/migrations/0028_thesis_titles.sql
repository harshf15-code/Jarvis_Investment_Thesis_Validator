-- 0028_thesis_titles.sql
--
-- Part 4 of docs/prd-multi-portfolio-crypto-and-naming.md: a thesis gets a
-- name.
--
-- `theses` has no title, so three separate surfaces --
-- `components/thesis/thesis-list.tsx`, `components/feed/thesis-preview-drawer.tsx`
-- and `components/feed/add-signal-modal.tsx` -- each render the same fallback,
-- `t.ticker ?? "Macro Thesis"`. Every macro thesis is therefore called "Macro
-- Thesis", and a list of six of them is six identical rows, while the thesis's
-- own `input_text`, `market_view` and `catalyst` sit right there unused.
--
-- The title costs nothing to produce. `lib/jarvis-thesis-prompt.ts` already
-- asks for a trailing JSON object and `lib/jarvis-thesis-parser.ts` already
-- validates it, so the name rides the call that produced `market_view` and
-- `catalyst`. No new model call, no new `llm_feature`, no new spend line.
--
-- Separate from 0027 because this blocks nothing and nothing blocks it.
alter table theses add column title text
  check (title is null or length(trim(title)) between 1 and 80);

-- Why a second column rather than inferring "edited" from anything else: a
-- trader who renames a thesis has said something the model must not overwrite.
-- Any later re-run or re-parse skips the title when this is true, and there is
-- no way to reconstruct that intent from the title string alone -- an
-- auto-generated name and a chosen one look identical once written.
alter table theses add column title_edited boolean not null default false;

-- Backfill to what the screens already showed, so nothing renders differently
-- on the day this ships. A thesis with no ticker stays null and falls through
-- to "Untitled thesis" -- honest about a missing name, where "Macro Thesis"
-- was a category masquerading as one.
--
-- `title_edited` stays false: this is the app restating what it already knew,
-- not the trader choosing a name.
update theses set title = ticker where ticker is not null;
