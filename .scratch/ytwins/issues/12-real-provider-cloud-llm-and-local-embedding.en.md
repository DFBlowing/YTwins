# 12: Real provider — cloud LLM + local embedding + switchable

**What to build:** Turn off the fake provider and put the real implementation behind the port: a cloud LLM handles
`extract` / `judgeLink` / `compose` / `respond` (OpenAI-compatible endpoint, JSON output), while embeddings run
offline on the local CPU with a pretrained multilingual small model, needing no key. Both are switchable by
configuration between "cloud OpenAI-compatible endpoint / local Ollama" and "local / cloud embedding", and the
domain logic notices no difference at all.

**Blocked by:** 03 (Parent voice — emotion first, mechanically checked rules), 04 (Terms and links — connecting the fragments)

**Status:** ready-for-agent

- [ ] The real provider implements all five operations: `extract` / `embed` / `judgeLink` / `compose` / `respond`.
- [ ] The LLM goes through an OpenAI-compatible endpoint and returns structured JSON; a parse failure produces a clear, diagnosable error.
- [ ] Embeddings run through transformers.js inside Node on the local CPU, fully offline with no key; model files are not committed.
- [ ] The API key lives only in a server-side environment file, never in git and never in the browser; the repo contains no plaintext key.
- [ ] Configuration selects among four combinations (cloud / local LLM × local / cloud embedding) with zero domain-logic changes.
- [ ] Domain tests are still driven entirely by the fake provider — the suite stays deterministic and passing after the real implementation lands.
- [ ] The real implementation gets only a manual smoke check (it connects, it returns the expected structure); its semantic quality is not asserted automatically.
- [ ] **Prerequisite (not part of this ticket's acceptance):** a human has already obtained and stored the cloud LLM API key; only a human can do it, using `/wizard` if needed.
