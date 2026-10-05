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
    name: '改图展开 · 生成新图（高清灰掉说原因 / 扩图）+ 本机处理不花钱（裁剪 / 旋转翻转）',
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
