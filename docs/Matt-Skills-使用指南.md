# Matt Skills 使用指南

> 依据：官方手册 <https://www.aihero.dev/skills>、`/to-spec` 与 `/implement` 详情页，以及本机 `ask-matt/SKILL.md`（Matt 自己写的路由文档，比网页分组更权威）。
> 本工作区已装 **25 个**，全部中文化（详见 `DSH-工作区说明.md`）。

---

## 一、先搞懂一件事：两种 skill

这是整套体系**唯一必须先理解的概念**。25 个 skill 按「谁能调用」分成两类：

| 类型 | 数量 | 谁调用 | 本工作区 |
|---|---|---|---|
| **用户调用**（user-invoked） | **14** | **只能你手动打 `/xxx`** | 不进模型目录，但你打 `/` 能看到 |
| **模型调用**（model-invoked） | **11** | 我能自动用，你也能打 | 出现在我的技能目录里 |

**为什么这个区分重要**：14 个「用户调用」的 skill 是**编排者**（它们指挥流程）；11 个「模型调用」的是**可复用的纪律**（它们干活）。

规则是单向的：**编排者可以调用纪律，纪律不能调用编排者**。

> 所以你在 `/` 菜单里看到 14 个、我的目录里看到 11 个，加起来 25 —— **不是装丢了，是设计如此**。之前你可能因为看不到 `grill-with-docs` 而以为没装上，其实是它只在 `/` 菜单里。

**14 个用户调用**：`setup-matt-pocock-skills`、`ask-matt`、`grill-with-docs`、`to-spec`、`to-tickets`、`implement`、`code-review`、`wayfinder`、`improve-codebase-architecture`、`triage`、`wizard`、`grill-me`、`handoff`、`to-questionnaire`

**11 个模型调用**：`prototype`、`research`、`diagnosing-bugs`、`resolving-merge-conflicts`、`tdd`、`code-review`\*、`domain-modeling`、`codebase-design`、`grilling`、`writing-for-agents`、`wait-what`\*

\* 有 3 个（`code-review`、`wait-what`、`grill-me` 等）名字看着像同一类，注意 `code-review` 虽是模型可调用，但实践上你**手动打**它最有效。

---

## 二、主线：从想法到交付

官方把它叫 **The Main Flow**，是一条**流水线**。核心心法：**先对齐，再动手**。

```
/grill-with-docs  →  /to-spec  →  /to-tickets  →  /implement  →  /code-review
   追问+记决策       固化成 spec    拆成 ticket     一个ticket一个 双轴审查diff
```

**每一步在干什么、为什么需要它：**

| 步骤 | 干什么 | 为什么不能跳过 |
|---|---|---|
| `/grill-with-docs` | 我**追问你**，逼你把想法想清楚；顺手把术语写进 `CONTEXT.md`、把难回退的决定记成 ADR | 跳过它 = 我以为懂了、其实没懂，这是 AI 开发**最大的失败模式** |
| `/to-spec` | 把刚聊完的结论**固化**成 spec 文档 | **不做访谈**，只记录已决定的事。存在的理由：上下文窗口会结束，spec 是活下来的那份记忆 |
| `/to-tickets` | 把 spec 切成一个一个 **tracer bullet** ticket，每个声明自己的 blocking edges | 每个 ticket 大小刚好塞进一个全新的上下文窗口 |
| `/implement` | 读一个 ticket，打通它，内部驱动 `/tdd`，结尾跑 `/code-review`，然后 commit | **绝不重新讨论计划**。计划在上游已经定死了 |
| `/code-review` | 双轴审查：**Standards**（符合本仓库规范吗）+ **Spec**（符合最初需求吗），两个方向由并行子代理跑 | 两个轴故意分开，避免互相污染 |

### 两个关键分支

**分支 1：某个问题必须"跑起来"才能回答？**（状态模型、业务逻辑、要看见的 UI）

那就绕道 prototype，**两头都用 `/handoff` 搭桥**（因为 prototype 住在自己的目录里）：

