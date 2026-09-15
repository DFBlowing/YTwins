# 05: Threshold assembly — the first conclusion, portrait and conclusion chain

**What to build:** Out of the user's sight, when an emotion or decision connects to enough **terms** to cross the
**threshold**, it assembles into a plain-language **conclusion** (say "you seem to really want to learn guitar"),
storing the supporting terms alongside it. Assembly is **debounced**: the threshold is not judged right after every
drop, but "after a quiet stretch" or "after N accumulated drops", so a few mutually-contextual sentences are not
prematurely assembled into a wrong conclusion. The user can see the **portrait** (which is the set of conclusions
itself, not another hidden model) and the **conclusion chain** (read-only by default, viewable at will), with each
conclusion listing the terms that support it.

**Blocked by:** 04 (Terms and links — connecting the fragments)

**Status:** ready-for-agent

> **Run a prototype first to find the numbers** (settled 2026-09-15). This ticket's three constants — the
> **threshold value**, the **debounce window**, and the relevance-score rubric — cannot be pinned down by reading
> the spec; they need to be played through against real terms and links to develop any feel. So **before**
> implementing this ticket, run a throwaway prototype answering four questions: ① how many drops should it take
> before a conclusion is due, and where are the too-early / too-late boundaries; ② when several related sentences
> are dropped in a row, is one assembled conclusion right or is one conclusion each right; ③ does judging "same
> topic" by semantic overlap of term sets actually lump two different things together; ④ does the
> support-strength → wording-strength mapping read as insight or as awkwardness.
> The numbers found feed back into this ticket's constants, while the prototype itself stays on a throwaway branch
> per `/prototype`'s rules and never enters `src/`. The findings from questions ③ and ④ also affect **06**
> (surfacing) and should be carried over when it is built.

- [ ] The **threshold** is a count gate (enough terms connected), not a time gate.
- [ ] Below the threshold no **conclusion** appears; crossing it produces a conclusion carrying its full supporting term list.
- [ ] The threshold value, the relevance-score rubric, and the debounce window are carried by configurable constants; initial values are set so that the demo's act ③ preloaded data necessarily triggers, without every drop triggering.
- [ ] Debouncing works: a few mutually-contextual consecutive drops do not assemble a wrong conclusion immediately after the last one, but only once the quiet period or the accumulation count is met.
- [ ] A **conclusion** is a plain-language declarative sentence the user can immediately judge right or wrong.
- [ ] What the **portrait** reads back is the set of conclusions itself; no second model hidden from the user exists.
- [ ] The **conclusion chain** is read-only by default, viewable on the page, showing each conclusion's supporting terms and its revises/revised-by relations.
- [ ] The user can see which terms support any given conclusion.
- [ ] The whole **settling** process needs no user participation; the page offers no step the user must maintain.
