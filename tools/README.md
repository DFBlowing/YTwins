# `tools/` —— 长期工具

只收**会被第二个 effort 再次用到**的程序。只服务单一 effort 的脚本不进这里，跟案进 `archive/<case>/`。
规则全文见 [`docs/agents/workspace-layout.md`](../docs/agents/workspace-layout.md)。

**写新脚本之前先看这张表 —— 能复用就别重写。**

| 工具 | 做什么 | 入口 |
|---|---|---|
| [`check-workspace.mjs`](check-workspace.mjs) | 检查目录布局有没有违例（根目录杂物、`.scratch/` 里的非 tracker 目录、effort 目录里的杂物、`archive/` 里的大文件）。按需运行，不拦截任何操作 | `node tools/check-workspace.mjs` |

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

# 类型检查（只覆盖 src/）
npm run typecheck
```

> **`node --test` 在受限沙箱里会报 `spawn EPERM`。** 那是沙箱禁止子进程管道，不是测试失败 ——
> 直接执行测试文件本体即可（`node tools/check-workspace.test.mjs`），效果相同，退出码 0 才算过。
