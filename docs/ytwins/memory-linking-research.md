# 词条抽取与链接：方案调研（YTwins）

本文回答 YTwins 的一个具体技术疑虑：把「投递」抽成词条、再让词条之间建立链接，**是不是必须靠大数据训练才能做出来，成本会不会很高**。全文结论均指回一手来源（官方文档、源码仓库、定价页、论文），定价与许可证均注明查验日期。

**全部事实查验日期：2026-09-14**（本地系统日期，UTC+8）。定价随时会变，本文数字仅代表该日所见的挂牌价。

**关于来源与方法的几点说明**（便于你判断每条数字的可信度）：

- 所有价格、许可证、模型规格、Star 数均于上述日期**实际打开页面读取**，未使用记忆值。许可证一律取自仓库 `LICENSE` 文件原文或 GitHub API 的 `spdx_id`。
- **引用时请连同"查验日期"一起引用本文档。** 本次核查已经实测到三处厂商侧变动（DeepSeek 模型改名、Letta 换仓、Zep 仓库性质变化），说明这类信息半衰期很短。
- **两个需要标注的渲染差异**：`gemini-embedding-001` 的 $0.15/1M 取自同一 URL 的本地化渲染（英文渲染页当日只列 `gemini-embedding-2`）；`neo4j.com/licensing` 抓取只得导航壳，Neo4j 许可表述改引其官方 GitHub 仓库 README。
- **凡未查到的，本文一律写"未查到"，不做推测**，并在文末"未解决/存疑"集中列出。全文共有十余处"未查到"，其中最关键的是 **CPU 推理吞吐量**。

---

## 直接回答：必须"大数据训练"吗，成本高不高

