import React, { type JSX } from 'react'
import type { LabState } from '../labScreen'
import { CanvasGroupingStage } from './canvasGroupingLabKit'

export const CANVAS_GROUPING_STATES: readonly LabState[] = [
  {
    id: 'canvas-grouping-interaction',
    name: '临时多选 → 创建编组 → 整组拖动（真实组件交互）',
    source: '现役 BaseGenerationNode.tsx + GroupFrame.tsx + CanvasGroupToolbar.tsx；交互方向见 docs/plan/2026-10-06-grouping-interaction-design.md',
    coverage: 'component-only',
    render: (): JSX.Element => <CanvasGroupingStage />,
  },
]
