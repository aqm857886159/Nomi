import React from 'react'
import StoryboardShotRow from '../../../workbench/creation/storyboard/shotRow/StoryboardShotRow'
import type { PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import {
  ASPECT_OPTIONS,
  effectiveShotAspect,
  isAspectOverridden,
} from '../../../workbench/generationCanvas/agent/storyboardAspectScope'
import type { ShotRowExec } from '../../../workbench/creation/storyboard/exec/storyboardRowStatus'
import type { ShotVariant } from '../../../workbench/creation/storyboard/shotRow/shotVariants'
import { LAB_ANCHORS, LAB_IMAGE_MODELS, LAB_VIDEO_MODELS, labExec, labPlan, labShot, NOOP } from './storyboardFixtures'

/**
 * 分镜表屏的取景台。
 *
 * 舞台宽度 900：行是 `14 | 136 | 200 | 1fr`，900 给提示词块留下约 520px——接近真机
 * （创作区表格容器在 1440 视口下约 900–1000 宽）。窄了会让底栏胶囊换行，那是**取景失真**，
 * 不是设计问题，基线上却看不出区别。
 */
export const STAGE_WIDTH = 900
export const STAGE_HEIGHT = 260

export function TableStage({
  height,
  clip = true,
  children,
}: {
  height?: number
  /** 菜单/抽屉这类要溢出行外的形态取景时关掉裁剪，否则截出来是被切一半的菜单（假证据）。 */
  clip?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      className={`rounded-nomi border border-nomi-line bg-nomi-paper${clip ? ' overflow-hidden' : ''}`}
      style={{ width: STAGE_WIDTH, ...(height ? { height } : {}) }}
      data-design-lab-stage="storyboard"
    >
      {children}
    </div>
  )
}

/**
 * 打开"要点一下才出现"的形态（⋯ 菜单、槽浮层、变体抽屉）。
 *
 * 为什么用点击而不是给组件加一个 lab-only 的 `defaultOpen`：那种 prop 只有实验室会传，
 * 于是基线钉住的是**一条真机永远走不到的分支**——看着绿，实际没验到用户点开时的那条路。
 * 这里点的是真按钮，走的是真状态机。
 */
export function AutoClick({ selector, children }: { selector: string; children: React.ReactNode }): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(selector)?.click()
  }, [selector])
  return <div ref={ref}>{children}</div>
}

/** 同上，但只聚焦不点击——用于"点了会改数据"的入口（如行间插入线）。 */
export function AutoFocus({ selector, children }: { selector: string; children: React.ReactNode }): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(selector)?.focus()
  }, [selector])
  return <div ref={ref}>{children}</div>
}

type RowOverrides = {
  shot?: Partial<PlanShot>
  plan?: Partial<StoryboardPlan>
  exec?: Partial<ShotRowExec>
  skipped?: boolean
  variants?: readonly ShotVariant[]
  adoptedVariantId?: string
  outputTag?: string
  selected?: boolean
  isDragOver?: boolean
}

/**
 * 一整行的取景：喂真组件（`StoryboardShotRow`）固定 props。
 * 所有回调是 no-op——实验室不改数据，它只负责"长成这样对不对"。
 */
export function RowStage(overrides: RowOverrides & { clip?: boolean } = {}): JSX.Element {
  const shot = labShot({ index: 1, ...overrides.shot })
  const plan = labPlan({ shots: [shot], ...overrides.plan })
  const exec = labExec(overrides.exec)
  return (
    <TableStage clip={overrides.clip ?? true}>
      <StoryboardShotRow
        shot={shot}
        anchors={LAB_ANCHORS}
        modelOptions={shot.shotKind === 'image' ? LAB_IMAGE_MODELS : LAB_VIDEO_MODELS}
        danglingIds={[]}
        exec={exec}
        aspect={effectiveShotAspect(plan, shot)}
        aspectOverridden={isAspectOverridden(plan, shot)}
        aspectOptions={ASPECT_OPTIONS}
        onChangeAspect={NOOP}
        skipped={overrides.skipped ?? false}
        onToggleSkip={NOOP}
        variants={overrides.variants ?? []}
        adoptedVariantId={overrides.adoptedVariantId}
        outputTag={overrides.outputTag}
        onGenerate={NOOP}
        onRegenerate={NOOP}
        onToggleLock={NOOP}
        onOpenPreview={NOOP}
        onAgentHandoff={NOOP}
        onInsertAbove={NOOP}
        onInsertBelow={NOOP}
        onSaveAsReference={NOOP}
        onCopy={NOOP}
        onMoveToScene={NOOP}
        scenes={plan.scenes ?? []}
        targetShots={[]}
        allShots={plan.shots}
        sourcePosition={0}
        selected={overrides.selected ?? false}
        onSelect={NOOP}
        isDragOver={overrides.isDragOver ?? false}
        draggable
        onUpdate={NOOP}
        onToggleAnchor={NOOP}
        onRemove={NOOP}
      />
    </TableStage>
  )
}

/** 一行「换个模型/模式」的快捷取景——槽矩阵那六格全靠它，只换 modelKey/modeId。 */
export function SlotMatrixRow(modelKey: string, modeId: string, shot?: Partial<PlanShot>): JSX.Element {
  return RowStage({ shot: { modelKey, modeId, referenceBindings: {}, ...shot } })
}
