import type { LabState } from '../../labScreen'
import { ShotTableStage } from '../ShotTableStage'
const SOURCE = 'docs/plan/2026-09-10-left-sidebar-and-shot-table-node.md'
export const SHOT_TABLE_STATES: readonly LabState[] = [
  {
    id: 'shot-table-empty',
    name: '分镜表 · 空态',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage empty />,
  },
  {
    id: 'shot-table-production-ready',
    name: '分镜表 · 生产投影',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage />,
  },
  {
    id: 'shot-table-selected',
    name: '分镜表 · 选中',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage selected />,
  },
  {
    id: 'shot-table-generating',
    name: '分镜表 · 生成中',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage generating />,
  },
  {
    id: 'shot-table-partial-failed',
    name: '分镜表 · 部分失败',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage failed />,
  },
  {
    id: 'shot-table-density-compact',
    name: '分镜表 · 紧凑',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage density="compact" />,
  },
  {
    id: 'shot-table-density-card',
    name: '分镜表 · 卡片',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage density="card" />,
  },
  {
    id: 'shot-table-facts-ready',
    name: '拆解表 · 事实就绪',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage facts />,
  },
  {
    id: 'shot-table-deconstructing',
    name: '拆解表 · 正在读画面',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage facts deconstructing />,
  },
]
