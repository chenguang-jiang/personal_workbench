# FP-003 字体、排版与动效精修

## Status

Done

## Goal

把后半段录屏中的中文编辑部气质落实为稳定的字体角色、空间秩序和克制动效，并保持现有浅色研究工作台方向。

## Scope

- Included:
  - 中文正文与标题字体升级。
  - 评论、数据、书架新结构的响应式样式。
  - 页面进入、视图切换、弹窗、证据卡和书封悬停动画。
  - `prefers-reduced-motion` 降级。
- Excluded:
  - Footprints 专属黑色 3D 地球和 visionOS 玻璃视觉。
  - 装饰性渐变文字、持续粒子背景和弹跳动画。

## Requirements

- Functional:
  - 桌面、平板、390px 移动视口均可操作。
  - 字体加载失败时仍有合适的中文系统字体回退。
- Technical:
  - 等宽工具字体使用 `next/font`；中文使用系统内置字族，避免本地构建依赖 Google Fonts。
  - 所有持续动画受 reduced-motion 控制。
- UX/API/Data constraints:
  - 页面标题、正文、数据标签分别使用明确字体角色。
  - 动效只解释层级、选择和数据变化。

## Interfaces

- 无 API 或 schema 变化。
- 主要入口：`src/app/layout.tsx`、`src/app/globals.css`。

## Implementation Notes

### 设计计划

- Color:
  - Archive Canvas `#F8F7FA`
  - Paper `#FFFFFF`
  - Ink `#19161E`
  - Secondary Ink `#6E6874`
  - Intelligence Violet `#7137E2`
  - Verified Green `#279A68`
- Type:
  - Display：`Songti SC`，只用于页面标题、书名和主题结论。
  - Body/UI：`Avenir Next + PingFang SC`，用于正文、按钮、表单和导航。
  - Utility：`JetBrains Mono`，用于指标、微标签、时间和来源。
- Layout:

```text
评论页  [筛选与视图切换]
        ┌────────证据/主题列表────────┬────当前主题证据────┐
        │ 证据脊线 + 主题结论          │ 来源 / 情感 / 原话   │
        └────────────────────────────┴───────────────────┘

数据页  [连续指标信号带]
        ┌──────────30 天主趋势─────────┬──内容贡献──┐
        └─────────────────────────────┴────────────┘

书架    [当前阅读：封面 / 进度 / 动作]
        [封面卡] [封面卡] [封面卡]
```

- Signature：贯穿评论主题卡和分析面板的“证据脊线”，长度编码证据量；这是从评论原话走向选题结论的可追溯视觉标记。

### 自检与修订

初稿容易落入“紫色指标卡＋折线图”的通用 Dashboard。修订后把指标做成一条连续信号带，只把大胆表达集中在证据脊线与作品趋势钻取；其余容器保持安静、细边框和大留白。

## Acceptance Criteria

- Observable outcome:
  - 中文标题与正文没有字体跳变，数据标签字宽稳定。
  - Hover、视图切换和弹窗反馈清晰但不过度。
  - reduced-motion 下无持续呼吸或位移动画。
- Verification command:
  - `npm run lint`
  - `npm run build`
  - Playwright 1440×980 与 390×844 截图检查。

## Result

- Changed files:
  - `src/app/layout.tsx`
  - `src/app/globals.css`
  - 评论、数据和书架页面组件。
- API/schema impact:
  - 无。
- Verification:
  - 中文标题使用 `Songti SC`，正文使用 `Avenir Next + PingFang SC`，工具信息使用 JetBrains Mono。
  - 1440×980 与 390×844 截图检查通过。
  - reduced-motion 继续统一关闭持续动画与位移过渡。
- Design adjustment:
  - Noto CJK 在本地生产构建中需要访问 Google Fonts，已改用系统中文字体栈，避免破坏离线构建。