```
/handoff 出去 → 新会话 /prototype → /handoff 回来 → 把结论引用回原来的思路线程
```

**分支 2：这次构建跨多个会话吗？**

- **跨会话**（大）→ 走 `/to-spec` → `/to-tickets` → 每个 ticket 单独 `/implement`
- **单会话**（小）→ **直接 `/implement`**，跳过 spec

> 官方原话：单会话的改动走 spec「buys you nothing」，还多一次模型可能跑偏的综合步骤。**别为了流程完整而走流程。**

### 上下文卫生（最容易踩的坑）

- **第 1–3 步必须在同一个连续上下文窗口里**（`/grill-with-docs` → `/to-spec` → `/to-tickets` 之间**不要** `/clear` 或 `/compact`）。官方的具体警告：`/to-spec` 和 `/to-tickets` 之间一旦清理，`/to-tickets` 可能读不到 spec，会**反复截断**。
- **每个 `/implement` 则要开新窗口**，ticket 之间 `/clear`。因为每个 ticket 自包含，上一个的上下文是可丢弃的。
- 上限叫 **smart zone**（约 150k token），超出后推理质量下降。快到上限时**在最近的阶段边界** `/compact`，不要硬撑。

---

## 三、四条支线

主线之外，有四类使用场景。

### 1. 切入点（On-ramps）：先产出工作，再汇入主线

| 处境 | 用 | 之后汇入 |
|---|---|---|
| bug 报告、外部需求堆积 | **`/triage`** | 产出 agent-ready 的 issue，`/implement` 接 |
| 有东西坏了（难查的 bug / 偶发 / 回归） | **`/diagnosing-bugs`** | 若根因是"没有好 seam"，转 `/improve-codebase-architecture` |
| 巨大而模糊的工程（绿地项目、超大功能） | **`/wayfinder`** | 地图清晰后**转 `/to-spec`**，不是直接 implement |

> ⚠️ **`/triage` 只用于不是你创建的 issue**。`/to-tickets` 产出的 ticket 已经是 agent-ready，**不要去 triage 它们**。

> ⚠️ **`/wayfinder` 输出的是「决策」不是「交付物」**。它完成后要经 `/to-spec` 把决策**收敛**成可施工计划；直接跳 `/implement` 会丢掉那些关联细节。只有发现工程量其实很小才可以直接 implement。

### 2. 塑造（Shaping）：探索开放问题，产出决策喂给主线

| skill | 干什么 | 产出 |
|---|---|---|
| **`/wayfinder`** | 把跨多会话的大工程画成「决策 ticket 地图」，逐个解决 | 决策 |
| **`/prototype`** | 用**用完即弃的代码**回答一个设计问题 | 答案（折进真代码） |
| **`/research`** | 派**后台代理**去读一手来源 | 带引用的 Markdown |

### 3. 养护（Upkeep）：保持代码库和 issue 列表健康

| skill | 干什么 |
|---|---|
| **`/improve-codebase-architecture`** | 扫描代码库，找 **deepening 机会**，出可视化 HTML 报告 |
| **`/diagnosing-bugs`** | 从"能红的复现"开始，纪律化诊断 |
| **`/resolving-merge-conflicts`** | 逐个 hunk 解决 merge/rebase 冲突，按**意图**而非挑行，**永不 `--abort`** |
| **`/triage`** | 把原始 issue 分拣成可接手的工作 |
| **`/wizard`** | 生成引导**人类**完成只有人能做的步骤的脚本 |

> `/improve-codebase-architecture` 是关键枢纽：你从报告里挑一个 deepening 机会，**这就变成了一个新想法**，可以拿去 `/grill-with-docs` 开新一轮主线。Matt 建议每隔几天跑一次。

### 4. 生产力（与代码无关）

| skill | 干什么 |
|---|---|
| **`/grill-me`** | 和 `/grill-with-docs` 同样的追问，但**无状态**、不留文件。**没有工作目录时用它** |
| **`/handoff`** | 把长会话写成文件，交给另一个代理/目录/同事继续 |
| **`/to-questionnaire`** | 卡点不在你脑子里而在**别人**脑子里时，生成一份问卷 |
| **`/teach`** | 跨多次会话学一个概念，用当前目录当教学空间 |

