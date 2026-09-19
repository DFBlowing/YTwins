# 16: 一个 key 换一家模型 —— 给 Gemini / opencode / DeepSeek 各留一个预设

**What to build:** 把「换后端模型」压成两行：**选一个 preset + 填一个 key**。每个 preset 自带该家 OpenAI 兼容
端点、默认模型 id、鉴权方式（`Authorization: Bearer` / `x-goog-api-key` / 自定义头）以及必需的静态请求头 ——
于是换模型是换值，不是改调用路径。显式变量（`BASE_URL` / `MODEL` / `HEADERS`）继续存在并**优先于** preset，
当逃生口用。没选 preset 时行为与今天完全一致。

**Blocked by:** 12（真实 provider 可跑）

**Status:** ready-for-human

## 预设表（实施时逐条复核，票面记事实与出处）

| preset | base URL | 默认模型 | 鉴权 | 出处 |
|---|---|---|---|---|
| `deepseek` | `https://api.deepseek.com` | `deepseek-flash` | `Authorization: Bearer` | 本机实测 `GET /models` 返回 200，列出 `deepseek-flash` / `deepseek-v4-pro` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.8-flash`（开票时官方示例是 `gemini-3.6-flash`，复核时已换成 3.8，见 Comments） | `Authorization: Bearer` | 官方 OpenAI 兼容文档 |
| `opencode` | `https://opencode.ai/zen/v1` | `deepseek-v4-flash`（只取 `chat/completions` 那一档） | `Authorization: Bearer`，某些档位另需 `x-opencode-session` | Zen 端点表；该头见第三方代理与 free/Go 档报告 |
| `ollama` | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` | 无 key | 已有本地一档 |
| `custom` | 必须给 `YTwins_LLM_BASE_URL` | 必须给 `YTwins_LLM_MODEL` | Bearer + 可配额外头 | 逃生口 |

- [x] **一个 key 换一家。** `YTwins_LLM_PRESET=<名字>` + `YTwins_LLM_API_KEY=<key>` 就是全部：
      `resolveProviderConfig` 从预置表取出端点、模型与「key 放哪个头」，页面、领域与调用路径一行都不用改。
      缺 key 时报错点名预置与模型：`没有配置 YTwins_LLM_API_KEY，预设 gemini（云端）上的 gemini-3.8-flash
      用不了：…`（不选预设时那句文案与从前逐字相同，只是「无 key」改成了「缺 key」）。
- [x] **厂家的差异只落在预设里。** 三家的差异落成 `LlmPreset`（`kind` / `baseUrl` / `model` / `auth` / `headers`）
      五行；`src/ai/openai-chat.ts` 现在**完全不认识 key**（`ChatClientOptions.apiKey` 删除，改收一组请求头），
      `Authorization: Bearer` 的拼法搬进 `PresetAuth`，客户端不为任何一家写分支。
- [x] **额外请求头仍是预设的一个字段**（`LlmPreset.headers`，今天五行都是空表 —— 会话头是凭证，属于 `.env`
      不属于 git + 表），`YTwins_LLM_HEADERS` 形如 `name=value;name=value`；值绝不进日志（连被拒绝的那一段
      也不回显），头名非法响亮拒绝。
- [x] **未知 preset 响亮拒绝**：`环境变量 YTwins_LLM_PRESET 的值「claude」不认识；可用值是 deepseek /
      gemini / opencode / ollama / custom。`（大小写与首尾空格不算差异）
- [x] **显式覆盖优先于预设，且启动日志说出来**：覆盖清单落在 `LlmConfig.overrides`
      （只可能是 `YTwins_LLM_BASE_URL` / `YTwins_LLM_MODEL`），日志形如
      `预设 deepseek（云端）：https://api.deepseek.com · deepseek-v4-pro（key 已配置；显式覆盖：YTwins_LLM_MODEL）`。
- [x] **`notes` 只说三件事**：哪家 · 端点与模型 · key 已配置／缺 key（本机档是「无需 key」），另加
      「另带 N 个额外请求头」这一个**计数**（原票面那条要求），**没有任何 key，也没有任何一个头的值**。
