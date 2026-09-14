# FP-002 平台分析与书架分页

## Status

Done

## Goal

补齐录屏后半段的平台分析层级，并解决书架一次渲染全部文章导致的超长页面问题。

## Scope

- Included:
  - 新增平台分析聚合接口，读取 `ContentMetric`。
  - 无真实平台快照时返回明确标记的稳定演示数据。
  - 数据页增加平台筛选、指标带、30 天趋势、内容贡献与单作品钻取弹窗。
  - 文章列表 API 增加向后兼容的可选分页模式。
  - 书架增加封面式卡片和分页控制。
- Excluded:
  - 抖音、B站等 OAuth 或爬虫接入。
  - 自动刷新第三方指标。
  - 封面图片上传与对象存储。

## Requirements

- Functional:
  - 数据页清楚区分数据库快照和演示快照。
  - 趋势指标可在播放、点赞、评论、分享之间切换。
  - 点击作品可查看其历史曲线和互动明细。
  - 搜索文章后分页回到第一页。
- Technical:
  - 复用 `ContentMetric` 和 `Article`，不新增迁移。
  - 原有未携带 `paginate=true` 的 `/api/articles` 调用继续返回数组。
- UX/API/Data constraints:
  - 指标采用连续信号带，不堆叠通用 SaaS 卡片。
  - 图表和弹窗支持键盘焦点与 Escape 关闭。

## Interfaces

- `GET /api/analytics?platform=all&range=30`
- Response: `source`, `totals`, `trend`, `content`, `generatedAt`
- `GET /api/articles?paginate=true&page=1&pageSize=18&search=`
- Response: `items`, `total`, `page`, `pageSize`, `pageCount`, `current`

## Implementation Notes

- 平台快照按作品取最近记录计算总量；趋势按日期聚合。
- 演示数据使用固定公式生成，禁止 `Math.random()`，保证截图和测试稳定。

## Acceptance Criteria

- Observable outcome:
  - 数据页能切换趋势指标并打开作品详情。
  - 书架单页最多 18 篇，页码和搜索状态正确。
- Verification command:
  - `npm run lint`
  - `npm run build`
  - API curl 与 Playwright 交互检查。

## Result

- Changed files:
  - `src/app/api/analytics/route.ts`
  - `src/app/api/articles/route.ts`
  - `src/app/data/page.tsx`
  - `src/app/reading/page.tsx`
  - `src/app/globals.css`
- API/schema impact:
  - 新增 `GET /api/analytics`。
  - `/api/articles` 增加可选分页响应；默认数组响应保持兼容。
  - 无 Prisma schema 或迁移变化。
- Verification:
  - API 验证 30 天快照、文章总数 231、分页每页 12 篇。
  - Playwright 验证趋势指标、作品详情弹窗、Escape 关闭、书架第二页和移动端布局。
- Known gap:
  - 尚未接入第三方平台授权；没有 `ContentMetric` 时明确显示“演示快照”。
