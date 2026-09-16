# 06: Surfacing — the one line after an emotional drop

**What to build:** When the user makes an **emotional drop** (and not at any other time), the system attempts to
**surface** one **conclusion**: nothing is pushed proactively, at most one per turn, the same topic surfaces only
once per 7 days, and the wording is always uncertain in tone ("you seem…", "lately you…"). The strength of the
wording is decided by **explainable numbers** (supporting term count, average link strength, time span) rather than
by the model picking a tone on the spot — so that "why did you say that back then" remains answerable. With
insufficient support it prefers not to surface, or says plainly "I'm not really sure".

**Blocked by:** 05 (Threshold assembly — the first conclusion, portrait and conclusion chain)

**Status:** ready-for-agent

- [ ] Surfacing is attempted only on an **emotional drop** or a user's explicit question; other drops never trigger it.
- [ ] At most one item surfaces per turn; zero is a normal result (in cooldown, or insufficient support), not an error.
- [ ] The same topic does not surface twice within **7 days**.
- [ ] A **topic** is engineered as "semantic overlap of the supporting term sets" — overlap above an internal ratio carried by a configurable constant counts as the same topic.
- [ ] Surfaced content is always uncertain in tone, and the strength of the wording is mapped from explainable numbers — supporting term count, average link strength, time span — never chosen freely by the model. **Uncertain tone is a register, not a fixed template**: "you seem…" is one example among many, and the same band admits "it looks like…", "it sounds like…", "could it be…" and more. Check whether the sentence is stated as an assertion, not whether a particular word appears.
- [ ] Uncertain tone applies only to **judgments** (**answers** and **surfacings**); it never rewrites an ordinary **reply**. The test is in `CONTEXT.md` under 判断 / 事实: what it constrains is a **judgment**, not a **fact** — content already determinate outside the user is stated plainly, and hedging a fact is equally dishonest. **Recall** answers facts, so it is outside this rule (07 is done and its answers are statements); do not hedge those too.
- [ ] With insufficient support it does not surface, or says plainly "I'm not really sure", rather than burning trust with an assertion.
- [ ] Every surfacing leaves a record, so cooldown still holds after a restart.

## Comments

**2026-09-15 · inputs carried over from the prototype that ran before 05 (constraints for the implementation, not a widening of this ticket's scope)**

1. **Keep the three moments apart.** A drop's **reply** is immediate (ticket 03, done); **judging** is debounced and
   invisible to the user (ticket 05); **surfacing** is the visible one, and happens only at the moments this ticket
   defines. So the debounce window never makes the user wait — but **when the user asks, a judgement must be run on
   the spot before answering**, or the last few sentences would not be counted and the answer would read as stale.
2. **Mystery and randomness belong here, not in 05.** The author wants the internal logic not to be legible; that is
   ineffective at the judging layer (the user cannot see it), so it belongs here: when the moment arrives, it may
   flip a coin for whether to surface at all, which of the eligible conclusions to surface, and which phrasing of
   the same band to use. **An explicit question from the user is always answered, never rolled for.** The
   "alternating judgement timing" in 05 stays as it is; it does not carry the mystery.
3. **Catching and the wording bands divide the work** (`CONTEXT.md` now has 承接): the weak/medium/strong bands apply
   only to **judgments**; **catching** is the substitute when support is too thin (by default under 3 supporting
   terms), and since it makes no judgment it takes **no** uncertain wording ("那样真好。", not "你似乎松了口气") —
   hedging a catch is another kind of dishonesty.
4. **The band gates** (shared with 05, already decided): medium at "terms ≥ 3 and span ≥ 3 days"; strong at
   "terms ≥ 6 and span ≥ 14 days and average connection strength ≥ 0.80". **The sentence always follows the newest
   feeling in that matter** — the author measured it: 好烦 first and 松了口气 last used to be answered with
   "心里一直不太顺", which was wrong.
5. **The same-matter rubric**: "literal overlap ÷ the smaller side" at 0.50, with shared terms **weighted by rarity**
   (`weight = 1 / matters the term spans`). Note what 05 measured: the ratio knob **cannot separate** a misfire from
   a genuine continuation (they score identically), so do not rely on tuning the ratio here — use the weighted rubric.
