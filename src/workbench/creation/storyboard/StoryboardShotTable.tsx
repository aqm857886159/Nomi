import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronRight, IconPlayerPlay, IconPlus } from '@tabler/icons-react'
import type { ModelOption } from '../../../config/models'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { storyboardProfileForKey } from '../../generationCanvas/agent/storyboardProfiles'
import {
  addExternalReferenceAnchor,
  duplicateShotAt,
  danglingAnchorIdsForShot,
  moveShot,
  insertShotAt,
  rememberAnchorReferenceUrl,
  sceneGroupsOf,
  toggleShotAnchor,
  totalDurationSec,
  updateShotPrompt,
  updateShotAt,
  type SceneGroup,
} from '../../generationCanvas/agent/storyboardPlanEdits'
import type { AnchorCardRuntime, StoryboardRowRuntime } from './exec/storyboardRowStatus'
import { useShotMentionSource } from './shotRow/useShotMentionSource'
import StoryboardShotRow from './shotRow/StoryboardShotRow'
import { tableFrameMediaBox } from './shotRow/shotFrameGeometry'
import type { MentionSuggestionItem } from '../../assets/AssetMentionSuggestionList'
import {
  ASPECT_OPTIONS,
  effectiveShotAspect,
  isAspectOverridden,
  setShotAspectOverride,
} from '../../generationCanvas/agent/storyboardAspectScope'
import { stableShotId } from '../../generationCanvas/agent/storyboardPlan'
import type { ShotVariant } from './shotRow/shotVariants'
import { positionsForAnchorFilter } from './storyboardDInteractions'
import StoryboardSelectionToolbar from './StoryboardSelectionToolbar'
import { confirmDialog } from '../../../design'

/**
 * 分镜表主体（v5 场分组 + 执行态）：`sceneGroupsOf` 把镜序切成场组——组头（▾ 场名 · N 镜 ·
 * 合计时长 · 异常计数）+ 可折叠行区。无场旧 plan = 单一隐式组，不渲染组头。
 * 行执行态（rows，与 plan.shots 同序）由编辑器统一 derive 传入——组头计数与行状态同一份
 * （F2 禁静态快照）。拖拽 = 行对行（moveShot 场感知）。合计口径 = totalDurationSec。
 */

type Props = {
  plan: StoryboardPlan
  projectId?: string | null
  /** 行执行 runtime（与 plan.shots 同序；exec/storyboardRowStatus 单源 derive）。 */
  rows: StoryboardRowRuntime[]
  /** C1：参考卡 runtime（供行级 @ 候选）。缺省 = 不开 @ 面板。 */
  anchorCards?: AnchorCardRuntime[]
  imageModelOptions: ModelOption[]
  videoModelOptions: ModelOption[]
  /** 提示词为空的镜号（validatePlan 的 empty-shot-prompt 投影，行红边用）。 */
  emptyPromptShots: Set<number>
  onChange: (plan: StoryboardPlan) => void
  /** The resident Agent receives the same stable storyboard reference as the row selection UI. */
  onStoryboardShotSelect?: (shot: StoryboardPlan['shots'][number]) => void
  /** 选中集变化时上报（footer 的「选中 N 镜 · 交给 Agent 改」与浮条读同一份选择，不各存一份）。 */
  onSelectionChange?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /** 行内「生成」（画面格常驻按钮 / 失败重试）。 */
  onGenerateRow: (runtime: StoryboardRowRuntime) => void
  /** 浮条 ↻ 原地重生成。 */
  onRegenerateRow: (runtime: StoryboardRowRuntime) => void
  /**
   * 可找回行的**免费**续查（`recoverNodeResult`）。可选：设计实验室等只读取景不接执行通路，
   * 缺省时那枚按钮就不出现——但绝不许拿 `onGenerateRow` 顶替（那是付费重跑）。
   */
  onRecoverRow?: ((runtime: StoryboardRowRuntime) => void) | undefined
  /** 「再出 3 版」：同镜连出三版，追加进变体抽屉。 */
  onVariantsRow: (runtime: StoryboardRowRuntime) => void
  /** 浮条 ×3 变体。 */
  /** 浮条 🔒/🔓 镜级锁定开关。 */
  onToggleLockRow: (runtime: StoryboardRowRuntime) => void
  /** 结果态双击 / 浮条 ⛶ 放大预览。 */
  onOpenPreviewRow: (runtime: StoryboardRowRuntime) => void
  /** 参考已变「用新图重跑」。 */
  onRerunFreshRefsRow: (runtime: StoryboardRowRuntime) => void
  /** ⏳ 态点参考卡名 → 滚动定位参考卡。 */
  onJumpToAnchor: (anchorId: string) => void
  onSaveResultAsReference: (runtime: StoryboardRowRuntime) => void
  onSetResultAsFirstFrame: (runtime: StoryboardRowRuntime, targetIndex: number) => void
  onGenerateSelected: (runtimes: StoryboardRowRuntime[]) => void
  onDeleteSelected: (runtimes: StoryboardRowRuntime[]) => void
  filterAnchorId?: string | null
  /**
   * 「本次跳过」的行（`stableShotId` 键，v6 §2.10）。**受控**：owner 是编辑器，因为 footer 的
   * 「将跑 N 镜」必须与它同一份 derive（合同 §9.3：不许 footer 自己再减一次）。
   */
  skippedShotIds?: ReadonlySet<string>
  onToggleSkip?: ((shotId: string) => void) | undefined
  /** 每镜的历史变体（§2.9）；键 = `stableShotId`。本轮由调用方喂，落盘是下一刀。 */
  variantsByShotId?: Readonly<Record<string, readonly ShotVariant[]>>
  adoptedVariantByShotId?: Readonly<Record<string, string>>
  onAdoptVariant?: ((runtime: StoryboardRowRuntime, variant: ShotVariant) => void) | undefined
  onDeleteVariant?: ((runtime: StoryboardRowRuntime, variant: ShotVariant) => void) | undefined
  /** 每镜产出的 `@tag`（§2.10）；键 = `stableShotId`。 */
  outputTagByShotId?: Readonly<Record<string, string>>
  /** 「交给 Agent」——多选浮条与每行 ⋯ 菜单两处（§2.7 入口 2/3 与 3/3）。 */
  onAgentHandoff?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  onLockSelected?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /** 播放本场；整片播放复用同一 playback queue owner。 */
  onPlayGroup?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
}

