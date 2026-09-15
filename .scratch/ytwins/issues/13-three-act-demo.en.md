# 13: Three-act demo — preloaded data and repeatability

**What to build:** Three actions run stably and repeatably on preloaded data: ① **Drop** — drop a messy input
containing the teacher's grading rules plus one emotional sentence, pick no type and fill in no time, and it splits
into an **item** and a **record**; ② **Ask** — ask "how is the final graded" from a "a few days later" viewpoint and
get an accurate answer naming the **drop** it came from; ③ **Surface** — drop one more emotional sentence and one
**conclusion** surfaces in **uncertain tone**, supported by **enough preloaded terms**. The page also states plainly
which part of the data leaves this machine.

**Blocked by:** 06 (Surfacing — the one line after an emotional drop), 07 (Recall — asking about an old thing, answered with its source), 12 (Real provider — cloud LLM + local embedding + switchable)

**Status:** ready-for-agent

- [ ] Act ①: a messy input containing grading rules and one emotional sentence, with no type picked and no time filled in, splits into an **item** and a **record**.
- [ ] Act ②: asking "how is the final graded" from a "a few days later" viewpoint returns an accurate answer naming the **drop** it came from.
- [ ] Act ③: one more emotional sentence surfaces one **conclusion** in **uncertain tone**, supported by **enough preloaded terms**.
- [ ] All three acts share one set of preloaded data, and that set is the same one the domain tests use.
- [ ] The three acts can be re-run back to back with unchanged results (one preloaded data set, one chain, no luck involved).
- [ ] The page states plainly which part of the data leaves this machine (at the demo stage: the original text sent to the cloud LLM), with embeddings staying local.
- [ ] The whole demo needs no account and no sign-up over the network; there is no system-level push or reminder.
- [ ] The demo script is written into the repo in Chinese so it can be reproduced later.
