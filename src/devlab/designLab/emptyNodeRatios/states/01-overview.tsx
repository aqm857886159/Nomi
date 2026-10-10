// 空节点比例：整屏一格（中英文同一个状态 id，语言由 URL `lang` 决定；浅深由 `scheme` 决定）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { EmptyNodeRatiosOverview } from '../emptyNodeRatiosLabKit'

const SOURCE = '用户 2026-10-10 反馈（图片节点空态随比例变排版）；协调会话 2026-10-10 返工裁定（现在 / A 上下居中 / B 视觉中心）；拍板稿 design-approved-1008/README.md 第 4、6 条'
const MIRRORS = 'src/workbench/generationCanvas/nodes/render/CardCommon.tsx:163'

export const EMPTY_NODE_RATIOS_STATES: readonly LabState[] = [
  {
    id: 'ner-overview',
    name: '空节点比例：现在 / A 上下居中 / B 视觉中心（真节点 · 小尺寸 · 混排 · 视频对照）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'missing',
    render: () => <EmptyNodeRatiosOverview />,
  },
]
