# 12: 真实 provider —— 云端 LLM + 本地 embedding + 可切换

**What to build:** 关掉假 provider，换上真实实现：云端 LLM 负责 `extract` / `judgeLink` / `compose` /
`respond`（OpenAI 兼容端点、JSON 输出），embedding 在本机 CPU 上用预训练的多语言小模型离线运行，
无需 key。两者都能按配置在「云端 OpenAI 兼容端点／本地 Ollama」与「本地／云端 embedding」之间切换，
领域逻辑完全不感知差异。

**Blocked by:** 03（回应方式 —— 情绪优先与机械规则校验）、04（词条与链接 —— 把碎片连起来）

**Status:** ready-for-human

- [x] 真实 provider 实现全部五个操作：`extract` / `embed` / `judgeLink` / `compose` / `respond`
      （**端口今天是八个方法**，票面这句停在 04 时期；八个全部落地，见 Comments 1）。
- [x] LLM 走 OpenAI 兼容端点并返回结构化 JSON；解析失败时有明确、可诊断的错误处理。
- [x] embedding 经 transformers.js 在 Node 内本地 CPU 运行，完全离线、不需要 key；模型文件不进 git。
- [x] API key 只存在服务端的环境变量文件里，不进 git、不进入浏览器；仓库里不含任何 key 的明文。
- [x] provider 通过配置选择四种组合（云端／本地 LLM × 本地／云端 embedding），领域逻辑零改动。
- [x] 领域测试仍然全部由假 provider 驱动 —— 引入真实实现后测试套件依然确定、依然通过。
- [x] 真实实现只做手工冒烟（能连通、返回结构符合预期），不对其语义质量做自动化断言。
- [x] **前提（不属于本 ticket 的验收）**：人类已先申请并填入云端 LLM 的 API key —— 2026-09-17 完成，
      过程见 Comments 第 4 条（第一把 key 是别家的，换过一把）。

## Comments

**2026-09-17 · 落地成的样子**

**1. 八个操作，不是五个。** 票面这句是 04 时期写的，端口此后长到了八个：`respond` / `extract` / `embed` /
`judgeLink` / `composeConclusion` / `composeAnswer` / `parseQuestion` / `composeRecallAnswer`。八个全部
落地，一个不缺 —— 「假 provider 能做的，真 provider 都能做」是这一票的验收面。其中
`composeAnswer`（**答案**，答的是判断）与 `composeRecallAnswer`（**追溯**，答的是事实）是 11 按
`CONTEXT.md` 摆正过的那一对，这一票没有把它们混起来。

**2. 代码落点。** 新增 `src/ai/`（port 的**实现侧**，见下第 3 条）与 `src/web/provider.ts`：

- `src/ai/config.ts`：环境变量 → 配置（四种组合、默认值、超时）。**不认识的值直接拒绝并指名变量**
  —— 一个把 `local` 拼成 `clod` 然后悄悄走云端的配置，等于在用户以为没出机器的时候把碎片发出去了。
- `src/ai/env-file.ts`：读 `.env`（注释、引号、`export` 前缀、`#` 后注释；**环境变量优先于文件**）。
- `src/ai/openai-chat.ts`：OpenAI 兼容的一次调用（`/chat/completions` + `response_format: json_object`
  + 超时 + 无 key 时不发 `Authorization` 头）。
- `src/ai/structured.ts` / `errors.ts`：把模型说的话里的那个 JSON 对象找出来，然后**逐字段**核对；
  每一处失败都是 `ProviderCallError`，指名哪一次调用、哪个字段、拿到的是什么。
- `src/ai/llm-provider.ts`：七个语言模型操作与它们的提示词。
- `src/ai/local-embedding.ts` / `cloud-embedding.ts` / `vectors.ts`：两半 embedding 与共同的向量核对。
- `src/ai/real-provider.ts`：把两半拼起来成 port；**哪一半没配好，那一半的每个调用都以原因失败**，
  另一半照常工作（服务端启动日志逐行说明，且**从不打印 key**）。
