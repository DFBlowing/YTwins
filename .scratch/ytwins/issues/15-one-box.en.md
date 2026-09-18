# 15: One box — collapsing drop, ask and surface into one thing the user does

**What to build:** The user sees one input box, and everything they say in passing goes into it. Telling "this is a
fragment" apart from "this is a question" is the **product's** job, not the user's — so it is neither a choice the
user makes nor a guess the page makes. The original words always become a **drop** first (stored verbatim), and then
the product decides what else to say: a question about something in the **records** → **recall** (stated plainly,
naming its source); a question about the **user themselves** → the same moment gives an **answer**; a plain fragment
→ only the drop's own reply, plus the line **surfaced** when it carries a feeling. The three-act page stays exactly
as it is, as the demo's and the regression suite's reference.

**Blocked by:** 07 (recall), 11 (the answer), 13 (the demo page and the preset material)

**Status:** ready-for-human

- [x] One input box: no tabs, no separate way in for 「问」, no controls for type / time / tags.
      The product itself is now `/` (`src/web/index.html` + `one-box.ts`), and the three-act page moved to
      `/demo.html` with not one character changed (the author's call).
- [x] Every fragment is **stored first** (the drop's promise of a faithful record is unchanged), and what the user
      gets back is a **reply**, plus the **items** and **terms** it yielded when it has any.
      `deliver` waits for that **reading** to land (`drop` does not): the routing reads the **input type**, and the
      response carries the items and terms.
- [x] **Routing is the domain's rule, not the page's `if`.** The page hands over the original words and shows what
      the domain decided — as one **task-shaped** operation (named from `CONTEXT.md`'s words: 投递 / 追溯 / 浮现),
      rather than the page stitching together `drop` + `recall` + `surface` itself.
      The shape it landed in: `Domain.deliver(body) → { drop, speech }`, with `speech` one of three
      (`recall` / `surface` / `none`); the routing itself is the domain's `readQuestionShape` plus the port's
      `judgeQuestion`.
- [x] **A question about a fact**: answered plainly with its source when the records cover it, and a plain "found
      nothing" when they do not. **Asking about a fact must not be answered with a judgement** — no surfacing on
      that turn. (Pinned with material that *would* speak: `provider.answers` stays empty.)
- [x] **A question about the user**: the same moment gives an **answer** (several conclusions assembled into one
      sentence), and falls back to **surfacing** the single line when there are not two conclusions to assemble
      (ticket 11's fallback, unchanged). **This differs from leaning ② in the Comments, deliberately** — see below.
- [x] **A fragment**: no follow-up question, no pretending to understand; a feeling is **surfaced** as before
      (ticket 06's moments, one line per turn, seven-day cooldown all unchanged).
- [x] **When it cannot tell, it does not guess**: a turn that cannot be judged a question is not treated as one.
      A `statement` shape **never reaches a model at all**; an `unclear` shape on a drop read as `emotion` does not
      either.
- [x] **The port keeps up**: a new port method `judgeQuestion({ body, shape }) → { asks: false } | { asks: true, about }`,
      **implemented by both implementations** (`fake-provider.ts` and `ai/llm-provider.ts`); ticket 12's
      `satisfies Record<keyof …, true>` did force the exhaustiveness it promised (`LLM_OPERATIONS` in
      `real-provider.ts` fails the build if one is missed).
- [x] **The page**: one **drop** = the original words + its reply + its items + its terms + (when there is one)
      recall's answer and source, or the surfaced line; below that, 「接下来要做的 / 连起来的词条 / 画像」 as now.
- [x] **The three-act page is not touched**, and stays the demo's and the regression suite's reference;
      `tools/e2e-ticket-13.mjs` and everything about the three acts stays green unchanged (the file was
      `git mv`-ed to `demo.html`, which changed its address and nothing else; `main.ts` is untouched).
- [x] Four new domain checks pin the routing (a fragment produces no answer, a fact question produces no surfacing,
      an uncovered question says so, a question about the user produces an answer — ticket 11's fallback included);
      every **existing** check under `src/domain/**` stays green unchanged (163 → 167).
- [x] The DOM is not tested automatically (the spec's testing decision); the cross-layer reads are covered by a real
      HTTP e2e (`tools/e2e-ticket-15.mjs`, 10/10).
- [x] **Walked by hand once**: three fragments (one of them emotional), a question about something really said, a
      question about the user, and a question about something never said — one look at each (real DeepSeek + local
      embedding; the raw output is in the Comments).

## Comments

**2026-09-17 — opened**

**The author's words** (2026-09-17): "the product I picture should fuse **drop, ask and surface** into one; the user
only ever sees one screen, and which of the three it is should not be something the user has to care about."

**Confirmed: this is the design, not a new requirement.** The three acts are a **demo device**: the spec's 「demo
三幕」 stories are spoken by "**as a demonstrator**, I want…" (62–65), and `NEXT.md` froze that on 2026-09-14 with
"whether it grows or shrinks will be settled in practice". Fusing the three into one box follows directly from
`CONTEXT.md`'s **无感** (input without ceremony: just drop it in) and from user story 6 (the **input type** is judged
internally, **never shown to me and never asked of me**); user story 59 (the interface can be swapped wholesale for a
phone app without touching domain logic) is exactly why the tabs can retire.

**The author decided: keep both interfaces.** The three-act page stays as the reference for **the demo and the
regression suite** (a stage wants one act at a time, and `demo-script.md` is written against it); the fused page is
**the product**. Both work through the same **domain** interface and do not affect each other.

**Why this is not a reskin.** The routing decision — "is this a question", and "is it about something in the records
or about me" — is a **product rule**. This repository's repeated principle is that the page decides nothing and only
shows what the domain decided (every read in `createHandler` / `main.ts` copies the domain's answer). So it belongs
in the **domain**, which is what gives this ticket substance; but the **existing behaviour under `src/domain/**`
changes not at all** — what is added is the layer that decides what to say after the words.

**Two implementation choices left open** (recorded here, decided while implementing; ① is the leaning):

1. **Where the judgement comes from**: ① code-visible cues (question shape) plus the existing **input type**
   judgement, handing the unclear cases to a model; ② asking a model every time (more accurate, costs more);
   ③ treating any question mark as a question (cheapest, but 「下周三交提纲吗」 said to oneself would be misread).
2. **Recall before the moment, or after**: trying **recall** first and handing it to the moment only when the records
   say they do not cover it is a cheap and structurally clear reading (asking about a fact then never has a
   judgement pushed at it); the other order burns the cooldown. Recall first is the leaning.

**Explicitly not doing**: no conversation history, no multi-turn follow-up, no typewriter effect, no "clear the chat"
furniture — this product is **陪伴**, not 陪聊 (`CONTEXT.md`'s `_Avoid_`).

**Relation to 14**: the two touch almost disjoint places (14 is the thresholds in `linking.ts`; 15 is the routing and
the page), but this repository still runs tickets **serially**: 14 first (already open), 15 after it.

---

**2026-09-19 — implemented (`Status: ready-for-human`)**

**What it became.** The domain gained one task-shaped operation: `Domain.deliver(body) → { drop, speech }`. `drop` is
the delivery itself (the original, its reply, its items, its terms — the very shape `/api/drops` reports, so a
refresh shows the same thing); `speech` is one of three — `{ kind: 'recall', result }` (追溯),
`{ kind: 'surface', result }` (浮现 or an assembled answer), or `{ kind: 'none' }` (nothing beyond the drop's own
reply). **The page makes one call and gets all of it**; `POST /api/deliver` is its only write. The three-act page's
`POST /api/drop` answers with exactly the three fields it always did (pinned by the e2e).

**One cost, said out loud: `deliver` waits for that reading, and `drop` does not.** For two reasons — the routing
reads the **input type**, and this page shows the items and terms in the same delivery as the reply, so it never has
to poll. What it costs is that a very slow or stuck provider makes this page wait (the AI layer times out at 120
seconds, which degrades to "nothing was read out of it this time"; the drop itself was stored long before). The
three-act page's own route is not changed at all.

**Where the judgement comes from (the Comments' choice ①, landed).** Two readings, and only the second costs
anything:

1. `readQuestionShape(body)` in `src/domain/routing.ts` reads the **shape**: a question mark, or a phrase that only
   turns up when something is being asked for (「怎么／为什么／哪／多少／是不是」) → `question`; only a trailing
   「吗／嘛／呢」 → `unclear`; anything else → `statement`, and **no model is asked at all** (a stream of fragments
   costs nothing).
2. The port's new `judgeQuestion({ body, shape })` → `{ asks: false } | { asks: true, about: 'records' | 'self' }`
   has a model settle "is this a question, and which kind". **A judgement nobody could make (or no provider at all)
   leaves the words a fragment** — `判不出是问题，就不当问题` is a branch in the code, not an agreement.

**The input type is read in exactly one place**: when the shape is `unclear` (a trailing 「吗」 is where a question and
a thought spoken aloud look alike) and the drop was read as `emotion`, it stays a fragment without anyone being
asked — 「下周三交提纲吗」 is self-talk. A `question` shape goes to the model whatever the reader called the drop,
because swallowing a real question is the one mistake with no honest fallback.

**One correction: leaning ② in the Comments — "recall first, hand it to the moment when the records say they do not
cover it" — was overturned by the real chain.** Implemented that way, a real DeepSeek + local-embedding run of
「你觉得我最近怎么样」 got the right reading from the model (`{"asks":true,"about":"self"}`), then put the question to
the records, and they **matched**: the user was handed their own newest fragment back — 「今天你记下的是：「这几天还是
睡不好，白天没精神…」」 — as the answer to "what do you make of me". **It now goes to the moment and nowhere else**
(with too little to assemble, that is ticket 11's fallback of the one line). The trade-off that motivated the leaning
still stands ("surfacing first burns the cooldown"), but the classification has already solved the problem it was
there for: a fact question **still** never meets a judgement (it takes the `recall` arm). This is also what the
ticket's own checkbox says: 「关于用户自己的问题：走那个 moment 给答案」.

**One incidental repair (not this ticket's change, but a red script hides your own red): `tools/e2e-ticket-04.mjs`
has been failing since 14.** Ticket 14 moved `DEFAULT_LINK_POLICY` to 0.87/0.85 (commit `24fdf92`), while 04's
fixture still used a cosine of **0.8** for "a pair in the grey zone" — 0.8 now lands in the **skip** band, the judge
is never asked, and two assertions must fail. 14's Comments list the verification it ran, and **04 is not on that
list**, so it was a missed re-run rather than new breakage. Repaired exactly as 14 repaired the domain fixtures: the
`想学门乐器` vector moved to a cosine of 0.855, the strength range became `>0.85 && <0.87`, and the file says why.
**A fixture moving with a value, not a rule change**; `LinkPolicy`'s shape and `decideLink` are untouched.

**How the page is split (asked before starting; the author chose the product at `/`).** `src/web/index.html` was
**renamed** wholesale to `demo.html` (`git mv`, not one character changed in it — the evidence is that
`git diff HEAD:src/web/index.html src/web/demo.html` prints nothing), and the new `index.html` is the product — one
box. `src/web/one-box.ts` is its browser entry; `main.ts` is untouched (the three-act page is a frozen
reference). Vite got two entries (`rollupOptions.input`: `index` and `demo`), and the server needed no routing change
to serve both (`/` falls back to `index.html`, `/demo.html` is a real file).

**The cost, said out loud**: `one-box.ts` and `main.ts` share a batch of similar-looking rendering code (the
timeline, the links, the portrait, the two light actions, the deletion preview). That is the direct price of "the
three-act page is not touched": the two pages share the **domain** and not the view. Unifying them is a ticket of its
own later, and a cheap one — the shapes are identical and neither file holds knowledge the domain owns.

**This page keeps no conversation.** A recall answer and a surfaced line live on the page for that session only
(the `speeches` map, keyed by drop id); after a refresh what remains is the delivery itself and the portrait. That is
deliberate: no conversation history is part of the product, which is not a chat app.

**How the routing is observed** (both the domain checks and the e2e lean on it): the fake provider gained
`classified` (every `judgeQuestion` request), so "**nobody was ever asked**" and "somebody was asked and said no" can
be told apart in a check — both cheap arms of a fragment are the former. An unscripted `judgeQuestion` **fails on
purpose** (it does not default to "not a question"), because otherwise "a fragment gets no judgement" would pass for
a reason nobody set up.

**Checks and evidence (all green on this machine):** domain **167/167** (4 new, the existing 163 untouched), provider
**58/58** (2 new; "all nine operations" now says nine), new `tools/e2e-ticket-15.mjs` **10/10** (all four routings
over real HTTP, the page markers at `/` and `/demo.html`, `POST /api/drop`'s response shape unchanged, an empty
delivery refused with 400, and the three acts run through the fused box in demo mode), e2e 02/03/04/05/06/08/09/10/11/13
all green (04 above), `tsc` clean, `vite build` succeeds (two artifacts, `dist/web/index.html` and `demo.html`),
`check-workspace` clean.

**Another check this ticket quietly narrowed (found by re-reading it):** the "the page never offers a rating, a
like or a bulk answer" assertion in `tools/e2e-ticket-10.mjs` reads the text of
`['index.html', 'main.ts', 'style.css']`. Once the pages split, that list covered **the product page's HTML and the
three-act page's script** only — the three-act page's own `demo.html` and the product page's own `one-box.ts` were
not in it. The assertion still passed (none of those three files contains such a word), but the claim was no longer
about **both pages**: a rating button added to `demo.html` or `one-box.ts` tomorrow would not have tripped it. The
list is now `['index.html', 'one-box.ts', 'demo.html', 'main.ts', 'style.css']` — one edit, not one assertion
changed — and it is still 11/11.

**Walked by hand (real DeepSeek `deepseek-flash` + local embedding, on a throwaway database — `data/ytwins.sqlite`
was never touched):** the script and the raw output are in `archive/ytwins-15-one-box/` (not in git; the method, the
samples and the whole output are copied into this ticket so the run can be rebuilt from a clone). One look at each of
the four:

- a fragment (no feeling) → just the reply and its terms, nothing said after it ✅
- a fragment with a feeling, on its third mention → one line surfaced (with the real band and the four numbers) ✅
- a question about something really said → recall answered the fact and named **that one** drop ✅
- a question about something never said → 「留档里没有相关的记录」 ✅
- a question about the user → the moment was reached; this run got **ticket 11's fallback** (one line surfaced),
  because only one conclusion was still unheard (the sleep matter had already been surfaced and was cooling, and the
  other matter did not cross the threshold in that run). **To be precise: the assembled-answer path did not appear on
  the real chain in this walk.** It is pinned by the domain checks and by the scripted provider in the e2e (two
  conclusions → an answer). Asking the same sentence again came back `cooldown`, which shows the shared cap still
  holds on the fused page.
- a separate probe (`probe-judge-question.mjs`) recorded what the real model actually says: `self` for
  「你觉得我最近怎么样」; `records` for 「我最近在忙什么」, 「期末怎么算分」 and 「上周的会议纪要放哪了」;
  `asks:false` for the messy exam fragment (one call spent, and it was not mistaken for a question); and
  `asks:true` for 「下周三交提纲吗」 — which the model *would* misread, but the product never asks it, because the
  drop's input type settles that arm. The numbers and the raw text are in `real-chain-run.txt`.

---

**2026-09-19 — the two-axis `/code-review`, and what came of it**

Standards and Spec each ran as one sub-agent (against the working tree, base HEAD). **Changed:**

1. **`DeliveryRoute` moved out of `createDomain` into `routing.ts`, and its arms now use the port's
   `QuestionTarget`** (`'fragment' | QuestionTarget`). The same arm used to be `about: 'records'` on the port and
   `'recall'` in the route — one concept with two names. `speech.kind` still reads `recall`/`surface`, because those
   are the domain's 追溯 / 浮现 and are not the thing to rename.
2. **`QUESTION_SHAPES` deleted** (exported, read nowhere). **`judgeQuestionFallback` kept**: every other operation on
   this fake has the same "fallback + per-key table" pair, and removing it would make this one the odd one out — the
   reviewer marked it a judgement call, and the reason is recorded here.
3. **`real-provider.ts` had a wrong count in a comment** ("nine" where `LLM_OPERATIONS` has eight; "a ninth
   operation" now means the tenth) — fixed.
4. **`structured.ts` gained `matchChoice`**, shared by `requireChoice` and `requireInputType` (the latter adds
   nothing but case-normalisation, which its comment now says is the whole of the difference).
5. **`server.ts` gained `readWords`**, shared by `/api/drop` and `/api/deliver` (parse the body / empty → 400 / the
   same sentence).
6. **One check added**: only the "`unclear` + emotion → no model call" half of the input-type rule was pinned, never
   the other half — that an **explicitly marked** question from an emotional drop still goes to the model. Added
   `BOX_EMOTIONAL_QUESTION` and three assertions (it was asked, the shape handed over is `question`, and it takes the
   recall arm). That is exactly the sentence `routeDelivery`'s comment claims, and it now has a check under it.
7. **`routeDelivery`'s comment now spells out the `inputType === null` branch**: a failed reading suppresses nothing,
   so the words are judged as usual — a reading that never happened is not a judgement of "not a question", and the
   same sentence must not route two ways depending on whether a provider answered. The behaviour was right; it just
   was not written down.
8. **`SurfacingMiss`'s documentation now matches the product**: when the user **asked**, the page does report the
   reason (before ticket 15 only the three-act page's surfacing path did), while a drop still shows nothing — the
   difference is the trigger, not the reason. The old wording said "for the domain and its checks, not for the user",
   which the three-act page already contradicted (`missLine` in `main.ts`).
9. **The BOM on line 1 of `domain.test.ts` was stripped by the editing tool** (a one-line change unrelated to this
   ticket; the Spec axis caught it) — restored. That file's diff is now **258 insertions, 0 deletions**, so "every
   existing check under `src/domain/**` stays unchanged" is literally true.
10. **`tools/e2e-ticket-10.mjs`'s page list** gained `one-box.ts` and `demo.html` (see the item above: the split had
    narrowed its coverage).

**Kept, with the reason recorded:**

- **`Delivery` / `deliver` does not use `CONTEXT.md`'s word** (Standards finding 1). **Not changed; noted for
  `/domain-modeling`.** The glossary's concept here is **互动** ("one drop the user makes, plus the AI's optional
  response"), while `drop` already holds **投递**; `Delivery` is that shape. Renaming the English to `Interaction`
  would collide with the web layer's DOM-event vocabulary (in `one-box.ts` it reads like a user-input event), so this
  follows what `docs/agents/domain.md` §"Use the glossary's vocabulary" prescribes for a gap — **note it for
  `/domain-modeling`** — rather than deciding it here. If it is decided the other way, it is a mechanical rename
  (`Delivery*` → `Interaction*`, `deliver` → `interact`, `/api/deliver` with them); the bulk of it is prose in
  comments. `QuestionTarget`'s `'self'` is the same case: it is a machine value for the model to answer with (the
  other arm is `'records'`, i.e. **留档**), and the glossary calls that thing **判断** / **画像** / **答案**.
- **The duplication between `one-box.ts` and `main.ts`**: the reviewer agreed it is the trade-off the ticket
  documents, but noted the two copies **have already drifted** (`renderTerm` vs `termChips`, `settleDrop` vs
  `settleReply`), so "the merge will be cheap" needs a discount. **Recorded here**: the merging ticket aligns the two
  copies' names and signatures first, then extracts the shared module (`main.ts` only becomes editable then).
- **`NEXT.md` and `demo-script*.md` are not scope creep**: NEXT is the recovery note every ticket updates, and
  `demo-script` states the three-act page's **address**, which this ticket changed.
- **Spec finding 1** (the assembled-answer path was not observed on the real chain that run) **is not a missing
  check**: that path is pinned by the domain checks and the e2e's scripted provider (two conclusions → an answer),
  and why it is hard to hit live is written in the walk section above.
- **Spec finding 6** (the `self` arm can report `{kind:'none'}` to the page): that is what the ticket asks for — a
  question about the user may not be answered with silence — so the reason is said (see item 8).

**Numbers, re-run after those changes, all green**: domain 167/167, provider 58/58, e2e 02–15 all green (02 7/7,
03 6/6, 04 5/5, 05 5/5, 06 6/6, 08 11/11, 09 15/15, 10 11/11, 11 6/6, 13 12/12, 15 10/10), `tsc` clean,
`check-workspace` clean, `check-workspace.test.mjs` 21/21, `vite build` producing both pages.