/**
 * 行级 @ mention 适配层（C1）：`useShotMentionSource` 需要 shot 作为参数，所以必须在行级调用。
 * 这一层**只**负责把 hook 的产出补进行 props——其余 props 原样透传（以前逐字段重列一遍，
 * 每加一个行属性就要在三处同步，是典型的"同一份契约抄了两遍"）。
 */
type ShotRowProps = React.ComponentProps<typeof StoryboardShotRow>

function ShotRowWithMention({
  rowProps,
  anchorCards,
  projectId,
  onRememberAnchorUrl,
  onAddExternalReference,
}: {
  rowProps: ShotRowProps
  anchorCards: AnchorCardRuntime[]
  projectId?: string | null
  onRememberAnchorUrl: (anchorId: string, url: string) => void
  onAddExternalReference: (item: MentionSuggestionItem) => void
}): JSX.Element {
  const { mentionSearch, onMentionSelect, currentReferenceUrls, mentionUpload } = useShotMentionSource(
    rowProps.shot,
    rowProps.anchors,
    anchorCards,
    rowProps.onToggleAnchor,
    onRememberAnchorUrl,
    onAddExternalReference,
    projectId,
  )
  return (
    <StoryboardShotRow
      {...rowProps}
      mentionSearch={mentionSearch}
      onMentionSelect={onMentionSelect}
      currentRefUrls={currentReferenceUrls}
      mentionUpload={mentionUpload}
    />
  )
}

