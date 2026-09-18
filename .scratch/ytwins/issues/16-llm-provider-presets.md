# 16: 一个 key 换一家模型 —— 给 Gemini / opencode / DeepSeek 各留一个预设

**What to build:** 把「换后端模型」压成两行：**选一个 preset + 填一个 key**。每个 preset 自带该家 OpenAI 兼容
端点、默认模型 id、鉴权方式（`Authorization: Bearer` / `x-goog-api-key` / 自定义头）以及必需的静态请求头 ——
于是换模型是换值，不是改调用路径。显式变量（`BASE_URL` / `MODEL` / `HEADERS`）继续存在并**优先于** preset，
当逃生口用。没选 preset 时行为与今天完全一致。

**Blocked by:** 12（真实 provider 可跑）

**Status:** ready-for-agent

## 预设表（实施时逐条复核，票面记事实与出处）

| preset | base URL | 默认模型 | 鉴权 | 出处 |
|---|---|---|---|---|
| `deepseek` | `https://api.deepseek.com` | `deepseek-flash` | `Authorization: Bearer` | 本机实测 `GET /models` 返回 200，列出 `deepseek-flash` / `deepseek-v4-pro` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.6-flash` | `Authorization: Bearer` | 官方 OpenAI 兼容文档 |
| `opencode` | `https://opencode.ai/zen/v1` | `deepseek-v4-flash`（只取 `chat/completions` 那一档） | `Authorization: Bearer`，某些档位另需 `x-opencode-session` | Zen 端点表；该头见第三方代理与 free/Go 档报告 |
| `ollama` | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` | 无 key | 已有本地一档 |
| `custom` | 必须给 `YTwins_LLM_BASE_URL` | 必须给 `YTwins_LLM_MODEL` | Bearer + 可配额外头 | 逃生口 |

- [ ] **一个 key 换一家。** `YTwins_LLM_PRESET=<名字>` + `YTwins_LLM_API_KEY=<key>` 就是全部；
      缺 key 时的报错**点名这个 preset 需要哪个变量**，而不是笼统说「provider 不可用」。
- [ ] **厂家的差异只落在预设里。** `src/ai/config.ts` 认识预设；`src/ai/openai-chat.ts` 只认识
      「base URL + model + 一组请求头」，不为任何一家写分支（与 spec 冻结的「换 provider 是换值」一致）。
- [ ] **额外请求头仍是预设的一个字段**（原票面就是这一条，保留）：`x-opencode-session` 这类要么写在预设里、
      要么由 `YTwins_LLM_HEADERS` 配；值绝不进日志；头名非法要响亮拒绝。
- [ ] **未知 preset 响亮拒绝**（照 `ProviderConfigError` 的方式，指出是哪个变量、可用值有哪些）。
- [ ] **显式覆盖优先于预设**，且启动日志要说明「预设是哪家、哪些值被显式覆盖了」—— 覆盖是逃生口，
      不该是一次静默的配置漂移。
- [ ] **`notes` 只说三件事**：哪家 · 哪个模型 · key 已配置 / 缺 key。**绝不打印 key、也绝不打印头的值。**
- [ ] **embedding 那一半不在「只填 key」的承诺里。** 换 embedding 必须重跑 ticket 14 那套标定
      （实测：换成 `bge-small-zh-v1.5` 会让真相关对从 0.875 掉到 0.456，两个分布反而重叠），所以本地模型仍是默认，
      云端 embedding 仍走既有的显式 base URL + key，并且要在 `.env.example` 与启动日志里**说清这一点**。
- [ ] **测**：每个预设解析出正确的 base / model / 鉴权头；缺 key 的报错文案；未知 preset；
      显式覆盖优先；以及「请求里真的带上了正确的头」——用注入的 `fetch` 断言，与 12 既有的请求断言同一套写法。
- [ ] **文档**：`.env.example` 只留必填的两行（preset + key），预设表写进注释；`config.ts` 的模块注释更新；
      `docs/` 里讲 provider 配置的地方一并改。
- [ ] **手工过一遍**：本机有可用的 DeepSeek key，**至少 DeepSeek 真跑一次**；Gemini / opencode 没有 key 时用
      注入的 fetch 断言请求形状，并在 Comments 里明记「未用真 key 验过」。
- [ ] **顺手修这台机器 `.env` 的坏配置**：key 是好的 DeepSeek key，端点与模型却指向 Google（详见 Comments）。
      改成 `YTwins_LLM_PRESET=deepseek` + 那一行 key，或按作者的意思留到落地后再说。

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
