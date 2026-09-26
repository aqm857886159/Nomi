import React from 'react'
import StoryboardShotRow from '../../../workbench/creation/storyboard/shotRow/StoryboardShotRow'
import { AssetPreviewDialog, type AssetPreviewSequenceItem } from '../../../workbench/assets/AssetPreviewDialog'
import type { AssetRef } from '../../../workbench/assets/assetTypes'
import type { PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import {
  ASPECT_OPTIONS,
  effectiveShotAspect,
  isAspectOverridden,
} from '../../../workbench/generationCanvas/agent/storyboardShotScope'
import { tableFrameMediaBox } from '../../../workbench/creation/storyboard/shotRow/shotFrameGeometry'
import type { ShotRowExec } from '../../../workbench/creation/storyboard/exec/storyboardRowStatus'
import type { ShotVariant } from '../../../workbench/creation/storyboard/shotRow/shotVariants'
import { FRAME_COLUMN_WIDTH } from '../../../workbench/creation/storyboard/shotRow/shotFrameGeometry'
import { REFERENCE_COLUMN_WIDTH } from '../../../workbench/creation/storyboard/shotRow/shotReferenceStackGeometry'
import { missingRequiredSlots, resolveShotArchetypeMode } from '../../../workbench/creation/storyboard/shotRow/shotRowModel'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import { LAB_ANCHORS, LAB_IMAGE_MODELS, LAB_VIDEO_MODELS, labExec, labPlan, labShot, NOOP } from './storyboardFixtures'

/**
 * 分镜表屏的取景台。
 *
 * 舞台宽度 900：行是 `14 | 136 | 200 | 1fr`，900 给提示词块留下约 520px——接近真机
 * （创作区表格容器在 1440 视口下约 900–1000 宽）。窄了会让底栏胶囊换行，那是**取景失真**，
 * 不是设计问题，基线上却看不出区别。
 */
export const STAGE_WIDTH = 900

/**
 * 「装不下」那一档的取景宽度——**从行几何 derive，不是挑一个看着窄的数**。
 *
 * 行固定 68（行首 14 + 三个 `gap-3` 36 + `pl-1.5`/`pr-3` 18）+ 画面格列 + 参考列，
 * 剩下的就是提示词列，也就是底栏的宽度。这里取「底栏 ≈ 389」那一档：
 * 1280 视口 + Agent 面板展开 + 创作内容列收起时，真机量出来的就是这个数。
 */
export const NARROW_STAGE_WIDTH =
  389 + 68 + FRAME_COLUMN_WIDTH + REFERENCE_COLUMN_WIDTH
export const STAGE_HEIGHT = 260

export function TableStage({
  height,
  width,
  clip = true,
  children,
}: {
  height?: number
  /** 取景宽度。缺省 = `STAGE_WIDTH`；要照「装不下」那一档时传窄档宽。 */
  width?: number
  /** 菜单/抽屉这类要溢出行外的形态取景时关掉裁剪，否则截出来是被切一半的菜单（假证据）。 */
  clip?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      className={`rounded-nomi border border-nomi-line bg-nomi-paper${clip ? ' overflow-hidden' : ''}`}
      style={{ width: width ?? STAGE_WIDTH, ...(height ? { height } : {}) }}
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
  sourceSegment?: { id: string; edited: boolean }
}

/**
 * 一整行的取景：喂真组件（`StoryboardShotRow`）固定 props。
 * 所有回调是 no-op——实验室不改数据，它只负责"长成这样对不对"。
 */
export function RowStage(overrides: RowOverrides & { clip?: boolean; width?: number; height?: number } = {}): JSX.Element {
  const shot = labShot({ index: 1, ...overrides.shot })
  const plan = labPlan({ shots: [shot], ...overrides.plan })
  // 红格读 exec.missingSlots（与真机同一个 owner）：夹具不自己编「缺什么」，按这一行的模式问 missingRequiredSlots。
  // 场景要演别的状态时（如 sb-row-05）照样可以整份覆盖。
  const models = shot.shotKind === 'image' ? LAB_IMAGE_MODELS : LAB_VIDEO_MODELS
  const mode = resolveShotArchetypeMode(findModelOptionByIdentifier(models, shot.modelKey, shot.modelVendor), shot.modeId)?.mode ?? null
  const exec = labExec({ missingSlots: missingRequiredSlots(mode, shot, LAB_ANCHORS), ...overrides.exec })
  return (
    <TableStage clip={overrides.clip ?? true} width={overrides.width} height={overrides.height}>
      <StoryboardShotRow
        shot={shot}
        anchors={LAB_ANCHORS}
        modelOptions={shot.shotKind === 'image' ? LAB_IMAGE_MODELS : LAB_VIDEO_MODELS}
        danglingIds={[]}
        exec={exec}
        aspect={effectiveShotAspect(plan, shot)}
        frameBox={tableFrameMediaBox([effectiveShotAspect(plan, shot)])}
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
        sourceSegment={overrides.sourceSegment}
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

function labAsset(id: string, kind: 'image' | 'video', renderUrl: string): AssetRef {
  return { id, kind, name: id, renderUrl, source: 'project', origin: { source: 'project', projectId: 'design-lab', relativePath: id } }
}

/** 播放器三种实验室登记态：播放中、含未生成占位、全部未生成空态。 */
export function PlaybackStage({ variant }: { variant: 'playing' | 'skipped' | 'empty' }): JSX.Element {
  const image = labAsset('lab-playback-image', 'image', 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#243244"/><text x="160" y="96" fill="white" text-anchor="middle" font-size="18">playback</text></svg>'))
  const sequence: AssetPreviewSequenceItem[] = variant === 'empty'
    ? [1, 2].map((index) => ({ asset: labAsset(`empty-${index}`, 'image', ''), playable: false, label: `镜 ${index}：未生成` }))
    : variant === 'skipped'
      ? [{ asset: labAsset('empty-1', 'image', ''), playable: false, label: '镜 1：未生成' }, { asset: image, playable: true, durationSec: 3 }]
      : [{ asset: image, playable: true, durationSec: 3 }, { asset: labAsset('empty-2', 'image', ''), playable: false, label: '镜 2：未生成' }, { asset: image, playable: true, durationSec: 3 }]
  const [open, setOpen] = React.useState(true)
  return (
    <TableStage clip={false}>
      <div className="h-40 p-4 text-caption text-nomi-ink-40">
        <span className="mr-2">播放弹层状态</span>
        <span className="rounded-pill bg-nomi-ink-05 px-2 py-0.5">镜序</span>
        <span className="ml-2 rounded-pill bg-nomi-ink-05 px-2 py-0.5">进度</span>
      </div>
      {open ? <AssetPreviewDialog asset={sequence[0].asset!} sequence={sequence} onClose={() => setOpen(false)} /> : null}
    </TableStage>
  )
}
