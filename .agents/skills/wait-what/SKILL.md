---
name: wait-what
description: "停一下。上一条消息没听懂：请用中文、更平实简短地重新讲一遍。"
disable-model-invocation: true
---

> **输出语言**：面向用户的回复、提问、汇报、审批请求一律用**中文**（内部推理可用英文）。需要用户阅读的产出文档**中文优先**；重要文档同时产出英文对照件，命名为 `<原名>.en.md`（如 `spec.md` 与 `spec.en.md`）。代码、路径、命令、commit message 保持英文。架构术语（module、interface、depth、seam 等）与协议字段（`Status:`、`.scratch/`、`CONTEXT.md` 等）保留英文原词，不翻译。

Wait, I don't understand where you've got to here. Re-pitch that: give me a little bit of context, talk in plain, simple Chinese (用中文，平实简短), and use the ubiquitous language from `CONTEXT.md` (follow `CONTEXT-MAP.md` to the right one if the repo has more than one).