---

## 四、两张底层词汇表（Reference Skills）

这两个是**跑在所有 skill 下面**的单一事实来源。当问题出在**用词**而不是流程时，直接用它们：

| skill | 管什么 | 谁在用 |
|---|---|---|
| **`/domain-modeling`** | 项目**领域**语言：挑战模糊术语、消解一词多义、把难回退的决定记成 ADR | `/grill-with-docs` 驱动它维护 `CONTEXT.md` |
| **`/codebase-design`** | **deep module** 词汇表：module、interface、depth、seam、adapter、leverage、locality | `/tdd` 和 `/improve-codebase-architecture` 都说它 |

> 这就是为什么中文化时**这些术语保留英文** —— `/codebase-design` 明文要求「use these terms exactly」并禁止替换成 component/service/API/boundary。

---

## 五、阶段边界：五个选择

一个会话内部，两个阶段之间（追问完、实现完、QA）你有五个选择。Matt 说这是**整张地图里最模糊的决策**：

| 选择 | 什么时候用 |
|---|---|
| **继续** | 什么都不损失 —— **应该最先被排除的选项** |
| **`/clear`** | 这里的东西对接下来毫无价值 |
| **`/handoff`** | 换新 harness、新目录、给同事、或中途分叉侧任务。**买的只有「可移植」** |
| **子代理** | 把一个边界清晰的任务送到独立窗口，拿报告回来 |
| **`/compact`** | 压缩当前上下文喂给新会话 —— **默认选项** |

---

## 六、什么时候用哪个：决策表

| 你现在的处境 | 打这个 |
|---|---|
| 刚建好仓库，第一次用 | `/setup-matt-pocock-skills` |
| 不知道现在该用哪个 | `/ask-matt` |
| 有个想法，想要人问我问题 | `/grill-with-docs`（有代码库）／`/grill-me`（没有） |
| 已经聊定了，工程跨多个会话 | `/to-spec` → `/to-tickets` → 每个 ticket `/implement` |
| 已经聊定了，工程很小 | 直接 `/implement` |
| 只有对话、没写下来，且很小 | 直接 `/implement`（**告诉它"计划就在刚才的对话里"**） |
| 有一个具体行为想测试先行 | 直接 `/tdd` |
| 已经写完了，想检查 | 直接 `/code-review` |
| 有个设计问题纸上说不清 | `/prototype` |
| 需要一个有引用来源的答案 | `/research` |
| 有难查的 bug | `/diagnosing-bugs` |
| 代码库该收拾了 | `/improve-codebase-architecture` |
| 工程大到看不见路 | `/wayfinder` |
| 卡在别人身上 | `/to-questionnaire` |
| 需要人类去点某个后台面板 | `/wizard` |
| 消息没看懂 | `/wait-what` |
| 上下文快满了 | 看第五节，在阶段边界 `/compact` |
| 要换机器/换人继续 | `/handoff` |

---

## 七、本工作区（DSH）实操

前置已完成：`/setup-matt-pocock-skills` 已跑过，tracker 配成 **Local markdown**，文档落在 `.scratch/<feature-slug>/`。

**完整的第一次体验（建议按这个走一遍）：**

```
1. /grill-with-docs     我追问你，你回答（中文）
2. /to-spec             产出 .scratch/<feature>/spec.md（中文）+ spec.en.md（英文）
3. /to-tickets          拆出 .scratch/<feature>/issues/01-*.md ...
4. /implement           一个 ticket 一次；中间 /clear
5. /code-review         双轴审查
```

**你会实际看到的文件：**

```
.scratch/<feature-slug>/
├── spec.md          ← 中文主件，给你读
├── spec.en.md       ← 英文对照，保证文档质量
└── issues/
    ├── 01-first-ticket.md       ← Status: ready-for-agent
    ├── 01-first-ticket.en.md
    ├── 02-second-ticket.md      ← Blocked by: 01
    └── ...
```

