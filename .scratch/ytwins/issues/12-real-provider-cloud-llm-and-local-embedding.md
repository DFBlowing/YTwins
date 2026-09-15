# 12: 真实 provider —— 云端 LLM + 本地 embedding + 可切换

**What to build:** 关掉假 provider，换上真实实现：云端 LLM 负责 `extract` / `judgeLink` / `compose` /
`respond`（OpenAI 兼容端点、JSON 输出），embedding 在本机 CPU 上用预训练的多语言小模型离线运行，
无需 key。两者都能按配置在「云端 OpenAI 兼容端点／本地 Ollama」与「本地／云端 embedding」之间切换，
领域逻辑完全不感知差异。

**Blocked by:** 03（回应方式 —— 情绪优先与机械规则校验）、04（词条与链接 —— 把碎片连起来）

**Status:** ready-for-agent

- [ ] 真实 provider 实现全部五个操作：`extract` / `embed` / `judgeLink` / `compose` / `respond`。
- [ ] LLM 走 OpenAI 兼容端点并返回结构化 JSON；解析失败时有明确、可诊断的错误处理。
- [ ] embedding 经 transformers.js 在 Node 内本地 CPU 运行，完全离线、不需要 key；模型文件不进 git。
- [ ] API key 只存在服务端的环境变量文件里，不进 git、不进入浏览器；仓库里不含任何 key 的明文。
- [ ] provider 通过配置选择四种组合（云端／本地 LLM × 本地／云端 embedding），领域逻辑零改动。
- [ ] 领域测试仍然全部由假 provider 驱动 —— 引入真实实现后测试套件依然确定、依然通过。
- [ ] 真实实现只做手工冒烟（能连通、返回结构符合预期），不对其语义质量做自动化断言。
- [ ] **前提（不属于本 ticket 的验收）**：人类已先申请并填入云端 LLM 的 API key；这一步只有人能做，必要时用 `/wizard`。
