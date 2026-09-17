# 08: Scheduling — items landing on time

**What to build:** **Items** land on time automatically, with no time typed by the user. The page shows the list of
items coming due, so opening the page tells the user what to do; items with no parsed time stay "unscheduled"
rather than being dropped.

**Blocked by:** 02 (The shape of catching — auto-splitting items and records)

**Status:** ready-for-human

- [x] An item carrying time information lands on a concrete time automatically, with no manual entry.
      → `dueAt` is still reported by the provider during **extraction** (the shape ticket 02 fixed); ticket 08 is
      what **lands it on the timeline**: `domain.upcoming()` (via `upcomingFrom()` in `src/domain/scheduling.ts`),
      ordered by moment into the **due** list. No control anywhere asks the user for a time. Parsing itself is not
      08's — that is the provider port's job, and tickets 01–11 all run on a fake (`ExtractedItem.dueAt` in
      `ai-provider.ts` says outright: say when there is no time, do not invent one).
- [x] An item with no parsed time is kept as "unscheduled" and never silently discarded.
      → `Upcoming.unscheduled`, a separate list from `due`. A `dueAt` that is null **or** that `Date.parse` cannot
      read goes here rather than being dropped — a time nobody can read is not a time, and treating it as one would
      put the item at the head of the timeline under a date that cannot be rendered.
- [x] The page lists items coming due by time, plus a separate unscheduled list.
      → A new 「接下来要做的」 section at the top of act one (`/api/upcoming`): due first, unscheduled after, each
      with its own empty state. **Overdue items lead the list** (`已过期 · …`) rather than being filtered out —
      they are the thing most worth doing right now. Two columns and not one: having a time and having none are
      different facts, and merging them would mean inventing an order for the second.
- [x] An item's state can be advanced (say from todo to done) and that state survives a refresh.
      → `ItemState = 'todo' | 'done'` + `domain.setItemState()` + `POST /api/items/:id`; `item_.state` is stored
      (`NOT NULL DEFAULT 'todo'`) and still holds after a restart. It is **reversible** (done → todo): a mistaken
      tick must be undoable, and "done" is a fact the user corrects rather than a commitment they made.
      **A done item leaves both lists** (both answer "what is still to do") but is **still an item**: it is in
      `listItems()`, with its `dueAt` intact — what is finished is the asking, not the fact.
- [x] Scheduling introduces no full calendar UI and does no conflict detection.
      → No month grid, no durations, no date picker; two things due at one moment are two things due at one moment,
      and `upcomingFrom` never compares items against each other at all. `tools/e2e-ticket-08.mjs` pins this with
      two items at an identical instant.
- [x] The demo stage makes no system-level push or reminder-reliability guarantee.
      → **No reminder of any kind was built**; see "what the meaning of 提醒 was narrowed to" below.

## Comments

**2026-09-17 — implemented**

**New domain vocabulary and shapes** (`src/domain/interface.ts`, the highest seam):

- `ItemState = 'todo' | 'done'` and `ITEM_STATES` — two values rather than a pick-list of statuses. The product
  asks nothing of the user, so there is no "in progress", no priority and no category, and none is coming; the one
  action is "finished". The glossary's `_Avoid_` list for 事项 still holds — in the domain it is an **item**.
- `Item.state` added; `Upcoming { due, unscheduled }` added.
- Two new operations: `upcoming()` (**scheduling**: what is still to do) and `setItemState(itemId, state)`.

**Three design decisions worth recording:**

1. **`upcoming()` returns two lists, not one list plus a boolean.** Having a time and having none are two
   different facts, and one column would force the page either to invent an order for the second or to hide it
   behind the first — and "never silently discarded" is the very reason this section exists.
2. **Time is read once by the domain and handed down.** `core.ts` takes `now()` once and passes it to
   `upcomingFrom(items, at)`. The domain already owns time (`createDomain({ now })`), and a single read that asked
   the clock twice could order one list against two moments. Note that `at` is currently **used to fix the moment,
   not to filter** — overdue items are still listed (and lead), deliberately.
3. **The `item_.state` migration carries a default; the other columns do not.**
   `ensureColumn(db, 'item_', 'state', "TEXT NOT NULL DEFAULT 'todo'")` — because a rule reads that column
   (`upcomingFrom` takes only `todo`), and leaving it NULL in an old file would make **every item that file already
   held invisible**. Databases written by tickets 02–07 upgrade through this; `domain.test.ts` builds an old
   database without the column by hand to pin it.

**What the meaning of 提醒 (remind) was narrowed to — write this down, so the next ticket does not assume a
reminder was built.** The glossary entry for **排程** says "把事项落到时间上，并在到点时提醒", and the ticket's
*What to build* uses 提醒 too. This change builds **no reminder at all** — no system push and no in-page prompt.
`NEXT.md` instructed that the word's meaning be narrowed in 08 to something in-page, and the spec's out-of-scope
list excludes system push and reminder reliability; what those two together produce is a **list that is correct
when the page is opened**: the right order, overdue first, unscheduled apart. That satisfies "opening the page
tells the user what to do" but not "reminds them when it is due" — a deliberate omission rather than an oversight.
Building a real reminder means first answering what would make it fire on time in the demo stage.

**Three things the two-axis `/code-review` found, all fixed:**

1. **A dead button in the unscheduled column** (Spec axis). `renderScheduledItem(item, false)` drew the 「未办」
   button as usual, but only `dueList` had a listener and `unscheduledList` had none — every unscheduled row
   rendered a button that did nothing when pressed. Both lists now share one delegated listener
   (`scheduleLists`), and the e2e gained "an item with no date can be advanced too".
2. **`ITEM_STATES` declared twice, with `interface.ts`'s copy imported by nobody** (Standards axis, Duplicated
   Code). Every other vocabulary (`INPUT_TYPES`, `LINK_KINDS`, `CONCLUSION_TIERS`) lives only in `interface.ts`;
   the copy in `scheduling.ts` was deleted and replaced with an import.
3. **`DropResult.dropId` was unowned speculative abstraction** (both axes, Speculative Generality). It existed for
   ticket 11, but **nothing in this change reads it**, its value always equals `id`, and its doc comment defended
   shipping it by saying records cannot yet be told apart — circular. It is exactly what the same interface's
   comment says the interface does not do ("it does not get pre-declared with stubs that would fake behaviour").
   Removed; ticket 11 can add it when records actually differ.
   (One minor duplication fixed too: `dueLabel` and `formatDue` each wrote the "this time is unusable" test —
   extracted as `dueMoment()`.)

**Two things deliberately not tripped**: no calendar and no conflict detection (pinned by the e2e); and
date-only `dueAt` values also sort correctly — comparison is by **moment**, not by string, so
`2026-09-23` and `2026-09-23T09:00Z` cannot fool it into the wrong order.

**Tests**: domain 117/117 (7 new, one of them the old-database migration), new `tools/e2e-ticket-08.mjs` 11/11,
the 02–06 e2e suites all green (7/6/5/5/6), `tsc --noEmit` clean, `vite build` succeeds, `check-workspace` clean
(21/21), and the real server was walked by hand against the real demo provider (one sentence dropped three times →
three items all on the timeline; ticking one off drops the list by one and leaves the item count unchanged).
