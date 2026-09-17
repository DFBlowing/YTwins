# 12: Real provider — cloud LLM + local embedding + switchable

**What to build:** Turn off the fake provider and put the real implementation behind the port: a cloud LLM handles
`extract` / `judgeLink` / `compose` / `respond` (OpenAI-compatible endpoint, JSON output), while embeddings run
offline on the local CPU with a pretrained multilingual small model, needing no key. Both are switchable by
configuration between "cloud OpenAI-compatible endpoint / local Ollama" and "local / cloud embedding", and the
domain logic notices no difference at all.

**Blocked by:** 03 (Parent voice — emotion first, mechanically checked rules), 04 (Terms and links — connecting the fragments)

**Status:** ready-for-human

- [x] The real provider implements all five operations: `extract` / `embed` / `judgeLink` / `compose` / `respond`
      (**the port has eight methods today**; this line was written in ticket 04's era — all eight landed, see
      Comments 1).
- [x] The LLM goes through an OpenAI-compatible endpoint and returns structured JSON; a parse failure produces a
      clear, diagnosable error.
- [x] Embeddings run through transformers.js inside Node on the local CPU, fully offline with no key; model files
      are not committed.
- [x] The API key lives only in a server-side environment file, never in git and never in the browser; the repo
      contains no plaintext key.
- [x] Configuration selects among four combinations (cloud / local LLM × local / cloud embedding) with zero
      domain-logic changes.
- [x] Domain tests are still driven entirely by the fake provider — the suite stays deterministic and passing after
      the real implementation lands.
- [x] The real implementation gets only a manual smoke check (it connects, it returns the expected structure); its
      semantic quality is not asserted automatically.
