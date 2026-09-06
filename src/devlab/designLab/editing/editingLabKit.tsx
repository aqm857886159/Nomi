// 设计实验室 · 剪辑面（editing 屏）的取景台。
//
// 和 Agent 面板那屏的区别在于**这一族东西都是浮层**：转场选择器 Portal 到 body，
// 右键菜单和快捷键面板是 `position: fixed`。三种都会跑出普通容器，取景框如果只是
// 一个 div，截图截到的就是一个空盒子——浮层画在别的地方去了。
//
// 所以这里有两种取景台，各自解决一半：
//   · `FixedStage`：给自己开 `transform`。CSS 里只要祖先有 transform（≠ none），
//     后代的 `position: fixed` 就改按这个祖先定位——`fixed inset-0` 的遮罩于是铺满取景框
//     而不是铺满整个视口，居中的对话框也居在框里。用于右键菜单、快捷键面板。
//   · `AnchoredStage`：Portal 到 body 的浮层没法用 transform 收编（它压根不在树里），
//     所以换个思路——取景框够大，锚点放在左上角，浮层落在框**上面**。
//     Playwright 的元素截图是「整页渲染后按元素的框裁」，盖在框上的浮层照样进图。
//     `frame=1` 单格模式下取景框贴着视口原点，所以浮层一定落在可见区内。
//
// 夹具灌 store 用 `useMemo` 而不是 `useEffect`：晚一帧灌会先渲染一次空态，
// 截图捕到那一帧就成了「面板是空的」的假证据（同 agentPanelKit.ShellStage 的理由）。
import React from 'react'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { EDITING_PANEL_DEFAULTS } from '../../../workbench/preview/panelLayout'
import { labTimeline } from './editingFixtures'
import type { TimelineState } from '../../../workbench/timeline/timelineTypes'

/** 属性面板取景宽 = 现役默认面板宽（panelLayout 的单一真相源），不另抄一个数。 */
export const INSPECTOR_WIDTH = EDITING_PANEL_DEFAULTS.inspectorWidth
export const INSPECTOR_HEIGHT = 560

/**
 * 接触表一格的取景尺寸。这屏各状态取景框大小不一（浮层 300–420 宽、属性面板一条窄柱），
 * 按最宽/最高的那一格开格子，免得宽件被挤成两行。屏注册表（`labScreens.ts`）从这里取，
 * 不另抄一个数。
 */
export const EDITING_CELL_WIDTH = 420
export const EDITING_CELL_HEIGHT = 480

export const NOOP = (): void => {}

/**
 * 把固定时间轴 + 一个选中态灌进 store，返回 store 里那条（活的）时间轴。
 * 选中态就是对象态的真相源：`selectedTimelineClipIds` / `selectedTextClipId`
 * 决定属性面板显示整片、片段、字幕还是配乐（PreviewInspector.tsx:56-58）。
 *
 * 入参刻意是两个字符串而不是一个对象/数组：对象字面量每次渲染都是新的，
 * useMemo 会每渲染一次就 setState 一次，而 setState 又让订阅者重渲染——自转不停。
 */
export function useLabTimeline(selectedClipId = '', selectedTextClipId = ''): TimelineState {
  React.useMemo(() => {
    useWorkbenchStore.setState({
      timeline: labTimeline(),
      selectedTimelineClipIds: selectedClipId ? [selectedClipId] : [],
      selectedTextClipId,
      previewAspectRatio: '16:9',
      exportResolution: '1080p',
      exportQuality: 'standard',
    })
    return null
  }, [selectedClipId, selectedTextClipId])
  return useWorkbenchStore((state) => state.timeline)
}

/** 属性面板取景框：给 `h-full` 一个真实高度，其余按现役面板宽。 */
export function InspectorStage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg"
      style={{ width: INSPECTOR_WIDTH, height: INSPECTOR_HEIGHT }}
      data-design-lab-stage="inspector"
    >
      {children}
    </div>
  )
}

/**
 * `position: fixed` 浮层的取景框。`transform` 让它成为 fixed 后代的包含块——
 * 这一行就是「遮罩铺满整个视口」和「遮罩铺满这一格」的全部区别。
 */
export function FixedStage({
  width,
  height,
  children,
}: {
  width: number
  height: number
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      className="relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width, height, transform: 'translate(0, 0)' }}
      data-design-lab-stage="fixed"
    >
      {children}
    </div>
  )
}

/**
 * Portal 浮层的取景框：左上角放一颗真锚点，浮层贴着它落下来、盖在框上。
 * `render` 拿到 anchorRef，自己决定挂什么。
 */
export function AnchoredStage({
  width,
  height,
  anchorLabel,
  render,
}: {
  width: number
  height: number
  anchorLabel: string
  render: (anchorRef: React.RefObject<HTMLButtonElement>) => React.ReactNode
}): JSX.Element {
  // 锚点和浮层同一次 commit 挂载：ref 在 layout effect 之前就已绑好，
  // AnchoredPopover 首帧量得到 rect，不需要延后一帧。
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  return (
    <div
      className="relative overflow-visible rounded-nomi border border-nomi-line bg-[var(--workbench-surface)] p-4"
      style={{ width, height }}
      data-design-lab-stage="anchored"
    >
      <button
        ref={anchorRef}
        type="button"
        className="rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] px-2 py-1 text-micro text-[var(--workbench-muted)]"
      >
        {anchorLabel}
      </button>
      {render(anchorRef)}
    </div>
  )
}
