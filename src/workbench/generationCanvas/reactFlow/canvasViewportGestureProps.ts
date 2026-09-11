/**
 * 「画布手势」设置 → React Flow 内核开关（2026-09-11 迁移回填①）。
 *
 * 为什么需要这一层：设置页那个二选一（#832，2026-07-31 用户拍板）在旧内核里是
 * `useCanvasViewportGestures.ts:433` 一句 `resolveWheelIntent(scheme, event)`；
 * 迁到 React Flow 时整条没接，于是滚轮恒缩放、设置选了没用、帮助浮层照着设置说了假话
 * （审计 docs/plan/2026-09-11-canvas-migration-audit.md ② 表「滚轮语义可配」那行）。
 *
 * 回填的方式是**声明式接框架的开关**，不是把旧的 wheel 监听器搬回来（R29：框架已提供的
 * 能力不许再长一份自研版）。装机版 @xyflow/react 12.11.5 已经替我们做掉了三件事：
 *   · `⌘/Ctrl + 滚轮` 与捏合两档恒缩放 —— `isPanOnScroll = panOnScroll && !zoomActivationKeyPressed`
 *     （@xyflow/system 0.0.81 dist/esm/index.js:3001）+ `if (event.ctrlKey && zoomOnPinch)`（:2762）；
 *   · Shift+滚轮 = 横向平移 —— `:2775` 的 `if (!isMacOs() && event.shiftKey) deltaX = event.deltaY`
 *     （macOS 由浏览器自己换轴），与旧版 `deltaX === 0 ? deltaY : deltaX` 同判据；
 *   · 缩放锚光标。
 * 所以本模块只剩一件事：把**那张真值表**翻译成两颗布尔。真值表本身仍然只有一个 owner
 * （`resolveWheelIntent`），这里不复制它的分支——复制一次，两拨人的语义就会开始漂。
 */
import { PanOnScrollMode } from '@xyflow/react'
import { resolveWheelIntent, type CanvasGestureScheme } from '../../../utils/canvasGesturePreference'

export type CanvasWheelGestureProps = {
  zoomOnScroll: boolean
  panOnScroll: boolean
  panOnScrollMode: PanOnScrollMode
  panOnScrollSpeed: number
}

/**
 * 裸滚轮（不按任何修饰键）这一档该缩放还是该平移，由共享真值表决定；
 * 其余组合（⌘/Ctrl、捏合、Shift）全部由内核按上面注释里的那三条自己处理。
 */
export function canvasWheelGestureProps(scheme: CanvasGestureScheme): CanvasWheelGestureProps {
  const bareWheelPans = resolveWheelIntent(scheme, { ctrlKey: false, metaKey: false }) === 'pan'
  return {
    zoomOnScroll: !bareWheelPans,
    panOnScroll: bareWheelPans,
    // 自由方向：触控板的斜向滑动被折成单轴，用户读到的是「画布卡住了」。
    panOnScrollMode: PanOnScrollMode.Free,
    // 1:1 跟手。React Flow 默认 0.5，同样的两指滑动只走一半路程；旧画布是
    // `scheduleOffset({ x: offset.x - panX … })`（OLD useCanvasViewportGestures.ts:439），
    // 与 1 等价——并排一试就能看出 0.5 不跟手。
    panOnScrollSpeed: 1,
  }
}