- [x] **embedding 那一半不在「只填 key」的承诺里。** 本地模型仍是默认，云端 embedding 仍走既有的显式
      base URL + key；`.env.example` 单列一节写清，**启动日志每次也带这句**
      （「换它等于换一套标定（要重跑 ticket 14 那套实测）」）。
- [x] **测**：provider 检查 58 → **72** —— 每个预设解析出正确的 base / model / 鉴权头、缺 key 的文案、
      未知 preset、显式覆盖优先、头名与取值的三条规则、`notes` 不含凭证，以及**三个云端预设各走一遍
      注入 `fetch` 的真实请求形状**（URL / model / `Authorization` / 额外头），与 12 既有写法同一套。
- [x] **文档**：`.env.example` 只留必填两行（preset + key）+ 预设表 + key 怎么送；`config.ts` 的模块注释与
      预置表出处更新；`docs/ytwins/demo-script.md`（及 `.en.md`）§7 补一节讲预设。
- [x] **手工过一遍**：DeepSeek 用真 key 跑了 `node tools/smoke-provider.mjs llm`（**7/7**），并起真实服务器
      读了启动日志与 `/api/privacy`；Gemini / opencode 没有 key，用注入的 `fetch` 断言请求形状 ——
      **「未用真 key 验过」明记在 Comments 里**。
- [x] **顺手修这台机器 `.env` 的坏配置**：改成 `YTwins_LLM_PRESET=deepseek` + 那一行 key，旧的 Google 端点
      与模型两行删掉（`.env` 不进 git，改动只落在这台机器上）。

## Comments

**2026-09-18 — 开票，同日按作者的意思改过一次口径**

**作者的原话（两次，后一次是这一票现在的样子）：**

1. 「未来我可能会将 opencode go 作为产品后端模型的一种可能，请你留个能使用 opencode api 的通道。」
2. 「ticket 16 规范为为 Gemini、opencode、deepseek 等模型预留相应的端口，需要用什么模型时只需要输入 api key 即可。」

所以这一票的范围从「额外请求头」扩成**预设（preset）**：请求头那条**没有丢**，它是预设的一个字段，
但真正要交付的是「选一家 + 填 key 就能跑」。**未选 preset 时，行为与今天逐字节相同。**

**为什么要预设，而不是为每家写一段。** `src/ai/config.ts` 是唯一知道「这台机器跑哪种组合」的地方，
`src/ai/openai-chat.ts` 只该知道「怎么把一个 JSON 请求发到一个 OpenAI 兼容端点」。三家真正的差异只有三样：
**base URL、模型名、key 放在哪个头里**（外加 opencode 那种额外头）。把这三样做成一张表，接第四家就是加一行；
写成分支，接第四家就是改调用路径 —— 而 spec 冻结的正是「换 provider 是换值」。

**实施前查实的三家事实**（票面的事实要有一手出处）：

- **DeepSeek**：`https://api.deepseek.com`，`Authorization: Bearer`，`GET /models` 实测 200，
  列出 `deepseek-flash` 与 `deepseek-v4-pro`。这台机器的 key 正是它认的。
- **Gemini**：Google 有官方 OpenAI 兼容层，base URL 是
  `https://generativelanguage.googleapis.com/v1beta/openai/`，用 `Authorization: Bearer $GEMINI_API_KEY`
  （官方文档的例子就是这么写的）。**现在 `.env` 里写的是 `…/v1beta`，少了 `/openai/` 这一段** ——
  这也是它 400 的原因之一（另一个原因是 key 是 DeepSeek 的）。
- **opencode Zen**：是网关，`https://opencode.ai/zen/v1/chat/completions` 是 OpenAI 兼容那一档
  （DeepSeek / MiniMax / GLM / Kimi 等走这里），但同站还有 `/responses`、`/messages`、`/models/<id>` 三种别的形状 ——
  所以 preset 只承诺 **`chat/completions` 那一档**，别的形状不在本产品说的协议里。
  `x-opencode-session` 出现在 free/Go 档与第三方代理的报道里，因此额外头要留着。

