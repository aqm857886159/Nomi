import React from 'react'
import type { LabState } from '../../labScreen'
import { SelectionActionsStage } from '../SelectionActionsStage'

// 选区浮条「拆成镜头」换分镜图标、挪到「AI 编辑」右边（样张 B，用户 2026-11-12 拍板）。
// 清单：docs/design/boards/2026-11-12-selection-storyboard/SelectionStoryboard.board.json。
// 三个状态照样张：正常（中 / 英 × 亮 / 暗）、「拆成镜头」暂不可用、没有「AI 编辑」。
const SOURCE = 'docs/design/boards/2026-11-12-selection-storyboard/ · 样张 OptionB / OptionB-en'

export const SELECTION_ACTIONS_STATES: readonly LabState[] = [
  {
    id: 'selbar-ready-zh-light',
    name: '浮条 · 拆成镜头在 AI 编辑右边 · 中文 · 亮',
    source: SOURCE,
    mirrors: ['src/workbench/creation/WorkbenchEditor.tsx:214'],
    coverage: 'shell',
    scheme: 'light',
    render: () => <SelectionActionsStage scene="ready" locale="zh-CN" />,
  },
  {
    id: 'selbar-ready-en-light',
    name: 'Bar · Split into shots beside AI edit · English · light',
    source: SOURCE,
    mirrors: ['src/workbench/creation/WorkbenchEditor.tsx:214'],
    coverage: 'shell',
    scheme: 'light',
    render: () => <SelectionActionsStage scene="ready" locale="en" />,
  },
  {
    id: 'selbar-ready-zh-dark',
    name: '浮条 · 拆成镜头在 AI 编辑右边 · 中文 · 暗',
    source: SOURCE,
    mirrors: ['src/workbench/creation/WorkbenchEditor.tsx:214'],
    coverage: 'shell',
    scheme: 'dark',
    render: () => <SelectionActionsStage scene="ready" locale="zh-CN" />,
  },
  {
    id: 'selbar-ready-en-dark',
    name: 'Bar · Split into shots beside AI edit · English · dark',
    source: SOURCE,
    mirrors: ['src/workbench/creation/WorkbenchEditor.tsx:214'],
    coverage: 'shell',
    scheme: 'dark',
    render: () => <SelectionActionsStage scene="ready" locale="en" />,
  },
  {
    id: 'selbar-storyboard-unavailable-zh-light',
    name: '浮条 · 拆成镜头暂不可用（灰） · 中文 · 亮',
    source: SOURCE,
    mirrors: ['src/workbench/creation/WorkbenchEditor.tsx:214'],
    coverage: 'shell',
    scheme: 'light',
    render: () => <SelectionActionsStage scene="storyboard-unavailable" locale="zh-CN" />,
  },
  {
    id: 'selbar-no-ai-edit-zh-light',
    name: '浮条 · 没有 AI 编辑时拆成镜头单独夹在两条分隔线之间 · 中文 · 亮',
    source: SOURCE,
    mirrors: ['src/workbench/creation/WorkbenchEditor.tsx:214'],
    coverage: 'component-only',
    scheme: 'light',
    render: () => <SelectionActionsStage scene="no-ai-edit" locale="zh-CN" />,
  },
]
