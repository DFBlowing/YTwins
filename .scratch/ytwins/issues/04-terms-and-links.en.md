# 04: Terms and links — connecting the fragments

**What to build:** Every drop yields **terms**, keeping the user's own wording ("wants to learn guitar", not "music
interest"). **Links** grow between terms automatically, in two kinds: a zero-model hard edge for terms that appear
in the **same drop**, and a semantic-similarity edge (pretrained-embedding cosine over a **threshold**, handled in
three bands: high connects, low skips, the **grey zone** calls `judgeLink` or is left unlinked for now). Every link
carries a comparable strength and a reason for existing, readable by the user.

**Blocked by:** 02 (The shape of catching — auto-splitting items and records)

**Status:** ready-for-agent

- [ ] Extracted **terms** keep the user's own wording instead of being rewritten into a higher-level concept.
- [ ] Terms appearing in the same drop grow a hard-edge link with no model call anywhere in the path.
- [ ] Semantic links are decided by term-vector cosine similarity in three bands: high similarity connects, low similarity skips, the grey zone calls `judgeLink`.
- [ ] The grey-zone policy (call `judgeLink`, or leave unlinked for now) is carried by a configurable constant so the rule can be changed later.
- [ ] Every link records a comparable strength and a "why it connected" reason.
- [ ] The similarity threshold and grey-zone bounds are carried by configurable constants, not scattered through the implementation.
- [ ] The fake provider returns deterministic vectors and deterministic `judgeLink` verdicts, so link results are fully assertable in tests.