export default function StoryboardShotTable({ plan, projectId, rows, anchorCards, imageModelOptions, videoModelOptions, emptyPromptShots, onChange, onStoryboardShotSelect, onSelectionChange, onGenerateRow, onRegenerateRow, onRecoverRow, onVariantsRow, onToggleLockRow, onOpenPreviewRow, onRerunFreshRefsRow, onJumpToAnchor, onSaveResultAsReference, onSetResultAsFirstFrame, onGenerateSelected, onDeleteSelected, filterAnchorId, skippedShotIds, onToggleSkip, variantsByShotId, adoptedVariantByShotId, outputTagByShotId, onAgentHandoff, onLockSelected, onPlayGroup, onAdoptVariant: props_onAdoptVariant, onDeleteVariant: props_onDeleteVariant }: Props): JSX.Element {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)
  const [foldedScenes, setFoldedScenes] = React.useState<ReadonlySet<string>>(new Set())
  const [selectedShotIds, setSelectedShotIds] = React.useState<ReadonlySet<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = React.useState<number | null>(null)

  const visiblePositions = positionsForAnchorFilter(plan, filterAnchorId ?? null)
  const visiblePlan = filterAnchorId ? { ...plan, shots: visiblePositions.map((position) => plan.shots[position]) } : plan
  const groups = sceneGroupsOf(visiblePlan)
  const allGroups = sceneGroupsOf(plan)
  const selectedRows = rows.filter((runtime) => selectedShotIds.has(runtime.shot.shotId ?? `index:${runtime.shot.index}`))
  // 选择是表的状态、footer 是它的消费者——上报而不是让 footer 再存一份（两份选择必然会漂）。
  const selectedKeysSignature = [...selectedShotIds].sort().join('|')
  React.useEffect(() => {
    onSelectionChange?.(selectedRows)
    // selectedRows 每次渲染都是新数组；用稳定签名当依赖，避免每帧回调。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeysSignature, rows])
  const selectableModelOptions = [...new Map([...imageModelOptions, ...videoModelOptions].map((option) => [option.value, option])).values()]
  const selectKeyOf = (shot: StoryboardRowRuntime['shot']): string => shot.shotId ?? `index:${shot.index}`
  const onSelectShot = (position: number, event: React.MouseEvent): void => {
    const keyAt = (index: number): string => selectKeyOf(rows[index].shot)
    const visible = visiblePositions
    if (event.shiftKey && selectionAnchor !== null) {
      const start = Math.min(selectionAnchor, visible.indexOf(position))
      const end = Math.max(selectionAnchor, visible.indexOf(position))
      setSelectedShotIds(new Set(visible.slice(start, end + 1).map((index) => selectKeyOf(rows[index].shot))))
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedShotIds((previous) => {
        const next = new Set(previous)
        const key = keyAt(position)
        if (next.has(key)) next.delete(key); else next.add(key)
        return next
      })
      setSelectionAnchor(visible.indexOf(position))
    } else {
      setSelectedShotIds(new Set([keyAt(position)]))
      setSelectionAnchor(visible.indexOf(position))
    }
    onStoryboardShotSelect?.(rows[position].shot)
  }
  const moveSelectedToScene = (sceneId: string): void => {
    if (!sceneId) return
    onChange({ ...plan, shots: plan.shots.map((shot) => selectedShotIds.has(selectKeyOf(shot)) ? (sceneId === '__none__' ? (() => { const { sceneId: _removed, ...rest } = shot; return rest })() : { ...shot, sceneId }) : shot) })
  }
  const applyModelToSelected = (modelKey: string): void => {
    if (!modelKey) return
    onChange({ ...plan, shots: plan.shots.map((shot) => selectedShotIds.has(selectKeyOf(shot)) ? { ...shot, modelKey, modeId: undefined, params: undefined } : shot) })
  }
  const deleteSelected = async (): Promise<void> => {
    const generated = selectedRows.some((row) => Boolean(row.exec.resultUrl))
    if (generated && !(await confirmDialog({ title: t('storyboardEditor.rowActions.deleteTitle'), message: t('storyboardEditor.rowActions.deleteMessage'), confirmLabel: t('storyboardEditor.selection.delete'), danger: true }))) return
    onDeleteSelected(selectedRows)
    setSelectedShotIds(new Set())
  }
  // 单一隐式组 = 无分场故事：不显组头（表退化成今天的平铺行为）。
  const showHeads = !(groups.length === 1 && groups[0].scene === null)

  const foldKeyOf = (group: SceneGroup): string => group.scene?.id ?? '__implicit__'
  const toggleFold = (group: SceneGroup): void => {
    const key = foldKeyOf(group)
    setFoldedScenes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const headTitleOf = (group: SceneGroup, groupIndex: number): string => {
    if (group.scene === null) return t('storyboardEditor.sceneGroup.unassigned')
    return group.scene.title.trim() || t('storyboardEditor.sceneGroup.untitled', { index: groupIndex + 1 })
  }

  // 组头小结：与行状态同一份 derive（rows 按 startPos 切片；F2 禁静态快照）。
  // 媒体盒**一张表算一次**（§2.4 修订 · 2026-09-06 用户反馈四「不同画幅的行一放进来整个框就不齐」）：
  // 全表同一画幅 → 盒就是那个画幅的框，缩略图铺满、行行同高；混排 → 全表共用一只盒，各自 letterbox。
  // 输入是**全部镜头**（不是当前可见的那几行）——按可见行算，展开/折叠一个场就会让盒子跳一次尺寸。
  const tableBox = React.useMemo(
    () => tableFrameMediaBox(plan.shots.map((shot) => effectiveShotAspect(plan, shot))),
    [plan],
  )

  const groupRowsOf = (group: SceneGroup): StoryboardRowRuntime[] =>
    group.shots
      .map((_shot, index) => rows[visiblePositions[group.startPos + index]])
      .filter((row): row is StoryboardRowRuntime => Boolean(row))

  return (
    <div className="border border-nomi-line rounded-nomi divide-y divide-nomi-line-soft overflow-hidden" data-storyboard-rows="true">
      {groups.map((group, groupIndex) => {
        const folded = foldedScenes.has(foldKeyOf(group))
        const groupRows = groupRowsOf(group)
        const missingCount = groupRows.filter((row) => row.exec.status === 'missing-required').length
        const doneCount = groupRows.filter((row) => row.exec.status === 'done' || row.exec.status === 'locked').length
        const lockedCount = groupRows.filter((row) => row.exec.status === 'locked').length
        return (
          <React.Fragment key={foldKeyOf(group)}>
            {showHeads ? (
              <div className="flex w-full items-center gap-2 bg-nomi-ink-05 px-3 py-1.5 hover:bg-nomi-ink-10">
                <button
                  type="button"
                  onClick={() => toggleFold(group)}
                  aria-expanded={!folded}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {folded ? (
                    <IconChevronRight size={13} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden />
                  ) : (
                    <IconChevronDown size={13} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden />
                  )}
                  <span className="min-w-0 truncate text-caption font-medium text-nomi-ink-80">{headTitleOf(group, groupIndex)}</span>
                  <span className="ml-auto shrink-0 flex items-center gap-2.5 text-micro text-nomi-ink-40">
                  <span>{(() => {
                    const allGroup = allGroups.find((candidate) => foldKeyOf(candidate) === foldKeyOf(group))
                    return filterAnchorId && allGroup
                      ? t('storyboardEditor.sceneGroup.filteredSummary', { visible: group.shots.length, total: allGroup.shots.length, seconds: totalDurationSec(group.shots) })
                      : t('storyboardEditor.sceneGroup.summary', { count: group.shots.length, seconds: totalDurationSec(group.shots) })
                  })()}</span>
                  {doneCount > 0 ? (
                    <span className="text-workbench-success">{t('storyboardEditor.sceneGroup.doneCount', { count: doneCount })}</span>
                  ) : null}
                  {lockedCount > 0 ? (
                    <span>{t('storyboardEditor.sceneGroup.lockedCount', { count: lockedCount })}</span>
                  ) : null}
                  {missingCount > 0 ? (
                    <span className="text-workbench-danger">{t('storyboardEditor.sceneGroup.missingRequired', { count: missingCount })}</span>
                  ) : null}
                  </span>
                </button>
                {onPlayGroup ? (
                  <button
                    type="button"
                    onClick={() => onPlayGroup(groupRows)}
                    disabled={groupRows.length === 0}
                    data-storyboard-play-scene={foldKeyOf(group)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 py-0.5 text-micro text-nomi-ink-60 hover:border-nomi-accent hover:text-nomi-accent disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t('storyboardEditor.playback.sceneAria', { name: headTitleOf(group, groupIndex) })}
                  >
                    <IconPlayerPlay size={11} stroke={1.8} />
                    {t('storyboardEditor.playback.scene')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {!folded
              ? group.shots.map((shot, indexInGroup) => {
                  const pos = visiblePositions[group.startPos + indexInGroup]
                  const runtime = rows[pos]
                  // C1：anchorCards 有时用 ShotRowWithMention（含 useShotMentionSource），
                  // 缺省（编辑器没提供 anchorCards）退回 StoryboardShotRow（无 @ 面板）。
                  const shotKey = stableShotId(shot)
                  const commonRowProps = {
                    shot,
                    anchors: plan.anchors,
                    modelOptions: shot.shotKind === 'image' ? imageModelOptions : videoModelOptions,
                    danglingIds: danglingAnchorIdsForShot(plan, shot),
                    promptInvalid: emptyPromptShots.has(shot.index),
                    exec: runtime?.exec,
                    onGenerate: runtime ? () => onGenerateRow(runtime) : undefined,
                    onRegenerate: runtime ? () => onRegenerateRow(runtime) : undefined,
                    onRecover: runtime && onRecoverRow ? () => onRecoverRow(runtime) : undefined,
                    onToggleLock: runtime ? () => onToggleLockRow(runtime) : undefined,
                    // 画幅（v6 §2.4.1）：生效值与"是不是覆盖"都从 storyboardAspectScope 单源读，
                    // 行自己不判"读哪一个"。
                    aspect: effectiveShotAspect(plan, shot),
                    // 媒体盒是**表级**的（§2.4 修订 · 2026-09-06 用户反馈四）：全表同画幅时盒=该画幅，
                    // 混排时全表共用一只盒、画面 letterbox 居中。行自己按画幅算就会一行一个尺寸。
                    frameBox: tableBox,
                    aspectOverridden: isAspectOverridden(plan, shot),
                    aspectOptions: ASPECT_OPTIONS,
                    onChangeAspect: (next: string | null) => onChange(setShotAspectOverride(plan, pos, next)),
                    skipped: skippedShotIds?.has(shotKey) ?? false,
                    onToggleSkip: onToggleSkip ? () => onToggleSkip(shotKey) : undefined,
                    variants: variantsByShotId?.[shotKey] ?? [],
                    adoptedVariantId: adoptedVariantByShotId?.[shotKey],
                    onAdoptVariant: runtime && props_onAdoptVariant ? (variant: ShotVariant) => props_onAdoptVariant(runtime, variant) : undefined,
                    onDeleteVariant: runtime && props_onDeleteVariant ? (variant: ShotVariant) => props_onDeleteVariant(runtime, variant) : undefined,
                    outputTag: outputTagByShotId?.[shotKey],
                    onAgentHandoff: runtime && onAgentHandoff ? () => onAgentHandoff([runtime]) : undefined,
                    onInsertAbove: () => onChange(insertShotAt(plan, pos)),
                    onInsertBelow: () => onChange(insertShotAt(plan, pos + 1)),
                    onGenerateVariants: runtime ? () => onVariantsRow(runtime) : undefined,
                    targetShots: plan.shots.filter((candidate) => candidate.shotId !== shot.shotId && candidate.index !== shot.index),
                    allShots: plan.shots,
                    sourcePosition: pos,
                    onSaveAsReference: runtime ? () => onSaveResultAsReference(runtime) : undefined,
                    onSetAsFirstFrame: runtime ? (targetIndex: number) => onSetResultAsFirstFrame(runtime, targetIndex) : undefined,
                    selected: selectedShotIds.has(selectKeyOf(shot)),
                    onSelect: (event: React.MouseEvent) => onSelectShot(pos, event),
                    scenes: plan.scenes ?? [],
                    onCopy: () => onChange(duplicateShotAt(plan, pos)),
                    onMoveToScene: (sceneId: string) => onChange(updateShotAt(plan, pos, sceneId === '__none__' ? (() => { const { sceneId: _removed, ...rest } = shot; return rest })() : { sceneId })),
                    onKeyboardMove: (direction: -1 | 1) => {
                      const target = pos + direction
                      if (target >= 0 && target < plan.shots.length) onChange(moveShot(plan, pos, target))
                    },
                    onKeyboardFocus: (direction: -1 | 1) => {
                      const target = visiblePositions[visiblePositions.indexOf(pos) + direction]
                      if (target === undefined) return
                      const element = document.querySelector<HTMLElement>(`[data-storyboard-row="${CSS.escape(String(plan.shots[target].index))}"]`)
                      element?.focus()
                    },
                    onOpenPreview: runtime ? () => onOpenPreviewRow(runtime) : undefined,
                    onRerunFreshRefs: runtime ? () => onRerunFreshRefsRow(runtime) : undefined,
                    onJumpToAnchor,
                    draggable: true as const,
                    isDragOver: overIndex === pos && dragIndex !== null && dragIndex !== pos,
                    onDragStart: () => setDragIndex(pos),
                    onDragOver: (event: React.DragEvent) => { event.preventDefault(); setOverIndex(pos) },
                    onDrop: () => {
                      if (dragIndex !== null && dragIndex !== pos) onChange(moveShot(plan, dragIndex, pos))
                      setDragIndex(null); setOverIndex(null)
                    },
                    onDragEnd: () => { setDragIndex(null); setOverIndex(null) },
                    onUpdate: (patch: Partial<typeof shot>) => {
                      if (typeof patch.prompt !== 'string') {
                        onChange(updateShotAt(plan, pos, patch))
                        return
                      }
                      const next = updateShotPrompt(plan, pos, patch.prompt)
                      onChange(updateShotAt(next, pos, { promptSegments: patch.promptSegments }))
                    },
                    onToggleAnchor: (anchorId: string) => onChange(toggleShotAnchor(plan, pos, anchorId)),
                    onRememberAnchorUrl: (anchorId: string, url: string) => onChange(rememberAnchorReferenceUrl(plan, anchorId, url)),
                    onAddExternalReference: (item: MentionSuggestionItem) => {
                      const sourceNodeId = item.group === 'canvas' && item.key.startsWith('shot-result:')
                        ? item.key.slice('shot-result:'.length).split(':')[0]
                        : undefined
                      const added = addExternalReferenceAnchor(plan, { id: item.key, name: item.label, url: item.url, kind: item.kind ?? 'image', ...(sourceNodeId ? { sourceNodeId } : {}) })
                      const nextShot = plan.shots[pos]
                      const anchorIds = nextShot.anchorIds.includes(added.anchorId) ? nextShot.anchorIds : [...nextShot.anchorIds, added.anchorId]
                      onChange(updateShotAt(added.plan, pos, { anchorIds }))
                    },
                    onRemove: () => {
                      const runtimeForRow = rows[pos]
                      if (runtimeForRow?.exec.resultUrl) {
                        void confirmDialog({ title: t('storyboardEditor.rowActions.deleteTitle'), message: t('storyboardEditor.rowActions.deleteMessage'), confirmLabel: t('storyboardEditor.row.delete'), danger: true }).then((ok) => { if (ok) onDeleteSelected([runtimeForRow]) })
                      } else onDeleteSelected([runtimeForRow])
                    },
                    // 只套 params：模型/模式归「全部镜头」批量条管（一功能一个家，§1.5.2）
                    onApplyParamsToAll: () => onChange({ ...plan, shots: plan.shots.map((s) => ({ ...s, params: shot.params })) }),
                    storyboardProfile: storyboardProfileForKey(plan.profileKey),
                  }
                  // C1：有 anchorCards 时走 ShotRowWithMention（含 useShotMentionSource），
                  // 缺省（编辑器没提供）退回 StoryboardShotRow（无 @ 面板）。
                  const { onRememberAnchorUrl, onAddExternalReference, ...rowProps } = commonRowProps
                  const row = anchorCards
                    ? (
                      <ShotRowWithMention
                        rowProps={rowProps}
                        anchorCards={anchorCards}
                        projectId={projectId}
                        onRememberAnchorUrl={onRememberAnchorUrl}
                        onAddExternalReference={onAddExternalReference}
                      />
                    )
                    : <StoryboardShotRow {...rowProps} />
                  return (
                    <React.Fragment key={shot.shotId ?? shot.index}>
                      {pos > 0 ? (
                        <div className="group/insert relative h-1.5" data-storyboard-insert-line={shot.index}>
                          <button
                            type="button"
                            onClick={() => onChange(insertShotAt(plan, pos))}
                            aria-label={t('storyboardEditor.selection.insert')}
                            // 也在 focus-within 时现身：只靠 hover 的话键盘用户永远看不见这个入口。
                            className="absolute inset-x-2 top-1/2 z-[2] hidden h-5 -translate-y-1/2 items-center justify-center rounded-full border border-nomi-accent bg-nomi-paper text-nomi-accent group-hover/insert:flex group-focus-within/insert:flex focus:flex"
                          >
                            <IconPlus size={13} stroke={1.8} />
                          </button>
                        </div>
                      ) : null}
                      {row}
                    </React.Fragment>
                  )
                })
              : null}
          </React.Fragment>
        )
      })}
      {selectedRows.length > 0 ? (
        <StoryboardSelectionToolbar
          selectedCount={selectedRows.length}
          modelOptions={selectableModelOptions}
          sceneOptions={plan.scenes ?? []}
          onGenerate={() => onGenerateSelected(selectedRows)}
          onMoveToScene={moveSelectedToScene}
          onApplyModel={applyModelToSelected}
          onDelete={() => { void deleteSelected() }}
          onClear={() => setSelectedShotIds(new Set())}
          onAgentHandoff={onAgentHandoff ? () => onAgentHandoff(selectedRows) : undefined}
          onLock={onLockSelected ? () => onLockSelected(selectedRows) : undefined}
        />
      ) : null}
    </div>
  )
}
