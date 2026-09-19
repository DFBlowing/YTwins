# 16: One key to switch model — a preset each for Gemini, opencode, DeepSeek

**What to build:** reduce 「switch the backend model」 to two lines: **pick a preset + paste a key**. Each preset
carries that vendor's OpenAI-compatible endpoint, its default model id, how the key is sent
(`Authorization: Bearer` / `x-goog-api-key` / a header of their own) and any static headers the vendor needs — so
switching model is changing a value, not editing the call path. The explicit variables (`BASE_URL` / `MODEL` /
`HEADERS`) stay and **win over** the preset, as an escape hatch. With no preset chosen, behaviour is byte-for-byte
what it is today.

**Blocked by:** 12 (the real provider runs)

**Status:** ready-for-human

## The preset table (each row verified while implementing; this ticket carries the facts and their sources)

| preset | base URL | default model | auth | source |
|---|---|---|---|---|
| `deepseek` | `https://api.deepseek.com` | `deepseek-flash` | `Authorization: Bearer` | measured on this machine: `GET /models` answers 200 with `deepseek-flash` / `deepseek-v4-pro` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.8-flash` (the official example was `gemini-3.6-flash` when this ticket was opened; it had moved to 3.8 when the row was checked — see Comments) | `Authorization: Bearer` | Google's official OpenAI-compatibility doc |
| `opencode` | `https://opencode.ai/zen/v1` | `deepseek-v4-flash` (the `chat/completions` family only) | `Authorization: Bearer`, plus `x-opencode-session` on some tiers | Zen's endpoint table; the header from third-party proxies and free/Go tier reports |
| `ollama` | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` | no key | the local option this project already has |
| `custom` | `YTwins_LLM_BASE_URL` is required | `YTwins_LLM_MODEL` is required | Bearer + configurable extra headers | the escape hatch |

- [x] **One key switches vendor.** `YTwins_LLM_PRESET=<name>` + `YTwins_LLM_API_KEY=<key>` is the whole of it:
      `resolveProviderConfig` takes the endpoint, the model and "which header the key goes in" off the table, and
      nothing in the page, the domain or the call path changes. When the key is missing the message names the
      preset and the model — `没有配置 YTwins_LLM_API_KEY，预设 gemini（云端）上的 gemini-3.8-flash 用不了：…`
      (with no preset the sentence is what it always was, except that 「无 key」 became 「缺 key」).
- [x] **Vendor differences live in the presets only.** The differences are five rows of `LlmPreset`
      (`kind` / `baseUrl` / `model` / `auth` / `headers`); `src/ai/openai-chat.ts` now **knows no key at all**
      (`ChatClientOptions.apiKey` is gone, replaced by a set of request headers) and the `Authorization: Bearer`
      spelling moved into `PresetAuth`. No branch for any vendor is left in the call path.
- [x] **Extra request headers stay a preset field** (`LlmPreset.headers`, empty for all five rows today — a
      session token is a credential and belongs in `.env`, not in a file in git), configured as
      `YTwins_LLM_HEADERS=name=value;name=value`; values never reach a log (not even the segment that was
      refused), and an illegal name is refused loudly.
- [x] **An unknown preset is refused loudly**: `环境变量 YTwins_LLM_PRESET 的值「claude」不认识；可用值是
      deepseek / gemini / opencode / ollama / custom。` (case and surrounding spaces are not a difference).
- [x] **Explicit settings win over the preset, and the startup log says so.** The list lands in
      `LlmConfig.overrides` (only `YTwins_LLM_BASE_URL` / `YTwins_LLM_MODEL` can ever appear) and the line reads
      like `预设 deepseek（云端）：https://api.deepseek.com · deepseek-v4-pro（key 已配置；显式覆盖：YTwins_LLM_MODEL）`.
