# 16: One key to switch model — a preset each for Gemini, opencode, DeepSeek

**What to build:** reduce 「switch the backend model」 to two lines: **pick a preset + paste a key**. Each preset
carries that vendor's OpenAI-compatible endpoint, its default model id, how the key is sent
(`Authorization: Bearer` / `x-goog-api-key` / a header of their own) and any static headers the vendor needs — so
switching model is changing a value, not editing the call path. The explicit variables (`BASE_URL` / `MODEL` /
`HEADERS`) stay and **win over** the preset, as an escape hatch. With no preset chosen, behaviour is byte-for-byte
what it is today.

**Blocked by:** 12 (the real provider runs)

**Status:** ready-for-agent

## The preset table (each row verified while implementing; this ticket carries the facts and their sources)

| preset | base URL | default model | auth | source |
|---|---|---|---|---|
| `deepseek` | `https://api.deepseek.com` | `deepseek-flash` | `Authorization: Bearer` | measured on this machine: `GET /models` answers 200 with `deepseek-flash` / `deepseek-v4-pro` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.6-flash` | `Authorization: Bearer` | Google's official OpenAI-compatibility doc |
| `opencode` | `https://opencode.ai/zen/v1` | `deepseek-v4-flash` (the `chat/completions` family only) | `Authorization: Bearer`, plus `x-opencode-session` on some tiers | Zen's endpoint table; the header from third-party proxies and free/Go tier reports |
| `ollama` | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` | no key | the local option this project already has |
| `custom` | `YTwins_LLM_BASE_URL` is required | `YTwins_LLM_MODEL` is required | Bearer + configurable extra headers | the escape hatch |

- [ ] **One key switches vendor.** `YTwins_LLM_PRESET=<name>` + `YTwins_LLM_API_KEY=<key>` is the whole of it;
      when the key is missing the error **names the variable that preset needs**, rather than a general
      "provider unavailable".
- [ ] **Vendor differences live in the presets only.** `src/ai/config.ts` knows the presets;
      `src/ai/openai-chat.ts` knows only "base URL + model + a set of request headers", with no branch for any
      vendor (which is what the spec's frozen 「changing provider is changing a value」 asks for).
- [ ] **Extra request headers stay a preset field** (this was the original ticket, and it is kept):
      something like `x-opencode-session` is either in the preset or configured through `YTwins_LLM_HEADERS`;
      values never reach a log; an illegal header name is refused loudly.
- [ ] **An unknown preset is refused loudly** (the `ProviderConfigError` way, naming the variable and listing the
      accepted values).
- [ ] **Explicit settings win over the preset**, and the startup log says 「preset is X; these values were
      overridden」 — an override is an escape hatch, not a silent configuration drift.
- [ ] **`notes` says three things only**: which vendor · which model · key configured or missing.
      **The key is never printed, and neither is any header value.**
- [ ] **The embedding half is not part of the "just paste a key" promise.** Changing the embedding means redoing
      ticket 14's calibration (measured: switching to `bge-small-zh-v1.5` drops a genuinely related pair from 0.875
      to 0.456 and makes the two distributions overlap), so the local model stays the default, a cloud embedding
      still goes through the existing explicit base URL + key, and both `.env.example` and the startup log must
      **say so**.
- [ ] **Checks**: every preset resolves to the right base / model / auth header; the missing-key message; an
      unknown preset; explicit settings winning; and "the request really carries the right header" — asserted
      through the injected `fetch`, the way ticket 12's request checks are written.
- [ ] **Docs**: `.env.example` keeps only the two required lines (preset + key), with the preset table in a
      comment; `config.ts`'s module comment updated; whatever narrates provider configuration under `docs/` too.
- [ ] **Walked by hand**: there is a working DeepSeek key on this machine, so **at least DeepSeek gets a real run**;
      for Gemini and opencode, without a key, assert the request shape with an injected fetch and record in the
      Comments that **no real key was used**.
- [ ] **Fix this machine's broken `.env` while at it**: the key is a good DeepSeek key while the endpoint and model
      point at Google (see Comments). Set `YTwins_LLM_PRESET=deepseek` plus that key line — or leave it to the
      author once this lands.

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
