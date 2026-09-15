# 07: Recall — asking about an old thing, answered with its source

**What to build:** Ask a question against the **records** (say "how is the final graded") and get an accurate answer
together with the **drop** it came from, checkable against the verbatim original text. When recall comes up short it
says **plainly that it found nothing** rather than inventing a plausible-sounding answer. So that this step can be
verified independently and early, the user can pin a "what day is it" time basis by hand instead of waiting days.

**Blocked by:** 01 (Project skeleton and the first "drop" end to end)

**Status:** ready-for-agent

- [ ] When a question hits a **record**, it returns an accurate answer and names the **drop** it came from.
- [ ] When recall comes up short, it returns an explicit "found nothing" and generates no plausible-sounding answer.
- [ ] The answer is traceable to the verbatim original text (the same content the user typed, byte for byte).
- [ ] Both question parsing and answer generation go through the **AI provider port**, so tests using the fake provider are deterministic.
- [ ] The user can pin a time basis by hand (for the demo's "a few days later" viewpoint); that basis affects answer wording and time references but never changes what is recalled.
