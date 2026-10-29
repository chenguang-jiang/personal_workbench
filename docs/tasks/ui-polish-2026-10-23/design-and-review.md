# DawnKB 阅读排版与全站 UI/UX 精修 · 2026-10-23

> 2026-10-24 追加：头脑风暴答案排版优化与操作栏移除，见文末「追加轮」。

## 设计说明

延续 2026-10-11 那轮总览/书架/设置/导航的精修，本轮聚焦上轮明确留下的两块：沉浸阅读正文（字体与排版、Mermaid 流程图）和全站可读性收尾。沿用既有视觉语言：浅色纸面 + 紫色强调、中文衬线正文 + 无衬线标题、mono 眉标、Lucide 图标，不做方向重选。

阅读页的主任务是"读长文和看图"：标题只出现一次、图表默认可读、宽图能拖能缩，是本轮的验收线。

## 关键变化

### 阅读正文（文章字体与排版）

- **标题去重**：正文以与文章标题相同的 H1 开头时（几乎每篇导入文章都如此），标题会与 intro 卡片重复出现。现在渲染后给该 H1 打 `reader-h1--dup` 标记视觉隐藏。只隐藏不删除——原位编辑保存走 `serializeProse`（从渲染 DOM 反序列化回 Markdown），DOM 节点必须保留，否则下次保存会把标题从源文件里删掉。标题与正文首个 H1 文字不一致时照常显示，不误伤。
- **表格行悬停**：宽表逐行核对时给跟随反馈（lilac 悬停底色），颜色沿用悬停语义而非选中语义。
- **圆角归入令牌体系**：表格 10px → `--radius-lg`(12)、Mermaid 图块 15px → `--radius-xl`(16，与灯箱一致)。

### Mermaid 流程图

- **智能默认模式**：此前一律"适应宽度"，复杂架构图（自然宽 1600–3000px）缩放比只有 0.23–0.45，节点文字完全不可读。现在图缩到全宽后文字低于 0.72 倍（`MIN_READABLE_FIT_SCALE`，既有阈值）时默认按**原始尺寸**打开并水平居中；小图仍适应宽度。实测 36 张图分布：≤992px 的图适应宽度（77%–88% 缩放可读），更宽的默认 100% 原始尺寸。
- **⌘/Ctrl + 滚轮缩放**：以指针位置为锚点缩放（触控板捏合同事件通道），缩放焦点不漂移；普通滚轮仍滚动图表视口。
- **拖拽平移**：溢出的图按住拖拽即可平移（grab/grabbing 光标），拖拽中禁用图内文字选择。
- 以上与既有的工具栏缩放按钮、"原始尺寸/适应宽度"切换、全屏灯箱叠加工作，不互相抢占状态。

### 全站可读性（截图工具 lint 驱动）

- **`--color-tertiary` 0.53 → 0.55**：日期等辅助文字在 surface 上实测 4.41:1（低于 AA），提亮后达标。
- **文件夹面包屑识别色**：色相保留（文件夹识别是既有设计），亮度压到 `hsl(hue 58% 32%)` 混合后实测 ≥4.5:1；暗色模式反向提亮到 68%。
- **手机端阅读工具栏**：390px 下"书架"文字把面包屑挤成竖排折行，改为窄屏只留返回箭头（`font-size: 0` 保留图标），文件夹名不折行。

## 保留项（非遗漏）

- 正文 H2 的渐变左线、页面 mono 眉标（`// DEEP READING` 等）、英文章节小标：DawnKB 既有的识别语言，与 quote/callout 的左线体系一致，全部页面统一出现，不属 AI 眉标堆加。
- 题库标题里的 📝：来自用户数据（题集生成时写入标题），不是 UI chrome，展示层不做清洗。
- 书架卡片的 h3"标题离上文比离下文还近"lint 提示：卡片标题距本卡 meta 行 14px、距下一张卡 62px，是卡片边界而非分组标题间距，误报保留。

## 验证与证据

截图存于 `output/playwright/ui-ux-1023/`（遵循仓库本地输出目录规则，未加入 Git）：

- 修改前：`reader-vpp-before.png`（标题重复）、`vpp-cdp/at-6000.png`（流程图 fit 模式不可读）。
- 修改后：`after-top/at-0.png`（标题只出现一次）、`after-top/at-5600.png`（流程图 100% 原始尺寸可读）、`after-dark-top.png` / `after-dark-mermaid.png`（暗色）、`after-mobile-recheck.png`（390px 工具栏修复后）、`page-dashboard/page-library/page-quiz/page-graph`（各页面基线）。
- 视口：桌面 1440×900（deviceScaleFactor 2）、手机 390×844；暗色经 `dawnkb-theme=dark` cookie。
- 交互实测（CDP 合成事件）：默认 100% 且 scrollLeft 居中（461/923）；⌘+滚轮 100%→110%、画布 1637→1801px；拖拽 -150px → scrollLeft +150px 精确平移、panning 状态正确清理；H1 带 `reader-h1--dup` 且不可见。
- 全文 36 张 Mermaid 图默认模式分布核查：宽图（>992px 自然宽）100% 原始尺寸，窄图适应宽度（77%–88%），符合阈值设计。
- 阅读器内部滚动容器截图用 `scripts/reader-shots.mjs`（CDP 直改 scrollTop，本轮新增的小工具，shoot.mjs 的 scroll 只动 window）。
- 截图 lint：书架页可读性项全部通过（对比度 0 处不达标）；总览、阅读器无控制台错误、无横向溢出、无加载失败图片。
- ESLint（改动的 TS/TSX）、`tsc --noEmit` 通过；生产构建通过（见下方构建输出）。

