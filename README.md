# 晨光知识库 / DawnKB

> 一个把 Obsidian、深度阅读、知识关系与内容复盘连在一起的本地知识工作台

---

## 项目简介

将知识获取、阅读消化、选题策划、评论洞察、数据复盘全链路工具整合到一个网页工作台。

**首版 MVP 链路**：导入文章 → 阅读 → 高亮/笔记 → AI 理解 → 人工确认入库 Obsidian → 搜索复用

**核心差异化**：
1. 阅读器 + AI 一体化体验：选中后可理解、笔记、高亮或入库，AI 回答可保存为笔记
2. 知识图谱可视化：从"文件列表"升级为"关系网络"
3. 评论 → 选题闭环：从用户反馈中发现创作方向
4. 每日精读：信息过载时代的"帮你选好"
5. 数据聚合：各平台数据集中展示

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16.3.0 | 前端 + API（App Router） |
| React | 19.2 | |
| Tailwind CSS | v4 | 暗色主题设计系统 |
| Prisma | 7.9.1 | ORM（adapter 模式） |
| PostgreSQL | 17 | 数据库（Orbstack 容器） |
| Zustand | 5.x | 状态管理 |
| AI SDK | 7.x | 流式 AI 输出 |
| Ollama | — | 本地 AI 模型（可选） |

---

## 快速启动

### 前置要求

- **Node.js** ≥ 18（推荐 20+）
- **Orbstack**（或 Docker）— 用于跑 PostgreSQL
- **Ollama**（可选，AI 功能需要）— [安装](https://ollama.com)

### 1. 启动 PostgreSQL

```bash
docker run -d --name workbench-postgres \
  -e POSTGRES_USER=workbench \
  -e POSTGRES_PASSWORD=workbench \
  -e POSTGRES_DB=workbench \
  -p 5433:5432 \
  -v workbench-pg-data:/var/lib/postgresql/data \
  postgres:17-alpine
```

### 2. 配置环境变量

```bash
cp .env.example .env
# .env 内容已预置，按需修改
```

关键变量：
- `DATABASE_URL` — PostgreSQL 连接串（默认 `localhost:5433`）
- `OPENAI_API_KEY` — 可选，配置则用云端 AI，否则用本地 Ollama
- `OLLAMA_HOST` — 本地 Ollama 地址（默认 `http://localhost:11434`）
- `OBSIDIAN_VAULT_PATH` — 本地 Obsidian Vault 绝对路径；配置后服务器启动即做差异同步，保存 `.md` 后约 0.5 秒增量更新

### 3. 安装依赖 + 初始化数据库

```bash
npm install
npm run db:generate    # 生成 Prisma Client
npm run db:migrate     # 创建数据库表
npm run db:seed        # 种子数据（示例文章 + 知识节点）
```

### 4. 启动 Ollama（可选，AI 功能需要）

```bash
ollama pull qwen2.5:7b
ollama serve
```

### 5. 启动开发服务器

```bash
npm run dev
```

浏览器打开 `http://localhost:3000`，自动跳转到工作台大屏。

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（localhost:3000） |
| `npm run build` | 生产构建 |
| `npm run db:migrate` | 数据库迁移 |
| `npm run db:generate` | 生成 Prisma Client |
| `npm run db:seed` | 种子数据 |
| `npm run db:studio` | Prisma Studio（数据库可视化管理） |
| `npm run obsidian:sync` | 手动执行一次 Obsidian 全量差异同步 |
| `npm run lint` | ESLint 检查 |

---

## 目录结构

```
personal_workbench/
├── docs/
│   ├── design-document.md       ← 完整设计方案
│   ├── frontend-styling.md     ← 前端样式规范
│   └── implementation-plan.md  ← 分阶段落地计划（含验收标准）
├── prisma/
│   ├── schema.prisma            ← 数据库 Schema
│   └── migrations/             ← 迁移文件
├── prisma.config.ts            ← Prisma 7 配置
├── src/
│   ├── app/                     ← Next.js App Router
│   │   ├── layout.tsx          ← 根布局
│   │   ├── globals.css         ← DawnKB 设计系统与跨页面转场
│   │   ├── dashboard/          ← 工作台大屏
│   │   ├── reading/            ← 阅读器（列表/新建/详情）
│   │   ├── daily/              ← 每日精读
│   │   ├── comments/           ← 评论区
│   │   ├── data/               ← 数据看板
│   │   ├── settings/           ← 设置
│   │   └── api/                ← API Routes
│   │       ├── ai/             ← AI API（explain/translate/summarize）
│   │       ├── articles/       ← 文章 CRUD
│   │       ├── highlights/     ← 高亮 CRUD
│   │       └── notes/          ← 笔记 CRUD
│   ├── components/
│   │   ├── layout/             ← 侧边栏
│   │   └── reading/            ← 阅读器组件（Reader/AnnotationDesk/HighlightToolbar）
│   └── lib/
│       ├── prisma.ts           ← Prisma 客户端
│       ├── ai.ts               ← AI 工具函数
│       ├── obsidian-sync.ts    ← Obsidian 差异同步核心
│       ├── obsidian-vault.ts   ← 真实目录浏览与安全路径约束
│       ├── vault-watcher.ts    ← Vault 实时监听与状态
│       ├── utils.ts            ← 通用工具
│       └── seed.ts             ← 种子数据
├── .env / .env.example
└── package.json
```

---

## 文档入口

- [设计方案](docs/design-document.md) — 功能、技术选型、数据库、AI、部署
- [落地计划](docs/implementation-plan.md) — 分阶段进度、MVP 范围、验收标准
- [前端样式](docs/frontend-styling.md) — 色彩、排版、组件、动画

---

## 部署架构

纯本地部署，不做 Vercel：

```
浏览器 → Next.js (localhost:3000) → PostgreSQL (Orbstack :5433)
                                  → Ollama (localhost:11434，可选)
                                  → Obsidian Vault（启动校准 + 保存时增量同步）
```

阅读器“入库”会在选定的现有 Vault 目录中新建 Markdown，并立即触发该文件的增量同步；不会覆盖同名文件。直接在 Obsidian 中保存 `.md` 时，由服务端 watcher 在文件稳定约 500ms 后更新 DawnKB。未运行 DawnKB 服务时，下一次启动校准或手动执行 `npm run obsidian:sync` 会补齐变化。

详见 [设计方案 §8](docs/design-document.md#8-部署架构)。