- [x] **`notes` says three things only**: which vendor · endpoint and model · key configured or missing (「无需 key」
      on the local row), plus one **count** — 「另带 N 个额外请求头」, which is what the original ticket asked for.
      **No key, and no header value, ever.**
- [x] **The embedding half is not part of the "just paste a key" promise.** The local model stays the default and a
      cloud embedding still goes through an explicit base URL + key; `.env.example` has a section of its own, and
      **the startup log carries the sentence every time** (「换它等于换一套标定（要重跑 ticket 14 那套实测）」).
- [x] **Checks**: provider checks 58 → **72** — every preset's base / model / auth header, the missing-key message,
      an unknown preset, explicit settings winning, the three header rules, no credential in `notes`, and
      **the request shape of all three cloud presets through the injected `fetch`** (URL / model /
      `Authorization` / extra header), written the way ticket 12's request checks are.
- [x] **Docs**: `.env.example` keeps only the two required lines (preset + key) plus the table and how the key is
      sent; `config.ts`'s module comment and the table's provenance updated; `docs/ytwins/demo-script.md` and its
      `.en.md` gained a section on presets.
- [x] **Walked by hand**: DeepSeek ran for real with the key (`node tools/smoke-provider.mjs llm` → **7/7**), and a
      real server was started to read the startup log and `/api/privacy`; Gemini and opencode have no key on this
      machine, so their request shape is asserted through an injected `fetch` — **and the Comments record that no
      real key was used**.
- [x] **This machine's broken `.env` fixed while at it**: it is now `YTwins_LLM_PRESET=deepseek` plus that key line,
      with the old Google endpoint and model lines deleted (`.env` is not in git; the change exists on this machine only).

## Comments

**2026-09-18 — opened, and re-scoped the same day on the author's word**

**The author's words (twice; the second is what this ticket is now):**

1. 「未来我可能会将 opencode go 作为产品后端模型的一种可能，请你留个能使用 opencode api 的通道。」
2. 「ticket 16 规范为为 Gemini、opencode、deepseek 等模型预留相应的端口，需要用什么模型时只需要输入 api key 即可。」

So the ticket grew from 「extra request headers」 into **presets**: the header requirement is **not dropped** — it is
one field of a preset — but what is being delivered is 「pick a vendor, paste a key, it runs」. **With no preset
chosen, behaviour is byte-for-byte what it is today.**

**Why presets rather than a paragraph per vendor.** `src/ai/config.ts` is the only place that knows which provider
combination this machine runs, and `src/ai/openai-chat.ts` should know only how to send a JSON request to an
OpenAI-compatible endpoint. The three vendors really differ in three things: **the base URL, the model name, and
which header the key goes in** (plus, for opencode, an extra header). Make those a table and adding a fourth vendor
is one row; make them branches and adding a fourth vendor edits the call path — and what the spec froze is precisely
「changing provider is changing a value」.

**Three vendor facts established before opening** (this ticket should carry first-hand sources):

- **DeepSeek**: `https://api.deepseek.com`, `Authorization: Bearer`, `GET /models` measured at 200 listing
  `deepseek-flash` and `deepseek-v4-pro`. This machine's key is the one it accepts.
