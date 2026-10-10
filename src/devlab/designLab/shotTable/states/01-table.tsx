import type { LabState } from '../../labScreen'
import { ShotTableStage } from '../ShotTableStage'
const SOURCE = 'docs/plan/2026-09-10-left-sidebar-and-shot-table-node.md'
// 分镜表 / Agent 分镜表节点 0.24 退役（镜头在生成页「列表」里）；画布上的表只剩参考片拆解表。
export const SHOT_TABLE_STATES: readonly LabState[] = [
  {
    id: 'shot-table-facts-ready',
    name: '拆解表 · 事实就绪',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage />,
  },
  {
    id: 'shot-table-deconstructing',
    name: '拆解表 · 正在读画面',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ShotTableStage deconstructing />,
  },
]
