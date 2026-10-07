// 设计实验室 · 版本入口 = 图片右上角内侧的数字角标（用户 2026-10-07 拍板，替换 10-06 的叠卡 / 下沿入口）。
//
// 这几格挂在真的 React Flow 画布内核里（versionCardsFlowLabKit）：左右连线把手、选中后的「+」吸附区、浮条、生成框、
// 铺开的宫格都是现役组件，看角标和它们挤不挤。悬停态是纯 CSS（底色变实），走查里用真指针悬停截图，不另做一格。
import React from 'react'
import type { LabState } from '../../labScreen'
import { VersionEntryStage } from '../versionCardsFlowLabKit'

const SOURCE = '协调会话 10-07：用户在三种入口里选了「① 角标数字」（右上角内侧、只写数字、浅色胶囊）'
const MIRRORS = 'src/workbench/generationCanvas/nodes/versionCards/NodeVersionCards.tsx:36'

export const VERSION_ENTRY_STATES: readonly LabState[] = [
  {
    id: 'vc-b1-resting',
    name: '平时：节点就是一张图 + 右上角一个数字「4」；左右小圆点是连线把手',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage />,
  },
  {
    id: 'vc-b2-light-image',
    name: '浅色画面上：浅底 + 细描边 + 轻阴影，照样看得清',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage light />,
  },
  {
    id: 'vc-b3-selected',
    name: '选中：上方浮条、左右「+」、下方生成框都在，角标在图片右上角内侧不和它们挤',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage selected />,
  },
  {
    id: 'vc-b4-expanded',
    name: '铺开：点角标原地铺成宫格，角标变按下态；再点它或按 Esc 收起',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage expanded />,
  },
  {
    id: 'vc-b5-dark-selected',
    name: '暗色 · 选中',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <VersionEntryStage selected />,
  },
  {
    id: 'vc-b6-dark-expanded',
    name: '暗色 · 铺开',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <VersionEntryStage expanded />,
  },
  {
    id: 'vc-b7-video',
    name: '视频节点：底部是进度条，右上角角标不冲突',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage kind="video" count={3} />,
  },
  {
    id: 'vc-b8-twelve-expanded',
    name: '12 版：角标写「12」；铺开时宫格前 8 格 +「+4」',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage count={12} expanded />,
  },
  {
    id: 'vc-b9-en-selected',
    name: 'EN · selected: the badge is just a number',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage locale="en" selected />,
  },
  {
    id: 'vc-b10-en-expanded',
    name: 'EN · laid out',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionEntryStage locale="en" expanded />,
  },
]
