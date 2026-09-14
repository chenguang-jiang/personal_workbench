# FP-004 DawnKB 品牌、文档连续转场与 Obsidian 同步

## 状态

Done

## 目标

将产品统一命名为“晨光知识库 / DawnKB”，建立独立标志；让书架卡片进入详情时保持对象连续；修正本地 Obsidian 同步只在开发模式启动、状态不可见和文章/知识节点更新不一致的问题。

## 前端实现

- 以晨曦紫书页与日出琥珀晨日构成 DawnKB 纯图形标志，不使用字母缩写。
- 使用 Next.js 16 / React 19 原生 `ViewTransition`，让书架卡片 morph 为阅读页标题区。
- 进入详情与返回书架分别使用前进/后退动效；全局尊重 `prefers-reduced-motion`。
- 文档阅读器识别 Obsidian callout 与 wikilink，wikilink 进入书架搜索。
- 设置页展示真实 Vault 状态，并提供“立即同步 Obsidian”。

## 后端实现

- `src/instrumentation.ts` 在 Node.js 服务实例启动时注册 watcher，生产服务与开发服务规则一致，构建阶段不启动监听。
- 启动后先执行全量差异同步；随后通过 Chokidar 监听 `.md` 的新增、修改和删除。
- `awaitWriteFinish` 稳定窗口为 500ms；因此 Obsidian 保存后通常约半秒开始增量更新。
- 同一文件同时更新 `Article` 与 `KnowledgeNode`，只有内容、标题、摘要或标签发生变化时才递增文章版本。
- 手动同步入口：设置页按钮、`POST /api/obsidian/sync`、`npm run obsidian:sync`。

## 验收

- [x] 产品标题、侧栏、移动端与 favicon 使用 DawnKB 品牌。
- [x] 桌面和移动端书架均可进入详情并返回。
- [x] View Transition 不支持时仍正常导航；减少动态效果时禁用动画时长。
- [x] `/api/obsidian/sync` 返回 configured / available / state / watching / lastEvent。
- [x] 连续执行两次完整同步时，第二次结果为 0 更新、全部 unchanged。
- [x] ESLint、Next.js production build 与浏览器 console 验收通过。
