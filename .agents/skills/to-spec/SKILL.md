---
name: to-spec
description: "把当前对话整理成一份 spec 并发布到项目的 issue tracker：不做访谈，只综合已经讨论过的内容。"
disable-model-invocation: true
---

> **输出语言**：面向用户的回复、提问、汇报、审批请求一律用**中文**（内部推理可用英文）。需要用户阅读的产出文档**中文优先**；重要文档同时产出英文对照件，命名为 `<原名>.en.md`（如 `spec.md` 与 `spec.en.md`）。代码、路径、命令、commit message 保持英文。架构术语（module、interface、depth、seam 等）与协议字段（`Status:`、`.scratch/`、`CONTEXT.md` 等）保留英文原词，不翻译。

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations.

3. Write the spec using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label - no need for additional triage.

<spec-template>

> **语言**：正文用**中文**撰写，章节标题用下面的中文标题。发布时写出两份：`spec.md`（中文，主件）与 `spec.en.md`（同一内容的完整英文翻译）。协议字段与路径保持英文。

## 问题陈述（Problem Statement）

用户面临的问题，从用户视角描述。

## 解决方案（Solution）

针对该问题的解决方案，从用户视角描述。

## 用户故事（User Stories）

一份**很长的**、编号的用户故事清单。每条用户故事采用如下格式：

1. 作为 <角色>，我希望 <功能>，以便 <收益>

<user-story-example>
1. 作为手机银行客户，我希望查看各个账户的余额，以便更好地决定我的开支
</user-story-example>

这份用户故事清单应当尽可能详尽，覆盖该功能的方方面面。

## 实现决策（Implementation Decisions）

已做出的实现决策清单。可以包括：

- 将要新建／修改的 modules
- 这些 module 中将被修改的 interfaces
- 来自开发者的技术澄清
- 架构决策
- Schema 变更
- API 契约
- 具体交互

**不要**写具体的文件路径或代码片段 —— 它们很快会过时。

例外：如果某个 prototype 产出的片段比文字更精确地表达了一项决策（状态机、reducer、schema、类型形状），把它内联到相关决策中，并简要注明来自 prototype。只保留承载决策的部分，不要放一个能跑的 demo。

## 测试决策（Testing Decisions）

已做出的测试决策清单。包括：

- 说明什么算是一个好测试（只测外部行为，不测实现细节）
- 哪些 modules 会被测试
- 测试的先例（即代码库中类似的测试类型）

## 不在范围内（Out of Scope）

说明本 spec 明确不覆盖的内容。

## 补充说明（Further Notes）

关于该功能的任何其他说明。

</spec-template>
