import type { LabState } from '../../labScreen'
import { GenerationListStage } from '../generationListLabKit'

const SOURCE = 'docs/plan/2026-10-08-generation-list-view.md'

// 全部是生产组件 + 真实宿主数据（GenerationListView 读画布 store / 分镜方案）；格子里没有样张自己画的零件。
// 板：List（定宽 256 卡、不套框、分区一行）、ListDetail（288 窄列 + 大详情）。每态光 / 暗、中 / 英都有。
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
    id: 'list-default-en',
    name: '列表 · 默认首屏（英文）',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" locale="en" />,
  },
  {
    id: 'list-default-dark',
    name: '列表 · 默认首屏（暗色）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <GenerationListStage fixture="kinds" />,
  },
  {
    id: 'list-width-1280',
    name: '列表 · 窗口 1280',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" width={1280} height={800} />,
  },
  {
    id: 'list-width-1000',
    name: '列表 · 窗口 1000',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" width={1000} height={800} />,
  },
  {
    id: 'list-detail-done',
    name: '大详情 · 已生成',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" inspectorKey="shot-1" />,
  },
  {
    id: 'list-detail-done-en',
    name: '大详情 · 已生成（英文）',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" locale="en" inspectorKey="shot-1" />,
  },
  {
    id: 'list-detail-done-dark',
    name: '大详情 · 已生成（暗色）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <GenerationListStage fixture="kinds" inspectorKey="shot-1" />,
  },
  {
    id: 'list-detail-generating',
    name: '大详情 · 生成中',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" inspectorKey="shot-2" />,
  },
  {
    id: 'list-detail-failed',
    name: '大详情 · 失败',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" inspectorKey="poster-2" />,
  },
  {
    id: 'list-detail-draft',
    name: '大详情 · 还没生成',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" inspectorKey="shot-3" />,
  },
  {
    id: 'list-detail-width-1000',
    name: '大详情 · 窗口 1000（窄列让位）',
    source: SOURCE,
    coverage: 'shell',
    render: () => <GenerationListStage fixture="kinds" inspectorKey="shot-1" width={1000} height={800} />,
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
