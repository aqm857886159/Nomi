// 设计实验室 · 节点快捷动作（批次 1 样张）· 浮条这一族。
//
// 这一族渲染的是生产浮条 `ImageQuickActionsToolbar` 本体（生产宿主 `ImageQuickActionsToolbarHost` 只多一层
// 「点了走一键派生」的接线）；夹具只给节点和「点不了的项」，所以 `mirrors` 指向它在 `BaseGenerationNode` 的调用点。
//
// 顺序有意义：`labStates.mjs` 按文件名排序解析本屏 `states/`，汇总口按同样顺序拼接。
import React from 'react'
import type { LabState } from '../../labScreen'
import { QuickToolbarStage } from '../nodeQuickActionsLabKit'

const SOURCE = 'docs/plan/2026-10-04-node-quick-actions-batch1.md §1 ★4 / §4'

export const QUICK_ACTION_TOOLBAR_STATES: readonly LabState[] = [
  {
    id: 'qa-02-toolbar',
    name: '主样张 · 默认：多机位九宫格｜▾ 分体按钮 / 抠图 / 改图▾ / 宫格▾ + 画板纯图标（文字钮 4 个；用户 10-05 定）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    render: () => <QuickToolbarStage />,
  },
  {
    id: 'qa-03-more-effects-open',
    name: '▾ 更多效果展开 · 下一刻 / 前一刻 / 三视图 / 剧情四宫格（常用在上，不写价格）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="more-effects" />,
  },
  {
    id: 'qa-05-refine-open',
    name: '改图展开 · 生成新图（高清：没有放大模型时第二行说缺什么、点了去接入 kie / 扩图）+ 本机处理（裁剪 / 旋转翻转）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="refine" />,
  },
  {
    id: 'qa-06-grid-picker',
    name: '宫格展开 · 等分 4/9/16/25 + 自定义点阵（悬停到 2 行 3 列）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="grid" hoverCell="2x3" />,
  },
  {
    id: 'qa-07-derived-grid-split',
    name: '九宫格派生出的节点 · 浮条直接有「切成 9 张」',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    render: () => <QuickToolbarStage derivedGrid />,
  },
  {
    id: 'qa-09-narrow',
    name: '窄画布（520 宽）· 浮条按舞台宽折两行，不裁切',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    render: () => <QuickToolbarStage stageWidth={520} />,
  },
  // ── 边界态（2026-10-06 用户截图：节点靠画布上沿，「改图」菜单翻下来压住浮条那一排、盖住「宫格」）。
  // 每一格都是真点开的菜单；`tests/ux/design-lab/popupGeometry.mjs` 对**所有屏所有打开的浮层**量
  // 「浮层与自己的触发钮、所在浮条不相交、整块在窗口里」，这几格是专门喂给那条普查的。
  {
    id: 'qa-20-top-edge-refine-dark',
    name: '边界 · 节点贴上沿 · 改图展开（暗色，用户截图那一格）：头顶放不下就整块开到浮条下面，不压浮条',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="refine" edge="top" />,
  },
  {
    id: 'qa-21-top-edge-more-effects-en',
    name: '边界 · 节点贴上沿 · 更多效果展开（英文）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="more-effects" edge="top" locale="en" />,
  },
  {
    id: 'qa-22-top-edge-grid',
    name: '边界 · 节点贴上沿 · 宫格展开',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="grid" edge="top" />,
  },
  {
    id: 'qa-23-left-edge-refine-en-dark',
    name: '边界 · 节点贴左沿 · 改图展开（英文暗色）：菜单左缘收进窗口',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="refine" edge="left" locale="en" />,
  },
  {
    id: 'qa-24-right-edge-more-effects',
    name: '边界 · 节点贴右沿 · 更多效果展开',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="more-effects" edge="right" />,
  },
  {
    id: 'qa-25-bottom-edge-refine-en',
    name: '边界 · 节点贴下沿 · 改图展开（英文）：照常向上开',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="refine" edge="bottom" locale="en" />,
  },
  {
    id: 'qa-26-narrow-zoomed-top-refine-en',
    name: '边界 · 窄画布 + 缩到 40% + 贴上沿 · 改图展开（英文，浮条折两行）：菜单两行都不许压',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="refine" edge="top" stageWidth={420} zoom={0.4} locale="en" />,
  },
  // ── C 设计样张（2026-10-06 用户第 3 条「高清没有模型怎么办」）：同一个「改图 ▾」，高清的三种处境。
  {
    id: 'qa-31-upscale-guide-en-dark',
    name: 'C · 改图展开 · 没有放大模型（英文暗色）',
    source: 'docs/plan/2026-10-06-upscale-capability-design-card.md',
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="refine" upscale="guide" locale="en" />,
  },
  {
    id: 'qa-32-upscale-ready',
    name: 'C · 改图展开 · 目录里有放大模型（例：连了带 Topaz 放大的中转）：高清照常可点，点了建一个放大节点、不开跑',
    source: 'docs/plan/2026-10-06-upscale-capability-design-card.md',
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="refine" upscale="ready" />,
  },
  {
    id: 'qa-10-dark-more-effects',
    name: '暗色 · 更多效果展开',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:297',
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <QuickToolbarStage open="more-effects" />,
  },
]
