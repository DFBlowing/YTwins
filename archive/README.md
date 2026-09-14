# `archive/` —— 副产物区

**这个目录不进 git**（`/archive/` 在 `.gitignore` 里），装的是**只读历史**：

- `archive/<case>/` —— 一次性排查或修复案子留下的脚本、日志、快照、原始粘贴。
- 每次运行都会重生的记录（如 `latest-billing-run.json`）也放这里，避免它们反复长进受跟踪的目录。

## 三条规则

1. **放这里的都是副产物。** 写出来的报告、便携记录是**交付物**，留在 `docs/<effort>/`。
   分界是「将来还会被引用或重读吗」—— 会，就是交付物。
2. **归档前先瘦身。** 几百 MB 的二进制、临时数据库在搬进来**之前**删掉。
3. **归档件不再修改。** 案例内部的路径是当时实际执行过的命令原文，**故意不改写**；
   想复查时按「文件就在同目录下」理解。

完整约定见 [`docs/agents/workspace-layout.md`](../docs/agents/workspace-layout.md)。
想检查有没有放错位置的东西，跑：

```bash
node tools/check-workspace.mjs
```