## 本轮未覆盖

- 头脑风暴会话内、Dawn Agent 对话流的深层状态（上轮与本轮均只验收了入口页与共享布局）。
- Mermaid 灯箱内的拖拽/滚轮缩放（灯箱保留原有"完整缩放 + 滚动"行为，本轮交互集中在正文图块）。
- 流程图自身布局质量（节点间距、连线走向）由 Mermaid 布局引擎决定，未做源码级改写。

---

## 追加轮 · 2026-10-24：头脑风暴答案排版与操作栏移除

用户要求：优化知识库模式答案的排版（截图里表格被压成无框密排、列表无符号），并删除答案下方的操作栏（保存为笔记 / 转为命题 / 交给 Dawn Agent）。

### 操作栏移除

- 删除 `KnowledgeBrainstorm.tsx` 中的 footer JSX、`action()`（save-note/proposition，调 `/api/brainstorm/[id]/knowledge-message`）、`handoffToDawn()`（Dawn Agent handoff 跳转）及 `actionPending` 状态、`useRouter`、`createDawnHandoff` 引用与 Bot/Check/Save 图标导入。
- `createDawnHandoff` 库本身保留（阅读页标注台仍在用）；后端 action 路由未动，仅前端入口移除。
- 对应 footer 样式（`.kb-message--assistant > footer` 三块）删除。

### 答案排版

根因：`renderMiniMarkdown` 输出裸 `<table>`，而 Tailwind preflight 剥掉表格边框与列表符号，`.mini-markdown` 又从未补过样式——AI 回答里的表格/列表一直是浏览器裸排。

- `mini-markdown.ts`：表格包进 `<div class="mini-table-wrap">`（头脑风暴 / Dawn Agent / 题库解析三个使用方同时受益）。
- `base.css` 新增共享层（恢复列表符号与缩进、blockquote 左线、行内 code 与 pre 代码块、表格：表头 elevated 底色、单元格边框、斑马纹、圆角 + 横向滚动）。`pre` 规则用 `:where()` 置零特异性，Dawn Agent 的深色代码块样式原样保留。
- KB 答案正文：12.5px 次级灰 → 13.5px 主色（`color-mix(primary 88%, secondary)`），行高 1.8，标题加行高与 balance，strong 用主色。

### 环境事故记录

排查中发现 dev server 两个症状：`/api/brainstorm/[id]` 全量 500、页面每秒约 5 次自我硬刷新（`GET /brainstorm` 累计 9217 次）。逐层定位：路由处理器在 Next 之外直调返回 200、页面导航 initiator 是 turbopack HMR 的 `restart()`、HMR 报 `HMR hash mismatch` 死循环——均为 `.next` 的 turbopack 开发缓存损坏（旧 dev 进程被杀后缓存混用所致），与本次代码改动无关。删除 `.next` 重启后两个症状同时消失。原 dev server 已由本轮重启接管（日志在 /tmp/dawnkb-dev.log）。

### 验证

- 计算样式实测（明/暗）：答案 13.5px / 24.3px 行高 / 主色；表格 wrap overflow-x auto、边框 1px、表头 elevated；列表 `list-style: disc`；footer 已移除。
- 截图：`output/playwright/ui-ux-1023/kb-typography-light.png`、`kb-typography-dark.png`（含注入样例：表格/列表/引用/代码，与真实 renderer 产出同构）。
- Dawn Agent 入口页回归正常；ESLint、`tsc --noEmit` 通过。

---

## 追加轮 · 2026-10-24（二）：阅读器 AI 对话与选区增强

用户要求：阅读器提供 AI 图标，可直接引用整篇文章与 AI 对话并修改文章内容；选中文字支持高亮/加粗，或把选中内容直接引用给 AI。

### 现状盘点后的接入方式

阅读器已有：选区工具条（Dawn Agent/高亮/笔记/入库）、标注台（笔记/Dawn Agent handoff/入库）、一键整理（AI 全文重写 + 防护 + 可撤销）、`/api/ai/ask`（流式多轮文章问答，此前无调用方）。新功能全部挂进这些既有模式，不另起炉灶。

### 新增

