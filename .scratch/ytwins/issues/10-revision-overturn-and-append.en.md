# 10: Revision — marking "that's wrong" and appending your own sentence

**What to build:** The user can mark a **conclusion** as "that's wrong", and that negation becomes an **overturning**
on the **conclusion chain**: the original conclusion is kept, never overwritten or deleted, and the new judgement
stands in an overturning relation to it. The user can also append a sentence of their own beside a conclusion, and
that sentence itself becomes a new **drop** entering the same chain and continuing to settle.

**Blocked by:** 05 (Threshold assembly — the first conclusion, portrait and conclusion chain)

**Status:** ready-for-agent

- [ ] After marking "that's wrong", the overturned conclusion **is still on the conclusion chain** and viewable.
- [ ] After marking "that's wrong", a new record appears on the chain in an **overturning** relation to the old conclusion, naming which one it supersedes.
- [ ] The **conclusion chain is append-only**: no revision overwrites or physically deletes an old conclusion.
- [ ] Appending a sentence beside a conclusion stores that sentence as a new **drop**, keeping the original wording.
- [ ] That appended sentence also yields **terms** and takes part in later **settling**.
- [ ] There is no rating, liking, or bulk-feedback feature — a behavioural assertion covers this red line of **imperceptibility** (no such entry point exists in the UI).
