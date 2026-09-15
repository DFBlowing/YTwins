# 04: Terms and links — connecting the fragments

**What to build:** Every drop yields **terms**, keeping the user's own wording ("wants to learn guitar", not "music
interest"). **Links** grow between terms automatically, in two kinds: a zero-model hard edge for terms that appear
in the **same drop**, and a semantic-similarity edge (pretrained-embedding cosine over a **threshold**, handled in
three bands: high connects, low skips, the **grey zone** calls `judgeLink` or is left unlinked for now). Every link
carries a comparable strength and a reason for existing, readable by the user.

**Blocked by:** 02 (The shape of catching — auto-splitting items and records)

**Status:** ready-for-human

- [x] Extracted **terms** keep the user's own wording instead of being rewritten into a higher-level concept.
      → A term *is* the raw string from `ExtractResult.terms`, trimmed and stored verbatim (`toTerm` in
      `src/domain/core.ts`, `recordExtraction` in `sqlite-store.ts`). The checks assert "报个吉他班" and
      "想去爬山" character for character; if a provider rewrote "想学吉他" into "音乐兴趣", that rewrite is
      what the page would show — nothing in between normalises it.
- [x] Terms appearing in the same drop grow a hard-edge link with no model call anywhere in the path.
      → `recordSameDropLinks()` in `src/domain/core.ts`: one edge per pair of terms said together, strength
      fixed at `SAME_DROP_STRENGTH = 1`, reason "appeared in the same drop", written without reading anything
      and with no provider involved. The check uses a provider whose `embed` and `judgeLink` both **hang**:
      the edges still appear, and both `provider.embedded` and `provider.judged` are empty.
- [x] Semantic links are decided by term-vector cosine similarity in three bands: high similarity connects, low similarity skips, the grey zone calls `judgeLink`.
      → The cosine and the bands live in `src/domain/linking.ts` (`cosineSimilarity` / `decideLink`), the
      comparison in `linkInto()` in `core.ts`. Each of the three paths has its own check: 1.00 connects with
      `provider.judged` empty, 0.00 does not, and 0.80 lands in the grey zone and is put to `judgeLink`
      **exactly once** — a "no" leaves the pair unlinked, and a judge that blows up is treated as no answer
      rather than as a yes.
- [x] The grey-zone policy (call `judgeLink`, or leave unlinked for now) is carried by a configurable constant so the rule can be changed later.
      → `LinkPolicy.greyZone: 'judge' | 'skip'` (the default is `'judge'`), folded together with the two
      bounds into `decideLink()`'s answer of `'link' | 'ask' | 'skip'` — all three readings live in
      `linking.ts`, so a caller never has to combine "which band" with "what the policy says about it".
      A check pins the policy to `'skip'`: the same 0.80 pair stays unlinked and `provider.judged` is empty.
- [x] Every link records a comparable strength and a "why it connected" reason.
      → Both kinds share one scale: a hard edge is fixed at 1 (saying two things in one breath is certain, so
      there is nothing to estimate), a semantic edge carries the cosine it actually got. The reason is plain
      words: `出现在同一次投递里` / `语义相近（相似度 0.90）` / `语义相近（灰区判定，相似度 0.80）`.
      A check asserts a hard edge outranks a similar one and that the two reasons differ, so "comparable" is
      not just a claim.
- [x] The similarity threshold and grey-zone bounds are carried by configurable constants, not scattered through the implementation.
      → All of it is `LinkPolicy` (`connectAbove` / `skipBelow` / `greyZone`), handed to the core through
      `DomainCoreOptions.linkPolicy` and defaulting to `DEFAULT_LINK_POLICY` (0.85 / 0.7 / `judge`). A check
      swaps in 0.75 / 0.5 and the same 0.80 pair connects on its score alone, with no judge consulted —
      the numbers really drive behaviour rather than sitting in the implementation as decoration.
- [x] The fake provider returns deterministic vectors and deterministic `judgeLink` verdicts, so link results are fully assertable in tests.
      → `embedByText` (one vector per text, reassembled in `request.texts` order) and `judgeLinkByPair` /
      `judgeLinkFallback` (`{ kind: 'verdict', related }`), plus `embedded` / `judged` logs to assert
      against. Pairs are keyed with `pairKey()`, so a check never has to know which end the core calls
      `from` (one check pins that by writing the key the other way round). Unscripted encoding or judging
      **fails** rather than inventing a vector or a verdict, following the rule `composeAnswer` already had.

## Comments

