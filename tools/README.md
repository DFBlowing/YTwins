# `tools/` —— 长期工具

只收**会被第二个 effort 再次用到**的程序。只服务单一 effort 的脚本不进这里，跟案进 `archive/<case>/`。
规则全文见 [`docs/agents/workspace-layout.md`](../docs/agents/workspace-layout.md)。

**写新脚本之前先看这张表 —— 能复用就别重写。**

| 工具 | 做什么 | 入口 |
|---|---|---|
| [`check-workspace.mjs`](check-workspace.mjs) | 检查目录布局有没有违例（根目录杂物、`.scratch/` 里的非 tracker 目录、effort 目录里的杂物、`archive/` 里的大文件）。按需运行，不拦截任何操作 | `node tools/check-workspace.mjs` |
| [`smoke-provider.mjs`](smoke-provider.mjs) | **真实 provider 的手工冒烟**（ticket 12）：用 `.env` 里的真实配置打通八个操作，检查返回结构并打印内容。规格明确只手工冒烟、不自动断言语义质量，所以它不进任何测试套件 | `node tools/smoke-provider.mjs [all\|llm\|embedding]` |

**一次性的端到端验收脚本**（`e2e-ticket-<NN>.mjs`，一个 ticket 一个）：它们按
[`docs/agents/workspace-layout.md`](../docs/agents/workspace-layout.md) §`tools/` 里那条**已命名的例外**放在这里 ——
不是「长期工具」，而是**回归**：每改一次领域代码，重跑一遍这些脚本，看跨层的链路有没有被改坏。所以它们留在
git 里（`archive/` 不进 git），并且每个都在这张表里占一行。

| 脚本 | 验什么 | 入口 |
|---|---|---|
| [`e2e-ticket-02.mjs`](e2e-ticket-02.mjs) | 真 HTTP：投递 → 事项/留档、待安排、输入类型不外泄、重启后仍在 | `node tools/e2e-ticket-02.mjs` |
| [`e2e-ticket-03.mjs`](e2e-ticket-03.mjs) | 真 HTTP：落库那条回应 → 被校验过的替换、违规那句在任何响应里都取不到、停止追问、重启后同样 | `node tools/e2e-ticket-03.mjs` |
| [`e2e-ticket-04.mjs`](e2e-ticket-04.mjs) | 真 HTTP：投递 → 词条（保留原话）、同次投递的硬边、跨投递的相似边带理由与强度、向量不外泄、重启后仍在 | `node tools/e2e-ticket-04.mjs` |
| [`e2e-ticket-05.mjs`](e2e-ticket-05.mjs) | 真 HTTP：投递 → 阈值汇集出**小结论**（带支撑词条与可解释数值）、安静期内不出结论、画像只读（没有可写的入口）、不外泄 matter/向量、重启后**结论链**仍在 | `node tools/e2e-ticket-05.mjs` |
| [`e2e-ticket-06.mjs`](e2e-ticket-06.mjs) | 真 HTTP：三句之后**浮现**出一条（当场判定、带支撑与可解释数值）、同一轮不浮第二条、非情绪投递不是时机、不外泄 matter/向量、重启后 **7 天冷却**仍在 | `node tools/e2e-ticket-06.mjs` |
| [`e2e-ticket-08.mjs`](e2e-ticket-08.mjs) | 真 HTTP：投递 → **事项落到时间上**（按日期排序、过期的排最前）、没解析出时间的留在「待安排」不被丢掉、两件同一时刻的事项不做冲突检测、推进状态后从列表消失但仍是事项、状态改动重启后仍在、不外泄列名/向量 | `node tools/e2e-ticket-08.mjs` |
| [`e2e-ticket-09.mjs`](e2e-ticket-09.mjs) | 真 HTTP：**删除先告知再执行** —— 预览报出受影响的小结论（给出原话而非数字）且自身不改动任何东西、没有「不说选哪种」的删除入口、不认识的选项被拒、`keep` 什么都不删、`cascade` 之后投递/小结论/只有它说过的词条与链接一并消失且追溯不再命中、`original-only` 逐字保留小结论只去掉原文、删掉的东西重启后不回来 | `node tools/e2e-ticket-09.mjs` |
| [`e2e-ticket-10.mjs`](e2e-ticket-10.mjs) | 真 HTTP：**修订** —— 标「不对」在链上添一条推翻记录且**旧结论一字未改**（句子、支撑词条、位置都在）、重复标只记一次、标不存在的返回 404、补一句自己的话作为**新投递**原话落库并抽出词条、那句话落进同一条链、空话被 400 拒、打分/点赞/批量反馈在 API 与页面两侧都不存在、重启后修订仍在 | `node tools/e2e-ticket-10.mjs` |
| [`e2e-ticket-11.mjs`](e2e-ticket-11.mjs) | 真 HTTP：**主动询问 → 一条答案** —— 由**多条**小结论汇成（不是单条复述，句子是 provider 的、由档位开头说出来）、列出它由哪几条与哪些词条支撑、与浮现**共用同一轮与同一套冷却**（问第二次与随后的一次投递都是 cooldown）、不外泄 matter/向量/列名、重启后冷却仍在、**换一套更薄的数据就答不出来**（只剩一条时只浮现那一条） | `node tools/e2e-ticket-11.mjs` |
| [`e2e-ticket-13.mjs`](e2e-ticket-13.mjs) | 真 HTTP：**三幕 demo** —— 台词由服务端从预置素材给（页面不抄第二份）、重置把预置的两句×两件事铺进库、三幕各自跑出预期的那句话（事项带日期、答案指出**那一次**投递、第三幕浮出另一件事并列出预置词条）、**重置后再跑一遍逐字相同**、`/api/privacy` 在演示模式说「什么都不出去」而真实模式指名云端 LLM 与留在本机的 embedding、真实服务器上**没有**重置路由、没被告知边界的服务器说「没读到」而不是「什么都不出去」、注册/推送这类路由不存在 | `node tools/e2e-ticket-13.mjs` |

