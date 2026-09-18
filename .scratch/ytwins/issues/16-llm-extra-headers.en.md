# 16: Extra request headers on the LLM half — a channel for endpoints like opencode

**What to build:** let the LLM half carry **extra request headers** from configuration. The client today sends
only `Authorization: Bearer <key>`, and some OpenAI-compatible endpoints want a header of their own —
`opencode.ai/zen/go/v1` wants `x-opencode-session` (ticket 12's Comments item 4 records this). Once that exists,
**such an endpoint can be reached by configuration alone**: no branch in the call path, nothing vendor-specific
written into it, and with nothing configured the request is byte-for-byte what it is today.

**Blocked by:** 12 (the real provider runs)

**Status:** ready-for-agent

- [ ] **The headers are an injected value, not a constant.** The new setting lives on `LlmConfig` beside
      `baseUrl` and `model`, read from the environment; with nothing configured it is an empty map and
      `createChatClient`'s request is byte-for-byte today's.
- [ ] **Values never leak.** `notes` (the lines the server prints at startup) says "N extra headers
      configured" or the like and **never prints a value**; error messages do not contain one either — it is
      most likely a session credential.
- [ ] **Names are validated.** A header name must be a legal token (no empty name, no space or control
      character, no colon); an illegal one is **refused loudly** the way `ProviderConfigError` does, naming the
      variable, rather than being sent as a broken request.
- [ ] **The relationship with `Authorization` is pinned down.** If the configuration names `Authorization`:
      refuse it, or let it override the key? Pick one and write it into the comment and the checks — leaving it
      vague means one of the two settings silently does nothing.
- [ ] The cloud **embedding** half is untouched by this ticket (opencode is an LLM backend; wanting it for
      embeddings is another ticket).
- [ ] `YTwins_PROVIDER=demo` and the four existing combinations are unaffected; `npm test` and
      `npm run test:ai` stay green.
- [ ] **Checks**: configuration parsing (empty / one / several / an illegal name / a clash with
      `Authorization`), and "the request really carries this header" — asserted through the injected `fetch`,
      the same way ticket 12's request checks are written.
- [ ] **Docs**: list the variable in `.env.example` and in `config.ts`'s module comment, saying that its first
      use is opencode go; update any place under `docs/` that narrates provider configuration.
- [ ] **Walked by hand**: reach one endpoint that really needs an extra header (when a key exists); without a
      key, at least drive "configuration → request headers" end to end with an injected fetch and print the
      request.

## Comments

**2026-09-18 — opened**

**The author's words** (2026-09-18): 「未来我可能会将 opencode go 作为产品后端模型的一种可能，请你留个能使用
opencode api 的通道」 — opencode go may become one of this product's backend models, so leave a channel that can
use the opencode API.

**Why a "channel" rather than "support opencode".** One thing should know one thing: `src/ai/config.ts` is the
only place that knows which provider combination this machine runs, and `src/ai/openai-chat.ts` should know only
how to send a JSON request to an OpenAI-compatible endpoint. A branch for opencode would leak vendor knowledge
into the call path and need editing again for the next vendor; making "extra request headers" a configuration
value leaves opencode as merely its first user. That matches the frozen decision in the spec: **changing
provider is changing a value.**

**This came out of ticket 14's measurement.** While doing 14's real-chain walkthrough, the machine's `.env`
turned out to be broken: the key is a working DeepSeek key (`api.deepseek.com/models` answers 200) while the
endpoint pointed at `generativelanguage.googleapis.com` with `gemini-flash-lite-latest`, so every LLM call
returned 400 and the domain swallowed the failed reading — visible as "a drop that yields no terms at all".
The verification was run by pointing the environment at `https://api.deepseek.com` for that one command; `.env`
was not edited. **The opencode channel and that `.env` are two different things**: one is "this machine can
reach it later", the other is "which vendor this machine should reach now".

**Implementation choices left open** (decide while building; ① is the leaning):

1. **Variable name and format**: ① one variable `YTwins_LLM_HEADERS` shaped
   `x-opencode-session=abc;x-foo=bar` (close to `.env`'s one-NAME=VALUE-per-line style, but several values have
   to share a line); ② one variable per header (`YTwins_LLM_HEADER_x_opencode_session=…`, ugly but explicit);
   ③ a dedicated `YTwins_LLM_SESSION` for opencode alone (least work, but puts a vendor name into configuration,
   which is what the reason for this ticket argues against). ① preferred.
2. **A clash with `Authorization`**: ① refuse it (the configuration may not name `Authorization`; the key goes
   through `YTwins_LLM_API_KEY`); ② let the configuration win and override the key. ① preferred — two sources
   writing one header, resolved silently, is the dangerous version.

**Explicitly not doing**: OAuth or a login flow, session renewal, or an adapter branch for any one endpoint —
this ticket does exactly one thing: a call may carry a few extra headers.
