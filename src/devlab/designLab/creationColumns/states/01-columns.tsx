import React from 'react'
import type { LabState } from '../../labScreen'
import { CreationColumnsStage } from '../CreationColumnsStage'

const SOURCE = 'docs/design/2026-09-10-creation-workspace-columns.md'
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
    name: '已实施 · 统一外框',
    source: SOURCE,
    coverage: 'shell',
    render: () => <CreationColumnsStage specimen />,
  },
  {
    id: 'columns-specimen-dark',
    name: '已实施 · 暗色',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <CreationColumnsStage specimen />,
  },
]