### 2026-09-15 — revisions after the two-axis `/code-review`

Both axes found real problems. All of them are fixed.

**Spec axis.**

1. **The page could not reliably show this ticket's own product.** `loadLinks()` ran once, straight after
   `settleDrop()`, which returns as soon as `drop.extracted` — at which point `linkInto()` (encode + judge)
   was still in flight, so only the hard edges were drawn and a similarity edge needed a refresh. Now
   `settleLinks()` re-reads the list over a bounded handful of rounds (`LINK_GRACE_POLLS = 4`, about a
   second) after the reading lands. Every link on screen is real; one decided after that appears on the next
   load. It is deliberately **not** made a guarantee at the moment of writing: a similarity edge has to wait
   for an embedding call, and that is what it is.
2. **`package.json`'s `test:e2e` was changed in passing.** It ran ticket 02's script only; I had re-pointed
   it at `02 → 03 → 04`. Nothing in this ticket asked to redefine the project's default entry point, so it is
   back as it was, and each script is run by the path `tools/README.md` lists.
3. **The hard-edge rule used to live in the storage adapter.** The first version had `sqlite-store.ts` build
   the hard edges, which meant importing `SAME_DROP_STRENGTH` / `SAME_DROP_REASON` — a storage layer holding
   product copy and a distillation rule, the opposite of the spec's "distillation in the domain core, storage
   only carries". The core now writes them in `recordSameDropLinks()`, and the store offers only
   `recordLinks()` (one row per pair, a later write replacing an earlier one; **which link a pair has is the
   core's decision**). The price is that hard edges no longer share the extraction transaction: a failed
   write costs links, not words the user said, which is acceptable at this size and is written into the port
   docs in `storage.ts`.

**Standards axis.**

4. **"What the grey zone does" used to live in two modules.** `linking.ts` claims all three decisions are
   its own, yet `greyZone === 'skip'` was in `core.ts`. It is now folded into `decideLink()`, which answers
   `'link' | 'ask' | 'skip'`, so a caller never recombines the band with the policy. `bandFor()`, the
   intermediate that reported only the band, went with it — it invited callers to reimplement the other half.
5. **A pair had three spellings.** The core's `pairKey`, the store's `orderedPair` and the fake's
   `${from}\u0000${to}` were written separately; now `linking.ts` exports one of each, used in all three
   places, and the fake's "look it up both ways round" collapsed into a single lookup.
6. **`LINK_KINDS` was a fourth copy of the vocabulary.** The storage layer listed `'same-drop' | 'similar'`
   itself; it now uses the `LINK_KINDS` exported from `interface.ts`, the same shape `INPUT_TYPES` already has.
7. **A constant in the test file had been written wrong and never used** (`HILL_TERMS`) — deleted; `NewLink`'s
   fields got the doc comments its siblings have; a comment about terms that sat above the delete statements
   in `recordExtraction` was moved to where it belongs.

**Three checks added while fixing the above** (each was confirmed to fail against the old code first). A hard
edge **outranks** an earlier similarity edge for the same pair (the old code was first-writer-wins, which
contradicted the ticket's own claim). Two older terms whose vectors were **both missing** must be compared in
the round that finally encodes them (the old loop only compared "said today × everything else", leaving that
pair hanging forever). And vectors from **two different models** are never compared: `cosineSimilarity` used
to truncate to `Math.min(a.length, b.length)`, so a 3-wide and a 2-wide vector produced a similarity of 1.00
on their common prefix — and the spec allows swapping the embedding implementation. Different widths and
zero-direction vectors now return `null` — **incomparable**, not "unlike" — and the core skips them.

### 2026-09-15 — implementation complete

**What this ticket did.** A drop now yields **terms** alongside its **items** and **record**; terms grow
**links** from two sources, both carrying a strength and a reason, and both genuinely readable (act one lists
every term and every link). Three things stay separate:

1. **Extraction** (`extract` returns one more field, `terms`) writes rows into `term_`, deduplicated by the
   literal wording.
2. **Hard edges** (zero model) are written by the core as soon as the terms are stored, and mean "these were
   said in the same breath".
3. **Similarity edges** (cosine, three bands) run in the background on their own; the vectors live in
   `term_.vector` and never leave the domain.

**Deduplication is literal, not model-driven.** "想去学吉他" said again is the **same** term (`term_.text` is
unique); "学吉他" is a different one that a similarity edge may later join. Letting a model decide whether two
phrasings are one concept would replace the user's wording with the model's, which is the one thing this
ticket exists to prevent — and literal deduplication is what lets "said three times" actually accumulate,
which is exactly what ticket 05's **threshold** needs to count. `term_in_drop_` records *which drop said it*,
so a repeat mention adds a mention rather than moving the term or forging a new one.

**A few decisions that are not obvious.**

1. **With nobody to compare against, not a single vector is computed.** `linkInto()` returns early when the
   drop's terms are the only terms there are, so the very first fragment a user drops costs no embedding call
   at all; a term is encoded the first time it has a partner. A check pins this with a provider whose `embed`
   hangs. The cost is that one drop may encode both what was said today and what was said earlier but never
   embedded.
2. **Every pair is decided in the round where the *later* of its two ends gains a vector.** The comparison
   loop therefore runs from the terms encoded this round against everything that now has a vector, not just
   "said today × everything else": two older terms that a provider outage left unencoded must be compared
   with each other on the round that finally encodes them, or that pair hangs forever. This is the form in
   which "a pair is compared exactly once" is actually true.
3. **Encoding is all-or-nothing, and the vectors are stored first.** A provider that returns one vector too
   few, or a ragged one, costs the links for that round — but the terms were stored before this ran. Guessing
   at the missing measurements would be worse.
4. **Incomparable vectors return `null`, not 0.** Different widths (a swapped embedding implementation) or no
   direction (a provider saying it has nothing to compare) are not "unlike" but "not compared", so
   `cosineSimilarity()` returns no number and the core skips the pair. Truncating to the common prefix would
   stitch two models' numbers into an apparent 1.00 and turn that into a link.
5. **One link per pair, and the hard edge wins.** When a pair was both said together and semantically close,
   the later write replaces the earlier one, and the core guarantees the direction: a hard edge overwrites a
   similarity, never the reverse. Ticket 05 counts how many terms are connected, and counting the same pair
   twice would quietly lower that bar. `UNIQUE (a_term_id, b_term_id)` with one written form per pair
   (`orderedPair()`) enforces it; **which link a pair has is the core's decision**, and the store's job is
   only "one row per pair".
6. **The grey-zone verdict is a boolean, not a score.** The whole point of the call is to settle a band the
   domain has already measured; a second number on a different scale would only invite the two to be
   compared. The reason text says the pair was judged, while the strength stays the cosine — the two cannot
   tell different stories.
7. **No vector on the interface.** `Term` carries `id/text/dropId/firstSeenAt`, and a check asserts the key
   set explicitly, the same way ticket 02 kept the input type off the page. A cosine is not a confidence
   (research §6.1), and showing it would read as a probability.

**The page.** Act one now shows a row of **terms** under each drop (chips, in the user's own words) and a
section below listing the **links**: `「期末怎么算分」 — 「下周三交提纲」` plus the reason and the strength. A
link does not hang under any drop, because it is not any drop's property — it is what the drops added up to,
which is why it gets a section of its own. `/api/links` is its own endpoint. After a drop, the link list is
given a bounded grace (`LINK_GRACE_POLLS = 4`, about a second), because the semantic half waits on an
embedding call; everything drawn after that grace is real, and the rest appears on the next load.

**Preset data.** `demo-provider.ts` gives the demo fragment four terms (including 「好烦」 — a feeling is a term
too, and it is what ticket 05's threshold will count connections to), so act one really does grow six hard
edges. **No embedding is scripted**: all four were said in one drop, so the semantic half has no partner yet;
it gets one when a second fragment arrives, which is ticket 05's and 06's material and where a vector per
term belongs.

**Tests and verification.** Domain **80/80** (19 new, all driven through the domain interface with the fake
provider); new `tools/e2e-ticket-04.mjs` **5/5** (real HTTP: terms cross the wire in the user's words, three
hard edges with reasons, no vector leaked, a cross-drop grey pair judged and linked, all of it still there
after a restart); `e2e-ticket-02` 7/7 and `e2e-ticket-03` 6/6 still green; `tsc --noEmit` clean, `vite build`
succeeds, `check-workspace` clean. The real server was walked by hand through act one: dropping the demo
fragment produced four terms and six "appeared in the same drop" links.

**What the next ticket inherits.** Ticket 05's "the threshold is a count" can now be counted: term identity is
stable (literal deduplication), each pair contributes exactly one edge, and every edge carries a comparable
strength. The three parameters (threshold value, debounce window, relevance-score shape) and ticket 06's
tone mapping still go through a prototype first, as NEXT.md schedules.
