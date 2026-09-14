# FP-001 评论主题洞察工作流

## Status

Done

## Goal

把评论页从单一证据列表升级为录屏中的双层工作区：先浏览真实评论，再按关键词聚成主题，并能查看每个主题的代表证据和来源分布。

## Scope

- Included:
  - 新增评论主题聚类只读接口。
  - 评论页增加“评论证据 / 主题洞察”视图切换。
  - 主题卡展示证据数量、平台覆盖、情感分布和代表评论。
  - 保留单条评论纳入选题的现有能力。
- Excluded:
  - 自动登录或抓取第三方平台。
  - 调用大模型生成主题名称。
  - 批量删除、合并或改写原始评论。

## Requirements

- Functional:
  - 有关键词标签时按标签聚类；无标签的评论进入“待归类反馈”。
  - 聚类结果必须可追溯到原评论，不制造不存在的证据。
  - 空数据时明确引导导入 CSV / JSON。
- Technical:
  - 复用 Prisma `Comment`，不新增迁移。
  - 聚类发生在服务端，页面只负责筛选和呈现。
- UX/API/Data constraints:
  - 紫色证据脊线长度表达证据数量，同时保留数字标签，不能只靠颜色。
  - 主题切换保持 180–240ms，不做弹跳。

## Interfaces

- `GET /api/topics/insights?platform=all&sentiment=all`
- Response: `{ totalComments, groups[] }`
- `groups[]`: `id`, `title`, `evidenceCount`, `platforms`, `sentiments`, `examples`, `relatedTopicIds`

## Implementation Notes

- 主题 ID 使用稳定的关键词 slug；没有关键词时使用 `uncategorized`。
- 一个评论可进入多个显式关键词组，这符合“同一证据支持多个主题”的工作方式。

## Acceptance Criteria

- Observable outcome:
  - 评论页可在证据与主题间切换，主题卡点击后展示代表评论。
  - 接口结果与当前筛选条件一致。
- Verification command:
  - `npm run lint`
  - `npm run build`
  - Playwright 桌面与移动视口检查。

## Result

- Changed files:
  - `src/app/api/topics/insights/route.ts`
  - `src/app/comments/page.tsx`
  - `src/app/globals.css`
- API/schema impact:
  - 新增只读 `GET /api/topics/insights`。
  - 无 Prisma schema 或迁移变化。
- Verification:
  - `npm run lint` 通过。
  - `npm run build` 通过。
  - Playwright 验证评论证据/主题切换、桌面与 390px 空状态，控制台无错误。
- Known gap:
  - 当前数据库没有评论，因此未在用户数据上制造示例证据；导入带标签评论后即可展示聚类。
