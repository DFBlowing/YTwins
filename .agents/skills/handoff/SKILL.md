---
name: handoff
description: 把当前对话压缩成一份 handoff 文档，交给下一个 agent 接手。
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

> **输出语言**：面向用户的回复、提问、汇报、审批请求一律用**中文**（内部推理可用英文）。需要用户阅读的产出文档**中文优先**；重要文档同时产出英文对照件，命名为 `<原名>.en.md`（如 `spec.md` 与 `spec.en.md`）。代码、路径、命令、commit message 保持英文。架构术语（module、interface、depth、seam 等）与协议字段（`Status:`、`.scratch/`、`CONTEXT.md` 等）保留英文原词，不翻译。

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