- **AI 对话面板（`ReaderAiChat.tsx`）**：工具栏新图标（BotMessageSquare，激活态高亮）打开右侧停靠面板。复用 annotation.css 里早已建好但从未接线的 `.ai-assistant` 样式族（print/responsive 断点规则也因此天然覆盖）。
  - 问答模式：走 `/api/ai/ask`，文章全文 + 引用选区作为上下文，流式输出，完成后用 mini-markdown 渲染（上一轮补的表格/列表样式直接受益）。
  - 修改文章模式：走新端点 `POST /api/articles/[id]/ai-edit`，返回完整修改稿，先在预览卡里展示，「应用到文章」才走 PATCH 写回（vault 同步），旧文进撤销快照，与一键整理共用撤销通道。
  - ai-edit 防护沿用 tidy：12000 字上限、返回稿过短拒绝、代码围栏数量校验、剥掉模型误加的整体围栏。
- **选区工具条新增「问 AI」「加粗」**：
  - 问 AI：打开对话面板并把选中文字作为引用（面板顶部引用卡，提问自动附带前后文）。
  - 加粗：把渲染选区映射回 Markdown 源码（逐字符间允许空白/行内标记，兼容软换行与中英文拼合差异），包裹 `**` 保存；已是加粗则切换为取消；围栏内、wikilink 内、代码块/表格/链接/图表内直接拒绝并提示；走 PATCH + 可撤销。
- 撤销提示文案从「已撤销整理」泛化为「已撤销修改」，三条路径（整理/加粗/AI 修改）共用。

### 验证

- E2E（CDP 实测，短文《数据中心风格》）：面板打开 ✓；一句话提问流式回答 ✓；选区加粗 → 源码含 `**`、提示「已加粗并保存」✓；选区 → 问 AI → 引用卡正确 ✓；修改模式 → 预览卡 → 应用 → 内容写入 ✓ → 撤销 → 内容还原 ✓。
- 截图：`output/playwright/ui-ux-1023/reader-ai-panel-desktop.png`（桌面右侧停靠布局）、`reader-ai-chat.png`（窄视口 + 已撤销提示）。
- ESLint、`tsc --noEmit`、生产构建通过。

### 已知边界

- AI 对话在编辑态不可用（进入编辑自动收起面板），避免内容改写与原位编辑互相踩踏。
- 加粗的源码定位在极短选区（2-3 字）且文中多处出现时可能选中第一处；不匹配时明确报错不静默写错位置。
- 超过 12000 字的文章不支持修改模式（问答不受限），与一键整理同因：整篇交不全模型会截断。

---

## 追加轮 · 2026-10-24（三）：收藏夹

用户要求：知识空间增加收藏夹目录，文章可收藏，并在收藏夹快速查看。

### 实现

- **数据层**：`Article` 新增 `favoritedAt DateTime?`（非空即已收藏，收藏夹按它倒序）。开发库按既有流程用 `prisma db push` 应用（该库存在 schema 漂移，`migrate dev` 影子库重放不可用）。
- **API**：`POST /api/articles/[id]/favorite` 切换收藏；列表 API 支持 `favorites=1` 筛选（按收藏时间倒序）并在列表 select 里带上 `favoritedAt`。
- **阅读器**：工具栏新增星标按钮（`/reading/[id]` 页面的 `initialArticle` 显式字段白名单补传 `favoritedAt`）。乐观更新，失败回滚，成功提示「已加入收藏夹 / 已从收藏夹移除」。
- **收藏夹视图**：书架页抽成 `ReadingLibrary` 组件（`favoritesOnly` 属性），`/reading` 与新路由 `/favorites` 共用；收藏模式下无「继续阅读」大卡、空态引导去阅读器点星标、计数标签 STARRED。书架卡片上为已收藏文章常显紫色星标角标。
- **侧边栏**：知识空间组在「阅读器」下新增「收藏夹」（Star 图标），分组断点索引同步调整；中英文 i18n 键补齐。

### 排障记录（值得留档）

首版 E2E 出现「收藏后阅读器渲染仍显示未收藏」：逐层排除 turbopack 缓存、HTTP 缓存、proxy、obsidian 同步改写后，用渲染探针证明服务端查询拿到的是新数据，最终定位为 `/reading/[id]` 构造 `initialArticle` 时按显式字段白名单挑字段、漏传 `favoritedAt`。修复后渲染与库一致。教训：给服务端组件的 client 子组件补字段时，显式白名单是必须核查的清单。

另：本轮 dev server 重启两次（一次清 `.next` 缓存），原因同上一轮——分段热更把中间态编进缓存（Sidebar 先加 `icon: Star` 后加 import，中间态被缓存导致全站 500）。

### 验证

- E2E（CDP）：阅读器星标与库状态一致；点星标 → 提示 + 状态翻转；`/favorites` 页标题「收藏夹」、卡片正确、星标角标显示、侧边栏「收藏夹」激活；取消收藏 → 收藏夹清零（API total 0）。
- 截图：`output/playwright/ui-ux-1023/reader-starred.png`、`favorites-page.png`。
- ESLint、`tsc --noEmit`、生产构建通过。
