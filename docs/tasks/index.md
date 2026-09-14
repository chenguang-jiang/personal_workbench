# 晨光知识库 / DawnKB 任务总览

## 项目目标

把录屏后半段展示的“评论证据 → 主题洞察 → 选题”与“平台数据 → 趋势 → 单作品复盘”补成真实可用的数据流，同时统一中文字体、书架信息层级和状态动画。

## 任务表

| 任务 | 状态 | 负责人 | 依赖 |
| --- | --- | --- | --- |
| [FP-001 评论主题洞察工作流](./FP-001-comment-topic-insights.md) | Done | Codex | 现有 Comment / Topic 模型 |
| [FP-002 平台分析与书架分页](./FP-002-analytics-library-flow.md) | Done | Codex | ContentMetric / Article API |
| [FP-003 字体、排版与动效精修](./FP-003-typography-motion-polish.md) | Done | Codex | FP-001、FP-002 页面结构 |
| [FP-004 DawnKB 品牌、文档连续转场与 Obsidian 同步](./FP-004-dawnkb-brand-motion-sync.md) | Done | Codex | 书架 / Reader / Vault watcher |
| [FP-005 真实 Vault 浏览与阅读批注台](./FP-005-real-vault-annotation-desk.md) | Done | Codex | FP-004 / Reader / Obsidian Vault |

## 依赖顺序

1. 先稳定评论洞察、数据分析和分页接口。
2. 再让页面消费稳定的数据契约。
3. 最后统一字体、响应式布局和动效，避免视觉层反向承载业务规则。

## 下一推荐任务

接入真实平台快照写入 `ContentMetric`，让数据页从演示快照自动切换到数据库快照。
