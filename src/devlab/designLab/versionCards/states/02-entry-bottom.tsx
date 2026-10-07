// 设计实验室 · 版本卡片入口方案 A：叠卡从节点下沿露出，入口 = 下沿那一条（10-06 真画布实测：往右露的叠卡被连线把手盖住）。
//
// 这几格挂在真的 React Flow 画布内核里（versionCardsFlowLabKit），左右连线把手、选中后的「+」吸附区和生成框都是现役组件；
// 虚线框是实验室标注：红 = 把手命中区，蓝 = 版本入口。两块不重叠就是这一方案要证明的事。
import React from 'react'
import type { LabState } from '../../labScreen'
import { VersionEntryStage } from '../versionCardsFlowLabKit'

const SOURCE = '协调会话 10-06：入口与连线把手冲突，倾向方案 A（叠卡从下沿露出，右侧不当入口）'
const MIRRORS = 'src/workbench/generationCanvas/nodes/versionCards/NodeVersionCards.tsx:37'

export const VERSION_ENTRY_STATES: readonly LabState[] = [
  {
    id: 'vc-a1-collapsed',
    name: 'A · 收起、没选中：叠卡从下沿露出两层，右缘只多 2–4px 层次；右侧小圆点是连线把手',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage />,
  },
  {
    id: 'vc-a2-hover',
    name: 'A · 悬停下沿：叠卡往下扇开、露出「4 版」，点这条铺开',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage hover />,
  },
  {
    id: 'vc-a3-selected',
    name: 'A · 选中（320×180）：右侧「+」吸附区、下方生成框都在，下沿入口仍露在两者之间',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage selected hover />,
  },
  {
    id: 'vc-a4-small-selected',
    name: 'A · 小节点（240×135）选中：吸附区上下都超出节点，但只在左右两侧，下沿入口不受影响',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage small selected hover />,
  },
  {
    id: 'vc-a5-dark',
    name: 'A · 暗色：选中 + 悬停入口',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <VersionEntryStage selected hover />,
  },
  {
    id: 'vc-a6-en',
    name: 'EN · A · hover the bottom edge: "4 versions"',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage locale="en" hover />,
  },
  {
    id: 'vc-a7-selected-clean',
    name: 'A · 选中 + 悬停（不画标注，看真实样子）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage selected hover annotate={false} />,
  },
  {
    id: 'vc-a8-collapsed-clean',
    name: 'A · 收起没选中（不画标注）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage annotate={false} />,
  },
]
