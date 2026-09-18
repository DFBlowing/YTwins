# 16: LLM 侧的额外请求头 —— 给 opencode 一类端点留一条通道

**What to build:** 让 LLM 那一半能按配置带上**额外的请求头**。现在的客户端只会发
`Authorization: Bearer <key>`，而有些 OpenAI 兼容端点还要自己的头 —— `opencode.ai/zen/go/v1` 要
`x-opencode-session`（ticket 12 的 Comments 第 4 条记着这件事）。加完之后，**这类端点只靠环境变量就能接上**，
不用改调用路径、不用为某一家写分支；默认什么头都不加，今天的行为一个字节不变。

**Blocked by:** 12（真实 provider 可跑）

**Status:** ready-for-agent

- [ ] **头是注入的值，不是写死的常量。** 新配置项加在 `LlmConfig` 上（与 `baseUrl`、`model` 同一个位置），
      由环境变量读进来；一个都没配时是空 map，`createChatClient` 的请求与今天逐字节相同。
- [ ] **值绝不外泄。** `notes`（服务启动时打给人看的那几行）只说「配了 N 个额外头」或类似说法，
      **不打印任何一个值**；报错信息里也不出现值 —— 它多半就是一条会话凭证。
- [ ] **名字要校验。** 头名必须是合法的 token（拒绝空名、含空格或控制字符、含冒号的名字），
      不合法的**响亮拒绝**（照 `ProviderConfigError` 的方式，指出是哪个变量），而不是发一个坏请求出去。
- [ ] **与 `Authorization` 的关系要定死。** 若配置里出现 `Authorization`：是拒绝、还是让它覆盖 key？
      二选一并写进注释与测试 —— 含糊的话，两条设置会有一条静默失效。
- [ ] 云端 embedding 那一半**这一票不动**（opencode 是 LLM 后端；真要用在 embedding 上，另开票）。
- [ ] `YTwins_PROVIDER=demo` 与既有四种组合都不受影响；`npm test` / `npm run test:ai` 全绿。
- [ ] **测**：配置解析（空 / 一条 / 多条 / 非法名 / 与 `Authorization` 撞名）、以及
      「请求里真的带上了这个头」——用注入的 `fetch` 断言，与 12 里既有的请求断言同一套写法。
- [ ] **文档**：`.env.example` 与 `config.ts` 的模块注释里列出这个变量，并写明它的第一个用途是
      opencode go；`docs/` 若有 provider 配置的叙述处也一并更新。
- [ ] **手工过一遍**：拿一个真的需要额外头的端点跑通一次（有 key 时）；
      没有 key 时至少用注入的 fetch 把「配置 → 请求头」这条路端到端走一遍并打印请求。

## Comments

**2026-09-18 — 开票**

**作者的原话**（2026-09-18）：「未来我可能会将 opencode go 作为产品后端模型的一种可能，请你留个能使用
opencode api 的通道。」

**为什么是「通道」而不是「接上 opencode」。** 一件事只有一处该知道：`src/ai/config.ts` 是唯一知道
「这台机器跑哪种 provider 组合」的地方，`src/ai/openai-chat.ts` 只该知道「怎么把一个 JSON 请求发到一个
OpenAI 兼容端点」。为 opencode 写一个分支会把厂商知识漏进调用路径，将来换一家又要改一次；
把「额外请求头」做成配置，opencode 就只是它的第一个使用者。这与 spec 冻结的那条一致：**换 provider 是换值**。

**这件事是 ticket 14 的实测顺带查出来的。** 做完 14 的真实链路验证时发现，这台机器的 `.env` 里 key 是能用的
DeepSeek key（`api.deepseek.com/models` 返回 200），端点却指向 `generativelanguage.googleapis.com` +
`gemini-flash-lite-latest`，于是每个 LLM 调用都 400，而域侧把读失败静默吞掉 —— 表现是「投递了但一个词条
都读不出来」。当时是用环境变量临时指向 `https://api.deepseek.com` 跑通的，`.env` 没有改。
**opencode 的通道与这处 `.env` 是两件事**：前者是「以后能接」，后者是「现在这台机器该接哪家」。

**待定的实现取舍**（实现时定，倾向 ①）：

1. **变量名与格式**：① 一个变量 `YTwins_LLM_HEADERS`，形如 `x-opencode-session=abc;x-foo=bar`
   （与 `.env` 的「一行一个 NAME=VALUE」风格接近，但多值只能挤在一行）；② 为每个头一个变量
   （`YTwins_LLM_HEADER_x_opencode_session=…`，丑但清楚）；③ 单独的 `YTwins_LLM_SESSION`
   只为 opencode 一家准备（最省，但把厂商知识写进了配置名，与开票理由相悖）。倾向 ①。
2. **与 `Authorization` 撞名**：① 拒绝（配置里不许出现 `Authorization`，让 key 走 `YTwins_LLM_API_KEY`）；
   ② 配置优先、覆盖 key。倾向 ① —— 两个来源写同一个头，静默二选一才是危险的。

**明确不做**：不做 OAuth/登录流程、不做会话自动续期、不为某一家端点写适配分支 ——
这一票只做「调用时能多带几个头」这一件事。
