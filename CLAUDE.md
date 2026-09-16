@AGENTS.md

<!--
  本文件是 Claude Code 进入本仓库的入口，不是指令的第二份副本。
  AGENTS.md 是单一事实来源（DSH 也直接读它）；这里只做导入 + Claude 侧差异说明。
  改动语义内容的指令请改 AGENTS.md，不要在这里重复。
-->

## Claude Code

**技能来源。** 本仓库**不自带** skill 副本：25 个 Matt skill 的实体在中央 store
`C:\Users\17624\.cc-switch\skills`，Claude Code 与 DSH 分别通过用户级根 `~/.claude/skills`、
`~/.agents/skills`（都是链接层）读到同一批。**改 skill 只改中央 store 一处**，两边同时生效；
在 store 里新增 skill 时，另需在两个用户级根各补一条链接。
`disable-model-invocation: true` 与 `user-invocable: false` 在 Claude Code 与
DSH 中字段名和语义一致，14 个「仅用户调用」的编排 skill 在 `/` 菜单里可用、不会被自动触发。

**协议字段不要翻译。** `Status:`、`Type:`、`Blocked by:`、`## Comments`、`## Answer`、`CONTEXT.md`、
`CONTEXT-MAP.md`、`.scratch/`、`docs/adr/` 由其他 skill 解析；架构术语（module、interface、depth、seam、
adapter、leverage、locality）保留英文原词。

**命令别名冲突。** 本仓库流程走 `/code-review`（同名 skill，项目优先于捆绑）；Claude Code 自带的别名
`/review` 仍指向捆绑版本，那是另一套流程。

## Claude Code 桥接（本仓库怎么接上的）

2026-09-16 起只剩一个桥接件 —— skill 改走用户级根，仓库里不再需要 skill 侧桥接：

| 桥接件 | 类型 | 作用 |
|---|---|---|
| `CLAUDE.md` | 文件（导入 `@AGENTS.md` + Claude 侧补充） | 让 Claude Code 拿到与 DSH 相同的指令 |
| `~/.claude/skills` | 用户级链接层（**在仓库外**） | Claude Code 发现全部 skill；与 DSH 共用同一批实体 |

**为什么是导入，而不是符号链接。** Windows 上建符号链接需要管理员权限或开发者模式（Anthropic 官方
文档即如此建议），导入则避免 `CLAUDE.md` 变成第二份指令。（原来那个 `.claude/skills` junction 已于
2026-09-16 删除 —— 它指向 `.agents/skills`，而那批仓库内副本同一天一起删掉了。）

**字段兼容性（已核对）。** `disable-model-invocation: true` 与 `user-invocable: false` 在 DSH 与
Claude Code 中语义一致 —— 前者「不进模型技能目录 / 从上下文移除」，后者「不进 `/` 菜单 / Claude 仍可调用」。
本仓库的 14 个编排 skill 用的是前者。Claude Code 的扩展字段（`allowed-tools`、`model`、`paths` 等）
在本仓库**未使用**，`SKILL.md` 保持上游形态。

**已知限制。**

1. **skill listing 预算。** Claude Code 把每个 skill 的 `name` + `description` 放进上下文（约为窗口的 1%），
   超出时**优先裁掉调用次数最少**的描述 —— 这 25 个在 Claude Code 侧很少被调用，可能是第一批被裁的。
   影响仅限「模型自动选中 skill」；用 `/` 直接调用不受影响。
2. **`/review` 与 `/code-review` 是两个流程**（见上）。
3. **「能加载」不等于「能跑完」。** `/code-review` 依赖并行子 agent、`/implement` 依赖 TDD 循环与收尾审查，
   这些由 Claude Code 自己的机制承接，但要用一个真实 ticket 端到端验一次。
4. **agent 指令是上下文，不是强制配置。** `CLAUDE.md` 作为用户消息传入，Claude 会尽量遵守但无硬保证；
   需要硬约束时改用 hooks 或权限规则。

**验证。** 在 `D:\AppData\Obsidian\AI_Message\YTwins` 下启动 Claude Code：`/context` 应显示 `CLAUDE.md`，
`/skills` 应列出这 25 个 skill（来源是 user，不是 project），`/to-tickets` 应能直接调用。

**维护。** `.claude/` 不进 git。`CLAUDE.md` 是唯一还需要的桥接件，不要删。**不要再建仓库级的 skill
链接** —— 要让 Claude Code 用上某个新 skill，在中央 store 建实体，再往两个用户级根各加一条链接。
