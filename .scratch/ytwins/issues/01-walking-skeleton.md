# 01: 工程骨架与第一次「丢」打通全链路

**What to build:** 从空仓库到一个能跑的本地网页。打开页面，把一个无格式的碎片丢进输入框，它立刻回一句
「接住了」，**留档**保真落库，刷新页面后那句话还在。这一次投递里没有任何 AI 参与也能成功 —— 因为它在
**抽取异步于落库**这条决策上定下了形状。同时立起 TDD 测试的第一个先例：一个假 **AI provider** 驱动、
单进程、结果完全确定的测试入口。

本 ticket 还要一次性立起**三幕的页面骨架**：三个视图的布局与中文文案一次成型，第二、三幕此时是空壳
（它们分别在 07 与 06 里被填实）。这样做的理由是骨架的形状已在 spec 里冻结、且后续每张 ticket 都要往它
里面挂东西，提前做没有返工风险；但**只有第一幕接真实链路**，第二、三幕不接假数据、不实现逻辑 ——
它们不是「用假数据演示的页面」，只是还没有内容的容器。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] 仓库里存在一个 TypeScript + Node 单一工程（工程文件在仓库根），`src/` 下领域逻辑与界面层分居两个顶层目录。
      → `package.json`、`tsconfig.json`、`vite.config.ts` 在仓库根；`src/domain/` 与 `src/web/`。
- [x] 存在一个**领域核心** module，其 interface 的第一个操作是「**丢一次投递**」，返回**任务形状**的结果（这次接住了什么），不暴露表、id 拼装或 SQL。
      → `src/domain/interface.ts` 的 `drop()` 返回 `DropResult`（正文 + 回应）；存储细节藏在 `storage.ts` 端口后面。
- [x] 存在一个**AI provider port** interface，并有一个由测试脚本按输入返回预置结果的**假实现**；本 ticket 的测试全部由它驱动。
      → `src/domain/ai-provider.ts` 是端口，`src/domain/fake-provider.ts` 按 body 返回预置结果，可脚本化为延迟或抛错。
- [x] 本地 Node server 只在回环地址监听；网页由 Vite 构建；浏览器端拿不到任何 API key。
      → `src/web/server.ts` 绑 `127.0.0.1`；浏览器包内没有任何密钥形状的字符串（已核对）。
- [x] 丢一次投递后，**留档**的正文与用户当时输入的字符串逐字相同（原文全存，不存摘要）。
      → 测试断言含空白与换行的原文逐字往返；端到端也用中文原文核对过。
- [x] 投递的返回不等任何抽取：即使假 provider 被配置成延迟或抛错，投递本身依然成功落库并返回「接住了」。
      → `core.ts` 先落库、不 await provider；测试用「挂起」与「抛错」两种脚本各断言一次。
- [x] 页面刷新后该条**留档**仍在（数据落在本地 SQLite 文件里）。
      → 数据落在 `data/ytwins.sqlite`；已实测**重启服务后**该条仍在。
- [x] 存在一个可直接执行的单文件测试入口，用 Node 自带的 type stripping 运行，**不 spawn 子进程**、**不用 `node --test`**、不引入测试框架。
      → `node src/domain/domain.test.ts`，自带断言、退出码表达结果。
- [x] **三幕的页面骨架**一次立起：丢、问、浮三个视图都在，布局与中文文案成型，相互之间可切换。
      → `src/web/index.html` 三个 `data-act-panel`，顶部三个可切换的 tab。
- [x] 骨架里只有第一幕接真实链路（能真的丢、真的落库、真的回一句）；第二幕（问）与第三幕（浮）是空壳，不接假数据、不实现任何逻辑。
      → 端到端实测第一幕真的落库；第二、三幕只有一句「这一幕还没实现。」
- [x] 骨架不含任何为了演示而伪造的数据或写死的输出 —— 空的渲染成空，未实现的明确显示为未实现。
      → 列表由 `/api/drops` 真实返回驱动，空时显示「还没有丢过东西。」

## Comments

**2026-09-15 — 实现完成，两处偏离 spec 字面（均已与作者确认）**

1. **测试入口的写法被环境证伪。** ticket 要求「单文件测试入口 + Node 自带 type stripping + 不 spawn 子进程 + 不用
   `node --test`」，但这两个要求在本机无法同时成立：本机 Node v22.23.2 的 type stripping 是 **strip-only**（已实测），
   而测试文件若用 `node:test` 就**必须**打印 TAP 报告，那只能靠 spawn 拿子进程输出。结论：改用**自带断言、
   退出码表达结果**的单文件入口，与 `tools/check-workspace.test.mjs` 同形。已确认。
2. **存储实现用 `node:sqlite` 而非 spec 字面写的 `better-sqlite3`。** Node v22.5+ 内置 `node:sqlite`，零第三方
   运行时依赖、支持外键级联（`PRAGMA foreign_keys = ON`，已实测）。已确认。

**另外记两件实现中发现的实事：**

- **Vite 的 `vite build` 在本沙箱里会 `spawn EPERM`** —— esbuild 启动 service 子进程被拒。构建 `dist/web`
  需要一次不设限的执行。`npm install` 同理（生命周期脚本要 spawn）。**日常开发要注意这一点。**
- 第一版 `resolveStaticFile` 对 `GET /` 返回了构建目录本身，`readFile` 抛 `EISDIR` 把**整个 server 打挂**。
  已修：目录一律拒绝，静态服务失败降级为 404，handler 的 rejection 也不会再变成未处理拒绝。这个 bug 是
  端到端实测抓到的，不是单测抓到的 —— 记在这里当先例。
