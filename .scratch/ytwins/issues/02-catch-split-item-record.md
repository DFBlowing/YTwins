# 02: 接住的结构 —— 自动分出事项与留档

**What to build:** 丢一段混杂输入（例如「老师今天讲了期末怎么算分，下周三交提纲」），系统自动把它分成
**事项**与**留档**，页面当场显示「这次接住了什么」；用户全程不必选类型、不必填时间、不必打标签。
没解析出时间的事项被保留为「待安排」，不被丢掉。**输入类型**（情绪/决策/事项/灵感）在内部打上标记，
但界面上不出现、也不要求用户选择。

**Blocked by:** 01（工程骨架与第一次「丢」打通全链路）

**Status:** ready-for-human

- [x] 一次投递可以同时产出**事项**与**留档**，且**留档**是原文而非摘要。
      → 同一次 `drop()`：原文由 `store.appendDrop` 立即保真落库（`drop_.body`），**事项**由随后的抽取产出；
      测试断言两者同出，且留档与输入逐字相同（`src/domain/domain.test.ts`）。
- [x] **事项**指回它来自哪一次投递。
      → `item_.drop_id` 外键 + `Item.dropId`；接口层测过事项的 `dropId` 等于那次投递的 id。
- [x] 没解析出时间的事项以「待安排」形态保留，不出现在任何时间位置上。
      → `item_.due_at` 可为 NULL，`Item.dueAt: string | null`。**没有**任何排序、过滤或视图按时间摆放它 ——
      那是 08 的事；本 ticket 只保证它不被丢掉。页面把它显示为「待安排」。
- [x] 系统在内部给投递打上**输入类型**，但页面上没有任何类型选择控件、也不展示分类结果。
      → `drop_.input_type` 存内部判定，不经过 `DropSummary` 暴露给页面。**端到端断言**：`/api/drops` 的
      JSON 里不含 `inputType`、也不含任何类型值（`tools/e2e-ticket-02.mjs`）。页面无类型控件。
- [x] 抽取失败或延迟不影响投递成功（沿用 01 的异步形状），且抽取可事后补跑。
      → `drop()` 先落库、`void extractInto()` 不 await；`extract(dropId)` 是可重复调用的补跑入口，
      **永不 reject**，失败回落为 `extracted: false`。测试覆盖挂起、reject、同步 throw 三种形状，并断言
      补跑能成功且**不产生重复事项**。
- [x] 页面上能看见这次投递产生的事项列表。
      → 第一幕每条投递下方渲染它的事项（含时间或「待安排」）。因为投递不等抽取，页面在投递后**轮询**
      `GET /api/drops/:id` 直到读到为止；放弃轮询时诚实显示「还没读完这条」。

## Comments

**2026-09-15 — 实现完成**

**新增的领域词汇与形状**（都在 `src/domain/interface.ts`，即最高 seam）：

- `InputType = 'emotion' | 'decision' | 'item' | 'idea'` —— 内部判定，**只用于产品自己决策**，不是给用户浏览的
  分类；接口上没有任何入口能让调用方按类型查询或让用户选择。
- `Item { id, text, dueAt: string | null, dropId }` —— `dueAt` 为 null 即「待安排」。
- `DropResult` 增加 `id`（投递刚记下，事项还不存在，所以页面得知道该问哪一次投递）。
- `DropSummary` 增加 `items` 与 `extracted`。
- 新增两个操作：`getDrop(dropId)`（读回一次投递，不存在返回 null）、`listItems()`、
  `extract(dropId)`（补跑入口）。

**三个设计决策值得记下来：**

1. **`extracted` 是「读过了没有」，不是「是哪个类型」。** `drop_.input_type` 为 NULL 同时表示「还没读」，
   所以一个字段就够，不需要第二个可能与之矛盾的列。这条 null 是有承载力的：它正是**补跑**得以存在的前提 ——
   「读过且确实没有事项」和「还没读过」必须可区分，否则补跑要么重复产出、要么永远拒绝。
2. **抽取把事项与输入类型**一次写入**（`recordExtraction`），且先删后写。** 于是补跑收敛到同一批事项，
   重试不会让用户看到两份同样的东西。
3. **`drop()` 不返回事项，`extract()` 才等。** 投递返回时事项尚不存在（这是 01 定下的形状的直接后果），
   所以页面读回投递来获知结果 —— 与刷新后走的是同一条路径，因此两者不会漂移。

**兼容旧库**：`CREATE TABLE IF NOT EXISTS` 不会给已存在的表加列，01 的库会缺 `input_type`。`sqlite-store.ts`
用 `PRAGMA table_info` 检一次、缺则 `ALTER TABLE ADD COLUMN`（可空列，无需重写、不丢数据）。本 ticket 之后
`item_.drop_id` 的外键级联真正开始承载语义（09 依赖它）。

**一次并行的教训（已写进 `NEXT.md`）**：07 曾与 02 同时开工，两者改的是同一批文件（`interface.ts` 首当其冲），
互相覆写。07 已干净撤回、备份在 `archive/ticket-07-wip/`（不进 git），恢复方法记在 07 的 `## Comments`。
结论：**本 effort 一律串行。**

**测试**：领域 23/23（其中本 ticket 新增 13 条）、端到端 7/7（新增 `tools/e2e-ticket-02.mjs`）、
`check-workspace` 21/21、`tsc --noEmit` 全绿。Vite 构建与端到端实测均在本机跑通。
