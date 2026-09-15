# `tools/` —— 长期工具

只收**会被第二个 effort 再次用到**的程序。只服务单一 effort 的脚本不进这里，跟案进 `archive/<case>/`。
规则全文见 [`docs/agents/workspace-layout.md`](../docs/agents/workspace-layout.md)。

**写新脚本之前先看这张表 —— 能复用就别重写。**

| 工具 | 做什么 | 入口 |
|---|---|---|
| [`check-workspace.mjs`](check-workspace.mjs) | 检查目录布局有没有违例（根目录杂物、`.scratch/` 里的非 tracker 目录、effort 目录里的杂物、`archive/` 里的大文件）。按需运行，不拦截任何操作 | `node tools/check-workspace.mjs` |

**一次性的端到端验收脚本**（按 ticket 编号命名，验收完就留着当回归用；它们不属于上面的「长期工具」，
但也没别的地方可放）：

| 脚本 | 验什么 | 入口 |
|---|---|---|
| [`e2e-ticket-02.mjs`](e2e-ticket-02.mjs) | 真 HTTP：投递 → 事项/留档、待安排、输入类型不外泄、重启后仍在 | `node tools/e2e-ticket-02.mjs` |
| [`e2e-ticket-03.mjs`](e2e-ticket-03.mjs) | 真 HTTP：落库那条回应 → 被校验过的替换、违规那句在任何响应里都取不到、停止追问、重启后同样 | `node tools/e2e-ticket-03.mjs` |

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