- [x] **Prerequisite (not part of this ticket's acceptance):** a human has obtained and stored the cloud LLM API
      key — done 2026-09-17; the story, including a first key that belonged to somebody else, is Comments 4.

## Comments

**2026-09-17 · What it actually landed as**

**1. Eight operations, not five.** That line was written in ticket 04's era; the port has since grown to eight:
`respond` / `extract` / `embed` / `judgeLink` / `composeConclusion` / `composeAnswer` / `parseQuestion` /
`composeRecallAnswer`. All eight landed, none missing — "whatever the fake provider can do, the real one can do"
is this ticket's acceptance surface. `composeAnswer` (**the answer**, which states a judgement) and
`composeRecallAnswer` (**recall**, which states a fact) are the pair ticket 11 put right against `CONTEXT.md`,
and this ticket did not mix them up.

**2. Where the code went.** A new `src/ai/` (the port's **implementation side** — see item 3) plus
`src/web/provider.ts`:

- `src/ai/config.ts`: environment → configuration (the four combinations, defaults, timeouts). **A value nobody
  recognises is refused, naming the variable** — a `local` mistyped as `clod` that quietly went to the cloud
  would send the user's fragments off the machine while they believed otherwise.
- `src/ai/env-file.ts`: reads `.env` (comments, quotes, `export` prefix, trailing comments; **the environment wins
  over the file**).
- `src/ai/openai-chat.ts`: one OpenAI-compatible call (`/chat/completions` with
  `response_format: json_object`, a timeout, and no `Authorization` header at all when there is no key).
- `src/ai/structured.ts` / `errors.ts`: find the JSON object in what the model said, then check it **field by
  field**; every failure is a `ProviderCallError` naming the call, the field and what was actually there.
- `src/ai/llm-provider.ts`: the seven language-model operations and their prompts.
- `src/ai/local-embedding.ts` / `cloud-embedding.ts` / `vectors.ts`: the two embedding halves and the vector
  checking they share.
- `src/ai/real-provider.ts`: joins the halves into the port; **a half that is not configured fails every call with
  the reason** while the other keeps working, and the startup log says which pair is running — never a key.
- `src/web/provider.ts`: the composition root's one decision (real or demo).
- `src/web/server.ts`: at startup, read `.env` → resolve the configuration → build the provider → print the
  configuration lines; a broken configuration **refuses to start** (exit 1) rather than running wrong.

**3. "Turn off the fake provider" landed as "real by default, fake only when asked".** The default is the real
provider; 01–11's `demo-provider.ts` is **kept**, but only `YTwins_PROVIDER=demo` reaches it. That was the
author's call, made before work started (the option read: "real by default, keep demo as an explicit
configuration value"): the three-act demo has to stay repeatable and offline, while this ticket says "turn off
the fake provider" — "no longer used by default" satisfies both. The cost is that configuration now has five
choices rather than four; **not one line of domain logic changed**, so item 5 of the ticket is unaffected.
`NEXT.md` said the demo material would retire with the real provider; it did not, for the reason above.

**4. The key boundary, and the human-only prerequisite (including a real diagnosis).** The key lives in **`.env`
at the repository root**, which `.gitignore` already ignores; the server reads it and the page can never have it
(measured: after a full real round trip, no `/api/*` response contains `sk-`; and no plaintext key is committed —
every `sk-` in the diff is a **sentinel** such as `sk-secret`, in a test). The key the author had at the start was
in fact **not DeepSeek's**: `api.deepseek.com` answered **401**, while the endpoint it belonged to
(`opencode.ai/zen/go/v1`) wants `x-opencode-session` on every request and otherwise answers 400
`MissingSessionID` (that is this machine's coding-agent subscription endpoint, whose documentation says it is for
coding-agent traffic). The author then replaced it with a DeepSeek key and left a single `YTwins_LLM_API_KEY`
line, so the default endpoint and model (`https://api.deepseek.com` + `deepseek-flash`) are exactly the pair the
spec froze. **This episode is the most valuable thing this ticket leaves behind**: without a real smoke test it
would have surfaced as a 400/401 in front of the user instead of at the start of the work.

**5. Three rules for the prompts.** ① **The rules travel with the request**: the instruction arrays from
`parent-voice.ts` / `conclusions.ts` / `surfacing.ts` go into the system message verbatim, and `src/ai/` holds
**no second copy**; ② **a retry is told which rules the last attempt broke** (`violations`), because "try again"
without that is only a different guess; ③ **`composeAnswer` carries no persona** — see the `/code-review` section
below; that one was found in review, and it was the kind of error that overturns ticket 11's guarantee.

**6. The local embedding.** `Xenova/multilingual-e5-small` (384 dimensions), **q8** quantised (about 120 MB;
fp32 is 470 MB and slower on a CPU), **loaded lazily** (transformers.js is imported and the model built on first
use), **loaded once per process and shared**, with the memo **cleared on failure** (a first run that cannot reach
the model host is the commonest failure, and a server that needed a restart after a bad minute would be a bad
server), cached under `data/models` (which git ignores, so "model files are not committed" is structural), with
`YTwins_EMBEDDING_HOST` for a mirror. The e5 family is asked with the `query: ` prefix its authors recommend
(both ends of a symmetric comparison are the user's own words). **The precise reading of "fully offline"**: the
first use needs the network to fetch the model into the cache directory, and **after that it touches no network**
— measured by pointing the host at an unreachable address (`YTwins_EMBEDDING_HOST=http://127.0.0.1:1`), after
which the embedding still produced 384-dimension vectors.

**7. How the four combinations were verified (the honest version).** All four have automated checks at the
**configuration** layer (including "the default is a cloud LLM beside a local embedding" and "an unrecognised
value is refused"). **Exactly one was exercised against a real endpoint**: cloud LLM (DeepSeek) + local
embedding. There is no Ollama on this machine and no second key for a cloud embedding, so the other two have
configuration-level evidence only and **were never connected**. That is written here rather than glossed over.

**8. The smoke test and the real round trip (the "manual smoke" this ticket asks for).**
`tools/smoke-provider.mjs` (`npm run smoke`) checks all eight operations for structure and prints their contents
for a person to judge:

- **9/9 steps pass** (real DeepSeek endpoint + local embedding): `respond` leads with feeling, `extract` resolves
  「下周三」 to `2026-09-23T09:00:00.000Z` while keeping the user's own wording, `judgeLink` returns a boolean,
  `parseQuestion` returns strings that can be looked for, and `composeConclusion` / `composeAnswer` /
  `composeRecallAnswer` each produce one Chinese sentence.
- **The real server was walked through end to end by hand**: drop → extraction (1 item, 5 terms) → recall
  (`kind: answered`, with 1 source) → surfacing (`nothing-to-say` — a single drop has not crossed the threshold,
  which is correct) → links (13 `same-drop` hard edges) → **no key anywhere in the responses**.

**9. One thing left for the next ticket: the thresholds do not fit the real embedding (measured).** The cosine
distribution of e5-small is **compressed**: related pairs 0.88–0.91, unrelated pairs 0.84–0.88 (three groups
measured under the `query: ` prefix: 「期末怎么算分 × 平时分 40%」 = 0.895, 「想学吉他 × 琴行的帖子」 = 0.882,
「好烦 × 想学吉他」 = 0.835). The default three-band rule in `linking.ts` is "≥ 0.85 links, ≤ 0.7 does not, the
middle asks `judgeLink`", so nearly every pair lands in "links" or in the grey zone, and a **false link was
caught in the real run**: `琴行的帖子 × 下周三交提纲 = 0.852 → linked` ("语义相近（相似度 0.85）"). This is not
ticket 12's bug — the domain-side thresholds are the values the spec explicitly lists as **"parameters not yet
given values"**, carried by configurable constants and to be calibrated against real data later — but it is the
one thing **that must land before 13**: either widen the grey zone so `judgeLink` decides (which is what the
three-band design is for, at the cost of one call per grey pair) or pick an embedding whose distribution is more
spread. Both measurements (e5-small, and `bge-small-zh-v1.5` whose range is 0.37–0.63 and which today's
thresholds would leave with no links at all) are recorded in `NEXT.md`.

**10. Verification.**

- Domain tests **152/152** (**not one line changed**, still driven entirely by the fake provider); the new
  `src/ai/provider.test.ts` **56/56** (`npm run test:ai`; `fetch` and the model loader are injected, so it
  reaches no network and downloads nothing).
- 02's 7/7, 03's 6/6, 04's 5/5, 05's 5/5, 06's 6/6, 08's 11/11, 09's 15/15, 10's 11/11 and 11's 6/6 still
  green; `check-workspace`'s 21 tests and the checker itself clean.
- `tsc --noEmit` green; `vite build` succeeds; the real-endpoint smoke 9/9 (item 8).
- **No plaintext key in the repository**; `.env` and `data/models` are both in `.gitignore`.

**`/code-review`, both axes, and what was done about it**

Standards axis: **no hard violations**; two "standard and executor out of step" findings were upheld and fixed,
and the judgement calls were each handled.

- **Changed · `src/ai/` is a third top-level directory while the spec says "two top-level directories"** —
  upheld, and in this repo's own manner a **dated correction** was added to `spec.md` / `spec.en.md` (the original
  sentence is not deleted): the port's implementation is neither domain logic nor the interface layer, and it must
  **not be replaced along with the interface layer** (when a mobile client replaces the web demo, `src/web/` goes
  and `src/ai/` stays).
- **Changed · "the real implementation gets only a manual smoke test" vs the 56 new automated checks** — upheld,
  and corrected in the spec's **testing decisions**, where the line is now written down: what is not tested is the
  **model's judgement**, not the **code's wiring**. The four combinations, field checking, diagnosable errors and
  the key boundary are structure and are asserted; whether a sentence reads well, or a pair is judged alike, is
  asserted nowhere.
- **Changed · `DEFAULT_TIMEOUT_MS` in three places and the Abort/Timeout test in two** — upheld; the timeout now
  lives once in `config.ts`, `isTimeoutError` once in `errors.ts`, and both HTTP callers share them.
- **Changed · `Embedder` declared in `local-embedding.ts` but imported by `cloud-embedding.ts`** — upheld, moved
  to the neutral `vectors.ts`.
- **Changed · the parameter name `what`** — upheld, renamed `operation` (that is what it holds, and it is what
  the error messages use).
- **Changed · the unreachable default `baseUrl ?? ''` in `real-provider.ts`, and four `kind === 'cloud'`
  branches** — upheld: each half is now gathered into `buildLlm` / `buildEmbedder`, which test emptiness
  **inside** (so `baseUrl` is genuinely narrowed and no unreachable default remains) and return "the thing, or
  the reason it could not be built".
- **Changed · `unavailable()` claimed the type checker would catch a port method missing from its list, and it
  would not** — upheld (`readonly (keyof T)[]` is not exhaustive). Both operation tables are now
  `satisfies Record<keyof …, true>`, so **a ninth port method fails to compile**; and "a half that is not
  configured still implements the whole port" is now asserted over all eight operations rather than four.
- **Changed · three `...(x === undefined ? {} : { x })` spreads** — upheld; the optional option types are
  `T | undefined`, so call sites pass the value straight through.
- **Kept · the `check()` harness appears in `domain.test.ts`, `provider.test.ts` and `smoke-provider.mjs`** —
  that is the testing shape this repo **wrote down** (single process, self-contained assertions, exit code as the
  result, no framework); each copy is a dozen lines and independent, and extracting a shared module would turn
  "a single-file entry" into "an entry plus a library" for nothing.
- **Kept · both entry points write out "read .env → resolve configuration → report and exit"** — the server exits
  1 and the smoke exits 2 with usage text; the failure stances genuinely differ, and only two lines are shared.

Spec axis: **three upheld** — two changed, one strengthened; the rest are recorded as known and justified.

- **Changed · `composeAnswer` carried a generic persona** (`PRODUCT_CONTEXT` was in the system message of all
  seven operations) — upheld, and it was the kind of error that **overturns ticket 11's guarantee**: `NEXT.md`
  says in as many words that "`composeAnswer`'s input is only the user's own conclusions and terms; the server
  must not stuff a generic persona in there, which would overturn 11's guarantee on the spot". The context was
  removed from `composeAnswer` (the task, the band, the domain's rules and the output contract stay), and the
  check that used to look at the **user** message only was strengthened to read the **system** message line by
  line: anything beyond "task / band / the request's own rules / the output contract" counts as generic material.
  **Putting the bug back makes it red** (55/56, failing on exactly that check).
- **Changed · `unavailable()`'s safety claim did not hold** — see the Standards finding above; now genuinely
  pinned with `satisfies`.
- **Strengthened · the ticket's "prerequisite" had no evidence** — upheld; the actual acquisition of the key and
  the 401/400 diagnosis are recorded in item 4, and the smoke results in item 8.
- **Kept, with the reason written down · `YTwins_PROVIDER=demo` is a fifth choice** (the spec names four) —
  see item 3: the author's call.
- **Kept, with the reason written down · "fully offline" strictly holds only after the first run** — see item 6:
  the claim is now stated precisely, with the measurement that backs it.

**A pit worth repeating to whoever comes next (stepped in again during 12):** using PowerShell to do
"read — `-replace` — write back" turned the Chinese error strings in `src/ai/config.ts` into mojibake
(`环境变量` → `鐜鍙橀噺`). This is the pit `NEXT.md` already documents, and **this was the second time**. The
recovery is not to patch it back but to **rewrite the whole file with the `write` tool**; and the way to tell is
to look at the Chinese with the `read` tool (which decodes UTF-8 correctly) rather than PowerShell's
`Get-Content`. **Conclusion:** bulk text replacement goes through the `edit` tool, always; `-replace` is only for
files that are pure ASCII.
