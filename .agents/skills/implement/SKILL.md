---
name: implement
description: "根据一份 spec 或一组 ticket 实现指定的工作。"
disable-model-invocation: true
---

> **输出语言**：面向用户的回复、提问、汇报、审批请求一律用**中文**（内部推理可用英文）。需要用户阅读的产出文档**中文优先**；重要文档同时产出英文对照件，命名为 `<原名>.en.md`（如 `spec.md` 与 `spec.en.md`）。代码、路径、命令、commit message 保持英文。架构术语（module、interface、depth、seam 等）与协议字段（`Status:`、`.scratch/`、`CONTEXT.md` 等）保留英文原词，不翻译。

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