- **Gemini**: Google ships an official OpenAI-compatibility layer; the base URL is
  `https://generativelanguage.googleapis.com/v1beta/openai/` and the key goes in `Authorization: Bearer
  $GEMINI_API_KEY` (Google's own example is written that way). **`.env` currently has `…/v1beta`, missing the
  `/openai/` segment** — one of the reasons it answers 400 (the other being that the key is DeepSeek's).
- **opencode Zen**: a gateway. `https://opencode.ai/zen/v1/chat/completions` is its OpenAI-compatible family
  (DeepSeek / MiniMax / GLM / Kimi and others), but the same site also serves `/responses`, `/messages` and
  `/models/<id>` shapes — so the preset promises **the `chat/completions` family only**; the others are not a
  protocol this product speaks. `x-opencode-session` appears in free/Go tier and third-party proxy reports, which
  is why extra headers stay.

**Why the embedding half is excluded from 「just paste a key」 — this is what ticket 14 measured.** The thresholds
are calibrated **against one specific embedding**: under e5-small, positives `[0.861, 0.977]` and negatives
`[0.810, 0.856]`; under `bge-small-zh-v1.5`, positives `[0.341, 0.913]` and negatives `[0.252, 0.486]`, so the two
distributions **overlap**, and `想学吉他 × 琴行的帖子` falls from 0.875 to 0.456. On top of that, one pair's cosine
wanders by 0.005–0.0125 depending on how many texts shared the batch. Changing the embedding is therefore **not
changing a value but changing a calibration**: making it a one-line key swap would hand the user a set of uncalibrated
thresholds without telling them. This ticket makes the LLM half a preset and says this out loud in the docs and at
startup.

**This machine's broken `.env` (found while doing 14; fixed here while at it):** the key is a working DeepSeek key
while the endpoint is `generativelanguage.googleapis.com` and the model is `gemini-flash-lite-latest`, so every LLM
call returns 400 「Please pass a valid API key」 and the domain swallows the failed reading — visible as "the drop was
recorded but not one term could be read out of it". With presets in place, that 「endpoint, model and key disagree」
should become a **loud refusal** rather than a silent blank.

**Implementation choices left open** (decide while building; ① is the leaning):

1. **The key variable**: ① one `YTwins_LLM_API_KEY` shared by every preset (closest to 「just paste a key」;
   switching vendor changes one line); ② one per vendor (`YTwins_LLM_API_KEY_GEMINI`…, keeps several at once but
   grows the variable table). ① preferred.
2. **The `custom` preset**: ① require an explicit base URL and model, refusing otherwise; ② default to OpenAI's
   own endpoint. ① preferred — a default would suggest "unconfigured means OpenAI", which is a guess.
3. **`ollama` and its missing key**: ① the preset declares "no key needed", so its absence is not an error;
   ② require a key everywhere. ① preferred — a local model has no key, which is how ticket 12's `local` option
   already works.

**Explicitly not doing**: OAuth or a login flow, session renewal, automatic model selection or fallback, or switching
model per request — this ticket does one thing: pick a vendor, paste a key, and switch vendor by changing one line.

---

**2026-09-18 — implemented (`Status: ready-for-human`)**

**The shape that landed.** `src/ai/config.ts` grew a five-row preset table (`LLM_PRESETS`), each row an `LlmPreset`:
`kind` (cloud / on this machine) · `baseUrl` · `model` · `auth` (which header the key goes in, and what precedes it) ·
`headers` (headers every request to that vendor carries). `resolveProviderConfig` reads 「explicit variable → preset →
default」, spells the key into `LlmConfig.headers` through `auth`, and records which explicit variables were set on
top of the preset in `overrides`. **`src/ai/openai-chat.ts` no longer has an `apiKey` field**: it knows "base URL +
model + a set of headers" and not even `Authorization: Bearer` — no vendor knowledge leaked into the call path,
which is the structural guarantee that a fourth vendor is one row. `real-provider.ts` hands `config.llm.headers` to
the client and still makes every call fail with the reason when the key is missing.

**Each row of the table re-checked (2026-09-18, first-hand sources):**

- **DeepSeek**: `GET https://api.deepseek.com/models` on this machine → **200**, `deepseek-flash` /
  `deepseek-v4-pro`; `Authorization: Bearer`. The row reuses those two default constants.
- **Gemini**: the official OpenAI-compatibility page gives the base URL
  `https://generativelanguage.googleapis.com/v1beta/openai/` and `Authorization: Bearer $GEMINI_API_KEY`, and
  **its example model is `gemini-3.8-flash` today** (the page banner reads "Gemini 3.8 Flash is now available").
  **This ticket was opened with `gemini-3.6-flash`** (the example of that day), **so the row takes 3.8 and the
  difference is recorded here**; both ids are still on sale, and going back is a one-line change. The trailing `/`
  is dropped: the client strips trailing slashes before appending `/chat/completions` anyway.
- **opencode Zen**: in the endpoint table at `https://opencode.ai/docs/zen/`, the DeepSeek row of the
  `chat/completions` family is `deepseek-v4-flash` (the same host also serves `/responses`, `/messages` and
  `/models/<id>`; this product promises only the first). The official page does **not** mention
  `x-opencode-session`; that header shows up in third-party fixes and reports (openclaw's commit, zed's PR #63715,
  OmniRoute's issue #12657, deepseek-harness's discussion #5495), so it stays in `YTwins_LLM_HEADERS` for the user to
  configure and is **not** written into the table — it is a credential, and the table is in git.
- **ollama / custom**: the same shape as the other three; ollama runs on this machine and wants no key; custom's
  three unknowns (endpoint, model, where it runs) all come from the environment.

**The ticket's three open choices, all ①**: one shared `YTwins_LLM_API_KEY`; `custom` must be given an endpoint and a
model; `ollama` declares "no key needed" (so its absence is not an error, and a key that *is* configured is still
sent as Bearer — byte-for-byte what `YTwins_LLM=local` + a key does today).

**Four decisions made while implementing (blank in the ticket, or beyond it — each with its reason):**

1. **With a preset chosen, `YTwins_LLM` is agreement, not an override.** Contradicting the preset (`PRESET=gemini` +
   `YTwins_LLM=local`) is **refused loudly**: otherwise the startup log and `/api/privacy` would call a cloud
   endpoint "on this machine", i.e. tell the user their words never left it — the one mistake the module's own
   comment says it exists to prevent. `custom` is the exception: that row *is* null there, and
   `YTwins_LLM=local` is the only way to say the endpoint is the machine's own; it is not an override, and the log
   reads 「预设 custom（本地）」. (Review, Spec axis finding 4.)
2. **`YTwins_LLM_HEADERS` may not write the key's header — when a key is configured.** With no key nothing else
   writes that header, so it stays available: a local gateway asking for `Basic …`, or for a scheme that is not
   Bearer, is a real machine and this is the only place to say it. Both arms are checked. (Review, Spec axis
   finding 6 — the flat refusal was too strict.)
3. **`content-type` / `accept` may not be configured either, and the refusal list and the two headers the client
   actually writes are now the same constant** (`PROTOCOL_HEADERS`, imported by `openai-chat.ts`). They used to be
   two copies, so a third protocol header would have desynchronised the refusal silently (Review, Standards axis
   finding 3). The refusal itself is kept: silently dropping a header somebody configured is exactly the drift this
   ticket is against (Review, Spec axis finding 5 recorded it as beyond the ticket; kept, with the reason here).
4. **A malformed segment is identified by its position and never quoted.** It is a credential, and an error message
   goes to the log; the first implementation copied the whole segment into the message. (A real hole found by
   Review, Spec axis finding 7.)

**Other things the review changed:** `readPresetName` and `readChoice` merged into one `readOneOf` (one copy of that
message); `readEndpoint` renamed `readFromPreset` and its two same-source parameters (`preset` / `fromPreset`)
replaced by a field name; `noLlmKey` and `llmNote` share a `vendorPhrase`; the repeated `name` in each preset row
deleted (the key is the name); `ChatClientOptions.headers` made required, dropping the synonymous third state
(`undefined` + `?? {}`); doc wording corrected (`` `12` `` → `Ticket 12`; 「换 provider 是换值」 no longer claimed as
the spec's own words — the spec froze the port's shape, the phrase is this ticket's;
`bge-small-zh` → `bge-small-zh-v1.5`).

**Two review findings kept, with reasons:**

- **The 「另带 N 个额外请求头」 count stays in `notes`**: the original ticket (explicitly preserved by this one) asked
  for exactly that, and it is a count, not a value — no conflict with "three things only" (Spec axis finding 5). For
  the same reason the **endpoint** stays in the line: when an override happened, the endpoint is the only place that
  shows the machine is not running the preset's vendor.
- **`apiKey` and `headers` coexist on `LlmConfig`**: the first is the semantic fact "a key is configured" (the
  missing-key branch in `real-provider` and the disclosure in `privacy.ts` read it), the second is the same key in
  the shape the wire wants. Both are derived from one `readOptional` in one object literal, so there is no second
  place that reads the environment (which is what answers Standards axis finding 5's "nothing guarantees they agree").

**The embedding line gained "swapping it means redoing a calibration"** (Spec axis finding 1): the ticket asks for
that to be said at startup too, and it used to be only in `.env.example`.

**This machine's `.env` is fixed as the ticket asked**: `YTwins_LLM_PRESET=deepseek` plus that key line (the old
`generativelanguage.googleapis.com` + `gemini-flash-lite-latest` lines are gone). `.env` is not in git.

**Verification (all run on this machine):** domain **167/167** (`src/domain/**` untouched), provider **72/72**
(58 → 72, fourteen new checks), e2e **02–15 all green** (02 7/7, 03 6/6, 04 5/5, 05 5/5, 06 6/6, 08 11/11, 09 15/15,
10 11/11, 11 6/6, 13 12/12, 15 10/10), `tsc --noEmit` clean, `check-workspace` clean,
`check-workspace.test.mjs` 21/21. **The real chain**: with `YTwins_LLM_PRESET=deepseek` and that key,
`node tools/smoke-provider.mjs llm` → **7/7**; a real server was started too and its startup log and `/api/privacy`
were read line by line (with no preset chosen, that line is what it always was, word for word).
**Not verified with a real key: Gemini and opencode** (this machine has no key for either) — they are held by
request-shape assertions through the injected `fetch` (all three cloud presets through `provider.respond`, asserting
URL / model / `Authorization` header / extra header), and **"no real key was used" is recorded here as the ticket asks**.

**What this ticket did not touch**: the embedding half (`cloud-embedding.ts` still uses its own `Bearer` plus an
explicit endpoint), the domain and the pages (`src/domain/**`, `src/web/**` untouched).

---

**2026-09-18 — the two-axis `/code-review` result (base HEAD, against the working tree)**

One sub-agent per axis, read separately, dispositions recorded above. The two ends only:

- **Standards axis, 8 findings, all smell judgements, no documented-standard breach.** The heaviest was the
  **duplicated truth about the protocol headers** (the refusal list in `config.ts` and the headers hard-coded in
  `openai-chat.ts` would have desynchronised silently) — collapsed into one `PROTOCOL_HEADERS` the client imports.
  The rest: `readChoice` / `readPresetName` duplication, `noLlmKey` / `llmNote` each spelling out the preset
  wording, `readFromPreset`'s same-source parameters, the repeated `name` in the preset table, the third state of
  `headers?`, and two doc-wording slips. (`apiKey` and `headers` coexisting was kept, with its reason.)
- **Spec axis, 8 findings; the heaviest was "a header value can reach the log"** (a malformed segment was copied
  into the error message, and that message goes to `server.ts`'s log) — now identified by position, with a check
  that the credential does not appear. The rest: Gemini had no injected-`fetch` assertion (all three cloud presets
  now have one), `YTwins_LLM` overriding a preset could call a cloud endpoint "local" (now refused loudly), the
  Gemini model disagreed with the ticket (the re-check is recorded above), the embedding startup sentence was
  missing (added), the `authorization` collision was refused too strictly (relaxed to "only when a key is
  configured", both arms checked), the `notes` count and the `content-type` refusal (kept, with reasons), and the
  docs' "the first four all use Bearer" contradicting ollama (wording fixed).