**不需要训练。** 词条抽取用现成的 LLM 做 JSON 结构化抽取即可；词条之间的链接用**预训练** embedding 模型算余弦相似度 + 阈值判定即可，这两件事都不用自己训练任何模型。BAAI/bge-m3、intfloat/multilingual-e5、nomic-embed-text、OpenAI text-embedding-3 全都是已经在大规模语料上预训练好的成品，直接下载就用（[BGE-M3 模型卡](https://huggingface.co/BAAI/bge-m3)、[multilingual-e5-large 模型卡](https://huggingface.co/intfloat/multilingual-e5-large)）。"链接需要大数据训练"这个前提本身是误解——需要大数据的是**那个 embedding 模型**，而它已经有人替你训好了。

**成本量级：调 API 的话，一年不到 1 美元；纯本地的话，现金成本是 0。** 按"单用户、每天 5 次投递、每次 200 字、持续一年"估算，全年 LLM 输入约 1.57M token、输出约 0.31M token、embedding 约 0.55M token。按 OpenAI 当日挂牌价，最便宜的档位（`gpt-5-nano` + `text-embedding-3-small`）约 **0.21 美元/年**；按中档 `gpt-5.6-luna` 约 **0.70 美元/年**；换 DeepSeek `deepseek-flash` 约 **0.42–0.84 美元/年**（[OpenAI 定价页](https://developers.openai.com/api/docs/pricing)、[DeepSeek 定价页](https://api.deepseek.com/quick_start/pricing)）。这个量级下，"成本会不会很高"这个问题不成立——真正的约束不是钱，而是**你要不要为了隐私把推理留在本地**，以及本地 CPU 上跑生成式抽取会带来十几秒级的等待。

**推荐路线一句话：网页 demo 阶段用「云端 LLM 做 JSON 抽取 + 本地/云端 embedding 算余弦 + 阈值判定」，完全不训练任何模型；把"自己训练"这件事从路线图里删掉，直到你手里攒够了真实的误判样本再说。**

---

## 一、词条抽取：可选做法

YTwins 的"词条"有一个特殊要求：**保留用户原话**（「想学吉他」而不是"乐器学习意图"）。这一条会直接筛掉一半候选方案。

### 1.1 LLM 结构化抽取（JSON schema / function calling）

- **原理**：给 LLM 一段 schema，让它把自由文本直接吐成结构化 JSON，字段自定（比如 `[{词条原文, 类型, 情绪极性}]`）。
- **成熟度**：高，且是官方一等公民能力。OpenAI 的 Structured Outputs 明确承诺"模型总会生成符合你提供的 JSON Schema 的响应，不用担心漏掉必填字段或枚举值幻觉"，并给出了"从非结构化输入抽取结构化字段"的官方示例（[OpenAI Structured Outputs 官方文档](https://developers.openai.com/api/docs/guides/structured-outputs)，2026-09-14 查验）。注意官方文档明确区分了两种用法：**要接工具/数据用 function calling，要按固定结构回话用 `text.format` + json_schema**——YTwins 的抽取属于后者。
- **中文支持**：取决于所选 LLM。DeepSeek 官方文档确认 `deepseek-flash`、`deepseek-v4-pro` 均支持 [Json Output](https://api-docs.deepseek.com/guides/json_mode) 与 [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)（[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)）。
- **成本**：见第四节。这是**唯一能天然满足"保留原话 + 任意概念粒度 + 同时抽情绪"**的做法。
- **风险**：小模型/本地模型对 schema 的服从度会掉。Graphiti 官方 README 直说："Graphiti 依赖结构化（JSON）输出做实体/边抽取与去重，在能可靠遵守它的模型上效果最好……**非常小的模型经常吐出不符合请求 schema 的 JSON，表现为抽取失败**"（[Graphiti README](https://github.com/getzep/graphiti)）。这条警告对 YTwins 同样成立，是"纯本地小模型"路线的主要工程风险。

### 1.2 无监督关键词抽取（YAKE、KeyBERT）

- **YAKE**：基于单文档统计特征（词频、位置、共现、大小写等），官方 README 明确写着 "requires no training, external corpus, or dictionaries"（**无需训练、无需外部语料、无需词典**），并且 "works across multiple languages and domains regardless of text size"（[INESCTEC/yake README](https://github.com/INESCTEC/yake)）。论文见 Campos et al., *YAKE! Keyword Extraction from Single Documents using Multiple Local Features*, Information Sciences 2020（[README 引用条目](https://github.com/INESCTEC/yake)）。
- **KeyBERT**：作者自述"用 BERT embedding 加简单余弦相似度，找出与整篇文档最相似的子短语"，且设计目标就是"不用从头训练"（"I could not find a BERT-based solution that did not have to be trained from scratch"）。许可证 MIT（[KeyBERT README](https://github.com/MaartenGr/KeyBERT)）。KeyBERT 还内建了 `KeyLLM` 用 LLM 抽关键词，并支持 `threshold` 参数复用相似文档的结果以省调用。
- **中文支持**：这是硬伤。YAKE 是"语言无关"的统计方法，但它依赖分词与停用词；中文没有空格分词，效果与英文不可比。KeyBERT 可以换成中文 sentence-transformers 模型，但它做的是"从文档里挑最像文档的 n-gram 子串"，**输出的仍然是原文里的片段，无法给出"想学吉他"这种跨短语的归一化概念，也无法同时输出情绪标签**。
- **成本**：极低（纯 CPU，无 API 调用）。
- **对 YTwins 的结论**：可以做**廉价的候选召回**或降级兜底，不适合做主抽取器。

### 1.3 NER（命名实体识别）

- **原理**：序列标注，识别 PER/LOC/ORG 等实体类型。
- **中文可用模型**：`shibing624/bert4ner-base-chinese`，Apache-2.0，模型卡自报在 PEOPLE（人民日报）测试集上 Accuracy 0.9425 / Recall 0.9627 / F1 0.9525；标签集合为 **ORG / LOC / PER / TIME 四类**（[模型卡](https://huggingface.co/shibing624/bert4ner-base-chinese)）。
- **对 YTwins 的结论**：**不适用**。四类实体标签覆盖不了"想学吉他""最近很焦虑"这类概念与情绪；NER 的定义就是抽取现实世界实体，不是抽取用户主观概念。它可以作为辅助信号（比如识别时间以支撑"事项排程"那条能力），但做不了"词条"。

### 1.4 Embedding 聚类 / 主题模型

- **原理**：把文本转向量后聚类，或用 BERTopic 之类做主题发现。
- **成熟度**：成熟，但**产出的是簇而不是词条**，且簇标签仍需人来命名或 LLM 来生成。它解决的是"链接"问题的一半（相似度），不是"抽取"问题。
- **对 YTwins 的结论**：作为**链接阶段的补充**有价值（发现语义上聚集的一群词条），不适合作为主抽取器。

### 1.5 本节小结

| 做法 | 保留用户原话 | 抽情绪/决策 | 中文 | 需要训练 | 定位 |
|---|---|---|---|---|---|
| LLM 结构化抽取 | ✅ | ✅ | ✅（看模型） | ❌ | **主抽取器** |
| YAKE | 部分（是原文片段） | ❌ | ⚠️ 需分词 | ❌ | 廉价兜底/召回 |
| KeyBERT | 部分 | ❌ | ⚠️ 需中文模型 | ❌ | 廉价兜底/召回 |
| NER | ✅（但只4类实体） | ❌ | ✅ | ❌ | 只能辅助抽时间 |
| Embedding 聚类 | ❌（产出簇） | ❌ | ✅ | ❌ | 链接阶段补充 |

---

## 二、链接与记忆图谱：可选做法

### 2.1 基线做法：embedding 余弦相似度 + 阈值

原理一句话：把每个词条编码成向量，两两算余弦相似度，超过阈值就连一条边；另外再加一条**不需要任何模型**的硬规则边——"共同出现在同一次投递里"。

- **成熟度**：这是检索领域最基础的操作。BGE-M3 官方模型卡给的示例就是 `similarity = embeddings_1 @ embeddings_2.T` 直接点积算相似度（[BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)）。KeyBERT 整个算法也建立在"余弦相似度找最相似的短语"上（[KeyBERT README](https://github.com/MaartenGr/KeyBERT)）。
- **是否需要训练**：❌ 不需要。
- **成本**：计算本身是本地矩阵乘法，**零 API 成本**。
- **工程要点**：纯阈值会在灰区（0.7~0.85 之类）产生大量错边。标准做法是**三段式**：高分直接连、低分直接不连、**灰区才调 LLM 判定**。这能把 LLM 调用量压到"每次投递 0~1 次"。

### 2.2 现成系统的逐一核实

以下六项逐个核实。许可证均取自仓库 `LICENSE` 文件原文（2026-09-14 查验）。

#### mem0（mem0ai/mem0）

- **数据模型**：存储单元是**自然语言 memory facts（单条记忆）**，按 `user_id` / `agent_id` / `run_id`（Platform 另有 `app_id`）作用域——**不是三元组**。README 描述的当前算法是「**Single-pass ADD-only extraction** —— 一次 LLM 调用，不做 UPDATE/DELETE；记忆只累加、不覆盖」，并新增「**Entity linking**」与「Multi-signal retrieval：语义 + BM25 关键词 + 实体匹配并行打分后融合」（[mem0 README](https://github.com/mem0ai/mem0)）。⚠️ **官方文档与 README 在此点矛盾**：文档站写的是 `infer=True`（默认）时"一次 LLM 调用决定每条 fact 的 **ADD/UPDATE/DELETE**"（[docs.mem0.ai: add](https://docs.mem0.ai/core-concepts/memory-operations/add.md)）。详见文末"未解决/存疑"第 6 条。
- **⚠️ 图记忆已不在开源版**：v3 起 OSS 删除了 Neo4j/Memgraph/Kuzu/Apache AGE 等外部图集成，`relations` 字段恒为空；Graph Memory 现在是 **Platform（托管）专属**功能。Platform 的图也**不产生 typed relations**，只是"实体 ↔ 提及它的记忆"共现，用于给 `score` 加权（[platform-vs-oss](https://docs.mem0.ai/platform/platform-vs-oss.md)、[graph-memory](https://docs.mem0.ai/platform/features/graph-memory.md)）。
- **是否需要训练**：❌ 不需要。README 明确："**Mem0 requires an LLM to function**"，默认 `gpt-5-mini`；默认 embedding 是 `text-embedding-3-small`。近似"少 LLM"路径只有 `infer=False`（跳过抽取 LLM，但仍做 embedding）。**完全无 LLM 模式：未查到。**
- **许可证**：**Apache-2.0**（[LICENSE 原文](https://github.com/mem0ai/mem0/blob/main/LICENSE) 版权行 `Copyright [2023] [Taranjeet Singh]`；[GitHub API](https://api.github.com/repos/mem0ai/mem0) `spdx_id = "Apache-2.0"`）。属 **open-core**：OSS 库 Apache-2.0，托管 Platform 是商业服务；Graph Memory / Memory Decay / Temporal Reasoning / Dream / webhooks / memory export / custom categories 均不在 OSS。
- **能否纯本地**：**可以**。`Memory.from_config` 里 `llm.provider` 可设 `ollama`（官方示例 `mixtral:8x7b` / `llama3.1:8b`），embedder 也可换 `ollama` / `huggingface`，vector store 可用本地 `qdrant` / `pgvector` / `chroma` / `faiss`（[open-source/configuration](https://docs.mem0.ai/open-source/configuration.md)）。⚠️ **陷阱**：官方 Ollama 页的 Python 示例仍写着 `os.environ["OPENAI_API_KEY"]` 并在注释里标 `# for embedder`——**要完全离线必须同时把 embedder 也换成 ollama/huggingface**。
- **成熟度信号**：Python；65,276 stars；最新 release tag `pi-agent-v0.3.0`（插件版本，非核心库版本），2026-09-09。
- **对本项目的适配问题**：mem0 的记忆是"关于用户的事实"，为问答检索服务；YTwins 需要的是**保留原话的极简概念单位 + 情绪/决策节点 + 阈值触发汇集**，mem0 没有"阈值汇集成答案"这一层，且开源版**已经连图都没有了**。

#### Zep / Graphiti（getzep/graphiti）

- **数据模型**（直接读 `graphiti_core` 源码，**4 种节点 + 5 种边**）：
  - 节点：`EntityNode`（`name`, `name_embedding`, `summary`, `attributes`, `labels`, `group_id`, `created_at`）、`EpisodicNode`（`source` = `message|json|text|fact_triple`, `content`, `valid_at`, `episode_metadata`）、`CommunityNode`（`name_embedding`, `summary`）、`SagaNode`（`summary`, `first_episode_uuid`, `last_summarized_at` …）。
  - 边：`EntityEdge`（关系类型 `RELATES_TO`，属性 `name`, `fact`, `fact_embedding`, `episodes[]`, `valid_at` / `invalid_at` / `expired_at` / `reference_time`）、`EpisodicEdge`（`MENTIONS`）、`CommunityEdge`（`HAS_MEMBER`）、`HasEpisodeEdge`（`HAS_EPISODE`）、`NextEpisodeEdge`（`NEXT_EPISODE`）。
  - README 的抽象说法：Entities（节点，带随时间演化的 summary）/ Facts-Relationships（边，三元组带有效期窗口）/ Episodes（溯源，原始数据按摄入原样保留）/ Custom Types（Pydantic 定义本体）。实体名与 fact **各自生成 embedding**；事实失效是**打 validity 窗口而非删除**（bi-temporal）。论文见 [arXiv:2501.13956](https://arxiv.org/abs/2501.13956)。（[nodes.py](https://github.com/getzep/graphiti/blob/main/graphiti_core/nodes.py)、[edges.py](https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py)）
- **是否需要训练**：❌ 不需要。图由 LLM 抽取增量构建，README 强调 "**Incremental Graph Construction**：新数据立即整合，无需批量重算"。存在**有限的手动无 LLM 路径**：`graphiti.add_triplet(source_node, edge, target_node)` 可直接写 `EntityNode`/`EntityEdge` 绕过抽取（[Adding Fact Triples](https://help.getzep.com/graphiti/working-with-data/adding-fact-triples.md)）。**完全 no-LLM 模式：未查到。**
- **许可证**：**Graphiti = Apache-2.0**（[LICENSE 原文](https://github.com/getzep/graphiti/blob/main/LICENSE)，版权行 `Copyright 2024, Zep Software, Inc.`）。
- **⚠️ 必须分清 Zep 与 Graphiti**：`getzep/zep` 仓库的 README 明确声明「**This repository is not Zep's product or service**」——该仓库现在只放 examples / integrations / ingestion，其开源社区版已被移入 `legacy/` 并标注 "Deprecated Zep Community Edition (unsupported)"。**Zep 本体是闭源托管平台**（由 proprietary Context Graph Engine 支撑，官方 SDK 是 `zep-cloud`），**不能本地跑**。开源侧实际只剩 Graphiti。这是 open-core 的典型形态，**"Zep 开源"是过时的说法**。
- **能否纯本地**：Graphiti 可以，但**要自带一个第三方图数据库**。README 要求 Neo4j 5.26 / FalkorDB 1.1.2 / Amazon Neptune（+ OpenSearch Serverless）/ Kuzu 0.11.2（**已 deprecated，上游不再维护**）。本地 LLM 支持明确："可通过 OpenAI 兼容端点使用托管厂商（DeepSeek、Together、OpenRouter…）和**本地服务（Ollama、vLLM、llama.cpp、LM Studio）**"，示例用 `ollama pull deepseek-r1:7b` + `nomic-embed-text`。
- **成熟度信号**：Graphiti = Python，30,865 stars，最新 release `v0.30.2`（2026-09-08）。
- **⚠️ 对本项目的重要警示**：Graphiti **默认开启遥测**。README 的 Telemetry 一节写明用 PostHog 收集匿名使用统计，需要显式设置 `GRAPHITI_TELEMETRY_ENABLED=false` 才能关闭。对"纯本地、无账号"是明确的反向信号，虽然 README 同时承诺不收集"你的实际数据、查询或图内容"。

#### Letta（原 MemGPT，letta-ai）

- **数据模型**：**MemFS——属于该 agent 的一个 git 仓库**，投影到运行机器上作为真实 checkout，用普通文件工具读写。每条记忆 = **一个 Markdown 文件 + YAML frontmatter**，**路径即 label**（`system/persona` → `system/persona.md`）；`system/` 下的文件每轮进 system prompt，`system/` 外的文件不进上下文（只有文件树常驻）。每次编辑 commit 到 git，因此**天然有版本历史**（[MemFS 文档](https://docs.letta.com/concepts/memfs/index.md)）。还有 memory blocks、conversations（一个 agent 多条独立消息线程、共享 memory）、skills、以及 **dreaming**（[Memory & dreaming](https://docs.letta.com/configuration/memory/)）。
- **⚠️ 重要细节**：**默认没有语义/向量索引**——查找靠普通文件搜索/读取。需要关键词或语义/混合检索要另装 `memfs-search` mod，且语义/混合模式依赖外部 QMD 索引。这与你可能预设的"记忆系统 = 向量库"完全不同。
- **是否需要训练**：❌ 不需要，而且**官方明确否定权重更新这条路线**。`llms.txt` 原文：「Letta agents learn by actively managing their own context — creating durable token-space representations of their identity, memory, and continuity — **rather than by updating model weights**」（[docs.letta.com/llms.txt](https://docs.letta.com/llms.txt)）。这是第三节"路线 B 不该做"最直接的一手佐证。
- **许可证**：**Apache-2.0**（旧仓 `Copyright 2023, Letta authors`；[letta-code LICENSE](https://github.com/letta-ai/letta-code/blob/main/LICENSE) 为 `Copyright 2025, Letta authors`），**但附加 `Brand Assets Exclusion`**：Letta / Letta Code 名称、logo、wordmark、图片与 ASCII art 属 Letta, Inc. 版权资产，**不在 Apache-2.0 授权范围内**，未经书面许可不得用于衍生作品。
- **能否纯本地**：**可以，有官方专页**。`docs.letta.com/self-hosting` 原文：「all agent state, including messages, memory, and provider connections, **stays on-device, and no Letta account is required**」；命令为 `letta --backend local connect ollama`、`letta --backend local connect lmstudio --base-url http://127.0.0.1:1234/v1`（[self-hosting](https://docs.letta.com/self-hosting/index.md)）。⚠️ 该页同时点明一个容易误解的地方：**本地状态 ≠ 本地推理**——若连远端 provider，prompt 仍会发往该 provider。
- **⚠️ 仓库已迁移（旧资料会误导）**：现行源码在 [`letta-ai/letta-code`](https://github.com/letta-ai/letta-code)（**TypeScript**，npm `@letta-ai/letta-code`，最新 v0.32.8 / 2026-09-14）；`letta-ai/letta` 只剩 README/LICENSE（GitHub API 返回 `"language": null`），最新 release 停在 `0.16.8`（2026-05-14），V1 API server 在 `archive` 分支。**把它当"Python MemGPT 服务器"的认知已过时。**
- **对本项目的适配问题**：Letta 是**完整的 agent 运行时**（含 TUI、App Server、channels、云端），重量远超 YTwins 需要的一个"词条-链接"存储层。可借鉴其 **dreaming** 机制（见第五节）与"每次编辑都 commit"的版本化思路，但没必要引入整个框架。

#### Cognee（topoteretes/cognee）

- **数据模型**：**三存储架构**——relational store（文档/块/provenance 元数据）+ vector store（chunk 与 DataPoint 的 embedding）+ graph store（entities 与 relationships），三者用同一个 `id` 关联。原子单位是 **DataPoint**（Pydantic 模型），字段含 `id` / `created_at` / `updated_at` / `version` / `topological_rank` / `valid_to`（**双时间失效戳，由 `close_node()` 打标而非删节点**）/ `metadata.index_fields` / `type` / `ontology_uri`。内置类型：`Document`、`DocumentChunk`、`TextSummary`、`Entity` / `EntityType`、`Edge`。**嵌套字段会变成图节点+边**（`Book.author: Author` → `Node(Book)`、`Node(Author)`、`Edge(Book→Author, type="author")`）；去重靠 `Dedup()` / `identity_fields` 生成确定性 `uuid5`。（[architecture](https://docs.cognee.ai/core-concepts/architecture.md)、[datapoints](https://docs.cognee.ai/core-concepts/building-blocks/datapoints.md)）
- **四个核心操作**：`remember`（存永久记忆或 session 记忆）、`recall`（检索）、`improve`（富化、应用反馈、把 session 知识桥接进图）、`forget`（删除）——**`forget` 对"删除要能级联删干净"这条约束是好消息**（[cognee README](https://github.com/topoteretes/cognee)）。
- **是否需要训练**：❌ 不需要微调，但**模型不可省**。官方原文：「Cognee **always** uses **two** models together: an **LLM** for entity/relationship extraction and reasoning, and an **embedding model** for semantic search」；**embedding model 强制必需**，只配一个时另一半会静默回退 OpenAI，并在 `add()`/`remember()` 前抛 `ProviderConfigMismatchError`。默认 `openai/gpt-5-mini` + OpenAI embeddings，全部经 LiteLLM 路由。**无 LLM 模式：未查到。**
- **许可证**：**Apache License 2.0**（`Copyright 2024 Topoteretes UG`，[LICENSE 原文](https://github.com/topoteretes/cognee/blob/main/LICENSE)；[GitHub API](https://api.github.com/repos/topoteretes/cognee) `spdx_id = "Apache-2.0"`）。**存在 open-core 迹象**：图存储文档明确「A production-ready Postgres graph adapter is available as a **licensed product**」，站点另有 Cognee Cloud。
- **能否纯本地**：**可以，且是官方主打路径**。图库默认 **Kuzu（file-based，零配置，随 Cognee 提供；官方警告其文件锁不适合多进程并发）**，可换自托管 Neo4j。LLM 可 Ollama（推荐 `llama3.1:8b`）、LM Studio、llama.cpp、或任意 OpenAI-compatible（vLLM）；**embedding 可用 Fastembed 的 `all-MiniLM-L6-v2`，纯 CPU 运行**。官方有 Local Setup（零 API key）手册，`cognee-cli demo` 无需 key 即可跑。（[graph-stores](https://docs.cognee.ai/setup-configuration/graph-stores.md)、[llm-providers](https://docs.cognee.ai/setup-configuration/llm-providers.md)）
- **成熟度信号**：Python；30,679 stars；最新 release `v1.5.4`（2026-09-04）；要求 Python `>=3.10,<3.15`。
- **⚠️ 注意**：README 里 cognee 1.0 提到"整个记忆层可以跑在单个 Postgres 上"，但**自带警告**：用 Postgres 作图存储目前是 **demo 功能**，"生产就绪的功能需要商业授权"。

#### LangMem（langchain-ai/langmem）

- **数据模型**：**不是数据库，是一个记忆操作库**。官方分三类记忆：semantic（事实/知识，两种形态——**Collection** = 无界"单条记录"可搜索集合；**Profiles** = 按任务强 schema 的单文档，更新时改文档而非新增）、episodic（过去经验的 few-shot 示例/会话摘要，官方 `Episode` schema = `observation` / `thoughts` / `action` / `result`）、procedural（系统 prompt 规则）。统一抽象是 **memory operation**：输入「对话 + 当前记忆状态」→ **prompt 一个 LLM** 决定如何扩写/整合 → 返回更新后的记忆状态（含 delete/invalidate/consolidate）。存储层建在 **LangGraph BaseStore** 上，支持多级 namespace（如 `("acme_corp", "{user_id}", "code_assistant")`），检索方式 = direct get / semantic search / metadata filtering。**没有图数据库、没有 entity/relation/triple 结构**。（[Core Concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)）
- **是否需要训练**：❌ 不需要微调，但**除存储外全部由 LLM 驱动**——memory manager（`create_memory_manager`）与 prompt optimizer（`create_prompt_optimizer`）都是"prompt LLM"式函数。**无 LLM 模式：未查到（不存在）。**
- **许可证**：**MIT**（`Copyright (c) 2025 LangChain`，[LICENSE 原文](https://github.com/langchain-ai/langmem/blob/main/LICENSE)；[GitHub API](https://api.github.com/repos/langchain-ai/langmem) `spdx_id = "MIT"`；[PyPI](https://pypi.org/pypi/langmem/json) `info.license` 即 MIT 全文）。**未发现 open-core 拆分。**
- **能否纯本地**：⚠️ **官方"本地/离线运行"说明页：未查到。** 文档与 README 只给用 API key 的 provider 示例（如 `export ANTHROPIC_API_KEY=...`），**没有 Ollama / 离线章节**。能确认的只有两点：① 存储可完全本地——`InMemoryStore`（进程内存，重启即失）或 `AsyncPostgresStore`（自托管 Postgres）；② 模型经 LangChain 的 `"provider:model"` 抽象注入，**理论上**可换任意 LangChain 支持的 chat model。但"可指向本地 LLM"**缺少一手文档支撑，本文不作为已证实结论**。
- **成熟度信号（三者中最不成熟）**：Python；**仅 1,664 stars**；**GitHub releases 未查到——`/releases/latest` 返回 HTTP 404**（该仓未发布 GitHub Release）；替代信号是 PyPI 最新版本 **0.0.30**（2025-10-27），版本号仍在 `0.0.x`。
- **对本项目的价值**：**它的两个模式最值得抄**（阈值再总结 + 防抖，见第五节），而不是它的代码。

#### Neo4j 系图记忆方案

- **数据模型**：属性图——节点 + 关系 + 属性。给 YTwins 用时最自然的是 `(:Term)-[:RELATED_TO {score, reason}]->(:Term)`，情绪/决策作为特殊类型节点，投递作为 `(:Drop)` 节点与词条建立"出现在同一次投递"的硬边。
- **官方 GraphRAG 包（`neo4j-graphrag-python`）的数据模型**：分两层。**词法图**：`Document` 节点（带 `path`）、`Chunk` 节点（带 `text` + 可选 embedding 属性）、关系默认 `PART_OF_DOCUMENT` / `NEXT_CHUNK` / `PART_OF_CHUNK`，标签与关系名都可通过 `LexicalGraphConfig` 改（[KG Builder 指南](https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_kg_builder.html)）。**领域知识图**：由 schema 约束的 LLM 抽取产物——`node_types`（可带属性）、`relationship_types`（可带属性，如 `RULES {fromYear: INTEGER}`）、`patterns`（三元组），schema 可手写或由 `SchemaFromTextExtractor` 自动抽取。**后处理**：实体解析默认开启（`perform_entity_resolution=True`，合并"同 label 且同名"的节点），可选 spaCy 语义匹配或 RapidFuzz 模糊匹配。
- **是否需要训练**：❌ 不需要。LLM 只用于**抽取**与**生成回答**；README 写 "at least one is required for RAG and KG Builder Pipeline"——需要 LLM，但不是训练模型。**存在真正的无 LLM 检索路径**：README 用 "Retrievers: **when the Neo4j graph is already populated**" 分组列出 `VectorRetriever` / `HybridRetriever`，只依赖 embedder（可用本地 `sentence-transformers`）。例外是 `Text2CypherRetriever`（需 LLM 生成 Cypher）与 `GraphRAG`（需 LLM 生成答案）。可选 NLP 组件用的是**预训练** spaCy `en_core_web_sm`，不是自训模型。（[README](https://github.com/neo4j/neo4j-graphrag-python)）
- **许可证（包与数据库要分开看）**：
  - **`neo4j-graphrag-python` = Apache-2.0（主体）+ PSF-2.0（部分）**。`LICENSE.txt` 原文："Unless stated otherwise, this software is distributed under the terms of the **Apache License 2.0**. … Parts of this software is distributed under the terms of the **Python Software Foundation License Version 2**. The pieces of code covered by the PSF License are marked as such."（[LICENSE.txt](https://github.com/neo4j/neo4j-graphrag-python/blob/main/LICENSE.txt)）⚠️ GitHub API 对该仓显示 `spdx_id = "NOASSERTION"`，**不要误读成"无许可证"**——那是因为它不是单一标准许可文件。
  - **Neo4j Community Edition = GPLv3**。官方仓库 `README.asciidoc` 原文："**Neo4j Community Edition is an open source product licensed under GPLv3.**"（[README.asciidoc](https://github.com/neo4j/neo4j/blob/2026.07/README.asciidoc)）；根 `LICENSE.txt` 即 GNU GPL v3 全文（[LICENSE.txt](https://github.com/neo4j/neo4j/blob/dev/LICENSE.txt)；[GitHub API](https://api.github.com/repos/neo4j/neo4j) `spdx_id = "GPL-3.0"`）。
  - **Neo4j Enterprise Edition = 商业许可**，同一 README 原文："includes additional **closed-source components _not available in this repository_** and requires a commercial license from Neo4j or one of its affiliates." 旁证：Cognee 文档亦称 Neo4j 的 RBAC 与每用户库隔离"otherwise only available in the **Enterprise edition**"（[cognee graph-stores](https://docs.cognee.ai/setup-configuration/graph-stores.md)）。
- **能否纯本地**：✅ 可以。Neo4j Community 可自托管（Docker / Desktop，`bolt://localhost:7687`），无强制云服务。GraphRAG 包可用本地 embedder，`pip install "neo4j-graphrag[ollama]"` 走本地 Ollama。**Enterprise 专属能力（RBAC、多库隔离等）需付费。**
- **成熟度信号**：`neo4j-graphrag-python` = Python，1,286 stars，最新 release `1.19.0`（2026-08-26）；`neo4j/neo4j` = Java，17,226 stars。
- **对本项目的建议**：**网页 demo 阶段不要引入图数据库。** 单用户、一年约 1,825 次投递、量级至多数万个词条——一个 SQLite 表加两列（`term_a_id, term_b_id, score, kind`）完全够用，级联删除还能直接靠外键 `ON DELETE CASCADE` 满足"删干净"的约束。等到图上要跑多跳查询、或词条数到十万级，再考虑 Neo4j/FalkorDB。

### 2.3 横向对照

| 系统 | 数据模型 | 需要训练 | 许可证 | 纯本地 | 成熟度（2026-09-14） | 对本项目的关键问题 |
|---|---|---|---|---|---|---|
| mem0 | 自然语言记忆条目；**OSS 已无图** | ❌（需 LLM） | Apache-2.0（open-core） | ✅ 但 LLM **与 embedder 都要换** | Python，65,276★ | 没有"阈值汇集"层；README 与文档自相矛盾 |
| Graphiti | 时序图：4 节点 + 5 边 | ❌（需 LLM） | Apache-2.0 | ✅ 需自带图数据库 | Python，30,865★，v0.30.2 | **默认遥测**；需 Neo4j/FalkorDB |
| Zep（本体） | 闭源托管平台 | — | 商业托管（仓库≠产品） | ❌ | 4,914★ | **"Zep 开源"是过时说法** |
| Letta | MemFS：Markdown 文件 + git，路径即 label | ❌（官方明确不更新权重） | Apache-2.0（品牌资产除外） | ✅ 有官方 self-hosting 页 | TypeScript，3,337★(letta-code) | 整个 agent 运行时，过重；默认无向量索引 |
| Cognee | 三存储：关系+向量+图，DataPoint 为原子单位 | ❌（LLM 与 embedding 均强制） | Apache-2.0（open-core 迹象） | ✅ Kuzu 默认 + Ollama/Fastembed | Python，30,679★，v1.5.4 | Postgres 图存储为 demo，生产需商业授权 |
| LangMem | LangGraph store + namespace，无图 | ❌ | MIT | ⚠️ **官方本地说明未查到** | Python，1,664★，PyPI 0.0.30 | 值得抄模式，不值得引入；最不成熟 |
| neo4j-graphrag-python | 词法图 + schema 约束知识图 | ❌ | Apache-2.0 + PSF-2.0（部分） | ✅ 可自托管 | Python，1,286★，1.19.0 | demo 阶段属过度设计 |
| Neo4j Community / Enterprise | 属性图 | ❌ | GPLv3 / 商业许可（含闭源组件） | ✅ / Enterprise 能力付费 | Java，17,226★ | demo 阶段属过度设计 |

**共同的结论：八项里没有任何一项需要你训练模型。** 它们全都在运行时调用 LLM/embedding——**"训练"这个词在整张表里一次都没出现。**

---

## 三、是否必须训练：两条路线的对比

### 路线 A：预训练 embedding + 阈值/LLM 判定

**前置条件**：无。下载模型即可用。

- **embedding 模型候选**（模型卡信息均于 2026-09-14 从 HuggingFace 原始 README 读取）：

| 模型 | 维度 | 最大序列 | 许可证 | 参数/体积 | 多语言 | 来源 |
|---|---|---|---|---|---|---|
| BAAI/bge-m3 | 1024 | 8192 | **mit** | 参数计数**未查到**；`pytorch_model.bin` = 2,271.1 MB | "support more than 100 working languages" | [模型卡](https://huggingface.co/BAAI/bge-m3)、[文件体积](https://huggingface.co/api/models/BAAI/bge-m3?blobs=true) |
| nomic-ai/nomic-embed-text-v1.5 | 768（Matryoshka，可截 512/256/128/64） | 8192 | apache-2.0 | ≈137M | 模型卡 `language: en`，**标为英文** | [模型卡](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) |
| intfloat/multilingual-e5-large | 1024（24 层） | **512**（"Long texts will be truncated to at most 512 tokens."） | **mit** | ≈560M | 90+ 语种，列有 zh | [模型卡](https://huggingface.co/intfloat/multilingual-e5-large) |
| sentence-transformers/all-MiniLM-L6-v2 | 384 | 256（`sentence_bert_config.json`） | apache-2.0 | **22.7M** | `language: [en]` | [模型卡](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) |
| OpenAI text-embedding-3-small | 1536 | 8192 | 商业 API | — | 多语言 | [定价页](https://developers.openai.com/api/docs/pricing)、[Embeddings 指南](https://developers.openai.com/api/docs/guides/embeddings) |
| OpenAI text-embedding-3-large | 3072 | 8192 | 商业 API | — | 多语言 | 同上 |
| 阿里云百炼 text-embedding-v4 | 1024（默认；可选 2048/1536/768/512/256/128/64） | 8192 | 商业 API | — | 中文/多语言 | [百炼计费文档](https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio)、[API 文档](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api) |

  > **只有 bge-m3、multilingual-e5-large、text-embedding-v4 明确是中文/多语言可用**；nomic-embed-text 与 all-MiniLM-L6-v2 的模型卡都标注为英文，**不能想当然认为它们支持中文**。
  > **`multilingual-e5-large` 的最大序列长度只有 512 token**（远低于 bge-m3 的 8192）。词条通常是短句，512 够用；但如果你想把"整次投递"也编码进去，这个上限会截断。

- **成本**：见第四节。API 路线全年约 0.2–1 美元；本地路线现金成本 0。
- **结论**：**这条路今天就可行，且没有前置条件。**

### 路线 B：自己训练 / 微调模型

**前置条件（缺一不可）**：

1. **标注数据**。要做"两个词条是否语义相近"的监督训练，你至少需要几千到几万对**标注过**的词条对。YTwins 是单用户、无账号产品——你手上现在有 0 对。
2. **算力**。即使只是对比学习微调一个 100M~500M 参数的 encoder，也需要 GPU 小时。这是持续成本。
3. **工程流水线**。训练、评测、版本管理、回归测试。

**成本量级与现状**：

- 微调一个 embedding 模型**不是一次性工作**：你的词条分布会随使用漂移，模型要周期性重训。
- **一个直接的一手信号**：OpenAI 定价页在 Finetuning 一节写着："**OpenAI is winding down the fine-tuning platform. The platform is no longer accessible to new users**, but existing users of the fine-tuning platform will be able to create training jobs for the coming months."（[OpenAI 定价页](https://developers.openai.com/api/docs/pricing)，2026-09-14 查验）。连头部厂商都在收缩自建微调这条自助路径，对一个单人项目更不划算。
- **收益方向上也是负的**：预训练模型是在上亿句对上训练的（all-MiniLM-L6-v2 的模型卡明确写训练集 "Total 1,170,060,424" 句对）；你用几百条自造数据微调，几乎必然比原模型更差，除非你有远超这个量的高质量标注。

**结论**：**路线 B 现在不该做，而且大概率永远不该做。** 唯一可能让它变得合理的触发条件是：你已经积累了数千条**被用户真实纠正过**的链接判定记录（"这条连错了/这条该连但没连"），并且明确测出预训练模型在某一类中文概念上系统性失效。在那之前，训练是负收益。

### 补充：中文的必要澄清

"链接需要大数据训练"这个直觉，很可能来自"中文语义空间需要专门训练"的印象。事实是：**多语言预训练模型已经把这件事做完了**。bge-m3 是在多语言语料上统一微调（dense + sparse + colbert）来的，模型卡自述支持 100+ 语言（[BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)）。你要做的是**选一个多语言模型**（不是英文模型），而不是自己训一个。

---

## 四、成本估算

### 4.1 单价来源（USD / 1M tokens，2026-09-14 挂牌价）

**OpenAI**（[官方定价页](https://developers.openai.com/api/docs/pricing)）：

| 模型 | 输入 | 输出 |
|---|---|---|
| `gpt-5-nano` | $0.05 | $0.40 |
| `gpt-4.1-nano` | $0.10 | $0.40 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-5.6-luna` | $0.20 | $1.20 |
| `gpt-5-mini` | $0.25 | $2.00 |
| `text-embedding-3-small` | $0.02 | — |
| `text-embedding-3-large` | $0.13 | — |

Batch（异步半价）另有独立价目表，约为 Standard 的一半。

**DeepSeek**（[官方定价页](https://api-docs.deepseek.com/quick_start/pricing)）：

| | `deepseek-flash` | `deepseek-v4-pro` |
|---|---|---|
| 输入（cache miss，off-peak） | $0.15 | $0.66 |
| 输入（cache miss，peak） | $0.30 | $1.32 |
| 输出（off-peak） | $0.60 | $1.98 |
| 输出（peak） | $1.20 | $3.96 |

- Peak 时段为 UTC 周一至周五 01:00–04:00 与 06:00–10:00，其余时间 off-peak，**off-peak 是 peak 的一半**。
- ⚠️ **DeepSeek 文档中未出现 embedding 模型产品** → 若用 DeepSeek 做 LLM，embedding 需另配（本地 bge-m3 或别家 API）。
- ⚠️ **模型名已变**：`deepseek-chat` 与 `deepseek-reasoner` 在该定价页**已完全不出现**（英文/中文页全文检索均 0 命中），当前在售为 `deepseek-flash` 与 `deepseek-v4-pro`。旧资料里的模型名会误导。

**其他厂商（同样为 2026-09-14 一手页面）**：

| 厂商 / 模型 | 输入 | 输出 | 备注 |
|---|---|---|---|
| Anthropic **Claude Haiku 4.5** | $1.00 | $5.00 | [docs.claude.com 定价](https://docs.claude.com/en/docs/about-claude/pricing)。注意 `anthropic.com/pricing` 只有订阅价，无 API token 价 |
| 阿里云百炼 **qwen-flash**（0–256K） | $0.05 | $0.40 | [百炼计费文档](https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio)，Batch 5 折 |
| 阿里云百炼 **qwen-turbo** | $0.05 | $0.20 | 同上 |
| Google **gemini-embedding-2** | $0.20 | — | [Gemini 定价](https://ai.google.dev/gemini-api/docs/pricing)，Batch $0.10 |
| Voyage **voyage-4-lite** | $0.02 | — | [Voyage 定价](https://docs.voyageai.com/docs/pricing)，免费额度 200M tokens，Batch −33% |
| 阿里云百炼 **text-embedding-v4** | $0.07（国际站）/ 0.5 元（华北2 北京，每百万 token） | 不计费 | 按输入 token 计费，免费额度 100 万 token（90 天） |

未查到（官方页面当日不提供）：**Cohere Embed 的 per-token 单价**（该页只给 Model Vault 实例价 $4.00/小时 等）、**智谱 embedding-3 价格**（官方定价页为 JS 单页应用，无可解析价格文本；维度已查到）。

### 4.2 token 量换算依据

DeepSeek 官方文档给出一手换算比例：**"1 English character ≈ 0.3 token"、"1 Chinese character ≈ 0.6 token"**，并说明"由于各模型分词方式不同，比例会有差异，实际以 API 返回的 usage 为准"（[DeepSeek: Token & Token Usage](https://api-docs.deepseek.com/quick_start/token_usage)，2026-09-14 查验）。

本文全部估算**采用 1 汉字 = 0.6 token**，并据此计算。这个比例来自一手来源；但注意它绑定 DeepSeek 自己的 tokenizer，换成别的厂商会有偏差（见"未解决/存疑"）。

### 4.3 场景与假设

**场景**：单用户，每天 5 次投递，每次平均 200 字，持续一年。

| 项 | 算式 | 结果 |
|---|---|---|
| 年投递次数 | 5 × 365 | 1,825 次 |
| 年投递总字数 | 1,825 × 200 | 365,000 字 |
| 投递正文 token | 365,000 × 0.6 | 219,000 token |

**每次投递的链路假设**（每条都写明假设值，这些是工程取值不是实测值）：

| 环节 | 假设 | 年量 |
|---|---|---|
| ① 词条抽取（LLM）输入 | system prompt + schema 约 500 token + 正文 120 token = 620 | 1,131,500 in |
| ① 词条抽取（LLM）输出 | 约 150 token 的 JSON | 273,750 out |
| ② embedding | 正文 + 新词条，约 300 token | 547,500 |
| ③ 链接判定（LLM，**仅灰区触发**） | 50% 的投递触发 1 次，输入 400 / 输出 30 | 365,000 in / 27,375 out |
| ④ 阈值汇集答案（LLM） | 每月约 4 次触发，输入 1,500 / 输出 200 | 72,000 in / 9,600 out |

**年度合计**：

- LLM 输入 ≈ **1,568,500 token**（1.57 M）
- LLM 输出 ≈ **310,725 token**（0.31 M）
- Embedding 输入 ≈ **547,500 token**（0.55 M）

### 4.4 账本一：调 API（一年）

| 组合 | 算式 | 年成本 |
|---|---|---|
| `gpt-5-nano` + `text-embedding-3-small` | 1.5685×0.05 + 0.310725×0.40 + 0.5475×0.02 = 0.0784 + 0.1243 + 0.0110 | **≈ $0.21** |
| `gpt-4.1-nano` + `text-embedding-3-small` | 1.5685×0.10 + 0.310725×0.40 + 0.0110 | **≈ $0.29** |
| `gpt-5.6-luna` + `text-embedding-3-small` | 1.5685×0.20 + 0.310725×1.20 + 0.0110 | **≈ $0.70** |
| `gpt-5-mini` + `text-embedding-3-small` | 1.5685×0.25 + 0.310725×2.00 + 0.0110 | **≈ $1.02** |
| `deepseek-flash`（off-peak）+ 本地 embedding | 1.5685×0.15 + 0.310725×0.60 | **≈ $0.42** |
| `deepseek-flash`（peak）+ 本地 embedding | 1.5685×0.30 + 0.310725×1.20 | **≈ $0.84** |
| `deepseek-flash`（off-peak，cache 命中率高） | 输入 cache hit 低至 $0.003/M | **<$0.30** |

**量级判断：一年 $0.2 – $1.0。** 也就是「**不到 1 美元**」。折合人民币不到 10 元（此处汇率未取自一手来源，仅作量级示意）。用 Batch/off-peak 还能再减半。

即使把假设**放大 5 倍**（每天 25 次投递、或每次 1000 字），仍然是 **$1–5/年** 的量级。**成本完全不是这个项目的约束条件。**

### 4.5 账本二：纯本地（一年）

| 项 | 金额 |
|---|---|
| LLM 推理（生成式抽取/判定/汇集） | ¥0 现金 |
| Embedding 推理（bge-m3，CPU） | ¥0 现金 |
| 向量与图存储（SQLite） | ¥0 现金 |
| **现金合计** | **¥0**（只消耗电） |

**真正的成本是延迟和磁盘，不是钱。** 这里必须区分"能引用的数字"和"量级判断"：

**已核实的一手数字（磁盘 / 体积）：**

- `BAAI/bge-m3`：模型文件 `pytorch_model.bin` = **2,271.1 MB**（另有 `onnx/model.onnx_data` = 2,266.8 MB）。参数计数**未查到**（HF API 的 `safetensors.total` 为空）。架构上基于 XLM-RoBERTa-large（模型卡原文："extend the max_length of xlm-roberta to 8192"）。
- `intfloat/multilingual-e5-large`：**559,890,946 参数（≈560M）**。
- `sentence-transformers/all-MiniLM-L6-v2`：**22,713,728 参数（≈22.7M）**，6 层，hidden 384，max_seq_length 256。
- Ollama 上的生成式小模型（页面标注的磁盘体积）：`qwen3:4b` = 2.5GB、`llama3.2:3b` = 2.0GB、`gemma3:4b` = 3.3GB、`gemma3:1b` = 815MB（[ollama.com/library/qwen3](https://ollama.com/library/qwen3)、[llama3.2](https://ollama.com/library/llama3.2)、[gemma3](https://ollama.com/library/gemma3)）。

**只能作量级判断的部分（一手来源确实没有）：**

- **Embedding 延迟**：bge-m3 是约 5–6 亿参数级的 encoder，CPU 上单条短文本（200 字 ≈ 120 token）应在**毫秒到百毫秒**量级。**但 bge-m3 模型卡没有给 CPU 吞吐量。**
- **生成式延迟**：用本地 3B–4B Q4 模型在 CPU 上生成约 150 token 的 JSON，按每秒数个到十几个 token 计，**一次投递要等十几秒**。**但 Ollama 的模型页完全没有给 tokens/sec**（逐页检索 `tokens/s`、`tok/s`、`tokens per second`，0 命中），llama.cpp 官方基准讨论 [ggml-org/llama.cpp#4167](https://github.com/ggml-org/llama.cpp/discussions/4167) 给的是 **Apple Silicon（Metal GPU）** 的 LLaMA 7B 数字（M1 Pro / Q4_0：PP 232.55 t/s、TG 35.52 t/s），**属 GPU 数字，不能当作 CPU 结论引用**。
- **唯一可引用的 CPU 相关一手数字**是官方 SBERT 文档的对照表：`multi-qa-MiniLM-L6-cos-v1` 与 `msmarco-MiniLM-L6-cos-v5` 为 **18,000 queries/sec（GPU）/ 750 queries/sec（CPU）**；同页对 all-MiniLM-L6-v2 只给定性说法"is 5 times faster"（than all-mpnet-base-v2）（[sbert.net 预训练模型页](https://www.sbert.net/docs/sentence_transformer/pretrained_models.html)）。**注意这是约 22M 参数的 MiniLM，不是 560M 的 bge-m3，不能直接换算。**

⚠️ **因此"十几秒"与"毫秒到百毫秒"都是量级判断而非引用值**，必须在你自己的目标机器上实测（建议：拿 200 字中文投递跑 100 次，取 p50/p95）。这一点已列入文末"未解决/存疑"。

**工程上的消解办法**：把生成式抽取放进**后台队列**，投递先立即落库（"留档"本来就是全存原文，不依赖 LLM），词条抽取异步完成。这样用户体感不受影响，"纯本地"与"快"就不冲突了。另外**磁盘不是问题**：embedding 用 all-MiniLM-L6-v2 只要 ~90MB 级，用 bge-m3 是 2.3GB，加一个 2–3GB 的生成式模型，总共 5GB 以内。

### 4.6 两套账的对照结论

| | 调 API | 纯本地 |
|---|---|---|
| 现金/年 | $0.2–1.0 | ¥0 |
| 延迟 | 亚秒级 | 生成式环节十几秒（可异步化） |
| 隐私 | 原文出机器 | 完全不出机器 |
| 运维 | 需要 key 与网络 | 需要下载数 GB 模型 |
| 离线可用 | ❌ | ✅ |

$0.2/年 与"完全不出机器"之间的取舍，是本项目**唯一值得纠结的成本问题**——钱的维度可以直接划掉。

---

## 五、阈值触发汇集的既有模式

YTwins 的"当情绪/决策与足够多词条相连时汇集成答案"，在既有系统里有三个可以直接借鉴的模式。

### 5.1 Generative Agents：重要性累加触发 reflection（最贴近 YTwins 的原型）

这是与 YTwins 需求最接近的已发表架构。论文描述该架构"用自然语言存储 agent 完整经历记录，随时间**把这些记忆综合成更高层的 reflections**，并动态检索它们"，且消融实验证明 observation / planning / reflection 三者**每个都对行为可信度有决定性贡献**（[arXiv:2304.03442](https://arxiv.org/abs/2304.03442)）。

**关键在于它的触发条件是纯数值的，不需要训练。** 直接读源码：

- 每个记忆节点带一个 `importance`（poignancy）分数，由 LLM 打分（`generate_poig_score`）。
- hyper-parameter：`self.importance_trigger_max = 150`、`self.importance_trigger_curr = importance_trigger_max`。
- 触发判定（`reflection_trigger`）：**"Our current implementation checks for whether the sum of the new importance measure has reached the set (hyper-parameter) threshold."** 即当新记忆的重要性累加把计数器耗尽（`importance_trigger_curr <= 0`）且有内容时，就跑一次 reflection。
- 跑完 `reset_reflection_counter` 把计数器重置回 150。
- reflection 的产出方式（`run_reflect`）：先 `generate_focal_points` 生成 3 个焦点问题 → 对每个焦点 `new_retrieve` 取相关节点 → `generate_insights_and_evidence` 生成洞察**并附上支撑它的证据节点 id** → 作为新的 `thought` 节点写回记忆。

（以上均引自 [reflect.py 源码](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/reflect.py) 与 [scratch.py 源码](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/memory_structures/scratch.py)。）

同一文件里的其他可复用取值：`recency_w = 1`、`relevance_w = 1`、`importance_w = 1`（三者等权）、`recency_decay = 0.99`、`thought_count = 5`、`concept_forget = 100`。

**对 YTwins 的直接映射**：给每个词条一个 LLM 打的"情绪/决策相关度"分数，累加；跨过阈值就生成一句答案，**并把支撑它的词条 id 一起存下来**（这正是"追溯"能力需要的）。阈值 150 是它的取值，YTwins 需要按自己的投递频率重校准。

### 5.2 LangMem：token 预算阈值 + 防抖

- **阈值再总结**：`summarize_messages` 接受 `max_tokens_before_summary` —— 文档原话："**This is the token threshold at which summarization will kick in.**" 未达阈值就直接返回原消息；达到则返回 `[summary_message] + 剩余消息`。并用 `running_summary`（`RunningSummary`）避免每一轮都重复总结同样的内容（[LangMem: Summarization](https://langchain-ai.github.io/langmem/guides/summarization/)）。
- **防抖（debounce）**：`ReflectionExecutor` 用来延迟记忆处理。文档列出的问题是："每条消息都处理记忆"会带来**冗余工作、上下文中途处理导致信息不完整、不必要的 token 消耗**。做法是 `executor.submit(to_process, after_seconds=delay)`，**新消息到来时取消挂起的任务并用包含新消息的内容重新排期**，文档举例"实际中会选更长（30–60 分钟）"（[LangMem: Delayed Background Memory Processing](https://langchain-ai.github.io/langmem/guides/delayed_processing/)）。

**对 YTwins 的直接映射**：用户可能在几分钟内连丢好几条互为上下文的投递。**不要在每次投递后立刻判定阈值**，而是设一个"安静 30 分钟后"或"累积 N 条后"的触发窗口。这一条几乎零成本，能显著减少碎片化的错误汇集成句。

### 5.3 Letta：dreaming（把整合放到后台，按步数或上下文压缩触发）

Letta 文档的 "Dreaming" 一节原话：dreaming "使用**后台 subagent** 复核最近的对话，整合有用的经验，更新记忆，**而不打断你正在进行的工作**"；触发时机可配置为"**在完成一定数量的 agent step 之后**"或"**当上下文窗口被压缩时**"（[Letta Docs: Memory & dreaming](https://docs.letta.com/configuration/memory)）。它还提供一个可选档位：让 agent 在第二个后台会话里复核并修订待写入的记忆更新（代价是更多 token）。

**对 YTwins 的直接映射**：这印证了"**后台异步整合 + 事件触发（而非定时）**"是被主流实现采纳的模式。YTwins 的"阈值汇集"应该是一个后台过程，汇集结果以"通知/卡片"形式浮出来，而不是阻塞用户的下一次投递。

### 5.4 另外两个值得知道的对照

- **mem0 论文**给出的成本论据："Mem0 达到 **91% 更低的 p95 延迟**、节省**超过 90% 的 token 成本**"（对比把整个对话历史塞进上下文的全量做法）。这说明"抽取+整合成结构化记忆再检索"相对"每次喂全量原文"是压倒性的成本优势（[arXiv:2504.19413](https://arxiv.org/abs/2504.19413)）。
- **Graphiti/Zep** 走的是相反的设计哲学：**不做 LLM 摘要式整合，而是把事实失效但不删除**。README 明确列举其相对 GraphRAG 的优势包括"Contradiction Handling：**自动事实失效，同时保留时序历史**"，并称检索"不依赖 LLM 摘要"（[Graphiti README](https://github.com/getzep/graphiti)）。对 YTwins 的启示是：**"旧结论"不应该被新结论覆盖掉，而应该标记为被取代**——这与"原文全存 + 日后追溯"的产品约束高度一致，也意味着汇集答案需要留版本。

### 5.5 模式小结

| 模式 | 触发条件 | 出处 | YTwins 是否该用 |
|---|---|---|---|
| 重要性累加过阈值 | 数值阈值 | Generative Agents 源码 | ✅ **主模式** |
| token 预算阈值 + running summary | 数值阈值 | LangMem | ✅ 用于"追溯"问答的上下文裁剪 |
| 防抖（安静后/累积后） | 时间/条数 | LangMem | ✅ 强烈建议 |
| 事件触发后台整合 | agent step / 上下文压缩 | Letta | ✅ 异步化汇集 |
| 事实失效不删除 | 矛盾检测 | Graphiti | ✅ 汇集答案留版本 |

---

## 六、置信度与不确定表达

### 6.1 神经网络的置信度天然是失准的

Guo et al. (ICML 2017) 的核心发现：**"现代神经网络，与十年前的模型不同，是校准不良的（poorly calibrated）"**，并且"深度、宽度、weight decay 和 Batch Normalization 都是影响校准的重要因素"。他们给出的实用配方是 **temperature scaling**——"Platt Scaling 的单参数变体，在多数数据集上出乎意料地有效"（[arXiv:1706.04599](https://arxiv.org/abs/1706.04599)）。

**含义**：不要把 embedding 余弦相似度直接当成"置信度"用。0.82 的余弦不意味着 82% 的概率这两条该连。

### 6.2 让模型用自然语言说出置信度，是可行且校准良好的

- Lin, Hilton, Evans (2022)：证明 GPT-3 "可以学会用自然语言表达对自己答案的不确定性——**不使用模型 logits**"。模型同时生成答案和一个置信度（如 "90% confidence"），"这些等级映射到的概率是**良好校准的**"，且在分布偏移下"保持中等程度的校准"。这是**首次**有模型被证明能用自然语言表达对自己答案的校准不确定性。他们为此引入了 CalibratedMath 测试套件（[arXiv:2205.14334](https://arxiv.org/abs/2205.14334)）。
- Tian et al. (EMNLP 2023)：针对 RLHF 微调模型（ChatGPT、GPT-4、Claude）做广泛评估，结论是"**以输出 token 形式表达的 verbalized confidence，通常比模型的条件概率校准得更好**，在 TriviaQA、SciQ、TruthfulQA 上常常把 expected calibration error 相对降低 **50%**"（[arXiv:2305.14975](https://arxiv.org/abs/2305.14975)）。

**含义**：**让 LLM 自己输出一个置信度字段是当前最省事且被证明有效的做法。** YTwins 的汇集答案完全可以让模型顺手给出 `confidence: 0.7` 或 `"低"`。

### 6.3 不知道答案时应该能"知道自己不知道"

Kuhn, Gal, Farquhar (ICLR 2023 Spotlight) 提出 **semantic entropy**：因为"语义等价"的存在（不同句子可以表达同一意思），直接测自然语言的熵有困难，语义熵把这种语言不变性纳入进来。关键属性是"**该方法无需监督，只用单个模型，且不需要对现成语言模型做任何修改**"，并在消融实验中"比可比基线更能预测模型在问答数据集上的准确率"（[arXiv:2302.09664](https://arxiv.org/abs/2302.09664)）。

**含义**：如果你想让"汇总成答案"这件事有更强的拒答能力（阈值到了但证据其实很散），可以对同一批词条**采样多次生成、看结论是否语义一致**——不一致就降置信度。代价是多次 LLM 调用。**对 YTwins 而言这属于可选优化，不是 MVP 必需**。

### 6.4 措辞强弱的分级（YTwins 的产品设计，非引用）

上面的文献给的是"如何得到置信度"，以下是**把置信度映射到中文措辞**的产品设计建议（这一小节是我们的设计提案，不是一手来源的结论）：

| 置信度区间 | 建议措辞 | 触发条件（与链接证据挂钩） |
|---|---|---|
| 高 | 「你似乎……」「看起来你……」 | 支持词条多、彼此链接分高、时间跨度长、多次投递反复出现 |
| 中 | 「有一点像……」「会不会是……」 | 支持词条中等，或链接分处于灰区 |
| 低 | 「我不太确定，但有个猜测……」「这可能是我过度解读了」 | 支持词条刚过阈值、或链接分普遍偏低 |

**工程上的关键一条：措辞强弱必须绑定可解释的数值**（支持词条数 / 平均链接分 / 时间跨度），而不是让 LLM 自己"感觉"一个语气。这样才能在日后追溯时回答用户"你当时为什么这么说"。

### 6.5 校准怎么落地

- **短期（无需训练）**：直接采集 LLM 的 verbalized confidence，并把"答案 + 置信度 + 支撑词条 id"一起存下来。
- **中期（需要数据，不需要训练模型）**：等积累了足够多的"用户认可/否定了这个答案"的记录后，画一张可靠性图（reliability diagram）看 verbalized confidence 与实际正确率是否对齐；若系统性过于自信/过于保守，做一次**单调映射**即可——这就是 temperature scaling 的精神（[arXiv:1706.04599](https://arxiv.org/abs/1706.04599)），**它是后处理，不是训练模型**。

---

## 七、对本项目的含义与推荐路线

### 7.1 核心问题的最终回答

> 「词条之间的链接需要大数据训练得到，我不太清楚这个是否对项目实现有很大影响，成本是否会很高。」

**不需要训练，影响很小，成本极低。** "链接"= 预训练 embedding 的余弦相似度 + 阈值（外加"共同出现在同一次投递"这条零模型的硬规则）。embedding 模型（bge-m3 等）是别人用大数据训好的成品，你只是**使用者**。一年的 API 成本是 **$0.2–1.0**；纯本地是 **¥0**。这个决策对项目的影响，远小于"要不要为了隐私牺牲首字延迟"这个决策。

### 7.2 里程碑路线

**阶段一：网页 demo（现在）**

- ✅ 词条抽取：**云端一个便宜 LLM + JSON schema**（`gpt-5-nano` / `gpt-4.1-nano` / `deepseek-flash` 任一）。这是唯一能同时满足"保留原话 + 任意概念粒度 + 顺带抽情绪"的做法。
- ✅ 链接：**embedding 余弦 + 阈值**，先只做两条边类型：`语义相近`、`同次投递出现`。灰区可以暂时不判（宁可漏连），或调一次 LLM。
- ✅ 存储：**SQLite**。词条表、链接表（`ON DELETE CASCADE`）、原文表。**满足"级联删干净"**，且零运维。
- ✅ 阈值汇集：**照抄 Generative Agents 的形状**——给词条打分、累加、过阈值触发。异步执行。
- ❌ **现在就可以不做**：图数据库（Neo4j/FalkorDB）、mem0/Letta/Cognee 任一框架、semantic entropy、任何模型训练、任何置信度校准工作。
- ❌ **现在绝对不要做**：训练或微调任何模型。

**阶段二：MVP（demo 验证后）**

- 把 LLM/embedding **换成可切换的 provider 层**（本地 Ollama 与云端 API 都留口子）。Graphiti 的 `OpenAIGenericClient` 模式说明了这条路是通的：本地服务用 OpenAI 兼容端点接入即可。
- **引入 LangMem 的两个模式**：阈值防抖（安静 30 分钟后/累积 N 条后）+ running summary。
- **引入 Graphiti 的一个模式**：汇集答案**失效但不删除**，留版本。这直接服务"日后追溯"。
- 开始记录**用户对汇集答案的认可/否定**——这是未来一切校准与（如果真的需要）训练的**唯一燃料**。
- 若要上纯本地：先在目标机器上**实测** CPU 上 200 字投递的端到端耗时，再决定生成式环节是否只跑在后台队列。

**阶段三：只有当以下条件**全部**成立时，才考虑升级**

1. 词条规模进入十万级，且确实需要多跳图查询 → 引入 Neo4j Community（注意 GPLv3）或 FalkorDB。
2. 有数千条被用户真实纠正的链接判定记录，且**已测量出**预训练模型在某类中文概念上系统性失效 → 才谈微调。
3. 需要离线且不能接受云端 → 把 embedding 本地化，生成式环节本地化 + 异步。

**注意第 2 条的触发条件极其苛刻**——它大概不会发生。

### 7.3 明确说清"现在就可以不做"的部分

- 不要训练、不要微调任何模型。
- 不要引入图数据库（SQLite 足够）。
- 不要引入任何 agent 记忆框架（mem0 / Letta / Cognee / LangMem 全都不必装）——**值得借鉴的是它们的模式，不是代码**。
- 不要做置信度校准（先攒数据）。
- 不要做 semantic entropy 多次采样。
- 不要担心成本（$1/年 量级）。

---

## 来源清单

| 来源 | 类型 | 链接 | 用在哪一节 |
|---|---|---|---|
| OpenAI Structured Outputs 官方文档 | 一手 | https://developers.openai.com/api/docs/guides/structured-outputs | 1.1 |
| OpenAI 官方定价页 | 一手 | https://developers.openai.com/api/docs/pricing | 4.1 / 4.4 / 三（微调收缩） |
| DeepSeek Models & Pricing | 一手 | https://api-docs.deepseek.com/quick_start/pricing | 1.1 / 4.1 / 4.4 |
| DeepSeek Token & Token Usage | 一手 | https://api-docs.deepseek.com/quick_start/token_usage | 4.2 |
| DeepSeek JSON Output 文档 | 一手 | https://api-docs.deepseek.com/guides/json_mode | 1.1 |
| DeepSeek Tool Calls 文档 | 一手 | https://api-docs.deepseek.com/guides/tool_calls | 1.1 |
| INESCTEC/yake README | 一手（源码仓库） | https://github.com/INESCTEC/yake | 1.2 |
| MaartenGr/KeyBERT README | 一手（源码仓库） | https://github.com/MaartenGr/KeyBERT | 1.2 / 2.1 |
| shibing624/bert4ner-base-chinese 模型卡 | 一手（模型卡） | https://huggingface.co/shibing624/bert4ner-base-chinese | 1.3 |
| BAAI/bge-m3 模型卡 | 一手（模型卡） | https://huggingface.co/BAAI/bge-m3 | 1.5 / 2.1 / 三 / 4.5 |
| nomic-ai/nomic-embed-text-v1.5 模型卡 | 一手（模型卡） | https://huggingface.co/nomic-ai/nomic-embed-text-v1.5 | 三 |
| intfloat/multilingual-e5-large 模型卡 | 一手（模型卡） | https://huggingface.co/intfloat/multilingual-e5-large | 三 |
| sentence-transformers/all-MiniLM-L6-v2 模型卡 | 一手（模型卡） | https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 | 三 |
| mem0 README | 一手（源码仓库） | https://github.com/mem0ai/mem0 | 2.2 |
| Mem0 论文 arXiv:2504.19413 | 一手（论文） | https://arxiv.org/abs/2504.19413 | 2.2 / 5.4 |
| Graphiti README | 一手（源码仓库） | https://github.com/getzep/graphiti | 1.1 / 2.2 / 5.4 |
| Graphiti LICENSE（Apache-2.0） | 一手（许可证原文） | https://github.com/getzep/graphiti/blob/main/LICENSE | 2.2 |
| Zep 论文 arXiv:2501.13956 | 一手（论文） | https://arxiv.org/abs/2501.13956 | 2.2 |
| Letta Docs: Memory & dreaming | 一手（官方文档） | https://docs.letta.com/configuration/memory | 2.2 / 5.3 |
| letta-ai/letta-code LICENSE（Apache-2.0 + 品牌资产除外） | 一手（许可证原文） | https://github.com/letta-ai/letta-code/blob/main/LICENSE | 2.2 |
| Letta README（仓库迁移说明） | 一手（源码仓库） | https://github.com/letta-ai/letta-code | 2.2 |
| cognee README | 一手（源码仓库） | https://github.com/topoteretes/cognee | 2.2 |
| cognee LICENSE（Apache-2.0） | 一手（许可证原文） | https://github.com/topoteretes/cognee/blob/main/LICENSE | 2.2 |
| LangMem README | 一手（源码仓库） | https://github.com/langchain-ai/langmem | 2.2 |
| LangMem LICENSE（MIT） | 一手（许可证原文） | https://github.com/langchain-ai/langmem/blob/main/LICENSE | 2.2 |
| LangMem: Summarization | 一手（官方文档） | https://langchain-ai.github.io/langmem/guides/summarization/ | 5.2 |
| LangMem: Delayed Background Memory Processing | 一手（官方文档） | https://langchain-ai.github.io/langmem/guides/delayed_processing/ | 2.2 / 5.2 |
| neo4j/neo4j LICENSE.txt（GPLv3） | 一手（许可证原文） | https://github.com/neo4j/neo4j/blob/dev/LICENSE.txt | 2.2 |
| Neo4j 官方许可页 | 一手 | https://neo4j.com/licensing/ | 2.2 |
| Generative Agents 论文 arXiv:2304.03442 | 一手（论文） | https://arxiv.org/abs/2304.03442 | 5.1 |
| Generative Agents reflect.py 源码 | 一手（源码） | https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/reflect.py | 5.1 |
| Generative Agents scratch.py 源码（importance_trigger_max=150） | 一手（源码） | https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/memory_structures/scratch.py | 5.1 |
| Guo et al., On Calibration of Modern Neural Networks, ICML 2017 | 一手（论文） | https://arxiv.org/abs/1706.04599 | 6.1 / 6.5 |
| Lin, Hilton, Evans, Teaching Models to Express Their Uncertainty in Words | 一手（论文） | https://arxiv.org/abs/2205.14334 | 6.2 |
| Tian et al., Just Ask for Calibration, EMNLP 2023 | 一手（论文） | https://arxiv.org/abs/2305.14975 | 6.2 |
| Kuhn, Gal, Farquhar, Semantic Uncertainty, ICLR 2023 | 一手（论文） | https://arxiv.org/abs/2302.09664 | 6.3 |
| Neo4j 许可页搜索摘要（Community Edition = GPL v3） | 二手（仅作旁证） | https://neo4j.com/licensing/?ref=web-open-core | 2.2（主证为 LICENSE.txt） |
| Zep 仓库 README（声明"不是 Zep 产品/服务"） | 一手（源码仓库） | https://github.com/getzep/zep | 2.2 |
| Graphiti 源码 `nodes.py` / `edges.py` | 一手（源码） | https://github.com/getzep/graphiti/blob/main/graphiti_core/nodes.py ；https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py | 2.2 |
| Graphiti "Adding Fact Triples" 文档 | 一手（官方文档） | https://help.getzep.com/graphiti/working-with-data/adding-fact-triples.md | 2.2 |
| Letta MemFS 文档（Markdown+git，路径即 label） | 一手（官方文档） | https://docs.letta.com/concepts/memfs/index.md | 2.2 |
| Letta self-hosting 文档（`--backend local`，无需账号） | 一手（官方文档） | https://docs.letta.com/self-hosting/index.md | 2.2 |
| Letta `llms.txt`（"rather than by updating model weights"） | 一手（官方文档） | https://docs.letta.com/llms.txt | 2.2 / 三 |
| mem0 文档：add 操作（ADD/UPDATE/DELETE 表述） | 一手（官方文档） | https://docs.mem0.ai/core-concepts/memory-operations/add.md | 2.2 / 未解决 |
| mem0 文档：Platform vs OSS（图记忆不在 OSS） | 一手（官方文档） | https://docs.mem0.ai/platform/platform-vs-oss.md | 2.2 |
| mem0 文档：Graph Memory（无 typed relations） | 一手（官方文档） | https://docs.mem0.ai/platform/features/graph-memory.md | 2.2 |
| mem0 文档：OSS 配置 / Ollama LLM 页 | 一手（官方文档） | https://docs.mem0.ai/open-source/configuration.md ；https://docs.mem0.ai/components/llms/models/ollama.md | 2.2 |
| cognee 文档：架构 / DataPoint / LLM providers / graph stores | 一手（官方文档） | https://docs.cognee.ai/core-concepts/architecture.md ；https://docs.cognee.ai/core-concepts/building-blocks/datapoints.md ；https://docs.cognee.ai/setup-configuration/llm-providers.md ；https://docs.cognee.ai/setup-configuration/graph-stores.md | 2.2 |
| LangMem Core Concepts | 一手（官方文档） | https://langchain-ai.github.io/langmem/concepts/conceptual_guide/ | 2.2 |
| LangMem on PyPI（版本 0.0.30 / MIT） | 一手（包元数据） | https://pypi.org/pypi/langmem/json | 2.2 |
| neo4j-graphrag-python README 与 LICENSE.txt | 一手（源码仓库） | https://github.com/neo4j/neo4j-graphrag-python ；https://github.com/neo4j/neo4j-graphrag-python/blob/main/LICENSE.txt | 2.2 |
| Neo4j KG Builder 官方指南（词法图 + schema 图） | 一手（官方文档） | https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_kg_builder.html | 2.2 |
| Neo4j `README.asciidoc` Licensing 节（Community=GPLv3 / Enterprise=商业） | 一手（源码仓库） | https://github.com/neo4j/neo4j/blob/2026.07/README.asciidoc | 2.2 |
| GitHub API（star 数 / spdx 许可证标识） | 一手（API） | https://api.github.com/repos/mem0ai/mem0 ；https://api.github.com/repos/getzep/graphiti ；https://api.github.com/repos/topoteretes/cognee ；https://api.github.com/repos/langchain-ai/langmem ；https://api.github.com/repos/letta-ai/letta-code ；https://api.github.com/repos/neo4j/neo4j | 2.2 |
| OpenAI Embeddings 指南（维度 1536 / 3072） | 一手 | https://developers.openai.com/api/docs/guides/embeddings | 三 / 4.1 |
| Anthropic 官方 API 定价 | 一手 | https://docs.claude.com/en/docs/about-claude/pricing | 4.1 |
| Google Gemini API 定价 / Embeddings 文档 | 一手 | https://ai.google.dev/gemini-api/docs/pricing ；https://ai.google.dev/gemini-api/docs/embeddings | 4.1 |
| Voyage AI 定价 / Embeddings 文档 | 一手 | https://docs.voyageai.com/docs/pricing ；https://docs.voyageai.com/docs/embeddings | 4.1 |
| 阿里云百炼计费文档（国际站 USD / 国内站 CNY） | 一手 | https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio ；https://help.aliyun.com/zh/model-studio/billing-for-model-studio | 4.1 / 三 |
| 阿里云百炼 text-embedding 同步 API（维度取值） | 一手 | https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api | 三 |
| DeepSeek 中文定价页 | 一手 | https://api-docs.deepseek.com/zh-cn/quick_start/pricing | 4.1 |
| HuggingFace API（模型参数量 / 文件体积） | 一手（API） | https://huggingface.co/api/models/BAAI/bge-m3?blobs=true ；https://huggingface.co/api/models/sentence-transformers/all-MiniLM-L6-v2 ；https://huggingface.co/api/models/intfloat/multilingual-e5-large | 4.5 / 三 |
| SBERT 官方预训练模型页（GPU/CPU queries per sec） | 一手（官方文档） | https://www.sbert.net/docs/sentence_transformer/pretrained_models.html | 4.5 |
| Ollama 模型库页（磁盘体积 / 上下文） | 一手 | https://ollama.com/library/qwen3 ；https://ollama.com/library/llama3.2 ；https://ollama.com/library/gemma3 | 4.5 |
| llama.cpp 官方基准讨论（Apple Silicon，非 CPU） | 一手（源码仓库讨论） | https://github.com/ggml-org/llama.cpp/discussions/4167 | 4.5（用于说明"没有 CPU 数字"） |
| Cohere / 智谱定价页（查证"价格未公布"） | 一手（页面本身） | https://cohere.com/pricing ；https://open.bigmodel.cn/pricing | 4.1（用于记录未查到） |

---

## 未解决 / 存疑

1. **CPU 推理速度只有半个一手来源。** 第 4.5 节的"毫秒到百毫秒""十几秒"是**量级判断，不是引用值**。已核实的边界是：① bge-m3 / nomic-embed-text / multilingual-e5 / all-MiniLM 的模型卡**都没有给 CPU 吞吐量**；② Ollama 的模型页**一个 tokens/sec 数字都没有**；③ llama.cpp 官方基准讨论里的是 **Apple Silicon GPU** 数字，不能当 CPU 用；④ 唯一可引用的 CPU 数字是 SBERT 官方页上 **22M 参数的 MiniLM 变体 = 750 queries/sec（CPU）**，与 560M 参数的 bge-m3 不同量级，不能直接换算。**完整结论：必须在你自己的目标机器上实测**（方法：拿 200 字中文投递跑 100 次，取 p50/p95，embedding 与生成式分别测）。
2. **"1 汉字 ≈ 0.6 token" 绑定 DeepSeek 自己的 tokenizer。** 这是 DeepSeek 官方文档的一手比例，但如果 YTwins 改用 OpenAI 或本地 BGE 的 tokenizer，实际 token 数会有偏差（BGE 系列用 XLM-RoBERTa 的 sentencepiece，对中文通常接近 1 字 1 token，意味着按下限估算的 embedding 量可能偏低约 40%）。由于结论是"$1/年 量级"，这个偏差不影响任何决策。
3. **mem0 的 README 与官方文档互相矛盾（同一项目、两套说法）。** README 说当前算法是 "**Single-pass ADD-only extraction — one LLM call, no UPDATE/DELETE. Memories accumulate; nothing is overwritten.**"；而文档站写的是 `infer=True`（默认）时"一次 LLM 调用决定每条 fact 的 **ADD/UPDATE/DELETE**"（[add 操作文档](https://docs.mem0.ai/core-concepts/memory-operations/add.md)）。更早的论文（[arXiv:2504.19413](https://arxiv.org/abs/2504.19413)，2025-04）又把更新描述为"动态抽取、**整合**"。**三代文档三种说法。** README 还自述"分数反映的是 Mem0 托管平台，包含开源 SDK 中不提供的专有优化；开源用户应预期方向类似的收益但不是相同数字"。**若考虑 mem0：不要指望开源版复现其 benchmark 数字，且必须先定下以哪份文档为准。**
4. **四个系统的"完全无 LLM 模式"均未查到**：mem0、Graphiti、Letta、Cognee。Graphiti 有一个**有限**的手动路径（`add_triplet` 直接写节点/边），neo4j-graphrag-python 有**真正的**无 LLM 检索路径（图已建好后用 `VectorRetriever` / `HybridRetriever`）。若"纯本地无模型"是硬约束，Neo4j GraphRAG 是唯一能给出肯定答案的。
5. **LangMem 的官方"本地/离线运行"说明页未查到。** 只有 API-key 的 provider 示例，没有 Ollama/离线章节。能确认的只有"存储可完全本地（InMemoryStore / AsyncPostgresStore）"与"模型经 LangChain `provider:model` 抽象注入"两条。**"LangMem 能指向本地 LLM"目前缺一手文档支撑，本文未作为已证实结论。** 另：该仓**没有 GitHub Release**（`/releases/latest` 返回 404），PyPI 最新版本仍是 `0.0.30`（2025-10-27）——八个系统里最不成熟的一个。
6. **部分厂商价格确实查不到，非疏漏**：**Cohere Embed 的 per-token 单价**（[cohere.com/pricing](https://cohere.com/pricing) 当日只公布 Model Vault 实例价 $4.00/小时 或 $2,500/月，不再公布 embed token 价）；**智谱 embedding-3 价格**（官方定价页 [open.bigmodel.cn/pricing](https://open.bigmodel.cn/pricing) 是 JS 单页应用，抓到的正文仅 127 字符，无任何价格文本；其维度已查到）。另有 **Google `text-embedding-004` 已从定价页消失**（未查到）。**`gemini-embedding-001` 的 $0.15/1M 存在渲染差异**：该价格取自同一 URL 的本地化渲染（金额仍标 USD），英文渲染页当日只列 `gemini-embedding-2`；引用时须注明。
7. **厂商模型名与整条产品线都在快速变动，旧认知会直接误导**（本次实测到三处）：
   - DeepSeek 定价页上 `deepseek-chat` / `deepseek-reasoner` **已完全不出现**，现为 `deepseek-flash` / `deepseek-v4-pro`。
   - **Letta 主线已换仓到 `letta-ai/letta-code`（TypeScript）**，`letta-ai/letta` 顶层已无源码（GitHub API 返回 `"language": null`）。任何把它描述成"Python MemGPT 服务器"的资料都已过时。
   - **`getzep/zep` 仓库已不是 Zep 产品**（README 原文："This repository is **not** Zep's product or service"），开源社区版移入 `legacy/` 并标注 "Deprecated … (unsupported)"。**"Zep 是开源的"这一说法现在不成立**，开源侧只剩 Graphiti。
   - OpenAI 定价页同时显示 Finetuning 平台正在收缩，且页面上出现了 `gpt-6-astra`、`gpt-5.6-*` 等新模型名。
8. **Graphiti 的遥测默认开启**（必须显式设 `GRAPHITI_TELEMETRY_ENABLED=false`）。README 承诺不收集图内容与查询，但对"纯本地、无账号"的产品约束而言，这是需要显式处理的一项，**不是默认安全的**。
9. **Neo4j 的许可证依据不是 neo4j.com 页面原文。** `https://neo4j.com/licensing/` 会 302 到 `/legal-terms/`，抓取只得导航壳，拿不到正文。本文引用的两句（Community = GPLv3；Enterprise 含闭源组件、需商业许可）出自 **Neo4j 官方 GitHub 组织自己的仓库 `README.asciidoc`**（一手，可信度足够），但**不是官网页面逐字表述**。
10. **YTwins 自己的关键参数缺一手依据**：阈值取多少、灰区边界取多少、importance 分数怎么打——Generative Agents 的 `importance_trigger_max = 150` 是它的取值，与投递频率强相关，**不能直接照搬到 YTwins**。这些只能靠真实使用数据校准，没有可引用的现成答案。
11. **memory 框架的 benchmark 数字不能横向比较。** mem0（LoCoMo 92.5 / LongMemEval 94.4）、Zep（DMR 94.8% vs MemGPT 93.4%）、Cognee（BEAM 100K 0.79 / 10M 0.67）各自用不同数据集、不同 LLM、不同检索预算**自报**成绩，且 mem0 明确说数字来自托管平台。**本文因此没有把它们排成一张"谁更强"的表**——那样做会是错的。
