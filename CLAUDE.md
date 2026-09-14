@AGENTS.md

<!--
  本文件是 Claude Code 进入本仓库的入口，不是指令的第二份副本。
  AGENTS.md 是单一事实来源（DSH 也直接读它）；这里只做导入 + Claude 侧差异说明。
  改动语义内容的指令请改 AGENTS.md，不要在这里重复。
-->

## Claude Code

**技能来源。** 本仓库的 25 个 skill 装在**全局** `~/.claude/skills`，本仓库不带副本。改 skill 就去全局目录改，
不要往这里复制 SKILL.md。`disable-model-invocation: true` 与 `user-invocable: false` 在 Claude Code 与
DSH 中字段名和语义一致，14 个「仅用户调用」的编排 skill 在 `/` 菜单里可用、不会被自动触发。

**协议字段不要翻译。** `Status:`、`Type:`、`Blocked by:`、`## Comments`、`## Answer`、`CONTEXT.md`、
`CONTEXT-MAP.md`、`.scratch/`、`docs/adr/` 由其他 skill 解析；架构术语（module、interface、depth、seam、
adapter、leverage、locality）保留英文原词。

**命令别名冲突。** 本仓库流程走 `/code-review`（同名 skill，项目优先于捆绑）；Claude Code 自带的别名
`/review` 仍指向捆绑版本，那是另一套流程。
