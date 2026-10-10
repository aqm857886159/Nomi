import React from 'react'
import type { LabState } from '../../labScreen'
import { CreationColumnsStage } from '../CreationColumnsStage'

// 10-08 外壳重设计：创作内容树进了左栏「文稿」抽屉，旧的「创作内容列收起 / 展开」两格随那一列一起删了。
const SOURCE = 'docs/plan/2026-10-08-shell-redesign.md'
export const CREATION_COLUMNS_STATES: readonly LabState[] = [
  {
    id: 'columns-current',
    name: '生产 · 真实创作外壳',
    source: SOURCE,
    coverage: 'shell',
    render: () => <CreationColumnsStage />,
  },
  {
    id: 'columns-specimen',
    name: '外壳 · 创作页（Agent 停靠）',
    source: SOURCE,
    coverage: 'shell',
    render: () => <CreationColumnsStage specimen />,
  },
  {
    id: 'columns-specimen-dark',
    name: '外壳 · 创作页 · 暗色',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <CreationColumnsStage specimen />,
  },
  {
    id: 'columns-storyboard-tree',
    name: '外壳 · 分镜面',
    source: SOURCE,
    coverage: 'shell',
    render: () => <CreationColumnsStage specimen mode="storyboard" />,
  },
]
