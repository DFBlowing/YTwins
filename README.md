# YTwins

> **your twins** —— 一个**无感**的 AI 陪伴：你把日程、灵感、情绪随口丢进来，它接住，
> 在你看不见的地方把碎片沉淀成小结论，攒够了才在特定时刻以不确定的语气浮出来一句。

**当前状态：早期。** 

## 这是什么

一句话：**它一直记得你，而不是随时陪你聊。**

- 不用分类、不用打标签、不用填时间 —— 页面上只有一个框。
- 不存对话、不主动弹通知、不给你打分，也不要你点赞。
- 它说的每一句都是**判断**而不是**事实**，所以措辞永远带不确定（「你似乎…」）。

**它不是**：聊天助手、待办清单、情感陪伴机器人、笔记软件。

领域词表（无感、陪伴、投递、词条、小结论、浮现……）在 [`CONTEXT.md`](./CONTEXT.md) ——
**读代码之前先看它**，本仓库的术语以那一份为准。

## 快速开始

需要 **Node 22.18 以上**。

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run build:web
npm run server
```

浏览器打开 **http://127.0.0.1:5273/** —— 这个服务只在本机可见，同一局域网里别人打不开。

`.env` 里只填两行：选哪家模型（预设）+ 这一家的 key。**换一家 = 改这两行 + 重启服务**，
调用路径不用动。预设表在 [`.env.example`](./.env.example) 里。

## 文档

| 我想…… | 看这里 |
|---|---|
| **会用这个产品**：怎么起、怎么用、怎么换模型、出问题怎么调、参数表、数据在哪 | **[`projects/YTwins-使用手册.md`](./projects/YTwins-使用手册.md)** |
| 弄清每个词到底什么意思 | [`CONTEXT.md`](./CONTEXT.md) |
| 看完整需求（当初怎么定的） | [`.scratch/ytwins/spec.md`](./.scratch/ytwins/spec.md) |
| 看做到哪了、下一步做什么 | [`.scratch/ytwins/NEXT.md`](./.scratch/ytwins/NEXT.md) |
| 跑一遍演示、台下问题怎么答 | [`docs/ytwins/demo-script.md`](./docs/ytwins/demo-script.md) |
| 明白什么文件该放哪儿 | [`docs/agents/workspace-layout.md`](./docs/agents/workspace-layout.md) |

> English counterpart: [`README.en.md`](./README.en.md)。其余文档中文优先，本仓库的语言策略见
> [`AGENTS.md`](./AGENTS.md)。

## 常用命令

| 命令 | 做什么 |
|---|---|
| `npm run server` | 起本机服务（产品本体） |
| `npm run build:web` | 构建网页 —— 改过页面就要重跑，否则页面打不开 |
| `npm run smoke` | 用真实 `.env` 打一遍模型和 embedding，验证接线 |
| `npm test` | 领域逻辑测试 |
| `npm run typecheck` | 类型检查 |
| `npm run check` | 检查目录布局有没有跑偏 |

## 数据与隐私

`data/` 与 `.env` **都不进 git**，只属于跑它的那台机器。

| 路径 | 是什么 |
|---|---|
| `data/ytwins.sqlite` | 你丢进去的全部内容 |
| `data/models/` | 本地 embedding 模型缓存（约 120 MB，第一次用会联网下载） |
| `.env` | 你的 key 与配置 —— 别外传 |

想确认「哪些数据会离开这台机器」，看产品页面上同名的那一节 —— 它由**服务端按本机实际接线**读出来，
不写死文案。用本机模型（Ollama 一类）时，你的话不出这台机器。

## 许可

个人项目，尚未选定许可证。
