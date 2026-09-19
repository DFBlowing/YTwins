# Ask 档案（YTwins）

`/ask` 是**通用**的：它不认识任何工作目录。它从当前目录读到这份文件，就按这里写的办。

这里写的是**这个目录**认哪些路由器、有哪些本地说法。骨架的完整说明在 DSH 仓库的
`docs/DSH-工作区说明.md`「三层入口」与 `docs/agents/workspace-layout.md`。

## 本目录认的路由器

- **`ask-matt`** —— 这里的主线路由器。`src/` 是个 vite / TS 网页 demo，写功能、排障、重构与评审、
  拆 story 与 ticket 都走它。它点名的 flow 是**仅用户调用**的，所以 `/ask` 只替你投票，
  由你敲那一条。
- **`ask-basic`** —— 本机能力：网页与联网搜索、PDF / EPUB 解析、Obsidian 库、视频与讲座。
  它的叶子是**模型可调用**的，`/ask` 直接做完，再告诉你用了哪个。

本目录**只认这两个**。第三类需求是科研（`ask-scholar`）—— 那一族只挂在 AgScholar，从这里看不见。

## 写东西之前先看词表

story、ticket、测试名都要用 `CONTEXT.md` 规定的词 —— 这个产品的词是自造的，凭感觉写会写歪。
`/ask` 在这里替人写这类内容前，先读那份词表。

## 本目录其余的约定

语言策略、那五条约定、issue tracker（`.scratch/<feature-slug>/`）、triage 标签、材料该放哪 ——
一律以 `AGENTS.md` 为准；`/ask` 动手前先按它，不在这里重复。
