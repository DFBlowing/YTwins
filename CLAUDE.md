@AGENTS.md

<!--
  本文件是 Claude Code 进入本仓库的入口，不是指令的第二份副本。
  AGENTS.md 是单一事实来源（DSH 也直接读它）；这里只做导入 + Claude 侧差异说明。
  改动语义内容的指令请改 AGENTS.md，不要在这里重复。
-->

## Claude Code

**技能来源。** 25 个 skill 是本仓库自带的，在 `.agents/skills/`；`.claude/skills` 是指向它的目录 junction，
所以 Claude Code 无需复制任何文件即可加载同一批。**改 skill 只改 `.agents/skills/` 一处**，两边同时生效；
不要往 `.claude/` 里复制 SKILL.md。版本由 `skills-lock.json` 锁定。
`disable-model-invocation: true` 与 `user-invocable: false` 在 Claude Code 与
DSH 中字段名和语义一致，14 个「仅用户调用」的编排 skill 在 `/` 菜单里可用、不会被自动触发。

**协议字段不要翻译。** `Status:`、`Type:`、`Blocked by:`、`## Comments`、`## Answer`、`CONTEXT.md`、
`CONTEXT-MAP.md`、`.scratch/`、`docs/adr/` 由其他 skill 解析；架构术语（module、interface、depth、seam、
adapter、leverage、locality）保留英文原词。

**命令别名冲突。** 本仓库流程走 `/code-review`（同名 skill，项目优先于捆绑）；Claude Code 自带的别名
`/review` 仍指向捆绑版本，那是另一套流程。

## Claude Code 桥接（本仓库怎么接上的）

桥接件只有两个，都不产生第二份真相：

| 桥接件 | 类型 | 作用 |
|---|---|---|
| `.claude/skills` | **目录 junction** → `.agents/skills` | 让 Claude Code 发现这 25 个 skill，且不复制副本 |
| `CLAUDE.md` | 文件（导入 `@AGENTS.md` + Claude 侧补充） | 让 Claude Code 拿到与 DSH 相同的指令 |

**为什么是 junction + 导入，而不是符号链接。** Windows 上建符号链接需要管理员权限或开发者模式，
junction 不用提权；导入则避免 `CLAUDE.md` 变成第二份指令。

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
`/skills` 应列出 25 个项目 skill，`/to-tickets` 应能直接调用。

**维护。** `.claude/` 不进 git（junction 在别的机器上无意义，重建成本极低）。删桥接 = 删 `.claude/skills`
与 `CLAUDE.md`。**不要把 Claude Code 专属 skill 塞进 `.agents/skills/`** —— 那个目录 DSH 也会当成 skill 加载。
