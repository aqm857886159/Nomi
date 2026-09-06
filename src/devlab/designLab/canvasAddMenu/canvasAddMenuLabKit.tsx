// 设计实验室 · 屏「画布加号收束」的取景台。
//
// 这一格渲染的是**现役组件本身**（`CanvasToolbar` / `NodeAddMenu`），不是照着它画的样张——
// 2026-09-06 用户拍板的「UI 交付定义」就是这一条：样张与实现是两套代码描述同一个东西，
// 中间靠人脑翻译，漂移是结构性的。
//
// 取景台只做两件事：
//  1. 给一块 `relative` 的舞台——工具条是 `absolute top-1/2 left-4`，没有定位祖先它会飘到视口上；
//  2. 需要「菜单已展开」那一格时，挂载后按一次真实的 ＋ 钮（走真实的 onClick，不另设一条 open 道）。
//
// 用 `useEffect` + rAF 而不是给组件加一个 `defaultOpen` 道具：多一个只有实验室用的开关就是
// 第二条打开路径（P1 并行版），而且它证明不了真实那条能不能打开。
import React from 'react'

export const CANVAS_ADD_CELL_WIDTH = 420
export const CANVAS_ADD_CELL_HEIGHT = 460

export function CanvasAddStage({
  openMore = false,
  children,
}: {
  /** 挂载后按一次左缘的 ＋ 钮，把这一格推到「更多菜单展开」的形态。 */
  openMore?: boolean
  children: React.ReactNode
}): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!openMore) return
    ref.current?.querySelector<HTMLButtonElement>('[data-canvas-add-more="true"]')?.click()
  }, [openMore])
  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: CANVAS_ADD_CELL_WIDTH, height: CANVAS_ADD_CELL_HEIGHT }}
      data-design-lab-stage="canvas-add-menu"
    >
      {children}
    </div>
  )
}