- `src/web/provider.ts`：组合根的唯一次定（真实 / demo）。
- `src/web/server.ts`：起步时读 `.env` → 解析配置 → 建 provider → 打印配置行；配置坏了**拒绝启动**
  （exit 1）而不是带着错配置跑。

**3. 「关掉假 provider」落地成「默认真实 + 显式要才用假的」。** 默认组合就是真实 provider；01–11 的
`demo-provider.ts` **保留**，但只有 `YTwins_PROVIDER=demo` 才会用到它。这是 2026-09-17 开工前问过作者
后定的（选项原文：「默认走真实 provider，但保留 demo 作为显式配置项」）：三幕 demo 需要可重复、可离线
地演示，而这个 ticket 的字面是「关掉假 provider」—— 落地成「默认不再使用」同时满足两者。代价是配置面
从四种组合变成「四种 + demo」五种；**领域逻辑一行未动**，所以这条不影响票面第 5 条。
`NEXT.md` 原本写「demo 预置素材随真实 provider 一起退场」，这一票没有退场，理由同上。

**4. key 的边界，与那个只有人能做的前置（含一次真实的排查）。** key 放在**仓库根目录的 `.env`**，
`.gitignore` 早已忽略它；服务端读它，页面永远拿不到（实测：跑完一整条真实链路后，
`/api/drops` 等响应里不含 `sk-`；仓库里也没有任何明文 key —— 提交物里的 `sk-` 全是
`sk-secret` 这类**哨兵值**，只出现在测试里）。开工时作者手上那把 key 其实**不是 DeepSeek 的**：
直连 `api.deepseek.com` 返回 **401**，而它指向的 `opencode.ai/zen/go/v1` 要求每个请求带
`x-opencode-session`，否则 400 `MissingSessionID`（那是本机 coding agent 的订阅端点，其文档写明面向
编码 agent 流量）。作者随后换成 DeepSeek 的 key 并只留 `YTwins_LLM_API_KEY` 一行，于是默认端点与默认
模型名（`https://api.deepseek.com` + `deepseek-flash`）就是 spec 冻结的那一套。**这段插曲是这一票最
值得留下的一条**：没有真实冒烟，它会以一个 400/401 的形式出现在用户面前，而不是出现在开工时。

**5. 提示词的三条规矩。** ①**规则随请求走**：`parent-voice.ts` / `conclusions.ts` / `surfacing.ts` 的
指令数组原样进 system，`src/ai/` 里**不留第二份**；②**重试要被告知上次违反了哪几条**（`violations`），
否则「再试一次」只是换个方式猜；③**`composeAnswer` 不带人设** —— 见下面 `/code-review` 一节，
这一条是审出来的，而且是 11 的保证被推翻过的那种错。

**6. 本地 embedding。** `Xenova/multilingual-e5-small`（384 维）、**q8** 量化（约 120MB；fp32 要 470MB，
CPU 上还更慢）、**懒加载**（首次使用时才 import transformers.js 并建模型）、**一次加载全进程共享**、
失败后**清掉 memo**（首跑网络不通是最常见的失败，不该需要重启服务）、模型缓存在 `data/models`
（`data/` 已被 gitignore，所以「模型文件不进 git」是结构保证）、可用 `YTwins_EMBEDDING_HOST` 换镜像。
e5 家族按作者建议统一加 `query: ` 前缀（对称比较两端都是用户自己的词）。**「完全离线」的准确说法**：
首次使用需要联网把模型取到缓存目录，**之后不再碰网络** —— 实测方式是把 host 指到一个不可达地址
（`YTwins_EMBEDDING_HOST=http://127.0.0.1:1`），embedding 照常跑出 384 维向量。

**7. 四种组合是怎么验的（诚实版）。** 四种组合的**配置解析**都有自动检查（含「默认是云端 LLM + 本地
embedding」「不认识的组合被拒」）。**真实端点只跑过一种**：云端 LLM（DeepSeek）+ 本地 embedding ——
本机没有 Ollama，也没有第二把云端 embedding 的 key，所以另外两种组合只有配置层的证据，**没有连通过**。
这一点写在这里而不是含糊过去。

