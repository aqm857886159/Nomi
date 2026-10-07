// 设计实验室 · 画布 · 版本卡片（宫格）——用户 2026-10-06 改向后的样张，等他拍板再接进节点（V2）。
//
// 顺序有意义：`labStates.mjs` 按文件名排序解析本屏 `states/`。
import React from 'react'
import type { LabState } from '../../labScreen'
import { VersionCardsStage } from '../versionCardsLabKit'

const SOURCE = 'docs/plan/2026-10-06-version-cards-reconcile.md §7（用户 10-06：和节点一样、宫格、去图标）'
const MIRRORS = 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:484'

const NEIGHBOURS = [
  { id: 'vc-n1', title: '镜头 1 · 雨夜入场', x: 440, y: 120, versionNo: 7 },
  { id: 'vc-n2', title: '镜头 2 · 推近', x: 700, y: 330, versionNo: 9 },
] as const
const NEIGHBOURS_EN = [
  { id: 'vc-n1', title: 'Shot 1 · Night entrance', x: 440, y: 120, versionNo: 7 },
  { id: 'vc-n2', title: 'Shot 2 · Push in', x: 700, y: 330, versionNo: 9 },
] as const

export const VERSION_CARD_GRID_STATES: readonly LabState[] = [
  {
    id: 'vc-01-collapsed',
    name: '收起：节点就是一张图，右上角内侧一个数字角标（10-07 拍板）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={4} neighbours={NEIGHBOURS} />,
  },

  {
    id: 'vc-03-open-2',
    name: '铺开 2 版：1×2，最新一版贴着节点；角标变按下态，再点它收起',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={2} expanded />,
  },
  {
    id: 'vc-04-open-4-hover',
    name: '铺开 4 版：2×2；悬停第 3 版出动作条（设为主图 / 下载 / 删除）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={4} expanded hoverVersion={3} />,
  },
  {
    id: 'vc-05-open-9',
    name: '铺开 9 版：3×3',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={9} expanded at={{ x: 60,
    y: 60 }} />,
  },
  {
    id: 'vc-06-open-12-more',
    name: '12 版：先铺 8 张 +「+4」（最早的 4 版收在里面）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={12} expanded at={{ x: 60,
    y: 60 }} />,
  },
  {
    id: 'vc-07-open-12-all',
    name: '12 版点开「+4」：全部铺开，4×3',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    span: 2,
    render: () => <VersionCardsStage count={12} expanded showAll at={{ x: 20,
    y: 40 }} />,
  },
  {
    id: 'vc-08-right-edge',
    name: '节点贴着画布右沿：往左铺（顺序镜像，最新仍贴着节点）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={4} expanded at={{ x: 980,
    y: 140 }} />,
  },
  {
    id: 'vc-09-covers-neighbour',
    name: '铺开盖住邻居：版本卡在上面（09-28 拍板），点邻居它就浮上来',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={6} expanded neighbours={NEIGHBOURS} />,
  },
  {
    id: 'vc-10-pending',
    name: '铺开时在节点上再出一版：宫格最前一格是「生成中」占位（只是位置，不是按钮）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={4} expanded pending />,
  },
  {
    id: 'vc-11-deleted-toast',
    name: '删掉第 3 版：不弹框，提示条给「撤销」（⌘/Ctrl+Z 同样能撤）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={4} removed={[3]} expanded toast="deleted" />,
  },
  {
    id: 'vc-12-primary-set-toast',
    name: '设第 2 版为主图：提示条写下游几个节点下次生成会用它 + 撤销',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage count={4} expanded primaryVersion={2} toast="primary-set" />,
  },
  {
    id: 'vc-13-open-4-dark',
    name: '暗色 · 铺开 4 版 + 悬停动作条',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <VersionCardsStage count={4} expanded hoverVersion={3} />,
  },
  {
    id: 'vc-14-covers-dark',
    name: '暗色 · 盖住邻居',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <VersionCardsStage count={6} expanded neighbours={NEIGHBOURS} />,
  },

  {
    id: 'vc-16-open-4-en',
    name: 'EN · four versions laid out, hover bar',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage locale="en" count={4} expanded hoverVersion={3} />,
  },
  {
    id: 'vc-17-more-en-dark',
    name: 'EN · dark · 12 versions: 8 + "+4"',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <VersionCardsStage locale="en" count={12} expanded at={{ x: 60,
    y: 60 }} />,
  },
  {
    id: 'vc-18-deleted-en',
    name: 'EN · deleted version 3, toast with Undo',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage locale="en" count={4} removed={[3]} expanded toast="deleted" />,
  },
  {
    id: 'vc-19-pending-en',
    name: 'EN · generating placeholder at the head of the grid',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    render: () => <VersionCardsStage locale="en" count={4} expanded pending />,
  },
]
