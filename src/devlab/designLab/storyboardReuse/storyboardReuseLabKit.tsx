import React, { type JSX } from 'react'
import StoryboardShotRow from '../../../workbench/creation/storyboard/shotRow/StoryboardShotRow'
import StoryboardAnchorZone from '../../../workbench/creation/storyboard/anchorZone/StoryboardAnchorZone'
import type { AnchorCardRuntime } from '../../../workbench/creation/storyboard/exec/storyboardRowStatus'
import { missingRequiredSlots, resolveShotArchetypeMode } from '../../../workbench/creation/storyboard/shotRow/shotRowModel'
import { frameMediaBox } from '../../../workbench/creation/storyboard/shotRow/shotFrameGeometry'
import type { PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import {
  effectiveShotAspect,
  planDefaultAspect,
} from '../../../workbench/generationCanvas/agent/storyboardShotScope'
import { findModelOptionByIdentifier } from '../../../config/modelOptionResolvers'
import { labAnchorRuntime, labExec, NOOP } from '../storyboard/storyboardFixtures'
import { LINWEI_RESULT, REUSE_ANCHORS, REUSE_IMAGE_MODELS, REUSE_VIDEO_MODELS } from './storyboardReuseFixtures'

/**
 * 分镜表「复用画布底栏」提案屏的取景台（2026-10-06，L-sbui）。
 *
 * 两档宽度都是**真机量出来的**，不是挑的：
 *   · 宽 = 900：1440 视口、Agent 面板展开时创作区表格容器的宽度（与分镜表 v6 屏同一档）；
 *   · 窄 = 664：最小窗口 1100×690、Agent 面板展开时表格容器的宽度
 *     （审计截图 `33-min-window-selected-row.png`，行盒 x=35…699）。审计 A13 就是在这一档上
 *     看到「5 秒」半截、「⋯」与「生成」整个看不见。
 *
 * 舞台上摆的是**现役组件本体**（`StoryboardShotRow` / `StoryboardAnchorZone`），回调全是 no-op：
 * 实验室只回答「长成这样对不对」，数据变化（自动引用、删参考）在夹具里用真函数算好再喂进来。
 */
export const REUSE_WIDE = 900
export const REUSE_NARROW = 664

export function ReuseStage({ width, children }: { width: number; children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="rounded-nomi border border-nomi-line bg-nomi-paper"
      style={{ width }}
      data-design-lab-stage="storyboard-reuse"
    >
      {children}
    </div>
  )
}

function modelsFor(shot: PlanShot) {
  return shot.shotKind === 'image' ? REUSE_IMAGE_MODELS : REUSE_VIDEO_MODELS
}

/** 有序参考 url = 这一行参考里摆着的全部绑定（与 `useShotMentionSource` 同一口径，供 @ 芯片编号）。 */
function currentRefUrls(shot: PlanShot): string[] {
  return Object.values(shot.referenceBindings ?? {}).flatMap((bindings) => bindings.map((binding) => binding.url))
}

/** 一行镜头：现役 `StoryboardShotRow`，props 与 `StoryboardShotTable` 递下去的同一组。 */
export function ShotRow({ plan, shot }: { plan: StoryboardPlan; shot: PlanShot }): JSX.Element {
  const models = modelsFor(shot)
  const mode = resolveShotArchetypeMode(findModelOptionByIdentifier(models, shot.modelKey, shot.modelVendor), shot.modeId)?.mode ?? null
  const exec = labExec({ missingSlots: missingRequiredSlots(mode, shot, plan.anchors) })
  const aspect = effectiveShotAspect(plan, shot)
  return (
    <StoryboardShotRow
      shot={shot}
      anchors={plan.anchors}
      modelOptions={models}
      exec={exec}
      aspect={aspect}
      frameBox={frameMediaBox(planDefaultAspect(plan))}
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
}

/** 几行镜头摞在一起（行间分隔线与真表同一条）。 */
export function ShotRows({ plan, width }: { plan: StoryboardPlan; width: number }): JSX.Element {
  return (
    <ReuseStage width={width}>
      <div className="flex flex-col divide-y divide-nomi-line-soft">
        {plan.shots.map((shot) => <ShotRow key={shot.index} plan={plan} shot={shot} />)}
      </div>
    </ReuseStage>
  )
}

/** 锚区三张：林薇（已出图）· 后巷（默认模型、未生成）· 全片风格（仅文字）。 */
export function reuseAnchorCards(): AnchorCardRuntime[] {
  return [
    labAnchorRuntime(REUSE_ANCHORS[0], { resultUrl: LINWEI_RESULT, referencedByCount: 2 }),
    labAnchorRuntime(REUSE_ANCHORS[1], { referencedByCount: 1 }),
    labAnchorRuntime(REUSE_ANCHORS[2]),
  ]
}

export function AnchorZone({ width, cards = reuseAnchorCards() }: { width: number; cards?: AnchorCardRuntime[] }): JSX.Element {
  return (
    <ReuseStage width={width}>
      <div className="p-3">
        <StoryboardAnchorZone
          cards={cards}
          aspect="16:9"
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
    </ReuseStage>
  )
}

/** 林薇出图 → 引用它的镜头：参考卡在上、镜头在下，同一张舞台（「自动引用」那一格）。 */
export function AnchorThenShot({ plan, width }: { plan: StoryboardPlan; width: number }): JSX.Element {
  return (
    <ReuseStage width={width}>
      <div className="p-3 pb-0">
        <StoryboardAnchorZone
          cards={[labAnchorRuntime(REUSE_ANCHORS[0], { resultUrl: LINWEI_RESULT, referencedByCount: 1 })]}
          aspect="16:9"
          imageModelOptions={REUSE_IMAGE_MODELS}
          expanded
          onToggleExpanded={NOOP}
          onUpdateAnchor={NOOP}
          onChangeKind={NOOP}
          onRemoveAnchor={NOOP}
          onGenerateAnchor={NOOP}
          onRegenerateAnchor={NOOP}
          onToggleLockAnchor={NOOP}
          onAddAnchor={NOOP}
        />
      </div>
      <div className="mt-3 border-t border-nomi-line-soft">
        <ShotRow plan={plan} shot={plan.shots[0]} />
      </div>
    </ReuseStage>
  )
}

/**
 * 打开「点一下才出现」的形态（参数面板、⋯ 菜单）：点的是真按钮，走的是真状态机
 * （与分镜表 v6 屏的 AutoClick 同一个理由——不给组件加 lab-only 的 defaultOpen）。
 * 找不到就当场喊：这一格的信息量全在「点开之后」，静默截一张收起态是假证据。
 */
export function ClickFirst({ selector, children }: { selector: string; children: React.ReactNode }): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>(selector)
    if (!target) throw new Error(`[storyboard-reuse] 找不到 ${selector}，这一格截不到展开态`)
    target.click()
  }, [selector])
  return <div ref={ref}>{children}</div>
}
