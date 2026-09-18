# 14: Link thresholds — calibrating against the real embedding

**What to build:** Make the 「semantically close」 kind of **link** stop misfiring on the real embedding. First
measure the cosine distribution of a set of **labelled** term pairs with the real model, then re-set the three-band
boundaries of `LinkPolicy` (direct / grey zone / unrelated) and the grey-zone policy from what was measured — so
that the known fake link is no longer a direct edge, while genuinely related terms still link. The boundaries and
the policy stay **injected values** (`createDomain({ linkPolicy })`), not constants written into the code.

**Blocked by:** 04 (the shape of a link), 12 (the real embedding runs)

**Status:** ready-for-human

- [x] **Measure first; changing a number first is not allowed.** A calibration script runs the real embedding
      (`YTwins_EMBEDDING=local`, `Xenova/multilingual-e5-small`) over labelled term pairs and prints each pair's
      cosine; the sample and the full numbers go into this ticket's `## Comments`, and the script is filed as a
      throwaway under `archive/` (not committed).
- [x] At least three kinds of sample: **positives** (genuinely related pairs), **negatives** (the known fake link
      plus plainly unrelated pairs), and **hard-edge pairs** (said together in one **drop**, semantically ordinary —
      they are not supposed to need a similarity edge).
- [x] Put the two measured distributions (positives / negatives) in front of the author together with what each of
      the two ways out costs, and let the author choose:
      ① **widen the grey zone** (raise the direct gate above the positives' measured floor and lower the unrelated
      gate below the negatives' ceiling, handing everything in between to `judgeLink`) — what the three-band design
      intended, at the cost of one extra call per grey pair (a call is very cheap);
      ② **switch to an embedding whose distribution is wider** (the candidate is `Xenova/bge-small-zh-v1.5`,
      measured at 0.37–0.63, but everything has to be recalibrated and it only covers Chinese while the current one
      is multilingual).
      The author chose ①; the direct gate was then moved from 0.86 to **0.87** on the measured batch-size noise
      (see Comments).
- [x] The known fake link is no longer a direct edge: on the real chain `琴行的帖子 × 下周三交提纲` (measured at
      0.852) must not become a **link**, or at least not a direct 「semantically close」 one (letting `judgeLink`
      rule against it is allowed).
- [x] Genuinely related pairs still link: `期末怎么算分 × 平时分 40%` (measured 0.895) and `想学吉他 × 琴行的帖子`
      (0.882) keep their edges, with strengths still comparable.
- [x] None of ticket 04's rules changes: one **link** per pair, a **hard edge overrides a similarity edge**, two
      vectors of different dimensions are never compared, and `judgeLink` is called only in the grey zone;
      `LinkPolicy`'s shape (`connectAbove` / `skipBelow` / `greyZone`) did not gain or lose a field, and it is still
      an injected value.
- [x] The domain tests' **rule assertions** stay green unchanged, with 4 new checks pinning the new boundaries
      (an edge, no edge, who is asked in the grey zone, and demo mode having hard edges only). **One exception, put
      to the author and agreed**: three grey-zone fixtures moved from cosine 0.8 to 0.855 (two are "a pair in the
      grey zone is judged", one is "a judge that blows up still links nothing") — they test "the pair in the grey
      zone", and the grey zone itself moved with the calibration (0.8 is now in the unrelated band, which would have
      left the "blows up" check passing vacuously). This is a fixture following a value, not a rule change; the
      ticket originally said "not one line", which is not what the measurement allows, and that is recorded here.
- [x] Demo mode is unaffected: the preset provider scripts no vectors, so the semantic half never forms an edge at
      all. (The ticket said `tools/e2e-ticket-13.mjs` pinned this, but it has no link-kind assertion; a check that
      the three acts' links are all `same-drop` was added to the domain tests instead.)
- [x] Walked by hand on the real chain: four real fragments were dropped through the real DeepSeek `deepseek-flash`
      and the local embedding — the fake link was no edge, genuinely related pairs still linked, and all 14
      grey-zone questions were printed for a human to read (see Comments). **To be precise**: in that run the
      ticket's named related pair happened to be in one drop, so it linked as a **hard edge** and never went through
      similarity; the similarity path is evidenced by other pairs from the same run (`好烦 × 睡不好` 0.881,
      `有点想学吉他 × 要不要报个吉他班` 0.922), and in the "real embedding + real domain" run the named pair itself
      (`想学吉他 × 琴行的帖子`, two different drops) was a **direct semantic edge** at 0.879.
      **This also turned up a broken `.env` on this machine**: the key is a working DeepSeek key while the endpoint
      pointed at Google's `generativelanguage.googleapis.com` with `gemini-flash-lite-latest`, so every call
      returned 400. This ticket did not edit `.env`; the verification pointed the environment at
      `https://api.deepseek.com` for those commands only.

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

---

**2026-09-18 — measured, waiting on the author (not one number changed yet)**

**How it was measured.** A one-off script, `archive/ytwins-14-calibration/calibrate-link-thresholds.mjs` (under
`archive/`, not committed), takes **the path the product itself takes**: `resolveProviderConfig` →
`createRealProvider` → `provider.embed`, which is the production `createLocalEmbedding` (`query: ` prefix, mean
pooling, normalise — none of it skipped), rather than a second encoding path written for the measurement.
`YTwins_PROVIDER=real`, `YTwins_EMBEDDING=local`, model `Xenova/multilingual-e5-small` (384 dimensions, 17 terms
encoded in one batch in 1129 ms). The raw numbers are beside it in `e5-small-run.txt` and
`Xenova_multilingual-e5-small.json`.

**The sample.** 17 terms, 42 pairs, all of them wordings this product really meets (the demo material, the domain
tests, the drops the real chain produced) — not a general corpus. Four kinds: **15 positives** (genuinely related),
**4 uncertain** (a person would have to think about them; the grey zone exists for these), **16 negatives**
(including the known fake link), **7 hard-edge pairs** (said together in one drop, semantically ordinary). **The
labels are the agent's; the author may overturn any of them** — a label nobody can argue with measures nothing.

**The 15 positives** (0.861–0.977, mean 0.900):

| cosine | pair |
|---|---|
| 0.977 | 想学吉他 × 打算学吉他 |
| 0.933 | 想学吉他 × 吉他班 |
| 0.933 | 打算学吉他 × 吉他班 |
| 0.925 | 想学吉他 × 想学门乐器 |
| 0.908 | 平时分 40% × 期末考 60% |
| 0.903 | 期末怎么算分 × 期末考 60% |
| 0.900 | 最近老睡不着 × 白天没精神 |
| 0.896 | 期末怎么算分 × 平时分 40% (opening note measured 0.895 — matches) |
| 0.888 | 琴行的帖子 × 学琴 |
| 0.887 | 想学吉他 × 学琴 |
| 0.875 | 想学吉他 × 琴行的帖子 (opening note measured 0.882 — matches) |
| 0.872 | 吉他班 × 体验课 |
| 0.869 | 琴行的帖子 × 吉他班 |
| 0.866 | 琴行的帖子 × 想学门乐器 |
| 0.861 | 好烦 × 心里堵得慌 |

**The 4 uncertain** (0.846–0.867): 体验课 × 想学门乐器 0.867, 下周三交提纲 × 期末怎么算分 0.856,
好烦 × 最近老睡不着 0.854, 想学吉他 × 最近老睡不着 0.846.

**The 16 negatives** (0.810–0.856): 最近老睡不着 × 琴行的帖子 0.856, 最近老睡不着 × 下周三交提纲 0.856,
打算学吉他 × 下周三交提纲 0.855, **琴行的帖子 × 下周三交提纲 0.851 (the fake link)**,
想学吉他 × 期末考 60% 0.851, 想学吉他 × 下周三交提纲 0.848, 今天天气不错 × 好烦 0.846,
心里堵得慌 × 平时分 40% 0.844, 想学吉他 × 平时分 40% 0.841, 想去爬山 × 琴行的帖子 0.839,
体验课 × 期末考 60% 0.838, 白天没精神 × 吉他班 0.838, 今天天气不错 × 想学吉他 0.820,
学琴 × 期末怎么算分 0.820, 今天天气不错 × 期末怎么算分 0.814, 想去爬山 × 期末怎么算分 0.810.

**The 7 hard-edge pairs** (0.822–0.871): 想学吉他 × 体验课 0.871, 下周三交提纲 × 平时分 40% 0.868,
好烦 × 平时分 40% 0.860, 下周三交提纲 × 期末考 60% 0.852, 好烦 × 想学吉他 0.836 (opening note 0.835),
好烦 × 下周三交提纲 0.832, 好烦 × 期末怎么算分 0.822. All seven are already held together by the `same-drop`
hard edge, so **whether the similarity path would connect them changes nothing about them being connected**:
a hard edge overriding a similarity edge is 04's rule.

**The two distributions: one thing the opening note got wrong.** With only 3 sample pairs it looked as if e5's two
distributions **overlapped** in 0.84–0.91. Over 42 pairs the real numbers are:

```text
positives  [0.861, 0.977]  mean 0.900  p25 0.872  p75 0.908
negatives  [0.810, 0.856]  mean 0.839  p25 0.820  p75 0.851
```

**They do not overlap**: the positives' floor (0.861) is above the negatives' ceiling (0.856) — but by only
**0.005**. So 「the two distributions are crowded together」 holds (every negative sits in 0.81–0.86), while
「they overlap, so no single threshold can separate them」 **does not**: they separate, by a very narrow seam.
The fake link (0.851) sits inside the negatives, 0.001 above the 0.85 gate then in force.

**Four candidate policies, run through `decideLink` itself** (link/ask/skip = direct / through `judgeLink` /
silently skipped):

| policy | direct gate | unrelated gate | positives (link/ask/skip) | negatives (link/ask/skip) | judge calls | fake link |
|---|---|---|---|---|---|---|
| current (uncalibrated) | 0.85 | 0.70 | 15/0/0 | **5**/11/0 | 15 | **direct** |
| ① tight to the data (recommended) | 0.86 | 0.85 | 15/0/0 | 0/5/11 | 9 | through judgeLink |
| ① with margin | 0.87 | 0.85 | 12/3/0 | 0/5/11 | 14 | through judgeLink |
| ① wide grey zone | 0.87 | 0.76 | 12/3/0 | 0/16/0 | 29 | through judgeLink |

- **①「tight to the data」**: the direct gate goes above the negatives' ceiling (0.856 → 0.86) and the unrelated
  gate just below it (0.85). All 15 positives still link **directly**, no negative links directly, and the fake link
  falls into the narrow (0.85, 0.86) strip where `judgeLink` decides. Cost: 9 of the 42 pairs need one more call
  (e5's negatives are crowded near 0.85, so it is only these). **This is the ① the ticket described.**
- **①「with margin」**: the direct gate goes above the positives' floor of 0.861 (0.87), widening the margin from
  0.005 to 0.014; the cost is that the three weakest genuinely related pairs (0.861, 0.866, 0.869) also enter the
  grey zone, so **whether they become edges depends on `judgeLink`**.
- **①「wide grey zone」**: the unrelated gate drops to 0.76, so no negative is silently dropped and every one is
  asked — safest, at 29 of 42 pairs needing a call.
- All three ① variants satisfy the ticket's two criteria (the fake link is not a direct edge; `期末怎么算分 ×
  平时分 40%` 0.896 and `想学吉他 × 琴行的帖子` 0.875 still become edges); they differ only in how often the model is
  asked and in whether the genuinely related edges need the judge's nod.

**② switching to `Xenova/bge-small-zh-v1.5`: same 42 pairs, same path, measured — the answer is no.**

```text
positives  [0.341, 0.913]  mean 0.605
negatives  [0.252, 0.486]  mean 0.333
→ positives' floor 0.341 < negatives' ceiling 0.486: the two overlap in [0.341, 0.486]
```

Its distribution really is **wider** (0.25–0.91 against 0.81–0.98), but it widens by **scattering the related pairs
too**:

- `想学吉他 × 琴行的帖子` falls from 0.875 to **0.456**; `琴行的帖子 × 吉他班` 0.452, `琴行的帖子 × 想学门乐器`
  0.409, `吉他班 × 体验课` 0.341 — four positives land inside the negatives' range;
- taking the gates its data implies (direct 0.49 / unrelated 0.48): 11 link, 0 negatives direct, but **4 positives
  are silently dropped**, among them `想学吉他 × 琴行的帖子`, the very pair the ticket names as a required edge.
  Keeping them means the wide-grey-zone variant (unrelated gate 0.24), which asks `judgeLink` about **31 of 42**
  pairs;
- it covers Chinese only, while the current model is multilingual; switching means **recalibrating everything,
  narrowing the language reach, and asking the judge more often**, in exchange for worse separation.

**② also runs into a requirement of the ticket (not a guess — calculated).** The domain tests' "a grey pair is
judged" checks use **synthetic vectors** (cosine 0.8, `domain.test.ts` from line 1105), which run under the default
policy. So for the three pre-existing checks to stay green **unchanged**, the default policy must satisfy
**unrelated gate < 0.8 ≤ direct gate**. Every ① variant does (0.85/0.86/0.87); ②'s gates are 0.49/0.48, so the 0.8
synthetic pair would be a **direct link** and those checks would have to change — a direct conflict with the
ticket's "not one line".

**One thing for the author to settle: which ①.** My recommendation was **①「tight to the data」=
`connectAbove: 0.86` / `skipBelow: 0.85` / `greyZone: 'judge'`**, because it is the change the ticket describes
(direct gate above the negatives' ceiling, unrelated gate below it), all 15 positives still link **directly**
(without depending on the judge's nod), no negative links directly, and the fake link goes to `judgeLink`
(explicitly allowed by the ticket) for the price of 9 cheap calls. If the author would rather guard against false
links and let the three weakest related pairs ask the judge, take 「with margin」 0.87 / 0.85. **② is not
recommended on the measurements**, unless what the author wants is exactly 「Chinese first, ask more often」.

**One thing not yet done**: until the author chose, not a single number in `DEFAULT_LINK_POLICY` was touched — the
ticket's first line is 「measure first; changing a number first is not allowed」.

---

**2026-09-18 — settled: `connectAbove 0.87` / `skipBelow 0.85` / `greyZone: 'judge'`**

The author first chose 「tight to the data」 0.86 / 0.85 on the data above. After wiring it up, one more thing was
measured, and it overturned that choice: **the cosine of a pair changes with how many texts were encoded in the same
call**, and by more than the 0.005 seam.

**Measured: batch-size noise.** With the same two texts, changing only the batch size (the two ends encoded
separately, or together with 2/3/4/5 others), the 42 pairs moved by a **median of 0.0059 and a maximum of 0.0125**;
typical pairs:

```text
琴行的帖子 × 下周三交提纲    0.8513 – 0.8558
好烦 × 心里堵得慌            0.8647 – 0.8750
最近老睡不着 × 下周三交提纲   0.8501 – 0.8597
```

(Which neighbours share the batch does not matter — repeating one batch gives the same number every time; what moves
it is the **size** of the batch, i.e. padding and the reduction order inside it. That holds for any future model, so
it is worth remembering: **this embedding's cosine is only reproducible to about ±0.005**.)

**That noise settles two things:**

1. **A gate cannot be put inside the seam.** Recomputed at each pair's worst: at 0.86 the measured unrelated
   `最近老睡不着 × 琴行的帖子` reaches **0.8615 in some batch size → direct**, i.e. a false edge (not the ticket's
   named pair, but a false edge all the same). At 0.87 all 16 negatives reach **at most 0.8633 at any batch size**,
   so none links directly, and all 15 positives reach **at least 0.8647**, so none is silently dropped.
2. **Hence 0.87 / 0.85.** The cost is that the weakest genuinely related pairs (the 0.861–0.87 stretch) go through
   `judgeLink` when the batching runs against them — and if the judge says they are related, they still become edges.
   That is the side the research chose explicitly: a missed link is cheaper than a false one, and a false one is
   visible to the user.

**What changed.** `DEFAULT_LINK_POLICY` in `src/domain/linking.ts`: `connectAbove 0.85 → 0.87`,
`skipBelow 0.7 → 0.85`, `greyZone` unchanged. **`LinkPolicy`'s shape gained and lost nothing**, `decideLink`'s
three-band logic was not touched by a character — the injected value is what was replaced. The default's comment now
says it was measured, and that it belongs to this embedding.

**Checks added and changed (`domain.test.ts`):**

- new: `the calibrated bands: 0.87 links, 0.85 skips, and the strip between them is the only thing asked about`
  — pins all three bands at the measured extremes (0.87/0.875 direct, 0.8633/0.861/0.856/0.851 ask, 0.85/0.848 skip).
- new: `the measured false link is put to the judge, and turned down it is not an edge` — the 0.851
  `琴行的帖子 × 下周三交提纲` goes to `judgeLink`, and a "no" means no edge.
- new: `a related pair measured on the direct side links on its score alone, with nobody asked` —
  `想学吉他 × 琴行的帖子` (0.875) still links directly, with no 「灰区」 in the reason.
- new: `every link a demo makes is a hard edge: its provider scripts no vectors to compare` — the three acts' links
  are `same-drop` only, because the preset provider has no vectors to hand back.
- changed: three fixtures' synthetic vectors `[0.8, 0.6] → atCosine(0.855)`, plus one strength range
  `>0.7 && <0.85 → >0.85 && <0.87`. **A fixture, not a rule**, agreed with the author beforehand (see the checkbox
  note). The third is the easiest to miss and the most worth recording: `a provider that blows up in the grey zone`
  used the default policy with cosine 0.8, so once 0.8 fell into the unrelated band its
  `judgeLinkFallback: { kind: 'throw' }` became dead code and the check decayed into one always-true assertion —
  **04's 「a judge that blows up is an unanswered question, so nothing is linked」 would have lost its coverage**.
  It now uses 0.855 and asserts `provider.judged.length === 1`, which makes "it really was asked" part of the check:
  if the gates move again, it fails instead of passing vacuously.

**Verification (all green on this machine):** `npm run typecheck` clean; `npm test` **163/163**;
`npm run test:ai` 56/56; `tools/e2e-ticket-10.mjs` 11/11; `tools/e2e-ticket-13.mjs` 12/12;
`node tools/check-workspace.mjs` clean.

**Walked by hand on the real chain (real DeepSeek `deepseek-flash` + the local embedding, four real fragments):**
the script is `archive/ytwins-14-calibration/real-chain-walkthrough.mjs` and its raw output is
`real-chain-run.txt` beside it.

- The ticket's named pair: `下周三交提纲 × 琴行` is **not an edge** ✅ — and it was **never even asked about**. The
  script asks the embedding directly at the end: encoded together in a batch of two they score **0.8303 → skip**
  (the real reading extracted `琴行`, not the calibration sample's `琴行的帖子`, so the number differs from the 0.851
  that was calibrated). That is cheaper than a "no": it falls in the unrelated band and costs no call at all.
- The ticket's named related pair: `有点想学吉他 × 琴行` **is an edge** ✅ (the hard edge of one drop — this ticket
  does not touch hard edges; see 04).
- The real model was asked about **14 grey pairs** and judged all 14 「not related」; each similarity and verdict was
  printed, and none of them became an edge.
- **Edges through the similarity path** are evidenced by the same run: `有点想学吉他 × 要不要报个吉他班` 0.922,
  `要不要报个吉他班 × 吉他体验课的海报` 0.900, `好烦 × 睡不好` 0.881, `爬山 × 周末想去爬山` 0.932 — all of them
  edges that should exist. In the other walkthrough (real embedding + real domain, with the reading scripted),
  `想学吉他 × 琴行的帖子` (two different drops) is a **direct semantic edge** at 0.879, with the reason
  「语义相近（相似度 0.88）」.

**New finding (not this ticket's work; left for the next one): the false edges still present on the real chain come
from the shape of the extracted terms, not from the thresholds.** The real reading extracted a whole clause as a
term: `这周总是睡不好`. It is similar to everything — `× 平时分 40%` 0.874, `× 下周三交提纲` 0.880,
`× 周末想去爬山` 0.875, all direct edges — while the genuinely related `想学吉他 × 琴行的帖子` scores only 0.875.
**A long clause-shaped term lifts the cosine of everything it is compared with, pushing unrelated pairs onto the
related pairs' score line**, and no threshold fixes that: raising the gate to 0.89 would cut genuinely related pairs
with it. What has to change is how long a term may be, or how long and short terms are compared. Recorded in
`NEXT.md`.

**A machine configuration problem found along the way (not changed by this ticket):** the repository's `.env` is
broken — the key is a working DeepSeek key (`api.deepseek.com/models` answers 200 with `deepseek-flash` and
`deepseek-v4-pro`), while `.env` sets the endpoint to `https://generativelanguage.googleapis.com/v1beta` and the
model to `gemini-flash-lite-latest`, so every LLM call returns 400 「Please pass a valid API key」 and the domain
swallows the failed reading — which looks like "the drop was recorded but not one term could be read out of it".
This ticket's verification pointed the environment at `https://api.deepseek.com` for those commands (the environment
wins over `.env`) and **did not edit `.env`**. Whether to put `.env` back on DeepSeek, or to wait for ticket 16's
opencode channel, is the author's call.
