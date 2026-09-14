# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

> **语言约定**：这些文档是给用户读的，**中文优先**。重要的文档同时产出英文对照件，命名为 `<原名>.en.md`（如 `spec.md` 与 `spec.en.md`；ticket 为 `01-foo.md` 与 `01-foo.en.md`）。标题与章节名用中文；下方所有协议字段（`Status:`、`Type:`、`Blocked by:`、`## Comments`、`## Answer`、路径与 slug）**保持英文原样**，因为它们由其他 skill 解析。

## Scope: what belongs in `.scratch/` — and what does not

`.scratch/` holds **specs, tickets, wayfinder maps and resume notes only**: one directory per feature or effort, laid out exactly as `## Conventions` below describes.

It is **not** a general dumping ground. These do not belong here:

- **One-off diagnostic or repair cases** — a bug you chased, scripts you ran, logs you captured. Their scripts are throwaway, but a written report is a primary source worth keeping. Split the case: the report goes to `docs/<effort>/`, everything else to `archive/<case>/` (untracked). See `docs/agents/workspace-layout.md`.
- **Effort products** — fact-checks, portable records, strategy docs. These are deliverables: `docs/<effort>/`.
- **Binaries or vendored copies of any kind.** An `app.asar` or similar bundle runs to hundreds of MB. `.scratch/` is deliberately **not** gitignored (see the note in `.gitignore`), so a stray copy gets staged by the next `git add -A`. `*.asar` is ignored as a backstop, not as a licence to keep them.
- **Session probes and scratch scripts whose output is empty or missing.** If it produced nothing, delete it rather than filing it.

Mechanically, a foreign top-level directory does *not* break the frontier scan — that scan reads `.scratch/<effort>/issues/`, which is already scoped. The real costs are the git hazard above and the fact that a tracker you cannot read at a glance stops being used.

See `docs/agents/workspace-layout.md` for where everything else lives.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`（中文）／`spec.en.md`（英文对照）
- **Resume notes are `.scratch/<feature-slug>/NEXT.md`**（中文）／`NEXT.en.md`. A resume note answers "where did I stop, what is next" — it is not an overview (`projects/<slug>.md`) and not a spec. It stays here rather than in `docs/` so that resuming an effort is a single lookup.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
