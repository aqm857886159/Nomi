import type { LabState } from '../../labScreen'
import { GenerationListStage } from '../generationListLabKit'

const SOURCE = 'docs/plan/2026-10-08-generation-list-view.md'

export const GENERATION_LIST_STATES: readonly LabState[] = [
  {
    id: 'list-kinds',
    name: '列表 · 每种节点',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" height={2240} />,
  },
  {
    id: 'list-kinds-en',
    name: '列表 · 每种节点（英文）',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" locale="en" height={2240} />,
  },
  {
    id: 'list-kinds-dark',
    name: '列表 · 每种节点（暗色）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <GenerationListStage fixture="kinds" height={2240} />,
  },
  {
    id: 'list-default',
    name: '列表 · 默认首屏',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" />,
  },
  {
    id: 'list-inspector',
    name: '列表 · 检查器',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" inspectorKey="shot-1" />,
  },
  {
    id: 'list-inspector-en',
    name: '列表 · 检查器（英文）',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" locale="en" inspectorKey="shot-1" />,
  },
  {
    id: 'list-deep-link',
    name: '列表 · 只看这份分镜',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" filter />,
  },
  {
    id: 'list-thirty',
    name: '列表 · 30 镜',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="long" />,
  },
  {
    id: 'list-empty',
    name: '列表 · 空',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="empty" />,
  },
  {
    id: 'list-empty-en',
    name: '列表 · 空（英文）',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="empty" locale="en" />,
  },
]