**8. 冒烟与真实链路（这一票要求的「手工冒烟」）。** `tools/smoke-provider.mjs`（`npm run smoke`）
把八个操作按结构逐个核过、并把内容打印给人看：

- **9/9 步通过**（真实 DeepSeek 端点 + 本地 embedding）：`respond` 情绪优先、`extract` 把「下周三」
  正确算成 `2026-09-23T09:00:00.000Z` 且词条保持原话、`judgeLink` 给布尔、`parseQuestion` 给出可查的
  字符串、`composeConclusion` / `composeAnswer` / `composeRecallAnswer` 各出一句中文。
- **起真实服务器手工过了一整条**：投递 → 抽取（1 件事项、5 个词条）→ 追溯（`kind: answered`，带 1 条
  出处）→ 浮现（`nothing-to-say`，只有一次投递，阈值未到，正确）→ 链接（13 条 `same-drop` 硬边）→
  **响应里不含 key**。

**9. 留给下一票的一件事：阈值与真实 embedding 对不上（实测数据）。** e5-small 的余弦分布**很挤**：
相关对 0.88–0.91、不相关对 0.84–0.88（量过三组：`query:` 前缀下
「期末怎么算分 × 平时分 40%」= 0.895、「想学吉他 × 琴行的帖子」= 0.882、
「好烦 × 想学吉他」= 0.835）。`linking.ts` 的默认三段式是「≥ 0.85 直连、≤ 0.7 不连、中间问
`judgeLink`」，于是几乎每对都落在直连或灰区，**实测抓到一条假链接**：
`琴行的帖子 × 下周三交提纲 = 0.852 → 直连`（语义相近（相似度 0.85））。这不是 12 的 bug（域侧阈值是
spec 明确列为**「尚未定值的参数」**、由可配置常量承载、之后再按真实数据校准的值），但它是 13 之前
**必须先落地**的一件事：要么把灰区放宽（让 `judgeLink` 决定，这正是三段式的设计意图，代价是每个灰对
多一次调用），要么换一个分布更开的 embedding。两种模型的实测数（e5-small 与 `bge-small-zh-v1.5`，
后者分布是 0.37–0.63，用今天的阈值会一条都不连）都在 `NEXT.md` 里。

**10. 验证。**

- 领域测试 **152/152**（**一行未改**，仍全部由假 provider 驱动）；新增 `src/ai/provider.test.ts`
  **56/56**（`npm run test:ai`；`fetch` 与模型加载器都是注入的，全程不联网、不下载）。
- 02 的 7/7、03 的 6/6、04 的 5/5、05 的 5/5、06 的 6/6、08 的 11/11、09 的 15/15、10 的 11/11、
  11 的 6/6 仍全绿；`check-workspace` 的 21 条测试与检查器本身 clean。
- `tsc --noEmit` 全绿；`vite build` 成功；真实端点冒烟 9/9（见第 8 条）。
- **仓库里没有明文 key**；`.env` 与 `data/models` 都在 `.gitignore` 里。

**`/code-review` 两轴结论与按结论做的处理**

Standards 轴：**没有硬违规**；两条「标准与执行器不同步」属实并已补，其余判断项逐条处理。

- **改了 · `src/ai/` 是第三个顶层目录，而 spec 写着「两个顶层目录」** —— 属实，已按本仓库惯例给
  `spec.md` / `spec.en.md` 补上**带日期的更正**（不是删掉原句）：port 的实现既不是领域逻辑也不是界面层，
  而且**不该跟着界面层一起被换掉**（换手机端时 `src/web/` 退场、`src/ai/` 留下）。
- **改了 · 「真实现只做手工冒烟」与新增的 56 条自动检查** —— 属实，同样在 spec 的**测试决策**处补了更正，
  把界线写明：不测的是**模型的判断**，不是**代码的接线**；四种组合、字段核对、错误可诊断、key 不出边界
  这些是结构，自动测；句子好不好、判得准不准，一句都不自动测。
- **改了 · `DEFAULT_TIMEOUT_MS` 三份、Abort/Timeout 判断两份** —— 属实，超时常量归 `config.ts` 一处，
  `isTimeoutError` 归 `errors.ts`，两处 HTTP 调用共用。
