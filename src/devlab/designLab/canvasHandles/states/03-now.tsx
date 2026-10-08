// 对照：现役原样（main 上就长这样），让用户逐项比。
import React from 'react'
import type { LabState } from '../../labScreen'
import { EmptyCanvasStage, FIXTURES, HandlesStage } from '../canvasHandlesLabKit'

const SOURCE = '现役（origin/main 7588f472），作对照'

export const NOW_STATES: readonly LabState[] = [
  {
    id: 'ch-10-now-empty-image-zh',
    name: '现状 · 空图片卡（一句操作说明）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/render/CardCommon.tsx:134',
    coverage: 'shell',
    render: () => <HandlesStage proposal={false} nodes={[FIXTURES.emptyImage()]} selectedId="h-empty-image" />,
  },
  {
    id: 'ch-10-now-empty-image-en',
    name: '现状 · 空图片卡（英文）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/render/CardCommon.tsx:134',
    coverage: 'shell',
    render: () => <HandlesStage locale="en" proposal={false} nodes={[FIXTURES.emptyImage()]} selectedId="h-empty-image" />,
  },
  {
    id: 'ch-10-now-asset-selected-zh',
    name: '现状 · 选中上传素材卡：两侧都有「+」',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowVisualContract.ts:41',
    coverage: 'shell',
    render: () => <HandlesStage proposal={false} nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-10-now-asset-selected-en',
    name: '现状 · 选中上传素材卡（英文）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowVisualContract.ts:41',
    coverage: 'shell',
    render: () => <HandlesStage locale="en" proposal={false} nodes={[FIXTURES.genImage(), FIXTURES.asset()]} selectedId="h-asset" />,
  },
  {
    id: 'ch-10-now-empty-canvas-zh',
    name: '现状 · 空画布',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/components/CanvasEmptyState.tsx:13',
    coverage: 'shell',
    render: () => <EmptyCanvasStage proposal={false} />,
  },
]