**为什么 embedding 不在「只填 key」里 —— 这是 14 用实测换来的结论。** 阈值是**对着具体 embedding 标定**的：
e5-small 下正例 `[0.861, 0.977]` / 负例 `[0.810, 0.856]`；换成 `bge-small-zh-v1.5` 后正例 `[0.341, 0.913]`、
负例 `[0.252, 0.486]`，两个分布反而**重叠**，`想学吉他 × 琴行的帖子` 从 0.875 掉到 0.456。
而且同一对文本的余弦还会随「一次编码了多少条」漂 ±0.005～0.0125。所以换 embedding **不是换一个值，
是换一套标定**：把它做成「顺手填个 key 就换掉」，等于让用户在不被告知的情况下把链接质量交给一组没标过的阈值。
本票因此只把 LLM 那一半做成预设，并在文档与启动日志里写明这一条。

**这台机器 `.env` 的坏配置（14 顺带查出，本票实施时顺手修）：** key 是能用的 DeepSeek key，
端点却填了 `generativelanguage.googleapis.com`、模型填了 `gemini-flash-lite-latest`，于是每个 LLM 调用都
400「Please pass a valid API key」，而域侧把读失败静默吞掉 —— 表现是「投递了但一个词条都读不出来」。
有了预设之后，这种「端点、模型、key 三者对不上」应该变成一条**响亮的拒绝**，而不是静默的空白。

**待定的实现取舍**（实现时定，倾向 ①）：

1. **key 变量**：① 全预设共用一个 `YTwins_LLM_API_KEY`（最贴近「只填 key」，换家只改 preset 那一行）；
   ② 每家一个（`YTwins_LLM_API_KEY_GEMINI`…，能同时留着几家，但变量表变长）。倾向 ①。
2. **`custom` 预设**：① 必须显式给 base URL 与 model，否则拒绝；② 给一个「OpenAI 官方」的默认值。
   倾向 ①（默认值会让人以为「没配就是 OpenAI」，那是猜的）。
3. **`ollama` 无 key**：① 该预设显式声明「不需要 key」，缺 key 不算错；② 一律要求 key。
   倾向 ①（本地模型本来就没有 key，12 的 `local` 档就是这么用的）。

**明确不做**：不做 OAuth / 登录流程、不做会话自动续期、不做模型自动挑选或回退、不做按请求切模型 ——
这一票只做「选一家 + 填 key 就能跑，且换一家只改一行」。

---

**2026-09-18 — 实现完成（`Status: ready-for-human`）**

**交付的形状。** `src/ai/config.ts` 多了一张五行预置表（`LLM_PRESETS`），每行是 `LlmPreset`：`kind`
（云端／本机）· `baseUrl` · `model` · `auth`（key 放哪个头、前面加什么）· `headers`（该家每次都带的头）。
`resolveProviderConfig` 按「显式变量 → 预置 → 默认」取值，把 key 按 `auth` 拼成请求头放进 `LlmConfig.headers`，
并把「哪些显式变量压在预设之上」记进 `overrides`。**`src/ai/openai-chat.ts` 的 `apiKey` 字段删掉了**：
它现在只认「base URL + model + 一组头」，连 `Authorization: Bearer` 都不认识 —— 厂家知识一个字节都没漏进
调用路径，这正是「接第四家就是加一行」的结构保证。`real-provider.ts` 把 `config.llm.headers` 交给客户端，
缺 key 时照旧让每一次调用都以原因失败。

**票面事实逐条复核（2026-09-18，一手出处）：**

- **DeepSeek**：本机实测 `GET https://api.deepseek.com/models` → **200**，`deepseek-flash` / `deepseek-v4-pro`；
  `Authorization: Bearer`。预置复用这两个默认常量。
- **Gemini**：官方 OpenAI 兼容页给出 base URL `https://generativelanguage.googleapis.com/v1beta/openai/`、
  例子用 `Authorization: Bearer $GEMINI_API_KEY`，而**例子里的模型今天写的是 `gemini-3.8-flash`**
  （页首横幅「Gemini 3.8 Flash is now available」）。**票面开票时写的是 `gemini-3.6-flash`**（当时的示例），
  **预置因此取 `gemini-3.8-flash`，这处与票面的差异记在这里**；两个 id 都还在售，换回 3.6 是改这一行的事。
  末尾那个 `/` 不写：客户端本来就会去掉尾斜杠再拼 `/chat/completions`。
