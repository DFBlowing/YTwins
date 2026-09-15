# 07: 追溯 —— 问一件旧事，答得准并指出出处

**What to build:** 对**留档**提问（例如「期末怎么算分」），得到准确的回答，并看到这条答案来自哪一次
**投递**，可以核对到保真原文。召回不足时它**直说没找到**，而不是编一个听起来合理的答案。
为了让这一步早就能独立验证，用户可以手工指定「现在是几天后」的时间基准，不必真的等。

**Blocked by:** 01（工程骨架与第一次「丢」打通全链路）

**Status:** needs-triage

**已认领并暂停**（2026-09-15）：07 的工作已完成 RED 阶段与 provider port 的改写，但按要求**让 ticket 02 先做完**，
因此改动已撤出工作区、备份在 `archive/ticket-07-wip/`（不进 git）。恢复方法见文件末尾的 `## Comments`。

- [ ] 提问命中**留档**时给出准确回答，并指出它源自哪一次**投递**。
- [ ] 召回不足时返回明确的「没找到」，不生成听起来合理的答案。
- [ ] 答案可追溯到保真原文（与用户当时输入逐字相同的那份内容）。
- [ ] 问题的解析与答案的生成都经由 **AI provider port**，测试使用假 provider 因此结果确定。
- [ ] 用户可手工指定时间基准（用于 demo 里「几天后」的视角），该基准影响答案措辞与时间引用，但不改变召回结果。

## Comments

### 2026-09-15 —— 为什么暂停、怎么恢复

**暂停原因**：07 与 02 改的是同一批文件（`interface.ts` 是两者都要动的那一个）。02 的工作当时**还没提交**、
且正处于一次「`dropped.id` → `dropped.dropId`」的重命名中途（`tsc` 有 11 个 `TS2339`）。两边同时改同一批
未提交的文件，git 无法按 ticket 分开，继续做 07 只会把两个 ticket 的状态搅在一起。

**已撤销**：07 的四处改动已从工作区移出，备份在 `archive/ticket-07-wip/`（`/archive/*` 不进 git）：

| 备份文件 | 对应工作区文件 |
|---|---|
| `ai-provider.mine.ts` | `src/domain/ai-provider.ts` |
| `interface.mine.ts` | `src/domain/interface.ts` |
| `fake-provider.mine.ts` | `src/domain/fake-provider.ts` |
| `domain.test.mine.ts` | `src/domain/domain.test.ts` |
| `core.mine.ts` | `src/domain/core.ts`（未开始改，仅供对照） |

撤销是**纯删除**（逐文件核过：`domain.test.ts` 删 284 行、增 0 行；`fake-provider.ts` 删 69 行、增 0 行；
`ai-provider.ts` 仅因去掉 recall 段而重排一行文档注释）。**02 的状态未被改动**。

**恢复方法**：等 02 提交之后，把上表前四个文件拷回工作区，然后接着做「还没做完的部分」：

1. `fake-provider.ts` 的 recall 脚本（`ByQuestion` / `composeFallback` / `onCompose` / `askedQuestions`）
   —— 注意到一半。**注意**：`isFailure` 现在只认 `reply` / `read` 两种非失败脚本，
   加入 `cues` / `answer` 后要一并放宽（或像备份里那样另加一个 `isFailureAny`）。
2. `core.ts` 里实现 `recall`（挑选用纯代码，两端走 port）。
3. `src/web/server.ts` 加 `/api/recall`。
4. `index.html` + `main.ts` + `style.css` 填实第二幕（问）。
5. 全量 typecheck / 测试 / `check-workspace`，再 `/code-review`、提交。

**已核过的事实**（省得重查）：备份里 `domain.test.ts` 是 550 → 834 行，13 个 recall check 全红，
报 `domain.recall is not a function` —— 即 RED 阶段是干净成立的。设计已与用户确认：**AI 只做两端**
（`parseQuestion` + `composeAnswer`），**挑选由领域核心用纯代码做**；**时间基准收进领域核心的一个
可选 `now`**；**第二幕页面这次一并填实**。
