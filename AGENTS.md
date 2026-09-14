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

本仓库**自带** 25 个 Matt Pocock skill，装在 `.agents/skills/`，版本由根目录的 `skills-lock.json` 锁定
（`npx skills update` 按锁刷新）。`.claude/skills` 是指向 `.agents/skills/` 的目录 junction，供 Claude Code 使用；
`.claude/` 不进 git。

**加载来源要说清楚**：DSH 与 Claude Code 都从**工作区内的** `.agents/skills/` 读技能；用户主目录下的
`~/.agents/skills` 只有 10 个非 Matt skill（obsidian / byok 那批），两者不是一回事。改 skill 只改
`.agents/skills/` 一处，不要往 `.claude/` 里复制 SKILL.md。

主流程：`/grill-with-docs → /to-spec → /to-tickets → /implement → /code-review`。
25 个 skill 怎么用（14 个用户调用 + 11 个模型调用）见 `docs/Matt-Skills-使用指南.md`。

**副本提醒（重要）。** `DSH` 工作区里也有同一份 25 个 skill 的副本。**改 skill、或升级 skill 之后，
两个仓库各要更新一次**（在各自目录跑 `npx skills update`，它按 `skills-lock.json` 刷新），否则两边行为会
悄悄漂移 —— 同一个 `/implement` 在两个目录里跑出不同结果，是最难查的一类不一致。
之所以选「各存一份」而不是让本仓库 junction 到 `DSH`：本仓库要能**独立存活**（将来推远端、换机器、
或 `DSH` 被改名/删除），而 junction 不能进 git、跨机器失效。
