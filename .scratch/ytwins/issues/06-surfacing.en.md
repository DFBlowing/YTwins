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
