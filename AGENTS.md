# YTwins

**YTwins**（your twins）是一个个人产品：用户把日程、灵感、情绪随口丢进来，AI 接住、在用户看不见的地方把碎片
沉淀成小结论，并在特定时刻以不确定的语气把它们浮出来。终局是手机应用，当前从网页 demo 做起。

领域词表在 [`CONTEXT.md`](./CONTEXT.md) —— 写 story、ticket、测试名之前先用它规定的词。
本文件是 agent 进入本仓库的入口：语言策略 + 五条约定。语义内容只改这里，不要在别处留第二份副本。

## 语言策略（Language policy）

用户母语是**中文**。以下规则适用于**所有** skill，无需每个 skill 重复声明。

**回复语言：**
- 面向用户的全部输出使用**中文**：提问、汇报、澄清、方案对比、审批请求、错误说明、总结。
- 内部推理（thinking）可用英文，不必翻译。
- `/grill*`、`/triage`、`/wayfinder` 等 skill 向用户提出的问题，**必须是中文**。
- 用户用中文回答后，由你负责把答案归纳、翻译成英文再继续后续流程（写 spec、写 ticket、写 ADR 等）。

**产出语言：**
- 用户可读的文档**中文优先**：spec、ticket、评审报告、ADR 的叙述部分、HTML demo 的界面文案。
- 重要的用户可读文档**同时产出中英两份**：中文为 `X.md`，英文对照为 `X.en.md`（例如 `spec.md` 与 `spec.en.md`）。英文版是完整翻译，用于保证项目文档质量。
- 代码、代码注释、变量名、commit message、文件路径、命令保持**英文**（工程惯例）。
- 网站 / demo / 原型中**呈现给最终用户看的内容**遵循中文习惯：界面文案、示例数据、日期与货币格式、占位文本都用中文；代码本身仍为英文。

**术语处理（重要）：**
有的 skill 刻意用英文单词作为「leading word」来锚定行为，也有固定的架构词汇表。这些术语**保留英文原词**，不要翻译：
- 架构术语：module、interface、implementation、depth、deep、shallow、seam、adapter、leverage、locality（`/codebase-design` 明确禁止替换成 component、service、API、boundary）。
- 行为锚点：red、green、tight、tracer bullet、fog of war、seam 等。
- 首次出现时可用「英文词（中文解释）」的形式帮助理解，之后沿用英文原词。

**协议字段（必须保留英文，否则 skill 之间会失配）：**
`.scratch/`、`spec.md`、`issues/<NN>-<slug>.md`、`Status:`、`Type:`、`Blocked by:`、`## Comments`、`## Answer`、`CONTEXT.md`、`CONTEXT-MAP.md`、`docs/adr/`、`AGENTS.md`、triage 标签 `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。
**只翻译这些字段旁边的说明文字，不要翻译字段本身。**

> Skill 的指令正文（SKILL.md 的流程部分）保持英文。这是有意的：其中的英文词承担锚定作用，翻译会削弱 skill 驱动行为的能力。中文化只针对「人看得到」的部分。

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Workspace layout

Where each kind of material lives (`projects/` overviews, `docs/` detail, `.scratch/` tracker,
`archive/` by-products, `tools/` reusable programs). See `docs/agents/workspace-layout.md`.

### Skills

本仓库**不自带** skill 副本：25 个 Matt Pocock skill 的实体只有一处 —— 中央 store
`C:\Users\17624\.cc-switch\skills`。DSH 与 Claude Code 分别通过用户级根 `~/.agents/skills`（rank 500）
与 `~/.claude/skills` 读到它，两者都是链接层。仓库里没有 `.agents/skills/`、没有 `skills-lock.json`、
也没有 `.claude/skills` 桥接件 —— 2026-09-16 之前有，那天三处副本一起删掉了。

**改 skill 只改中央 store 一处**，两个 harness 同时生效；升级也只在 store 上跑一次 `npx skills update`。
在 store 里加**新** skill 时，别忘了在 `~/.agents/skills` 与 `~/.claude/skills` 各补一条链接。

主流程：`/grill-with-docs → /to-spec → /to-tickets → /implement → /code-review`。
25 个 skill 怎么用（14 个用户调用 + 11 个模型调用）见 `docs/Matt-Skills-使用指南.md`。

> **代价：本仓库不再自包含。** 换机器、或 clone 到别的机器时 skill 全部不可用，需要在那边重建
> store 与两个用户级根。这是 2026-09-16 用「不漂移」换来的取舍 —— 在那之前本仓库与 `DSH` 各存一份
> 副本，每次升级要在两个目录各跑一次 `npx skills update`，漏一处 `/implement` 就会跑出不同结果。
> 来龙去脉见 `DSH` 仓库的 `docs/skills-unification/`。
