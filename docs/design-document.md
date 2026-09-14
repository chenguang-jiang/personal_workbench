# 自媒体创作者工作台 — 完整设计方案

> 版本：v1.1 | 日期：2026-08-04 | 修订：锁定技术版本、本地部署、补 UI/UX 章节

---

## 目录

1. [项目概述](#1-项目概述)
2. [核心功能模块](#2-核心功能模块)
3. [页面架构与路由](#3-页面架构与路由)
4. [UI/UX 设计](#4-uiux-设计)
5. [技术选型](#5-技术选型)
6. [数据库设计](#6-数据库设计)
7. [AI 集成方案](#7-ai-集成方案)
8. [部署架构](#8-部署架构)

---

## 1. 项目概述

### 1.1 定位

**自媒体创作者的一体化工作台**——把知识获取、阅读消化、选题策划、评论洞察、数据复盘全链路的工具整合到一个网页中。

### 1.2 首版 MVP

只跑通一条完整链路：

> **导入文章 → 阅读 → 高亮/笔记 → AI 解释 → 自动进入素材库 → 搜索复用**

知识图谱、评论采集、跨平台数据看板先保留页面骨架，验证核心阅读闭环后再做。

### 1.3 目标用户

- 自媒体创作者（B站、抖音、公众号、小红书等）
- 内容运营人员
- 知识工作者（需要大量阅读-整理-输出的人）

---

## 2. 核心功能模块

### 2.1 内容概览大屏（Dashboard）

**功能**：总数据概览、最近更新、热门内容、待处理事项

### 2.2 知识图谱（Knowledge Graph）

**功能**：力导向图可视化知识节点、节点可点击查看详情

### 2.3 素材库/知识库（Material Library）

**功能**：所有内容输入的集中地（文章、笔记、概念、素材），支持筛选、搜索、标签分类

**文件夹浏览**：读取 `OBSIDIAN_VAULT_PATH` 下的真实目录与 Markdown 文件，支持面包屑逐级进入；已有 Vault 结构是唯一分类来源，不使用前端固定分类代替目录。

### 2.4 文章阅读器（Reader）—— ⭐ 核心功能

**交互**：
- 选中文本 → 弹出浮窗 → 理解 / 高亮 / 笔记 / 入库
- 标注高亮 + 记笔记（连成一体）
- 全文笔记和标注自动同步到素材库；用户确认后可打包写入 Obsidian
- 支持阅读进度追踪

### 2.5 每日精读（Daily Digest）

**功能**：从素材库中自动筛选每日精选内容

### 2.6 评论区管理（Comments Hub）

**功能**：聚合各平台评论，标记"纳入选题"

### 2.7 数据看板（Data Dashboard）

**功能**：聚合各平台内容数据，趋势图表

---

## 3. 页面架构与路由

### 3.1 路由设计

| 路由 | 说明 | 状态 |
|------|------|------|
| `/` | 重定向到 `/dashboard` | ✅ |
| `/dashboard` | 内容概览大屏 | ✅ |
| `/dashboard/knowledge` | 知识图谱 | 🏗 骨架 |
| `/dashboard/library` | 素材库 | 🏗 骨架 |
| `/reading` | 阅读器列表入口 | ✅ |
| `/reading/new` | 新建文章 | ✅ |
| `/reading/[id]` | 阅读器详情 | 🔌 数据接通 |
| `/daily` | 每日精读 | 🏗 骨架 |
| `/comments` | 评论区 | 🏗 骨架 |
| `/data` | 数据看板 | 🏗 骨架 |
| `/settings` | 设置 | ✅ |

### 3.2 布局结构

左侧固定侧边栏（240px）+ 右侧主内容区。

---

## 4. UI/UX 设计

### 4.1 设计风格

- **极简干净**：大量留白，突出内容本身
- **暗色优先**：适合长时间阅读和创作
- **毛玻璃质感**：AI 侧栏、浮窗使用 backdrop-filter
- **微交互**：hover 动画、过渡效果、加载骨架屏

> 完整样式规范见 `docs/frontend-styling.md`（色彩 / 排版 / 组件 / 动画 / 响应式）。

### 4.2 交互状态设计

每个核心交互区域需明确四种状态：

| 状态 | 设计要求 |
|------|---------|
| **Loading** | 骨架屏（shimmer 动画），不能用转圈，保持布局稳定 |
| **空状态** | 图标 + 说明文字 + 引导操作（如"创建第一篇"链接） |
| **错误状态** | 说明"出了什么错"和"如何修复"，不道歉，不含糊 |
| **正常** | 数据正常渲染 |

### 4.3 阅读器交互细节

**文本选择 → 浮窗**：
- 选中 ≥2 字符 → 浮窗在选中文本上方弹出
- 浮窗含：理解 / 高亮（4 色）/ 笔记 / 入库
- 点击页面空白处 → 浮窗消失
- 跨段落选择 → 正常弹出（surroundContents 失败时降级 extractContents）

**高亮标注**：
- 4 色高亮（黄 / 绿 / 蓝 / 粉）
- 高亮后选中文字被着色，可点击删除
- 高亮保存 DOM 位置信息（前后文锚点），原文变化时可恢复

**阅读批注台**：
- 从右侧滑入，页签内切换“笔记 / 理解 / 入库”，不离开当前阅读上下文
- “理解”显示选中文本预览，将用户问题、引用、附近上下文和全文一并交给 AI，流式输出回答
- AI 回答可保存为文章笔记；未配置 AI 时显示明确错误提示
- “入库”只能选择 Vault 内的真实目录，只创建新 Markdown 文件，不覆盖已有文件

### 4.4 响应式适配

| 断点 | 布局 |
|------|------|
| ≥1280px (xl) | 侧边栏 240px + 主内容 + AI 侧栏 320px |
| 1024-1279px (lg) | 侧边栏 240px + 主内容 |
| 768-1023px (md) | 侧边栏折叠 + 主内容全宽 |
| <768px (sm) | 底部导航 + 主内容全宽 |

### 4.5 键盘操作

| 快捷键 | 功能 |
|--------|------|
| `Esc` | 关闭浮窗 / AI 侧栏 |
| `⌘K` | 全局搜索（规划中） |
| `←/→` | 章节导航（规划中） |

---

## 5. 技术选型

### 5.1 技术栈（锁定版本）

| 层 | 技术 | 版本 | 说明 |
|----|------|------|------|
| 前端框架 | Next.js | 16.3.0 | App Router，Turbopack |
| UI 组件 | Tailwind CSS | v4 | `@theme` 语法，暗色优先 |
| 状态管理 | Zustand | 5.x | 轻量 |
| 图标 | lucide-react | 1.x | |
| 图表 | Recharts | 3.x | Phase 6 引入 |
| 知识图谱 | vis-network | 10.x | Phase 4 引入 |
| 富文本 | @tiptap/react | 3.x | 高亮扩展 |
| AI 流式 | AI SDK | 7.x | `streamText` + `toTextStreamResponse` |
| 数据库 ORM | Prisma | 7.9.1 | adapter 模式 |
| 数据库 | PostgreSQL | 17 | Orbstack 容器，端口 5433 |
| 文件存储 | 本地文件系统 | — | MVP 不需要 R2 |

### 5.2 依赖引入时机

| 依赖 | 引入时机 | 理由 |
|------|---------|------|
| Redis | MVP 外 | 阅读进度可用 localStorage + DB 节流，不需要 Redis |
| Cloudflare R2 | MVP 外 | 本地部署不需要云存储 |
| vis-network | Phase 4 | 知识图谱专用 |
| Recharts | Phase 6 | 数据看板专用 |

---

## 6. 数据库设计

### 6.1 Schema 设计原则

- **内容格式**：`Article.content` 存 **Markdown 纯文本**，渲染时转 HTML。不存 Tiptap JSON（避免格式锁定）。
- **高亮位置**：`Highlight` 不仅存文本，还存 **前后文锚点 + 字符偏移量**，原文变化时可恢复。
- **唯一约束**：`Article.url` 按 `userId + url` 唯一（非全局唯一），支持多用户。
- **枚举字段**：`status`、`type`、`sentiment`、`source` 用 PostgreSQL enum 或 CHECK 约束。
- **关系约束**：`Comment.relatedTopicId`、`DailyDigestConfig.userId` 加外键约束。

### 6.2 Prisma Schema

完整 Schema 见 `prisma/schema.prisma`。核心 model：

- `User` — 用户
- `Article` — 文章（Markdown 内容）
- `Highlight` — 高亮标注（含位置信息）
- `Note` — 笔记
- `KnowledgeNode` — 知识节点
- `KnowledgeRelation` — 知识关系
- `Topic` — 选题
- `Comment` — 评论
- `ContentMetric` — 内容数据
- `DailyDigestConfig` — 每日精读配置

### 6.3 Highlight 数据结构（待完善）

```prisma
model Highlight {
  id          String   @id @default(cuid())
  text        String   @db.Text       // 选中原文
  color       String   @default("yellow")
  note        String?  @db.Text       // 标注笔记
  // 位置信息（原文变化时可恢复高亮）
  prefix      String                   // 前锚点（选中文字前 50 字）
  suffix      String                   // 后锚点（选中文字后 50 字）
  startOffset Int?                     // 字符偏移量（辅助定位）
  endOffset   Int?                     // 字符偏移量
  articleId   String
  article     Article  @relation(...)
  createdAt   DateTime @default(now())

  @@index([articleId])
}
```

---

## 7. AI 集成方案

### 7.1 架构（本地部署）

```
浏览器 → Next.js API Routes → Ollama (localhost:11434)
                              或 OpenAI API（若配置了 Key）
```

### 7.2 模型选择

| 场景 | 优先模型 | 降级方案 |
|------|---------|---------|
| 选中文本解释 | Ollama Qwen2.5 7B | OpenAI gpt-4o-mini |
| 翻译 | Ollama Qwen2.5 7B | OpenAI gpt-4o-mini |
| 文章总结 | Ollama Qwen2.5 7B | OpenAI gpt-4o-mini |

**降级逻辑**：`ai.ts` 中先检查 `OPENAI_API_KEY`，有则用云端（质量高）；否则用 Ollama 本地（零成本）。两者都不可用时返回 503 + 明确错误提示。

### 7.3 API 路由

| 路由 | 功能 |
|------|------|
| `POST /api/ai/explain` | 流式解释选中文本 |
| `POST /api/ai/translate` | 流式翻译 |
| `POST /api/ai/summarize` | 流式总结全文 |

---

## 8. 部署架构

### 8.1 本地部署（唯一模式）

```
┌─────────────────────────────────────┐
│  浏览器 (localhost:3000)              │
└──────────────────┬──────────────────┘
                   │
┌──────────────────▼──────────────────┐
│  Next.js dev server (npm run dev)    │
│  前端页面 + API Routes               │
└────────┬─────────────────┬──────────┘
         │                 │
┌────────▼────────┐  ┌─────▼─────┐
│ PostgreSQL 17   │  │ Ollama    │
│ (Orbstack 容器) │  │ (本地)    │
│ localhost:5433  │  │ :11434    │
└─────────────────┘  └───────────┘
```

**不做 Vercel 部署**。所有服务跑在本地，原因：
- Vercel 服务端无法访问用户电脑的 `localhost:11434`（Ollama）
- 本地部署零成本、零延迟、数据不出本地
- Orbstack 提供接近原生的容器性能

### 8.2 环境变量

```bash
# 数据库（Orbstack PostgreSQL 容器）
DATABASE_URL="postgresql://workbench:workbench@localhost:5433/workbench"

# AI（可选，不配置则使用本地 Ollama）
OPENAI_API_KEY=""

# Ollama（本地）
OLLAMA_HOST="http://localhost:11434"
```

### 8.3 启动 PostgreSQL（Orbstack）

```bash
docker run -d --name workbench-postgres \
  -e POSTGRES_USER=workbench \
  -e POSTGRES_PASSWORD=workbench \
  -e POSTGRES_DB=workbench \
  -p 5433:5432 \
  -v workbench-pg-data:/var/lib/postgresql/data \
  postgres:17-alpine
```

### 8.4 启动 Ollama（可选，AI 功能需要）

```bash
ollama pull qwen2.5:7b
ollama serve
```
