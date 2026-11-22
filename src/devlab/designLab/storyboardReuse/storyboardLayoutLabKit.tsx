import React, { type JSX } from 'react'
import StoryboardShotRow from '../../../workbench/creation/storyboard/shotRow/StoryboardShotRow'
import { fixedEditorOwner } from '../fixedEditorOwner'
import { StoryboardRowsBox } from '../../../workbench/creation/storyboard/shotRow/storyboardRowDensity'
import StoryboardAnchorZone from '../../../workbench/creation/storyboard/anchorZone/StoryboardAnchorZone'
import type { AnchorCardRuntime, ShotRowExec } from '../../../workbench/creation/storyboard/exec/storyboardRowStatus'
import { missingRequiredSlots, resolveShotArchetypeMode } from '../../../workbench/creation/storyboard/shotRow/shotRowModel'
import { frameMediaBox } from '../../../workbench/creation/storyboard/shotRow/shotFrameGeometry'
import type { PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import { effectiveShotAspect, planDefaultAspect } from '../../../workbench/generationCanvas/agent/storyboardShotScope'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import type { ModelOption } from '../../../config/models'
import type { PlanShotPatch } from '../../../workbench/generationCanvas/agent/storyboardPlanEdits'
import { labExec, NOOP } from '../storyboard/storyboardFixtures'
import { REUSE_IMAGE_MODELS, REUSE_VIDEO_MODELS } from './storyboardReuseFixtures'
import { LabLocaleGate } from '../labLocaleGate'

/**
 * 第二轮版面（视觉列 + 内容列）的取景台。**只用三个版本（main / 上一版 / 本版）都有的 API**：
 * 表格递给行的那组 props、锚区的 props、整片画幅的预览框——这样同一格能在三个版本上各渲染一次，成对出图。
 * 媒体盒和表格一样由 `frameMediaBox(planDefaultAspect(plan))` 给出（真表 `StoryboardShotTable` 就是这么算的）。
 */
export const LAYOUT_WIDE = 900
export const LAYOUT_NARROW = 664

function currentRefUrls(shot: PlanShot): string[] {
  return Object.values(shot.referenceBindings ?? {}).flatMap((bindings) => bindings.map((binding) => binding.url))
}

export function LayoutStage({ width, children }: { width: number; children: React.ReactNode }): JSX.Element {
  // 证据脚本用 ?lang=en 把同一格再截一遍英文（格子本身只登记中文一份；不带参数时原样，不动存量格的语言）。
  const english = new URL(window.location.href).searchParams.get('lang') === 'en'
  const rows = (
    <StoryboardRowsBox className="rounded-nomi border border-nomi-line bg-nomi-paper" style={{ width }} data-design-lab-stage="storyboard-layout">
      {children}
    </StoryboardRowsBox>
  )
  return english ? <LabLocaleGate locale="en">{rows}</LabLocaleGate> : rows
}

type LabModels = { video: readonly ModelOption[]; image: readonly ModelOption[] }

export function LayoutRows({ plan, width, execs = {}, models: catalog }: { plan: StoryboardPlan; width: number; execs?: Partial<Record<number, Partial<ShotRowExec>>>; models?: LabModels }): JSX.Element {
  const box = frameMediaBox(planDefaultAspect(plan))
  // 行里改的值（面板里点时长、换比例）留在格子里：走查要看「改了值之后底栏怎么让」，静止态不受影响。
  const [edits, setEdits] = React.useState<Partial<Record<number, PlanShotPatch>>>({})
  return (
    <LayoutStage width={width}>
      <div className="flex flex-col divide-y divide-nomi-line-soft">
        {plan.shots.map((planned) => {
          const shot = { ...planned, ...edits[planned.index] } as PlanShot
          const models = [...(shot.shotKind === 'image' ? catalog?.image ?? REUSE_IMAGE_MODELS : catalog?.video ?? REUSE_VIDEO_MODELS)]
          const mode = resolveShotArchetypeMode(findModelOptionByIdentifier(models, shot.modelKey, shot.modelVendor), shot.modeId)?.mode ?? null
          const exec = labExec({ missingSlots: missingRequiredSlots(mode, shot, plan.anchors), ...execs[shot.index] })
          return (
            <StoryboardShotRow
              key={shot.index}
              shot={shot}
              promptSource={fixedEditorOwner(shot.prompt)}
              anchors={plan.anchors}
              modelOptions={models}
              exec={exec}
              aspect={effectiveShotAspect(plan, shot)}
              frameBox={box}
              onChangeAspect={NOOP}
              variants={[]}
              onGenerate={NOOP}
              onRegenerate={NOOP}
              onToggleFrozen={NOOP}
              onOpenPreview={NOOP}
              onInsertBelow={NOOP}
              onCopy={NOOP}
              onMoveToScene={NOOP}
              scenes={[]}
              selected={false}
              onSelect={NOOP}
              isDragOver={false}
              draggable
              currentRefUrls={currentRefUrls(shot)}
              mentionSearch={() => []}
              onMentionSelect={() => null}
              onUpdate={(patch) => setEdits((prev) => ({ ...prev, [shot.index]: { ...prev[shot.index], ...patch } }))}
              onRemove={NOOP}
            />
          )
        })}
      </div>
    </LayoutStage>
  )
}

export function LayoutAnchors({ cards, aspect, width, imageModels }: { cards: AnchorCardRuntime[]; aspect: string; width: number; imageModels?: readonly ModelOption[] }): JSX.Element {
  return (
    <LayoutStage width={width}>
      <div className="p-3">
        <StoryboardAnchorZone
          cards={cards}
          aspect={aspect}
          imageModelOptions={[...(imageModels ?? REUSE_IMAGE_MODELS)]}
          expanded
          onToggleExpanded={NOOP}
          onUpdateAnchor={NOOP}
          onChangeKind={NOOP}
          onRemoveAnchor={NOOP}
          onGenerateAnchor={NOOP}
          onRegenerateAnchor={NOOP}
          onToggleFrozenAnchor={NOOP}
          onFilterByAnchor={NOOP}
          onAddAnchor={NOOP}
        />
      </div>
    </LayoutStage>
  )
}