- **opencode Zen**：`https://opencode.ai/docs/zen/` 的端点表里，`chat/completions` 那一档的 DeepSeek 行是
  `deepseek-v4-flash`（站点同一路径下还有 `/responses`、`/messages`、`/models/<id>`，本产品只承诺前者）。
  官方页**没有**提 `x-opencode-session`；该头出现在第三方修复与报告里（openclaw 的 commit、zed 的
  PR #63715、OmniRoute 的 issue #12657、deepseek-harness 的 discussion #5495），所以它留在
  `YTwins_LLM_HEADERS` 里由用户配，**没有**写进表 —— 它是凭证，表在 git 里。
- **ollama / custom**：与前三家同一形状；ollama 跑本机、不要 key；custom 的三样（端点、模型、在哪跑）都由环境给。

**票面三处待定取舍的落点（全部 ①）：** 一个共用的 `YTwins_LLM_API_KEY`；`custom` 必须显式给端点与模型；
`ollama` 声明「不需要 key」（缺 key 不算错，配了 key 也照 Bearer 送 —— 与今天 `YTwins_LLM=local` + key
的行为逐字相同）。

**实现时定的四件事（票面留白或票面之外，逐条给理由）：**

1. **选了 preset 时，`YTwins_LLM` 是「同意」而不是「覆盖」。** 与预设相反（`PRESET=gemini` +
   `YTwins_LLM=local`）**响亮拒绝**：不拒的话启动日志与 `/api/privacy` 会把云端端点说成「本机」，
   等于告诉用户「你的话没离开这台机器」—— 那是这个模块存在的唯一理由（模块注释里本来就写着
   「这一类错是唯一不许出的」）。`custom` 例外：它这一行**是** null，本机端点只能靠 `YTwins_LLM=local`
   说出来，那时它不算覆盖，日志会写「预设 custom（本地）」。（评审 Spec 轴第 4 条。）
2. **`YTwins_LLM_HEADERS` 不许写 key 的那个头 —— 条件是「配了 key」。** 没有 key 时那个头没有第二个来源，
   于是留给用户：本机网关要 `Basic …`，或要一个不是 Bearer 的自有 scheme，这是唯一能表达的地方。
   两臂都有检查。（评审 Spec 轴第 6 条指出原先一律拒绝过严。）
3. **`content-type` / `accept` 也不许配，且这份名单与客户端实际写死的两个头是同一个常量**
   （`PROTOCOL_HEADERS`，`openai-chat.ts` import 它）。原先两处各写一份，客户端将来加第三个协议头会静默失同步
   （评审 Standards 轴第 3 条）。保留「拒绝」这个动作本身：静默丢掉一个用户配的头，正是本票反对的那种漂移
   （评审 Spec 轴第 5 条把它记为越界，这里选择保留并写明理由）。
4. **一段格式错的报错只点名「第 N 段」，不回显那一段。** 那是一句凭证，而报错会进日志 ——
   原先的实现把整段抄进了消息里。（评审 Spec 轴第 7 条抓出来的真漏洞。）

**评审改到的其它地方：** `readPresetName` 与 `readChoice` 合并成一个 `readOneOf`（同一句报错只有一份）；
`readEndpoint` 更名 `readFromPreset` 并收掉 `preset` / `fromPreset` 两个同源参数；`noLlmKey` 与 `llmNote`
共用 `vendorPhrase`；预置表每行原本重复一遍 `name`，删掉（键就是名字）；`ChatClientOptions.headers` 改为必填，
去掉 `?? {}` 那个同义的第三态；文档口径修正（`` `12` `` → `Ticket 12`、「换 provider 是换值」不再说成
spec 的原话 —— spec 冻结的是端口形状，这句话出自本票、`bge-small-zh` → `bge-small-zh-v1.5`）。

**保留并写明理由的两条（评审提了，这里不改）：**

