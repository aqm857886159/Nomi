// 设计实验室 · 剪辑面 · 时间轴右键菜单（四种 target）
//
// 顺序有意义：`labStates.mjs` 按本屏目录（screens/editing/）里 `NN-*.tsx` 的文件名排序解析，
// 同目录的 `index.tsx` 按同样顺序拼接，走查再拿活页面的 `window.__designLabStates`
// 与解析结果逐项比对——三者对不上当场红。加状态时别打乱文件名的数字前缀。
//
// 菜单是 `position: fixed`，所以取景用 `FixedStage`（它开了 transform，把 fixed 收进这一格）。
// 四种 target 各是一条独立分支（TimelineContextMenu.tsx:48/66/92/110），条目数和危险色都不同，
// 一格看一条——把四种挤进一张图就没法逐项对账了。
import React from 'react'
import { TimelineContextMenu, type TimelineContextTarget } from '../../../../workbench/timeline/TimelineContextMenu'
import { LAB_TEXT_ID, LAB_VIDEO_A_ID, LAB_VIDEO_B_ID } from '../editingFixtures'
import { FixedStage, NOOP, useLabTimeline } from '../editingLabKit'
import type { LabState } from '../../labScreen'

function MenuCell({ target, height }: { target: TimelineContextTarget; height: number }): JSX.Element {
  useLabTimeline()
  return (
    <FixedStage width={300} height={height}>
      <TimelineContextMenu target={target} x={16} y={16} onClose={NOOP} onRegenerate={NOOP} onChangeTransition={NOOP} onArrange={NOOP} />
    </FixedStage>
  )
}

export const CONTEXT_MENU_STATES: readonly LabState[] = [
  {
    id: 'menu-01-clip',
    name: '右键菜单 · 片段（8 项，5 项危险）',
    source: '现役 TimelineContextMenu.tsx:48 —— kind="clip"',
    coverage: 'shell',
    render: () => <MenuCell height={320} target={{ kind: 'clip', clipId: LAB_VIDEO_A_ID, trackId: 'videoTrack' }} />,
  },
  {
    id: 'menu-02-transition',
    name: '右键菜单 · 转场（改 / 套用到所有接缝 / 删）',
    source: '现役 TimelineContextMenu.tsx:92 —— kind="transition"',
    coverage: 'shell',
    render: () => <MenuCell height={160} target={{ kind: 'transition', fromClipId: LAB_VIDEO_A_ID, toClipId: LAB_VIDEO_B_ID }} />,
  },
  {
    id: 'menu-03-text',
    name: '右键菜单 · 字幕（含「对齐到所在镜头」）',
    source: '现役 TimelineContextMenu.tsx:66 —— kind="text"',
    coverage: 'shell',
    render: () => <MenuCell height={200} target={{ kind: 'text', textClipId: LAB_TEXT_ID }} />,
  },
  {
    id: 'menu-04-track',
    name: '右键菜单 · 空轨（AI 拼片 / 从素材库添加）',
    source: '现役 TimelineContextMenu.tsx:110 —— kind="track"',
    coverage: 'shell',
    render: () => <MenuCell height={140} target={{ kind: 'track', trackId: 'imageTrack' }} />,
  },
]
