// 设计实验室 · 剪辑面 · 转场选择器
//
// 顺序有意义：`labStates.mjs` 按本屏目录（screens/editing/）里 `NN-*.tsx` 的文件名排序解析，
// 同目录的 `index.tsx` 按同样顺序拼接，走查再拿活页面的 `window.__designLabStates`
// 与解析结果逐项比对——三者对不上当场红。加状态时别打乱文件名的数字前缀。
//
// 这一族**必须**留在实验室里：2026-09-06 之前这个选择器是原地 `absolute`，
// 被轨道格的 `overflow-hidden` 裁成一条边，49 个采样点只命中 7 个，而 DOM 断言全绿
// （见 src/design/AnchoredPopover.tsx 顶部）。裁切在 DOM 和 rect 上都看不出来，
// 只有截图看得出来——所以它的回归防线只能是一张图。
import React from 'react'
import { TimelineTransitionPicker } from '../../../../workbench/timeline/TimelineTransitionPicker'
import { resolveTimelineTransitionFeedback } from '../../../../workbench/timeline/timelineVisualFeedback'
import type { TimelineTransitionType } from '../../../../workbench/timeline/timelineTypes'
import { LAB_TRANSITION } from '../editingFixtures'
import { AnchoredStage, NOOP, useLabTimeline } from '../editingLabKit'
import type { LabState } from '../../labScreen'

const STAGE = { width: 420, height: 340 }

function PickerCell({ type }: { type: TimelineTransitionType }): JSX.Element {
  const timeline = useLabTimeline()
  // 反馈对象由现役解析器算，不手写：durationFrames 的钳制、connected/unsupported 的判定
  // 都住在 resolveTimelineTransitionFeedback 里，手抄一份就是第二个真相源。
  const feedback = resolveTimelineTransitionFeedback(timeline.tracks, [{ ...LAB_TRANSITION, type }])[0]
  return (
    <AnchoredStage
      width={STAGE.width}
      height={STAGE.height}
      anchorLabel="接缝 · 镜 1 → 镜 2"
      render={(anchorRef) => (
        <TimelineTransitionPicker feedback={feedback} fps={timeline.fps} anchorRef={anchorRef} onClose={NOOP} />
      )}
    />
  )
}

export const TRANSITION_PICKER_STATES: readonly LabState[] = [
  {
    id: 'picker-01-dissolve',
    name: '转场选择器 · 溶解（带时长步进）',
    source: '现役 TimelineTransitionPicker.tsx · 走 AnchoredPopover（Portal 到 body）',
    coverage: 'shell',
    render: () => <PickerCell type="dissolve" />,
  },
  {
    id: 'picker-02-cut',
    name: '转场选择器 · 硬切（无时长行）',
    source: '现役 TimelineTransitionPicker.tsx：type==="cut" 时时长行整行不出现',
    coverage: 'shell',
    render: () => <PickerCell type="cut" />,
  },
  {
    id: 'picker-03-unsupported',
    name: '转场选择器 · 甩镜（不支持提示）',
    source: '现役 TimelineTransitionPicker.tsx：match_cut / whip_pan 落 unsupportedNotice',
    coverage: 'shell',
    render: () => <PickerCell type="whip_pan" />,
  },
]