- **改了 · `Embedder` 长在 `local-embedding.ts` 里却被 `cloud-embedding.ts` 引** —— 属实，移到中立的
  `vectors.ts`。
- **改了 · 参数名 `what`** —— 属实，改成 `operation`（它装的就是操作名，错误文案里用的也是这个）。
- **改了 · `real-provider.ts` 里那个取不到的默认值 `baseUrl ?? ''`，以及四处 `kind === 'cloud'` 分支**
  —— 属实，两半各收进 `buildLlm` / `buildEmbedder`，**在那里面**判空（于是 `baseUrl` 真的被收窄了，
  不再有取不到的默认值），并各返回「建好的东西 + 建不出来的原因」。
- **改了 · `unavailable()` 声称类型检查会拦住漏写的端口方法，其实拦不住** —— 属实（`readonly (keyof T)[]`
  不保证穷尽）。现在两张操作表是 `satisfies Record<keyof …，true>`，**端口加第九个方法就会编译不过**；
  同时把「没配好的一半仍然实现整个 port」用八个操作逐一断言（原来只断言了四个）。
- **改了 · 三处 `...(x === undefined ? {} : { x })`** —— 属实，可选参数类型改成 `T | undefined`，
  调用处直接传。
- **保留 · 测试脚手架 `check()` 在 `domain.test.ts` / `provider.test.ts` / `smoke-provider.mjs` 各一份**
  —— 那是本仓库**写下来的**测试形态（单进程、自带断言、退出码表达结果、不引入框架），三处各十来行且互不
  依赖；抽成共享模块会让「单文件入口」这条约定变成「入口 + 库」，得不偿失。
- **保留 · 两处入口各自写「读 .env → 解析配置 → 报错退出」** —— 服务端 exit 1、冒烟 exit 2 且要打印用法，
  失败姿态本来不同；共用的只有两行。

Spec 轴：**三条属实**，两条已改、一条补强；其余是「已知并写明理由」。

- **改了 · `composeAnswer` 里塞了通用人设**（`PRODUCT_CONTEXT` 出现在所有七个操作的 system 里）
  —— 属实，而且是**推翻 11 保证**的那种错：NEXT.md 明写「`composeAnswer` 的输入只有用户自己的结论与
  词条，服务端不要再往里塞通用人设」。已把 `PRODUCT_CONTEXT` 从 `composeAnswer` 去掉（任务、档位、域侧
  规则、输出格式留着），并把原来那条**只看 user 消息**的检查补强成**逐行审视 system**：除「任务 / 档位 /
  请求自带的规则 / 输出契约」之外的任何一行都算通用素材。**实测把 bug 放回去它就红**（55/56，
  失败信息正是这一条）。
- **改了 · `unavailable()` 的安全声明不成立** —— 见 Standards 轴同一条，已用 `satisfies` 真正钉住。
- **补强 · 票面「前提」没有证据** —— 属实，已把 key 的实际取得过程与那次 401/400 排查写进第 4 条，
  并把冒烟结果写进第 8 条。
- **保留并写明理由 · `YTwins_PROVIDER=demo` 是第五种选择**（spec 只列四种）—— 见第 3 条，作者拍的板。
- **保留并写明理由 · 「完全离线」严格说只在首跑之后成立** —— 见第 6 条，已把它写准，并给了实测。

**一个给自己人的坑（12 期间又踩了一次）**：用 PowerShell 做「读进来—`-replace`—写回去」把
`src/ai/config.ts` 里的中文错误文案写成了乱码（`环境变量` → `鐜鍙橀噺`）。这正是 `NEXT.md` 里已经写过
的那条，**这次是第二次**。恢复办法不是改回去，而是**用 `write` 工具整份重写**；分辨办法是用
`read` 工具（它是按 UTF-8 正确解码的）而不是 PowerShell 的 `Get-Content` 去看中文。**结论**：批量文本
替换一律用 `edit` 工具，`-replace` 只允许出现在纯 ASCII 的文件上。
