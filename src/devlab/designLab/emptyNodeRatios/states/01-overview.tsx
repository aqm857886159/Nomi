// 空节点比例：整屏一格（中英文同一个状态 id，语言由 URL `lang` 决定；浅深由 `scheme` 决定）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { EmptyNodeRatiosOverview } from '../emptyNodeRatiosLabKit'

const SOURCE = '用户 2026-10-10 反馈（图片节点空态随比例变排版）；用户 10-10 选 B；拍板记录 docs/design/2026-10-08-approved-designs.md 第 ⑧ 节'
const MIRRORS = 'src/workbench/generationCanvas/nodes/render/CardCommon.tsx:163'

export const EMPTY_NODE_RATIOS_STATES: readonly LabState[] = [
  {
    id: 'ner-overview',
    name: '空节点比例：B 视觉中心（生产组件 · 生产比例表全部比例 · 小尺寸 240 · 视频 16:9 / 9:16）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'missing',
    render: () => <EmptyNodeRatiosOverview />,
  },
]
