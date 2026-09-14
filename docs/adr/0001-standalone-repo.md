---
Status: accepted
---

# YTwins 独立成仓，不寄生在 DSH 工作区里

产品从这个仓库开始，而不是作为 `DSH/products/ytwins/` 的一层。`DSH` 是 skill 工作区（25 个 Matt Pocock
skill 的宿主与它们的约定文档），YTwins 从今天起有自己的根目录、自己的 `CONTEXT.md`、自己的 ticket 队列。

## 为什么

搬出去的真实理由只有两条，而且都不是「ticket 会混在一起」——那条是误解：本地 tracker 按
`.scratch/<effort-slug>/` 隔离，不同项目各占一个目录，本来就不会互相干扰。真正的理由是：

1. **两个身份会挤同一份根文档。** `DSH` 的 `AGENTS.md` / `CONTEXT.md` 讲的是「25 个 skill 怎么驱动文档、
   东西放哪儿」；产品仓库要讲的是「这个产品怎么构建、术语是什么」。合在一起只能长期互相妥协 ——
   在讨论阶段就已经出现第一个补丁（为产品加一份 `CONTEXT-MAP.md` 把两个 context 分开），
   而产品越长大，这个补丁就越碍事。
2. **手机应用在计划内。** 手机端的构建链、依赖、发布流程与 skill 工作区毫无关系。到那时仍要切一次，
   但那时要切的是**有代码、有依赖、有历史的仓库**；而现在要搬的只有三份 markdown。

## Considered Options

- **作为 `DSH/products/ytwins/` 留在工作区里** —— 否掉：上面的第 1 条；且搬迁成本随时间单调上升。
- **先留在工作区做完 demo，MVP 前再搬** —— 否掉：那时要搬的是已经有代码与 `node_modules` 的仓库，
  而且 `docs/`、`docs/adr/`、`.scratch/` 已经长满两个项目的材料，切分要动脑；现在切是机械动作。
- **本仓库**（选中）—— 一次性成本：建骨架构 + 走一次 `/handoff`，让继续工作的人在新目录下开会话。

## Consequences

- **`DSH` 回到单 context。** 产品搬走后，工作区侧的 `CONTEXT-MAP.md`、`products/` 一并删除，
  `DSH` 的检查器恢复 `clean` —— 它是 skill 工作区，不是产品仓库。
- **skill 不搬家。** 25 个 skill 装在全局 `~/.claude/skills`，新仓库直接可用，不需要在仓库内 vendor 副本。
  代价是：skill 的版本由全局安装决定，不由本仓库锁定。
- **约定随迁。** `docs/agents/` 的四份约定与 `tools/check-workspace.mjs`（含测试）都移植过来并按本仓库实情
  改了常量 —— 这是 `workspace-layout.md` 里「搬到另一个工作区」那节写好的五步。
- **交接是一次性的。** 第一轮讨论的上下文留在 `DSH` 的会话里，交接文档记在系统临时目录；
  之后本仓库的 `CONTEXT.md` 与 `.scratch/ytwins/NEXT.md` 就是唯一事实来源。
