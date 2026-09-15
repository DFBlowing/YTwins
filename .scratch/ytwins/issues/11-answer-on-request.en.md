# 11: Asking directly — one observation (an answer)

**What to build:** When the user asks directly "what do you think of me lately", they get one observation: several
**conclusions** assembled into a single sentence that could only come from the user's own data, never a truism that
would fit anyone; the wording is uncertain in tone and states what supports it; with insufficient support it prefers
to say nothing or says plainly "I'm not really sure".

**Blocked by:** 06 (Surfacing — the one line after an emotional drop)

**Status:** ready-for-agent

- [ ] An explicit user question returns an **answer** assembled from several **conclusions**, not a restatement of one.
- [ ] The answer could only have grown out of the user's own data; a test asserts this by showing it cannot answer under a different data set.
- [ ] The answer is always uncertain in tone, with wording strength mapped from explainable numbers (sharing one mapping with **surfacing**).
- [ ] The answer shows which **conclusions** / **terms** support it.
- [ ] With insufficient support it returns "I'm not really sure" or explicitly withholds an answer, never fabricating one.
- [ ] Asking directly and **surfacing** share one cooldown and one per-turn cap, so the two never each produce an item in the same turn.
