import React, { type JSX } from 'react'
import StoryboardShotRow from '../../../workbench/creation/storyboard/shotRow/StoryboardShotRow'
import StoryboardAnchorZone from '../../../workbench/creation/storyboard/anchorZone/StoryboardAnchorZone'
import type { AnchorCardRuntime, ShotRowExec } from '../../../workbench/creation/storyboard/exec/storyboardRowStatus'
import { missingRequiredSlots, resolveShotArchetypeMode } from '../../../workbench/creation/storyboard/shotRow/shotRowModel'
import { tableFrameMediaBox } from '../../../workbench/creation/storyboard/shotRow/shotFrameGeometry'
import type { PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import { effectiveShotAspect } from '../../../workbench/generationCanvas/agent/storyboardShotScope'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import { labExec, NOOP } from '../storyboard/storyboardFixtures'
import { REUSE_IMAGE_MODELS, REUSE_VIDEO_MODELS } from './storyboardReuseFixtures'

/**
 * 第二轮版面（视觉列 + 内容列）的取景台。**只用三个版本（main / 上一版 / 本版）都有的 API**：
 * 表格递给行的那组 props、锚区的 props、`tableFrameMediaBox`——这样同一格能在三个版本上各渲染一次，成对出图。
 * 媒体盒和表格一样由 `tableFrameMediaBox(全表生效画幅)` 给出（真表 `StoryboardShotTable` 就是这么算的）。
 */
export const LAYOUT_WIDE = 900
export const LAYOUT_NARROW = 664

function currentRefUrls(shot: PlanShot): string[] {
  return Object.values(shot.referenceBindings ?? {}).flatMap((bindings) => bindings.map((binding) => binding.url))
}

export function LayoutStage({ width, children }: { width: number; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-nomi border border-nomi-line bg-nomi-paper" style={{ width }} data-design-lab-stage="storyboard-layout">
      {children}
    </div>
  )
}

export function LayoutRows({ plan, width, execs = {} }: { plan: StoryboardPlan; width: number; execs?: Partial<Record<number, Partial<ShotRowExec>>> }): JSX.Element {
  const box = tableFrameMediaBox(plan.shots.map((shot) => effectiveShotAspect(plan, shot)))
  return (
    <LayoutStage width={width}>
      <div className="flex flex-col divide-y divide-nomi-line-soft">
        {plan.shots.map((shot) => {
          const models = shot.shotKind === 'image' ? REUSE_IMAGE_MODELS : REUSE_VIDEO_MODELS
          const mode = resolveShotArchetypeMode(findModelOptionByIdentifier(models, shot.modelKey, shot.modelVendor), shot.modeId)?.mode ?? null
          const exec = labExec({ missingSlots: missingRequiredSlots(mode, shot, plan.anchors), ...execs[shot.index] })
          return (
            <StoryboardShotRow
              key={shot.index}
              shot={shot}
              anchors={plan.anchors}
              modelOptions={models}
              exec={exec}
              aspect={effectiveShotAspect(plan, shot)}
              frameBox={box}
              onChangeAspect={NOOP}
              skipped={false}
              onToggleSkip={NOOP}
              variants={[]}
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
              scenes={[]}
              targetShots={[]}
              allShots={plan.shots}
              sourcePosition={shot.index - 1}
              selected={false}
              onSelect={NOOP}
              isDragOver={false}
              draggable
              currentRefUrls={currentRefUrls(shot)}
              mentionSearch={() => []}
              onMentionSelect={() => null}
              onUpdate={NOOP}
              onRemove={NOOP}
            />
          )
        })}
      </div>
    </LayoutStage>
  )
}

export function LayoutAnchors({ cards, aspect, width }: { cards: AnchorCardRuntime[]; aspect: string; width: number }): JSX.Element {
  return (
    <LayoutStage width={width}>
      <div className="p-3">
        <StoryboardAnchorZone
          cards={cards}
          aspect={aspect}
          imageModelOptions={REUSE_IMAGE_MODELS}
          expanded
          onToggleExpanded={NOOP}
          onUpdateAnchor={NOOP}
          onChangeKind={NOOP}
          onRemoveAnchor={NOOP}
          onGenerateAnchor={NOOP}
          onRegenerateAnchor={NOOP}
          onToggleLockAnchor={NOOP}
          onFilterByAnchor={NOOP}
          onAddAnchor={NOOP}
        />
      </div>
    </LayoutStage>
  )
}