- **`notes` 多印的「另带 N 个额外请求头」保留**：原票面（本票明确保留的那条）要的正是它，而它只是计数、
  不是值 —— 与「只说三件事」并不冲突（Spec 轴第 5 条）。同理 `notes` 里仍有**端点**：覆盖发生时，
  端点才是唯一能看出「跑的不是预设那家」的地方。
- **`LlmConfig` 里 `apiKey` 与 `headers` 并存**：前者是「配没配 key」这个语义事实（`real-provider` 的缺 key
  分支、`privacy.ts` 的披露都读它），后者是同一个 key 在线上要的形状。两者在**同一个对象字面量**里由同一次
  `readOptional` 派生，不存在第二处读取（Standards 轴第 5 条记的「须永远一致」由这一点兜住）。

**embedding 那一行补了「换它等于换一套标定」**（Spec 轴第 1 条）：票面要求启动日志也说清这一点，
原先只写了 `.env.example`。

**这台机器的 `.env` 已按票面修好**：`YTwins_LLM_PRESET=deepseek` + 那一行 key（旧的
`generativelanguage.googleapis.com` + `gemini-flash-lite-latest` 两行删掉）。`.env` 不进 git。

**验收（全部在本机跑过）：** 领域 **167/167**（`src/domain/**` 一行未改）、provider **72/72**（58 → 72，
新增 14 条）、e2e **02–15 全绿**（02 7/7、03 6/6、04 5/5、05 5/5、06 6/6、08 11/11、09 15/15、10 11/11、
11 6/6、13 12/12、15 10/10）、`tsc --noEmit` 干净、`check-workspace` clean、`check-workspace.test.mjs` 21/21。
**真实链路**：`YTwins_LLM_PRESET=deepseek` + 那把 key 跑 `node tools/smoke-provider.mjs llm` → **7/7**；
真实服务器也起了一遍，启动日志与 `/api/privacy` 逐行读过（不选预设时那一行与从前逐字相同）。
**没有用真 key 验过的：Gemini 与 opencode**（这台机器上没有它们的 key）—— 它们由注入 `fetch` 的请求形状断言
兜住（三个云端预设各走一遍 `provider.respond`，断言 URL / model / `Authorization` 头 / 额外头），
**「未用真 key 验过」按要求明记在这里**。

**这一票没改的东西**：embedding 那一半（`cloud-embedding.ts` 仍走自己的 `Bearer` + 显式端点）、
领域与页面（`src/domain/**`、`src/web/**` 一行未改）。

---

**2026-09-18 — 两轴 `/code-review` 的结果（基点 HEAD，对着工作树）**

Standards 与 Spec 各跑一个 sub-agent，两份报告分开读，处理逐条记在上面。这里只留两头：

- **Standards 轴 8 条，全是 smell 判断，没有 documented standard 的硬违规。** 最重的一条是
  **协议头两份真相**（`config.ts` 的拒绝名单与 `openai-chat.ts` 写死的两个头会静默失同步）——
  已收敛成一个 `PROTOCOL_HEADERS`，客户端 import 它。其余：`readChoice` / `readPresetName` 重复、
  `noLlmKey` / `llmNote` 各写一遍预设措辞、`readFromPreset` 的同源参数、预置表里重复的 `name`、
  `headers?` 的第三态、两处文档口径。（`LlmConfig` 里 `apiKey` 与 `headers` 并存一条，保留并写明理由。）
- **Spec 轴 8 条，最重的是「头的值会进日志」**（段格式写错时整段被抄进报错，而报错进 `server.ts` 的日志）——
  已改成只点名「第 N 段」，并加了不让那句凭证出现的检查。其余：Gemini 未按票面走注入 `fetch`（已补齐三个
  云端预设各一遍）、`YTwins_LLM` 覆盖会把云端端点说成「本机」（已改成响亮拒绝）、Gemini 模型与票面不一致
  （已把复核实情记进票面）、embedding 的启动日志说明缺失（已补）、`authorization` 冲突拒绝过严（已按
  「配了 key 才算冲突」放宽并补检查）、`notes` 的计数与 `content-type` 拒绝（保留并写明理由）、
  文档「前四家都 Bearer」与 ollama 自相矛盾（已改口径）。
