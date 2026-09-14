# `.scratch/` — local issue tracker

**This directory holds what a resumable effort needs — spec, tickets, wayfinder maps and resume notes.**
One directory per feature or effort:

```
.scratch/<feature-slug>/
├── spec.md          ← 中文主件
├── spec.en.md       ← 英文对照
├── NEXT.md          ← 恢复笔记：从哪断的、下一步做什么
├── NEXT.en.md
├── map.md           ← 只有 /wayfinder 的 effort 才有
└── issues/
    ├── 01-<slug>.md
    └── 02-<slug>.md
```

Full conventions: `docs/agents/issue-tracker.md`.

## Do not file these here

| Not this | Where it goes instead |
|---|---|
| One-off diagnostic / repair cases (scripts, logs, snapshots) | `archive/<case>/` —— 不进 git |
| Effort products (fact-checks, records, strategy docs) | `docs/<effort>/` |
| Reports a case produced | `docs/<effort>/` —— 报告是交付物，不随案进 `archive/` |
| Large binaries (`app.asar` and friends), temp databases | Delete before archiving |
| Probes whose output is empty or missing | Delete |

This directory is deliberately **not** gitignored, because git is the only thing preserving the ticket queue. That is exactly why a 310 MB file dropped here becomes a problem: the next `git add -A` tries to stage it. See `docs/agents/workspace-layout.md` for the full layout and the thin-before-archiving rule.