**本地 tracker 怎么"取下一个活"**：先做 blockers 都完成的那个 —— 这就是 **frontier**。ticket 头部有 `Blocked by:` 行。

---

## 八、七个已知坑（官方文档自己承认的）

1. **`/implement` 不关 ticket、不勾选验收标准。** 它在 commit 处结束，从不碰工作项 —— 这是**设计如此，不是 bug**。你得自己关。**这在下游有连锁效应**：`/to-tickets` 定义 frontier 为"blockers 都已完成"的 ticket，如果没人关，就永远看不出谁解锁了。
2. **`/code-review` 看不到你的改动？** 它审查的是 `git diff <基点>...HEAD`，**不含已 staged 和工作区改动**。`/implement` 在 commit 前跑它，所以除非已有中间 commit，否则那个 diff 是空的。**先 commit 再 review。**
3. **别并行跑多个 `/implement`。** 官方原话是"比不支持更糟"：有人一个下午就遇到 `git commit --amend` 落到另一个会话的 commit 上、stash 从 `refs/stash` 消失、commit 落到错分支。它们共用同一个工作目录、index 和 HEAD。worktree 是社区变通，但 `refs/stash` 也是跨 worktree 共享的。
4. **spec 被打了 `ready-for-agent` 标签**，本意是"无需进一步分拣"，但**轮询该标签的 AFK agent 会试图把整份 spec 一次建完**，而不是捡 ticket 切片。这是被反馈最多的粗糙边。回避：在 AFK agent 的提示里显式排除父 spec，或 `/to-tickets` 跑完后把标签摘掉。
5. **`/implement #2` 在新会话里可能做错事。** `#2` 是拿"代理能看到的那个编号列表"去解析的，新会话里可能是别的待办清单。**传完整引用**（issue URL 或 `owner/repo#2`），并让它先复述标题再动手。
6. **`/to-spec` 不会检查重复工单、也不会链接它遵守的 ADR。** 它读取并尊重相关 ADR，但不建链接、不搜 tracker 查重叠。**热闹的区域自己先搜一遍。**
7. **单个 ticket 烧 150k token 是正常的**，通常说明 ticket 太大，而不是 skill 用错了。解法在上游：在 `/to-tickets` 时切小。

---

## 九、"它在正常工作"的标志

| skill | 标志 |
|---|---|
| `/grill-with-docs` | 它在**问你**问题，而不是急着写代码 |
| `/to-spec` | 它**开始写**而不是再问你一轮；写之前先把 seams 提给你确认；用你项目的名词而非通用 PM 套话 |
| `/implement` | 会话开头是**读 ticket 并复述要建什么**，而不是问你要建什么；trace 里能看到真的 `/tdd` 调用；最后自己走到 commit；diff 只是**一个 ticket 的量** |
| `/code-review` | 两个轴分开汇报，没有合并排名 |

> `/to-spec` 的 spec「大部分是给代理看的」—— 官方建议你**真正该看的是 seams 和 out-of-scope 两节**，因为那是错误决定「最便宜被发现、也最贵被漏掉」的地方。如果 spec 让你意外，问题在追问太浅，不在 spec 太长。

---

## 十、速查：一页总结

```
第一次用 →  /setup-matt-pocock-skills
不确定   →  /ask-matt

主线（先对齐再动手）：
  /grill-with-docs → /to-spec → /to-tickets → /implement → /code-review
        有代码库        跨会话才需要     一个ticket一次    自动跑tdd和review

小改动：/grill-with-docs → /implement        （跳过 spec）
纸上说不清：/prototype
外界事实：/research
难 bug：/diagnosing-bugs
收拾代码：/improve-codebase-architecture
大而模糊：/wayfinder → /to-spec
原始 issue：/triage
没有代码库：/grill-me
看不懂了：/wait-what
换人/换机：/handoff

铁律：1–3 步同一窗口；每个 implement 新窗口；先 commit 再 review；不要并行 implement
```
