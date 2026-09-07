// 设计实验室 · primitive 陈列三屏的共用取景台。
//
// 这三屏（primitives-actions / primitives-forms / primitives-surfaces）和别的屏不同：
// 别的屏画的是**某个功能界面**的形态，这三屏画的是 `src/design/` 那套**共用积木**本身。
// 动机（docs/plan/2026-09-07-design-system-optimization.md「实验室：补 primitive 屏」）：
// 在此之前 8 屏 134 张基线全是功能屏，primitive 层的漂移只有等它出现在某个功能屏上才被看见；
// 一个组件要是全仓零调用（当时有约 10 个），它的漂移就**永远**没人看见。
//
// 三条纪律：
//   1. 陈列渲染的必须是**现役组件本体**（从 `src/design` 导出口进来），不是照着它另画一份。
//      另画一份 = 第二个实现，改了生产代码这里照样绿，正是实验室要消灭的那种假证据。
//   2. 有交互的件（开关/分段/下拉）挂**真状态**，不挂空 handler——空 handler 让陈列变成
//      「看着能点、其实是张图」（`check:controls` 拦的正是那一族）。
//   3. 不碰 `src/design/` 的源码。陈列的活儿是把「有什么、长什么样」摆出来，不是顺手改它。
import React from 'react'

import { cn } from '../../../utils/cn'

/** 三屏共用的舞台宽：装得下「一行摆 3–4 个变体」的最宽那格，又不至于让接触表一列一屏。 */
export const PRIMITIVE_STAGE_WIDTH = 480
/** 接触表每格取景高。比最高的一格（表单四态）略高一点，留一线余量。 */
export const PRIMITIVE_CELL_HEIGHT = 320

/**
 * 一格陈列的舞台：白纸 + token 描边，与真机面板同一层底色。
 * 宽度固定（截图要确定性），高度随内容——陈列格的行数天然不等，钉死高度只会画出大片空白。
 */
export function PrimitiveStage({
  children,
  width = PRIMITIVE_STAGE_WIDTH,
}: {
  children: React.ReactNode
  width?: number
}): JSX.Element {
  return (
    <div
      data-design-lab-stage="primitive"
      className="flex flex-col gap-3 rounded-nomi border border-nomi-line bg-nomi-paper p-4 text-nomi-ink"
      style={{ width }}
    >
      {children}
    </div>
  )
}

/**
 * 一组同轴变体。`label` 是这一行在轴上的取值（如「variant=primary」「size=sm」），
 * 用 caption 级排版画——它是**陈列的坐标**，不是被陈列的组件，所以刻意比样本弱一档。
 */
export function Specimen({
  label,
  children,
  align = 'center',
  className,
}: {
  label: string
  children: React.ReactNode
  /** 竖排样本（输入框、空态这类整块件）用 stretch，横排小件用 center。 */
  align?: 'center' | 'stretch'
  className?: string
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-micro uppercase tracking-[0.08em] text-nomi-ink-40">{label}</div>
      <div
        className={cn(
          'flex flex-wrap gap-2',
          align === 'center' ? 'items-center' : 'flex-col items-stretch',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * 受控包装：给需要真状态的样本（开关、分段、下拉）用。
 *
 * 为什么要它：`LabState.render` 是个普通函数不是组件，里面调不了 hook。以前各屏的做法是
 * 每种交互件各写一个 `XxxStage` 组件；陈列屏一屏就有七八种，那样会写出七八个近重复的壳。
 * 这个泛型包装把「持有一个值 + 给出 setter」抽成一件事，样本本身仍是现役组件。
 */
export function Stateful<T>({
  initial,
  children,
}: {
  initial: T
  children: (value: T, setValue: (next: T) => void) => React.ReactNode
}): JSX.Element {
  const [value, setValue] = React.useState<T>(initial)
  return <>{children(value, setValue)}</>
}

/**
 * 展开态浮层的舞台：把浮层的 portal 目标钉在舞台里，并在**首帧之后**真的点一下触发钮。
 *
 * 与 `vendorOrderLabKit.ModelPickerStage` 同一手法（那边是模型下拉专用，这边是通用陈列）：
 * `useLayoutEffect` 里 ref 已指向真实节点，点击在同一帧内完成，`markReady` 的两帧 rAF
 * 之后浮层早就定好位了。自己另画一份「展开的下拉」= 第二个实现，见本文件头注纪律 1。
 */
export function OpenPopoverStage({
  height,
  triggerSelector = 'button[aria-label]',
  children,
  width = PRIMITIVE_STAGE_WIDTH,
}: {
  /** 舞台高度：要装得下展开后的浮层，否则按元素截图会把它悄悄截掉半截。 */
  height: number
  triggerSelector?: string
  children: (portalTarget: React.RefObject<HTMLDivElement>) => React.ReactNode
  width?: number
}): JSX.Element {
  const stageRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    stageRef.current?.querySelector<HTMLButtonElement>(triggerSelector)?.click()
  }, [triggerSelector])
  return (
    <div
      ref={stageRef}
      data-design-lab-stage="primitive-popover"
      className="relative rounded-nomi border border-nomi-line bg-nomi-paper p-4 text-nomi-ink"
      style={{ width, height }}
    >
      {children(stageRef)}
    </div>
  )
}
