# 13: Three-act demo — preloaded data and repeatability

**What to build:** Three actions run stably and repeatably on preloaded data: ① **Drop** — drop a messy input
containing the teacher's grading rules plus one emotional sentence, pick no type and fill in no time, and it splits
into an **item** and a **record**; ② **Ask** — ask "how is the final graded" from a "a few days later" viewpoint and
get an accurate answer naming the **drop** it came from; ③ **Surface** — drop one more emotional sentence and one
**conclusion** surfaces in **uncertain tone**, supported by **enough preloaded terms**. The page also states plainly
which part of the data leaves this machine.

**Blocked by:** 06 (Surfacing — the one line after an emotional drop), 07 (Recall — asking about an old thing, answered with its source), 12 (Real provider — cloud LLM + local embedding + switchable)

**Status:** ready-for-human

- [x] Act ①: a messy input containing grading rules and one emotional sentence, with no type picked and no time filled in, splits into an **item** and a **record**.
- [x] Act ②: asking "how is the final graded" from a "a few days later" viewpoint returns an accurate answer naming the **drop** it came from.
- [x] Act ③: one more emotional sentence surfaces one **conclusion** in **uncertain tone**, supported by **enough preloaded terms**.
- [x] All three acts share one set of preloaded data, and that set is the same one the domain tests use.
- [x] The three acts can be re-run back to back with unchanged results (one preloaded data set, one chain, no luck involved).
- [x] The page states plainly which part of the data leaves this machine (at the demo stage: the original text sent to the cloud LLM), with embeddings staying local.
- [x] The whole demo needs no account and no sign-up over the network; there is no system-level push or reminder.
- [x] The demo script is written into the repo in Chinese so it can be reproduced later.

## Comments

**2026-09-17 · What it actually landed as**

