---
name: to-tickets
description: 把 plan、spec 或当前对话拆成一组 tracer-bullet ticket，每个都声明自己的 blocking edges，并发布到已配置的 tracker（本地 tracker 每个 ticket 一个文件、用文本写 edges，真实 tracker 用原生 blocking 链接）。
disable-model-invocation: true
---

> **输出语言**：面向用户的回复、提问、汇报、审批请求一律用**中文**（内部推理可用英文）。需要用户阅读的产出文档**中文优先**；重要文档同时产出英文对照件，命名为 `<原名>.en.md`（如 `spec.md` 与 `spec.en.md`）。代码、路径、命令、commit message 保持英文。架构术语（module、interface、depth、seam 等）与协议字段（`Status:`、`.scratch/`、`CONTEXT.md` 等）保留英文原词，不翻译。

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: 简短描述性名称
- **Blocked by**: 必须先完成的其他 ticket（若有）
- **What it delivers**: 该 ticket 打通了什么端到端行为

Ask the user（用中文提问）:

- 这个粒度合适吗？（太粗／太细）
- 阻塞关系对吗：每个 ticket 是否只依赖真正会阻塞它的 ticket？
- 有没有 ticket 需要合并或继续拆分？

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured; the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below: one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply the `ready-for-agent` triage label unless instructed otherwise; the tickets are agent-grabbable by construction.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

<local-ticket-template>

> 正文用**中文**写；`# <NN>: <标题>` 的数字与 slug 保持英文格式。协议字段（`Blocked by:`、`Status:`）**保留英文原样**。发布时同时产出英文对照件 `<NN>-<slug>.en.md`。

# <NN>: <Ticket 标题>

**What to build:** 该 ticket 要打通的端到端行为，从用户视角描述，而不是逐层罗列实现步骤。

**Blocked by:** 卡住本 ticket 的 ticket 编号／标题；没有则写 "None (can start immediately)"。

**Status:** ready-for-agent

- [ ] 验收标准 1
- [ ] 验收标准 2

</local-ticket-template>

<issue-template>

> 正文用**中文**写；章节标题用下面的形式。协议字段保持英文。

## Parent

对 tracker 上父 issue 的引用（若来源是已存在的 issue，否则省略本节）。

## What to build

该 ticket 要打通的端到端行为，从用户视角描述，而不是逐层罗列实现。

## Acceptance criteria

- [ ] 标准 1
- [ ] 标准 2

## Blocked by

- 对每个阻塞 ticket 的引用；没有则写 "None (can start immediately)"。

</issue-template>

In either form, avoid specific file paths or code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.
