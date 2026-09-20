# YTwins

> **your twins** — a **frictionless** AI companion: you drop in your schedule, ideas and moods
> offhand, it catches them, quietly turns the fragments into small conclusions where you cannot
> see it, and once there is enough, surfaces one sentence in an uncertain tone at a chosen moment.

**Status: early.** The end goal is a phone app; today it starts as a web demo. The only user is the author.

## What this is

In one line: **it remembers you all along, rather than chatting with you at any time.**

- No filing, no tagging, no timestamps — the page has a single box.
- It keeps no conversation, never pushes a notification, never scores you or asks you to like anything.
- Everything it says is a **judgment** rather than a **fact**, so the wording always carries
  uncertainty ("you seem…").

**It is not**: a chat assistant, a to-do list, a companion bot, or a note-taking app.

The domain glossary (frictionless, companionship, drop, term, conclusion, surfacing …) lives in
[`CONTEXT.md`](./CONTEXT.md) — **read it before the code**; that file is the single source of truth
for this repository's terms. It is written in Chinese.

## Quick start

Requires **Node 22.18 or newer**.

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run build:web
npm run server
```

Open **http://127.0.0.1:5273/** — the server is visible on this machine only; nobody on the same
LAN can reach it.

`.env` takes just two lines: which vendor preset, and that vendor's key. **Switching vendors =
edit those two lines and restart the server**; no call path changes. The preset table is in
[`.env.example`](./.env.example).

## Documentation

| I want to… | Read |
|---|---|
| **use the product**: start it, switch models, troubleshoot, tune parameters, find my data | **[`projects/YTwins-使用手册.md`](./projects/YTwins-使用手册.md)** (Chinese) |
| know what each term means | [`CONTEXT.md`](./CONTEXT.md) (Chinese) |
| read the full requirements as originally agreed | [`.scratch/ytwins/spec.md`](./.scratch/ytwins/spec.md) (Chinese) |
| see where the work stands and what is next | [`.scratch/ytwins/NEXT.md`](./.scratch/ytwins/NEXT.md) (Chinese) |
| run the demo and handle audience questions | [`docs/ytwins/demo-script.md`](./docs/ytwins/demo-script.md) (Chinese) |
| understand where files belong | [`docs/agents/workspace-layout.md`](./docs/agents/workspace-layout.md) (Chinese) |

> Chinese original: [`README.md`](./README.md). Every other document is Chinese-first; the language
> policy is in [`AGENTS.md`](./AGENTS.md).

## Common commands

| Command | What it does |
|---|---|
| `npm run server` | Start the local server (the product itself) |
| `npm run build:web` | Build the web page — rerun it after touching the UI, or the page will not open |
| `npm run smoke` | Exercise the real `.env` against the model and the embedding to verify the wiring |
| `npm test` | Domain logic tests |
| `npm run typecheck` | Type checking |
| `npm run check` | Check whether the directory layout has drifted |

## Data and privacy

`data/` and `.env` **never enter git**; they belong to the machine that runs the product.

| Path | What it is |
|---|---|
| `data/ytwins.sqlite` | Everything you have dropped in |
| `data/models/` | Local embedding model cache (~120 MB, downloaded on first use) |
| `.env` | Your key and configuration — do not share it |

To confirm what leaves this machine, read the section of the same name on the product page: it is
read out by the **server from the actual local wiring**, not hard-coded. With a local model
(Ollama and the like), nothing you say leaves this machine.

## License

A personal project; no license chosen yet.
