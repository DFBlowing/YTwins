# 14: Link thresholds — calibrating against the real embedding

**What to build:** Make the 「semantically close」 kind of **link** stop misfiring on the real embedding. First
measure the cosine distribution of a set of **labelled** term pairs with the real model, then re-set the three-band
boundaries of `LinkPolicy` (direct / grey zone / unrelated) and the grey-zone policy from what was measured — so
that the known fake link is no longer a direct edge, while genuinely related terms still link. The boundaries and
the policy stay **injected values** (`createDomain({ linkPolicy })`), not constants written into the code.

**Blocked by:** 04 (the shape of a link), 12 (the real embedding runs)

**Status:** ready-for-agent

- [ ] **Measure first; changing a number first is not allowed.** A calibration script runs the real embedding
      (`YTwins_EMBEDDING=local`, `Xenova/multilingual-e5-small`) over labelled term pairs and prints each pair's
      cosine; the sample and the full numbers go into this ticket's `## Comments`, and the script is filed as a
      throwaway under `archive/` (not committed).
- [ ] At least three kinds of sample: **positives** (genuinely related pairs), **negatives** (the known fake link
      plus plainly unrelated pairs), and **hard-edge pairs** (said together in one **drop**, semantically ordinary —
      they are not supposed to need a similarity edge).
- [ ] Put the two measured distributions (positives / negatives) in front of the author together with what each of
      the two ways out costs, and let the author choose:
      ① **widen the grey zone** (raise the direct gate above the positives' measured floor and lower the unrelated
      gate below the negatives' ceiling, handing everything in between to `judgeLink`) — what the three-band design
      intended, at the cost of one extra call per grey pair (a call is very cheap);
      ② **switch to an embedding whose distribution is wider** (the candidate is `Xenova/bge-small-zh-v1.5`,
      measured at 0.37–0.63, but everything has to be recalibrated and it only covers Chinese while the current one
      is multilingual).
- [ ] The known fake link is no longer a direct edge: on the real chain `琴行的帖子 × 下周三交提纲` (measured at
      0.852) must not become a **link**, or at least not a direct 「semantically close」 one (letting `judgeLink`
      rule against it is allowed).
- [ ] Genuinely related pairs still link: `期末怎么算分 × 平时分 40%` (measured 0.895) and `想学吉他 × 琴行的帖子`
      (0.882) keep their edges, with strengths still comparable.
- [ ] None of ticket 04's rules changes: one **link** per pair, a **hard edge overrides a similarity edge**, two
      vectors of different dimensions are never compared, and `judgeLink` is called only in the grey zone; if
      `LinkPolicy`'s shape (`directAtLeast` / `unrelatedAtMost` / `greyZone`) needs to change, it still stays an
      injected value.
- [ ] The domain tests stay green **unchanged** (the thresholds were injected all along), with 2–3 new checks
      pinning the new boundaries (an edge, no edge, and who is asked in the grey zone).
- [ ] Demo mode is unaffected: the preset provider scripts no vectors, so the semantic half never forms an edge at
      all (`tools/e2e-ticket-13.mjs` already pins this — the three acts produce `same-drop` edges only).
- [ ] Walked by hand on the real chain (needs a key, a network, and a little money): drop a few real fragments and
      check that 「连起来的词条」 holds no fake links; where `judgeLink` is called, print its verdict and reason for a
      human to read.

## Comments

**2026-09-17 — opened (not started)**

**Why this ticket exists.** When ticket 12 landed the real provider, the measurement was: the cosine distribution of
`Xenova/multilingual-e5-small` is **very tight** — related pairs 0.88–0.91, unrelated pairs 0.84–0.88 (`query: `
prefix; the three samples are in `NEXT.md`'s 「下一步」 item 2 and ticket 12's Comments item 9), while
`src/domain/linking.ts` defaults to 「**≥ 0.85 direct / ≤ 0.7 unrelated / in between, ask `judgeLink`**」. The two
distributions **overlap**, so:

- raising the direct gate above 0.91 loses some genuinely related pairs;
- lowering the unrelated gate below 0.84 widens the grey zone and sends more pairs to `judgeLink` (a call is very
  cheap, and this is the design's intent);
- as long as the **direct** band sits inside the overlap, something will misfire — and one already has:
  `琴行的帖子 × 下周三交提纲 = 0.852 → direct`.

**This is not a defect of 12, and not a leftover of 13.** The spec lists 「thresholds / grey-zone boundaries / topic
overlap ratio」 as **values not yet fixed**, carried by configurable constants and calibrated against real data later;
and ticket 13's demo runs on the preset provider, never touching an embedding, so act three cannot have a fake link
beside it. This ticket is that calibration.

**The one question for the author before starting** (NEXT item 2 asks for it): whether to ① widen the grey zone and
let `judgeLink` decide, or ② switch the embedding model. It is asked after measuring, with the distributions in hand,
and not presumed.

**What gets measured, and what counts as done.** The calibration needs the cosine values of **one set of term pairs**
under the real model, sampled from the terms this product really meets (the user's own wording), not from a general
corpus. There are two criteria: ① the known fake pair is no longer a direct edge; ② the known related pairs still
link. Every other number is adjustable.

**What this ticket does not touch**: where `LinkPolicy` lives or what shape it has
(`src/domain/linking.ts`, injected into `createDomain`), the `same-drop` hard edge (no model, always strongest),
demo mode, and the preset material.