**演示脚本**（13）：[`docs/ytwins/demo-script.md`](../docs/ytwins/demo-script.md)（中文主件）与
[`demo-script.en.md`](../docs/ytwins/demo-script.en.md) —— 三幕的台词、预期结果、重跑与救场、
台下问题的答法。它不是 `tools/` 里的程序，所以只在这里指个路。

## 约定

- 单文件工具直接放 `tools/` 根；多文件工具各自一个目录，目录里带 `README.md`。
- 每个工具在上面的表里占一行，写清「做什么」和「怎么跑」。
- 测试与实现同目录，命名 `<name>.test.mjs`。
- 仓库现在有 `package.json` 了（`src/` 的 TypeScript 工程，见 ticket 01），所以 `tools/` 下的 `.mjs`
  可以照旧由 Node 直接跑，也可以用 `npm run typecheck` 顺带检查类型 —— 但 `tools/` 本身仍是纯 JS，
  不进 `tsconfig.json` 的 `include`。类型检查覆盖 `src/`。
- **`src/` 下的测试是 `<name>.test.ts`**（`src/domain/domain.test.ts`），不套用上面的 `.mjs` 命名 ——
  它要跟着被测代码一起过类型检查。**这条例外不改 `tools/` 的规矩**：`tools/` 里仍用 `.mjs`。

```bash
# 跑检查器
node tools/check-workspace.mjs

# 跑测试
node tools/check-workspace.test.mjs

# 跑领域测试（单进程、自带断言、退出码表达结果）
node src/domain/domain.test.ts

# 跑 AI provider 的测试（同样是单文件入口；全程不联网，fetch 与模型都是注入的）
node src/ai/provider.test.ts

# 真实 provider 的手工冒烟（要 key、要联网；第一次会下载本地 embedding 模型）
node tools/smoke-provider.mjs

# 类型检查（只覆盖 src/）
npm run typecheck
```

> **`node --test` 在受限沙箱里会报 `spawn EPERM`。** 那是沙箱禁止子进程管道，不是测试失败 ——
> 直接执行测试文件本体即可（`node tools/check-workspace.test.mjs`），效果相同，退出码 0 才算过。
