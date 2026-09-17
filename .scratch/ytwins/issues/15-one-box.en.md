# 15: One box — collapsing drop, ask and surface into one thing the user does

**What to build:** The user sees one input box, and everything they say in passing goes into it. Telling "this is a
fragment" apart from "this is a question" is the **product's** job, not the user's — so it is neither a choice the
user makes nor a guess the page makes. The original words always become a **drop** first (stored verbatim), and then
the product decides what else to say: a question about something in the **records** → **recall** (stated plainly,
naming its source); a question about the **user themselves** → the same moment gives an **answer**; a plain fragment
→ only the drop's own reply, plus the line **surfaced** when it carries a feeling. The three-act page stays exactly
as it is, as the demo's and the regression suite's reference.

**Blocked by:** 07 (recall), 11 (the answer), 13 (the demo page and the preset material)

**Status:** ready-for-agent

- [ ] One input box: no tabs, no separate way in for 「问」, no controls for type / time / tags.
- [ ] Every fragment is **stored first** (the drop's promise of a faithful record is unchanged), and what the user
      gets back is a **reply**, plus the **items** and **terms** it yielded when it has any.
- [ ] **Routing is the domain's rule, not the page's `if`.** The page hands over the original words and shows what
      the domain decided — as one **task-shaped** operation (named from `CONTEXT.md`'s words: 投递 / 追溯 / 浮现),
      rather than the page stitching together `drop` + `recall` + `surface` itself.
- [ ] **A question about a fact**: answered plainly with its source when the records cover it, and a plain "found
      nothing" when they do not. **Asking about a fact must not be answered with a judgement** — no surfacing on
      that turn.
- [ ] **A question about the user**: the same moment gives an **answer** (several conclusions assembled into one
      sentence), and falls back to **surfacing** the single line when there are not two conclusions to assemble
      (ticket 11's fallback, unchanged).
- [ ] **A fragment**: no follow-up question, no pretending to understand; a feeling is **surfaced** as before
      (ticket 06's moments, one line per turn, seven-day cooldown all unchanged).
- [ ] **When it cannot tell, it does not guess**: a turn that cannot be judged a question is not treated as one —
      better to say one line less than to answer a thinking-out-loud sentence as if it were a question.
- [ ] **The port keeps up**: judging "is this a question, and which kind" needs a home (a new port method, or a
      widened `parseQuestion` — decided when implementing); **both implementations** must provide it, and ticket
      12's `satisfies Record<keyof …, true>` will fail the build if one is missed.
- [ ] **The page**: one **drop** = the original words + its reply + its items + its terms + (when there is one)
      recall's answer and source, or the surfaced line; below that, 「接下来要做的 / 连起来的词条 / 画像」 as now.
- [ ] **The three-act page is not touched**, and stays the demo's and the regression suite's reference;
      `tools/e2e-ticket-13.mjs` and everything about the three acts stays green unchanged.
- [ ] Two or three new domain checks pin the routing (a fragment produces no answer, a fact question produces no
      surfacing, a question about the user produces an answer); every **existing** check under `src/domain/**` stays
      green unchanged.
- [ ] The DOM is not tested automatically (the spec's testing decision); the cross-layer reads are covered by a real
      HTTP e2e (`tools/e2e-ticket-15.mjs`).
- [ ] **Walked by hand once**: three fragments (one of them emotional), a question about something really said, a
      question about the user, and a question about something never said — one look at each.

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