**1. Four questions put to the author before starting** (their answers are this ticket's shape):

- **Which provider does the demo run on?** The demo path runs on the **preset provider**
  (`YTwins_PROVIDER=demo`); the real provider is still the product's default. Only the preset one satisfies both
  "one preloaded dataset" and "re-running changes nothing". Both paths were run; the measurements are in §8.
- **What does "preloaded data" mean?** The material is **laid down as ordinary drops** before the demo starts (each
  matter said twice), so each act on stage is a single drop. Without those two mentions, "the same thing raised
  three times" never crosses the threshold.
- **How is re-running done?** One "start the demo over" button at the foot of the page (**two-step confirmation**,
  like deletion) plus a server route that exists **only in demo mode**.
- **What about the `LinkPolicy` thresholds not matching the real embedding (NEXT item 2)?** Not this ticket; it
  becomes its own ticket after 13. The demo runs on the preset provider, never touches an embedding, and so act
  three cannot end up with a fake link beside it.

**2. One preloaded dataset, one module: `src/domain/preset.ts`.** It is the single home of the material, the provider
that reads it, and the seeding that lays it down:

- It sits in `src/domain/` rather than `src/web/` because of the ticket's own words — "the same set the domain tests
  use": `src/domain/domain.test.ts` has to import it, and the dependency direction `src/web/ → src/domain/` forbids
  the reverse. `src/web/demo-provider.ts` is therefore **deleted** and folded in; leaving a copy under `web/` would
  be exactly the drift the requirement exists to prevent.
- **The server hands the page its lines** (`GET /api/demo`): act one's input, act two's question and act three's
  sentence are all read from the material, so the page does not hold a second copy — not even in a placeholder.
  (`index.html`'s preset placeholder was the one place in this repo where a preset string was written twice, and
  its own comment admitted it; that is gone.)
- Each fragment in the table carries its own `terms` / `anchor` / `reply`, and `PRESET_LEADS` is only the part of
  that table the demo lays down first. One table, read once, laid down once.

**3. The shape of the material.** Four **leads** (two about the exam matter, two about not sleeping) plus the three
live lines. Both leads go in through the **ordinary drop path** (`domain.drop` + `domain.extract`), so they have
replies, yield terms and really attach to matters: the three acts run the real chain rather than a special state.

The three strings act two's question looks for (`期末怎么算分` / `平时分` / `期末考 60%`) **deliberately do not
appear in the leads**, so the answer's source is the fragment act one just dropped. That is what makes "names the
drop it came from" a checkable assertion rather than "one of several".

**4. "下周三" is not written down.** The item's due moment is resolved by code against **the day the material is
understood to have been said**, as the next Wednesday at 09:00 (the real provider converts relative times against
today too — its prompt says "今天是…"). A hard-coded date reads "overdue" a few days later, while the material
plainly says "next Wednesday".

**The dice are pinned in demo mode** (`random: () => 0`): which opening a line carries, and whether the turn is used
at all, are rolls, and "re-running gives the same thing" cannot depend on luck. The product itself keeps the real
dice.

**5. Reset = empty + lay down again, both where they belong.**

- `DropStore.clear()` (new): child-before-parent `DELETE`s, `settle_state_` put back to what a fresh file holds,
  **one transaction**. It is a store capability and **not** a domain-interface operation: the interface is the
  task-shaped things the product does, and "empty everything" is not one of them.
- `seedPreset(domain)` goes only through `domain.drop` / `domain.extract`; it reaches into no storage detail.
- **Demo mode keeps its own library (`data/demo.sqlite`) by default**: the button empties that, not the
  `ytwins.sqlite` you actually drop into (`YTwins_DB` wins when set, and the startup log names the file in use).
- The routes exist only under `YTwins_PROVIDER=demo`: on a real server `POST /api/demo/reset` is **404** and
  `/api/demo` answers `{demo: null}` — no request shape can empty somebody's real library. The page asks twice.

**6. The data boundary is read off the configuration, not copied into the page.** `src/web/privacy.ts` turns the
resolved `ProviderConfig` into two lists — what leaves and what stays — and the page reads them from
`GET /api/privacy`:

- Demo mode: `leaves` is empty and the page says outright that nothing leaves this machine (the preset provider has
  no network at all, which is a stronger statement than "the model is local").
- Real mode: it names the endpoint and the model (`api.deepseek.com`'s `deepseek-flash`), names **which part** is
  the original text, says the embedding runs on this machine's CPU, and says the key lives only in `.env` and is
  never visible to the page.
- A server that was not told returns 404, and the page shows "this time the data boundary could not be read" — it
  **never** renders as "nothing leaves". This is the one place on the page where "could not read it" and "there is
  nothing" have to be kept apart: the other way round is the disclosure lying.

**7. Two sections on the page** (below the three tabs): the three acts' script (with "start the demo over") and the
data boundary. Both are always there, so the boundary is visible wherever the user stands; the demo block appears
only in demo mode (a real server has no script to show, and a disabled button would suggest otherwise).

**8. Both providers were run (NEXT item 3 requires it); measurements, 2026-09-17:**

- **The real chain** (cloud DeepSeek + local embedding): act one's item and terms came out **identical** to the
  preset material (five terms, and 下周三 resolved to `2026-09-23`), and the reply met the feeling first; act two
  answered the grading scheme correctly ("平时分 40%，期末考 60%，下周三交提纲。") and cited only that drop. But:
  act three needed the same sentence **dropped three times live** to cross the threshold (the real chain has no
  leads), the wording differs every run, and it needs a key and a network.
- **One real race, chased down here** (not a ticket 13 defect): the settle that follows a drop can run between the
  reading and the attachment — `drop_.input_type` (the "has been read" flag) is written before the attachment
  lands, so a page or script that sees `extracted` may be looking at a fragment that is not in its matter yet. My
  throwaway driver saw `nothing-to-say` because of it. With the same chain driven through `domain.extract()`
  (properly awaited, as the domain tests do), the real provider **did** surface a conclusion ("我说不好，不过你似乎被
  这一周的睡不好缠着，到现在还没能缓过来。"). The page retries three times at 250 ms, which is what covers that window.
- **Conclusion**: the demo runs on the preset provider; the real provider stays the default, and tuning its
  semantics is not this ticket.
- The driver scripts are throwaway files under `archive/ytwins-13-real-run/`; `archive/` is not committed.

**9. Verification.** Domain tests **159/159** (seven new: the shape of the seeded library, each act's outcome,
**two consecutive runs over the same chain coming back identical**, and **the reset really empties the library
and leaves one that can be used again**); `src/ai/provider.test.ts` **56/56**; e2e 02/03/04/05/06/08/09/10/11
all green, plus the new `tools/e2e-ticket-13.mjs` **12/12** (real HTTP, including "after a reset the acts come
back word for word", "a real server has no reset route", "a server that was not told its boundary says so", and
"the three acts sent no request off this machine"); `tsc --noEmit` clean; `vite build` succeeds;
`check-workspace` clean; and a real demo server was walked by hand (start → reset → three acts → the boundary
block).

**10. The demo script is in the repo**: `docs/ytwins/demo-script.md` (the Chinese primary copy) plus
`demo-script.en.md` — the lines, the expected results, re-running, recovery, the answers to questions from the
floor, and the record of both providers having been run.

**11. What this ticket did not do**: calibrating the three-band `LinkPolicy` thresholds against the real embedding
(NEXT item 2) stays for its own ticket. Demo mode produces no similarity edges at all (the preset provider scripts
no vectors, so the semantic half never forms), which is why act three cannot have a fake link beside it.

**The `/code-review` verdicts, and what was done about them**

Spec axis — four findings, all **correct and all fixed** (the reviewer read the ticket before it was updated; the
"checkboxes unticked / no Comments" finding is resolved):

- **The placeholder trap (the worst one, fixed)**: the page set the placeholder to `` `比如：${acts.drop}` `` while
  the demo script said "copy the placeholder", and the preset provider matches fragments by **whole-string
  equality** — so copying it would type the line with a 「比如：」 in front, act one would read nothing, and acts two
  and three would fall over with it. In demo mode the placeholder is now the line **itself** (no prefix), and the
  static placeholders in `index.html` are descriptive text rather than a second, near-miss example.
- **"It does not go online" was only copy (fixed)**: the e2e used to assert that the sentence contained 「不联网」.
  It now wraps `globalThis.fetch` before the server is built, records every request that is not to `127.0.0.1`,
  and asserts the list is empty after the acts — so the claim is a fact about the code.
- **"No signup / push route" passed for the wrong reason (fixed)**: any unmatched non-GET is a 405, so any path
  would have "passed". Chasing it turned up a real gap: an unknown **`GET /api/*`** used to fall through to the
  static page and answer **200 with HTML** — which both hid the fact being checked and handed a client that
  expected JSON a document. Unknown paths under `/api/` now answer 404, and the e2e asks each of the four names
  under GET (404) and POST (405).
- **Act two's day count was asserted as a literal** (`还有 3 天`), which only holds in a UTC+8 timezone. It is now
  the answer's **shape** plus the property that a viewpoint one day nearer leaves exactly one day less (in both the
  domain test and the e2e), and the demo script says the count follows the moment asked.

Standards axis — **four things changed**:

- `CLEAR_ORDER` was a second copy of the schema (a table added later would not follow): `clear()` now reads the
  table names from `sqlite_master` (all but `settle_state_`) and lets the schema supply the order — every existing
  reference carries an `ON DELETE` action, so no delete can be blocked, while a table added later **without** one
  fails loudly instead of being quietly skipped. A negative check was added with it: after a reset the library is
  really empty across all five things the interface can see, and it can be used again (previously only the
  "acts run twice" check observed this indirectly).
- The four route assertions in the e2e whose name did not match what they checked (see above).
- Two composers were `export`ed while only this file used them (Speculative Generality): now module-private.
- `PRESET_ITEM_TEXT: string` was annotated unlike every other constant here; `PRESET_OUTLINE` now holds 「下周三」
  plus that item's wording in one place, and `composeRecallAnswer` reads the weekday from it.

Standards axis — **three things kept, with the reason written down**:

- **The e2e writes its expected lines as literals rather than importing the constants**: an expectation imported
  from the implementation agrees with it by construction (the TDD rule against recomputing expected values), while
  the e2e separately asserts that the three lines the **server** hands the page *are* the preset dataset. Together
  they say "the page runs the material, and the material still says this". So the reviewer's claim that "changing
  preset.ts leaves the e2e green" does not hold — changing the material turns the literal assertions red, which is
  the point.
- **The preset provider stays in `src/domain/` with the material**, rather than moving to ticket 12's `src/ai/`:
  what lives there is the implementations that talk to the outside world, while this one is a script built on
  `fake-provider.ts`, which has sat beside the domain since ticket 01 so the domain's own checks can drive it.
  Splitting them would either put it out of the tests' reach or make the tests build a provider of their own. The
  reason is in the module header.
- **Date phrasing exists twice** (`preset.ts`'s sentence in an answer, `main.ts`'s `dueLabel` on a row): one is what
  the product says about the user's material, the other is a label on a line, and they are allowed to word the same
  fact differently. The function comment now says which is which.

**12. A gap the author walked into while accepting the ticket, closed the same day (2026-09-17).** Following the
demo script, the author started the server, dropped 「开学真累」, and saw: **no terms, no items**, and a reply of
nothing but 「记下了。」; asking 「期末怎么算分」 then answered 「留档里没有和这个问题相关的记录。」

Both are **correct behaviour for demo mode**, but the page said nothing about it, so it read like a broken product:

- The preset stand-in reads from one written-out table; anything outside the script yields nothing at all, and the
  fake provider's default acknowledgement stands in as the reply;
- the four preset leads **deliberately do not contain** 「期末怎么算分 / 平时分 / 期末考 60%」 (that is what makes act
  two's source the fragment act one just dropped), and the author had not dropped act one's line yet — so recall
  answered 「not found」, correctly.

What was added is **option A**: in demo mode a line appears above the boxes in acts one and three ("this server only
understands the three lines in the 「三幕 demo」 block at the foot of the page; anything you write yourself yields no
terms and no items"), and the demo block itself says 「它只认这三句」. In real mode (the product's default) the line is
not shown, because there it is not true. **No domain behaviour changed**, and the preset provider's own wording was
left alone (option B stays for another day). The change is two empty notice nodes in `index.html`, the wording filled
in by `loadDemo` in `main.ts`, and `.demo-notice` in `style.css`. The DOM is not tested automatically (the spec's
testing decision), so this one is checked by eye.
