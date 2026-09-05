import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconMovie, IconLockOpen, IconPlayerPlay, IconPlus, IconX } from '@tabler/icons-react'
import { confirmDialog, WorkbenchButton } from '../../../design'
import { toast } from '../../../ui/toast'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { useModelOptionsState } from '../../../config/useModelOptions'
import {
  addAnchor,
  addExternalReferenceAnchor,
  addShot,
  changeAnchorKind,
  removeAnchor,
  updateAnchor,
  updateTitle,
  validatePlan,
  type PlanIssue,
} from '../../generationCanvas/agent/storyboardPlanEdits'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import StoryboardAnchorCard from './StoryboardAnchorCard'
import StoryboardBulkBar from './StoryboardBulkBar'
import StoryboardShotTable from './StoryboardShotTable'
import {
  deriveAnchorCardRuntimes,
  deriveStoryboardBatch,
  deriveStoryboardRowRuntimes,
  type AnchorCardRuntime,
  type StoryboardRowRuntime,
} from './exec/storyboardRowStatus'
import {
  generateAnchorCard,
  generateShotRow,
  generateShotRowVariants,
  regenerateAnchorCard,
  regenerateShotRow,
  rerunShotRowWithFreshRefs,
  runStoryboardBatch,
  toggleNodeLock,
} from './exec/storyboardRowActions'
import { canvasNodeToAssetRefs } from '../../assets/assetTypes'
import { AssetPreviewDialog, type AssetPreviewSequenceItem } from '../../assets/AssetPreviewDialog'
import type { AssetRef } from '../../assets/assetTypes'
import { buildStoryboardPlaybackQueue, hiddenGeneratingCount, positionsForAnchorFilter } from './storyboardDInteractions'
import { buildStoryboardReference } from '../../ai/resident/residentReferences'

/**
 * 分镜方案编辑器（v5 B：执行面）。表 = 画布节点的表格表示版——行内/批量直接生成，
 * 节点作为副作用按需长到画布（画布=旁路视图）。「确认落画布」及其守卫已删（P1）：
 * 没有单向门，行状态/计数全部从「plan × 画布节点」实时 derive（exec/storyboardRowStatus）。
 * 执行只有 canvas runner 一条通路（exec/storyboardRowActions），spendConfirm/波次/undo 全沿用。
 */

export default function StoryboardPlanEditor({ projectId }: { projectId?: string | null }): JSX.Element | null {
  const { t } = useTranslation()
  const entry = useWorkbenchStore((s) => (s.activeDocumentId ? s.storyboardPlans[s.activeDocumentId] : undefined))
  const plan = entry?.plan ?? null
  const setStoryboardPlan = useWorkbenchStore((s) => s.setStoryboardPlan)
  const deleteStoryboardDesign = useWorkbenchStore((s) => s.deleteStoryboardDesign)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setActiveStoryboardId = useWorkbenchStore((s) => s.setActiveStoryboardId)
  const activeDocumentId = useWorkbenchStore((s) => s.activeDocumentId)
  const activeStoryboardId = useWorkbenchStore((s) => s.activeStoryboardId)
  const setProjectAgentReferences = useWorkbenchStore((s) => s.setProjectAgentReferences)
  const canvasNodes = useGenerationCanvasStore((s) => s.nodes)
  // 图片/视频模型清单各拉一次，按镜头种类传给镜行的模型选择器 + 参数控件（完整 option 供解析 archetype 参数）。
  const videoModelOptions = useModelOptionsState('video').options
  const imageModelOptions = useModelOptionsState('image').options
  // 行内/批量生成的重入闸（生成本身异步、确认卡在别处；按钮点两下不重复 materialize）。
  const [busy, setBusy] = React.useState(false)
  // 放大预览：存 nodeId（不存快照），渲染时从画布节点现取结果——重生成后再开永远是最新图。
  const [previewNodeId, setPreviewNodeId] = React.useState<string | null>(null)
  const [filterAnchorId, setFilterAnchorId] = React.useState<string | null>(null)
  const [playbackOpen, setPlaybackOpen] = React.useState(false)
  const [mentionPreviewAsset, setMentionPreviewAsset] = React.useState<AssetRef | null>(null)
  const deletedPlanUndoRef = React.useRef<{ plan: NonNullable<typeof plan>; canvasSteps: number } | null>(null)

  const firstIssueLabel = (issue: PlanIssue): string => {
    switch (issue.kind) {
      case 'no-shots': return t('storyboardEditor.issue.noShots')
      case 'empty-shot-prompt': return t('storyboardEditor.issue.emptyPrompt', { index: issue.shotIndex })
      case 'dangling-ref': return t('storyboardEditor.issue.danglingRef', { index: issue.shotIndex })
      case 'anchor-no-name': return t('storyboardEditor.issue.anchorNoName')
    }
  }

  // 行执行态：plan × 画布节点的实时 derive（F2：组头/标题/footer 计数同一份，禁静态快照）。
  const designId = activeStoryboardId ?? ''
  const rows = React.useMemo(
    () => (plan ? deriveStoryboardRowRuntimes({ plan, designId, imageModelOptions, videoModelOptions, nodes: canvasNodes }) : []),
    [plan, designId, imageModelOptions, videoModelOptions, canvasNodes],
  )
  const batch = React.useMemo(() => deriveStoryboardBatch(rows), [rows])
  // 参考卡执行态（B3 图卡）：与行同一份 derive（「N 镜在等它」直接聚合 rows 的 waitingRefs）。
  const anchorCards = React.useMemo(
    () => (plan ? deriveAnchorCardRuntimes({ plan, designId, nodes: canvasNodes, rows }) : []),
    [plan, designId, canvasNodes, rows],
  )

  React.useEffect(() => {
    const onMentionPreview = (event: Event): void => {
      const detail = (event as CustomEvent<{ url?: string; kind?: AssetRef['kind']; label?: string }>).detail
      const url = detail?.url?.trim()
      if (!url) return
      const matched = canvasNodes.find((node) => canvasNodeToAssetRefs(node).some((asset) => asset.renderUrl === url))
      if (matched) {
        setMentionPreviewAsset(null)
        setPreviewNodeId(matched.id)
        return
      }
      const kind = detail.kind === 'video' || detail.kind === 'audio' || detail.kind === 'model3d' ? detail.kind : 'image'
      setPreviewNodeId(null)
      setMentionPreviewAsset({ id: url, kind, name: detail.label || url, renderUrl: url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } })
    }
    window.addEventListener('nomi:asset-mention-preview', onMentionPreview)
    return () => window.removeEventListener('nomi:asset-mention-preview', onMentionPreview)
  }, [canvasNodes])

  React.useEffect(() => {
    const onUndo = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || !deletedPlanUndoRef.current) return
      event.preventDefault()
      const undo = deletedPlanUndoRef.current
      deletedPlanUndoRef.current = null
      for (let index = 0; index < undo.canvasSteps; index += 1) useGenerationCanvasStore.getState().undo()
      setStoryboardPlan(undo.plan)
    }
    window.addEventListener('keydown', onUndo)
    return () => window.removeEventListener('keydown', onUndo)
  }, [setStoryboardPlan])

  const visiblePositions = React.useMemo(() => positionsForAnchorFilter(plan ?? { title: '', anchors: [], shots: [] }, filterAnchorId), [filterAnchorId, plan])
  const visibleRows = React.useMemo(
    () => visiblePositions.map((position) => rows[position]).filter((row): row is StoryboardRowRuntime => Boolean(row)),
    [rows, visiblePositions],
  )
  const playbackQueue = React.useMemo(() => buildStoryboardPlaybackQueue(visibleRows), [visibleRows])
  const playbackSequence = React.useMemo<AssetPreviewSequenceItem[]>(
    () => playbackQueue.flatMap((item) => {
      const asset = item.runtime.exec.node ? canvasNodeToAssetRefs(item.runtime.exec.node)[0] : null
      return asset ? [{ asset, durationSec: item.durationSec }] : []
    }),
    [playbackQueue],
  )

  if (!plan) return null

  const issues = validatePlan(plan)
  const emptyPromptShots = new Set(issues.filter((i) => i.kind === 'empty-shot-prompt').map((i) => i.shotIndex))
  const noNameAnchorIds = new Set(issues.filter((i) => i.kind === 'anchor-no-name').map((i) => i.anchorId))

  const onDiscard = async () => {
    const targetDocumentId = activeDocumentId
    const targetStoryboardId = activeStoryboardId
    if (!targetStoryboardId) return
    const ok = await confirmDialog({
      title: t('storyboardEditor.discardTitle'),
      message: t('storyboardEditor.discardMessage'),
      confirmLabel: t('storyboardEditor.discard'),
      danger: true,
    })
    if (ok) deleteStoryboardDesign(targetStoryboardId, targetDocumentId)
  }

  // 动作统一包一层：失败人话 toast（生成失败本身落在节点卡片，这里只兜 materialize/确认前异常）。
  const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (busy || !activeStoryboardId) return
    setBusy(true)
    try {
      await action()
    } catch (error: unknown) {
      toast(error instanceof Error && error.message ? error.message : t('storyboardEditor.exec.actionFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const execCtx = { documentId: activeDocumentId, designId, plan }
  const onStoryboardShotSelect = (shot: StoryboardPlan['shots'][number]): void => {
    const reference = buildStoryboardReference('shot', shot.index, t('storyboardEditor.row.selectAria', { index: shot.index }), 'selected shot')
    setProjectAgentReferences((current) => [
      ...current.filter((item) => !/^storyboard:(?:shot|result):\d+$/.test(item.value ?? '')),
      reference,
    ])
  }
  const onGenerateRow = (runtime: StoryboardRowRuntime): void => {
    void runAction(() => generateShotRow(execCtx, runtime.shot, runtime.mode))
  }
  const onRunBatch = (): void => {
    void runAction(() => runStoryboardBatch(execCtx, batch.runnable))
  }
  const onRegenerateRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.node
    if (node) void runAction(() => regenerateShotRow(execCtx, runtime.shot, node))
  }
  const onVariantsRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.node
    if (node) void runAction(() => generateShotRowVariants(execCtx, runtime.shot, node))
  }
  // 锁定开关：同步写 meta（不花钱不确认）；状态经 derive 立刻回流行/组头/footer。
  const onToggleLockRow = (runtime: StoryboardRowRuntime): void => {
    if (runtime.exec.node) toggleNodeLock(runtime.exec.node.id)
  }
  // 参考已变「用新图重跑」：一键补跑（花钱确认照过；首帧行按波次连跑），绝不自动跑。
  const onRerunFreshRefsRow = (runtime: StoryboardRowRuntime): void => {
    void runAction(() => rerunShotRowWithFreshRefs(execCtx, runtime.shot, runtime.exec))
  }
  // 参考卡就地生成/重生成/锁定（B3）：同一执行通路；重生成后引用镜经「参考已变」提示补跑。
  const onGenerateAnchor = (runtime: AnchorCardRuntime): void => {
    void runAction(() => generateAnchorCard(execCtx, runtime.anchor))
  }
  const onRegenerateAnchor = (runtime: AnchorCardRuntime): void => {
    const node = runtime.node
    if (node) void runAction(() => regenerateAnchorCard(execCtx, runtime.anchor, node))
    else void runAction(() => generateAnchorCard(execCtx, runtime.anchor))
  }
  const onToggleLockAnchor = (runtime: AnchorCardRuntime): void => {
    if (runtime.node) toggleNodeLock(runtime.node.id)
  }
  const onOpenPreviewRow = (runtime: StoryboardRowRuntime): void => {
    if (runtime.exec.node && runtime.exec.resultUrl) {
      setMentionPreviewAsset(null)
      setPreviewNodeId(runtime.exec.node.id)
    }
  }
  const onOpenPreviewAnchor = (runtime: AnchorCardRuntime): void => {
    if (runtime.node && runtime.resultUrl) {
      setMentionPreviewAsset(null)
      setPreviewNodeId(runtime.node.id)
    }
  }
  const resultReference = (runtime: StoryboardRowRuntime): { plan: typeof plan; anchorId: string } | null => {
    if (!runtime.exec.node || !runtime.exec.resultUrl) return null
    const asset = canvasNodeToAssetRefs(runtime.exec.node)[0]
    if (!asset) return null
    return addExternalReferenceAnchor(plan, { id: asset.id, name: t('storyboardEditor.resultIntake.shot', { index: runtime.shot.index }), url: asset.renderUrl, kind: asset.kind === 'video' ? 'video' : 'image', sourceNodeId: runtime.exec.node.id })
  }
  const onSaveResultAsReference = (runtime: StoryboardRowRuntime): void => {
    const result = resultReference(runtime)
    if (result) setStoryboardPlan(result.plan)
  }
  const onSetResultAsFirstFrame = (runtime: StoryboardRowRuntime, targetPosition: number): void => {
    const result = resultReference(runtime)
    if (!result) return
    const target = result.plan.shots[targetPosition]
    if (!target) return
    const anchorIds = target.anchorIds.includes(result.anchorId) ? target.anchorIds : [...target.anchorIds, result.anchorId]
    const keyframe = target.shotKind !== 'image' ? { ...(target.keyframe ?? {}), enabled: true } : target.keyframe
    setStoryboardPlan({ ...result.plan, shots: result.plan.shots.map((shot, position) => position === targetPosition ? { ...shot, anchorIds, ...(keyframe ? { keyframe } : {}) } : shot) })
  }
  const onStartPlayback = (): void => {
    if (playbackSequence.length === 0) return
    const skipped = visibleRows.length - playbackSequence.length
    if (skipped > 0) toast(t('storyboardEditor.playback.skipped', { count: skipped }), 'info')
    setPreviewNodeId(null)
    setPlaybackOpen(true)
  }
  const previewNode = previewNodeId ? canvasNodes.find((node) => node.id === previewNodeId) ?? null : null
  const previewAsset = previewNode ? canvasNodeToAssetRefs(previewNode)[0] ?? null : null
  // ⏳ 直达参考卡：滚动定位 + data 锚点（参考卡区在同一滚动容器内）。
  const onJumpToAnchor = (anchorId: string): void => {
    const card = document.querySelector(`[data-anchor-card="${CSS.escape(anchorId)}"]`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 不进批量的原因摘要（footer 写明原因，与批次判定同一份 derive）。
  const excludedReasons: string[] = []
  if (batch.excluded.waitingRefs > 0) excludedReasons.push(t('storyboardEditor.footer.reasonWaiting', { count: batch.excluded.waitingRefs }))
  if (batch.excluded.unlockedRefs > 0) excludedReasons.push(t('storyboardEditor.footer.reasonUnlocked', { count: batch.excluded.unlockedRefs }))
  if (batch.excluded.missingRequired > 0) excludedReasons.push(t('storyboardEditor.footer.reasonMissing', { count: batch.excluded.missingRequired }))
  if (batch.excluded.generating > 0) excludedReasons.push(t('storyboardEditor.footer.reasonGenerating', { count: batch.excluded.generating }))
  if (batch.excluded.locked > 0) excludedReasons.push(t('storyboardEditor.footer.reasonLocked', { count: batch.excluded.locked }))

  return (
    <section
      className="relative w-full h-full min-h-0 grid grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] border border-workbench-border rounded-workbench bg-workbench-surface-solid shadow-workbench-md overflow-hidden"
      data-storyboard-editor="true"
    >
      <header className="flex items-center justify-between gap-3 h-12 px-4 border-b border-nomi-line">
        <div className="flex items-center gap-2 min-w-0">
          <IconMovie size={16} stroke={1.5} className="text-nomi-ink-60 shrink-0" />
          <input
            value={plan.title}
            onChange={(event) => setStoryboardPlan(updateTitle(plan, event.target.value))}
            aria-label={t('storyboardEditor.titleAria')}
            placeholder={t('storyboardEditor.titlePlaceholder')}
            className="min-w-0 max-w-[260px] text-title font-medium text-nomi-ink bg-transparent outline-none focus:bg-nomi-ink-05 rounded-nomi-sm px-1"
          />
          <span className="shrink-0 text-micro text-nomi-ink-40 bg-nomi-ink-05 px-2 py-0.5 rounded-full">{t('storyboardEditor.shotCount', { count: plan.shots.length })}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WorkbenchButton
            variant="default"
            size="sm"
            onClick={onDiscard}
          >
            {t('storyboardEditor.discardPlan')}
          </WorkbenchButton>
        </div>
      </header>

      <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-nomi-line-soft text-caption text-nomi-ink-40">
        <IconLockOpen size={14} stroke={1.6} className="shrink-0" />
        <span className="truncate"><span className="text-nomi-ink-60">{t('storyboardEditor.draftEditable')}</span> · {t('storyboardEditor.spendHint')}</span>
      </div>

      {/* 「全部镜头」批量条（样张 A）：整片作用域的类型/模型/时长常驻这里，
          底下镜行那排同款选择器作用域是「这一镜」——两者靠组名 + 底色分开（§1.5 C3）。 */}
      <StoryboardBulkBar
        plan={plan}
        imageModelOptions={imageModelOptions}
        videoModelOptions={videoModelOptions}
        onChange={setStoryboardPlan}
      />

      <div className="overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <section data-storyboard-anchors="true">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-body-sm font-medium text-nomi-ink-80">{t('storyboardEditor.consistencyTitle')}</span>
            <span className="text-micro text-nomi-ink-40">{t('storyboardEditor.consistencyHint')}</span>
            {/* 区头小结（样张 sec-head right）：就绪/生成中/待生成——与卡面同一份 derive（F2）。 */}
            {(() => {
              const visual = anchorCards.filter((card) => card.visual)
              if (visual.length === 0) return null
              const ready = visual.filter((card) => card.locked || (card.resultUrl && !card.generating && !card.failed)).length
              const generating = visual.filter((card) => card.generating).length
              const pending = visual.length - ready - generating
              return (
                <span className="ml-auto shrink-0 text-micro text-nomi-ink-40 flex items-center gap-1.5">
                  {ready > 0 ? <span className="text-workbench-success">{t('storyboardEditor.anchor.headReady', { count: ready })}</span> : null}
                  {generating > 0 ? <span>{t('storyboardEditor.anchor.headGenerating', { count: generating })}</span> : null}
                  {pending > 0 ? <span>{t('storyboardEditor.anchor.headPending', { count: pending })}</span> : null}
                </span>
              )
            })()}
          </div>
          {/* v5 图卡网格（样张 .anchors）：图是审阅对象，必须大到能审（§3.9 拍板）。 */}
          <div className="flex flex-wrap gap-3 items-start">
            {plan.anchors.length === 0 && (
              <div className="text-caption text-nomi-ink-40 py-2">{t('storyboardEditor.noAnchors')}</div>
            )}
            {anchorCards.map((runtime) => (
              <StoryboardAnchorCard
                key={runtime.anchor.id}
                anchor={runtime.anchor}
                runtime={runtime}
                nameInvalid={noNameAnchorIds.has(runtime.anchor.id)}
                onUpdate={(patch) => setStoryboardPlan(updateAnchor(plan, runtime.anchor.id, patch))}
                onChangeKind={(kind) => setStoryboardPlan(changeAnchorKind(plan, runtime.anchor.id, kind))}
                onRemove={() => setStoryboardPlan(removeAnchor(plan, runtime.anchor.id))}
                onGenerate={() => onGenerateAnchor(runtime)}
                onRegenerate={() => onRegenerateAnchor(runtime)}
                onToggleLock={() => onToggleLockAnchor(runtime)}
                onFilterByAnchor={() => setFilterAnchorId(runtime.anchor.id)}
                onOpenPreview={() => onOpenPreviewAnchor(runtime)}
                modelOptions={imageModelOptions}
              />
            ))}
            <button
              type="button"
              onClick={() => setStoryboardPlan(addAnchor(plan))}
              aria-label={t('storyboardEditor.addAnchor')}
              title={t('storyboardEditor.addAnchor')}
              className="w-[108px] h-[144px] rounded-nomi border border-dashed border-nomi-ink-20 grid place-items-center text-nomi-ink-30 hover:text-nomi-ink-60 hover:border-nomi-ink-40"
            >
              <IconPlus size={20} stroke={1.6} />
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-body-sm font-medium text-nomi-ink-80">{t('storyboardEditor.storyboardHeading', { count: filterAnchorId ? visibleRows.length : plan.shots.length })}</div>
            <button
              type="button"
              onClick={onStartPlayback}
              disabled={playbackSequence.length === 0}
              aria-label={t('storyboardEditor.playback.aria')}
              className="h-6 px-2.5 rounded-full border border-nomi-line text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:border-nomi-accent hover:text-nomi-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <IconPlayerPlay size={12} stroke={1.8} />
              {t('storyboardEditor.playback.start')}
            </button>
          </div>
          {filterAnchorId ? (() => {
            const anchor = plan.anchors.find((candidate) => candidate.id === filterAnchorId)
            const hiddenGenerating = hiddenGeneratingCount(rows, visiblePositions)
            return (
              <div className="mb-2 flex items-center gap-2 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-2.5 py-1.5 text-caption text-nomi-ink-60" data-storyboard-filter="true">
                <span className="min-w-0 truncate">{t('storyboardEditor.filter.active', { name: anchor?.name || t('storyboardEditor.unnamed'), count: visibleRows.length })}</span>
                {hiddenGenerating > 0 ? <span className="shrink-0 text-nomi-warning">{t('storyboardEditor.filter.hiddenGenerating', { count: hiddenGenerating })}</span> : null}
                <button type="button" onClick={() => setFilterAnchorId(null)} aria-label={t('storyboardEditor.filter.clear')} className="ml-auto shrink-0 size-5 grid place-items-center rounded-full text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80">
                  <IconX size={13} stroke={1.8} />
                </button>
              </div>
            )
          })() : null}
          {filterAnchorId && visibleRows.length === 0 ? <div className="mb-2 text-caption text-nomi-ink-40">{t('storyboardEditor.filter.empty')}</div> : null}
          <div className="flex flex-col gap-2">
            <StoryboardShotTable
              plan={plan}
              projectId={projectId}
              rows={rows}
              anchorCards={anchorCards}
              imageModelOptions={imageModelOptions}
              videoModelOptions={videoModelOptions}
              emptyPromptShots={emptyPromptShots}
              onChange={setStoryboardPlan}
              onStoryboardShotSelect={onStoryboardShotSelect}
              onGenerateRow={onGenerateRow}
              onRegenerateRow={onRegenerateRow}
              onVariantsRow={onVariantsRow}
              onToggleLockRow={onToggleLockRow}
              onOpenPreviewRow={onOpenPreviewRow}
              onRerunFreshRefsRow={onRerunFreshRefsRow}
              onJumpToAnchor={onJumpToAnchor}
              onSaveResultAsReference={onSaveResultAsReference}
              onSetResultAsFirstFrame={onSetResultAsFirstFrame}
              onGenerateSelected={(selected) => void runAction(() => runStoryboardBatch(execCtx, selected))}
              onDeleteSelected={(selected) => {
                const ids = selected.flatMap((runtime) => [runtime.exec.node?.id, runtime.exec.keyframeNode?.id]).filter((id): id is string => Boolean(id))
                deletedPlanUndoRef.current = { plan, canvasSteps: ids.length }
                ids.forEach((id) => useGenerationCanvasStore.getState().deleteNode(id))
                const selectedIds = new Set(selected.map((runtime) => runtime.shot.shotId ?? `index:${runtime.shot.index}`))
                setStoryboardPlan({ ...plan, shots: plan.shots.filter((shot) => !selectedIds.has(shot.shotId ?? `index:${shot.index}`)).map((shot, index) => ({ ...shot, index: index + 1 })) })
              }}
              filterAnchorId={filterAnchorId}
            />
            <button
              type="button"
              onClick={() => setStoryboardPlan(addShot(plan))}
              className="self-start h-6 px-2.5 rounded-full border border-dashed border-nomi-ink-20 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-ink-80"
            >
              <IconPlus size={13} stroke={1.8} />
              {t('storyboardEditor.addShot')}
            </button>
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-nomi-line bg-nomi-paper">
        <div className="flex items-center gap-2 min-w-0">
          <WorkbenchButton variant="default" size="sm" onClick={() => {
            setActiveStoryboardId(null)
            setWorkspaceMode('creation')
          }}>
            {t('storyboardEditor.backToCreation')}
          </WorkbenchButton>
          {issues.length > 0 ? (
            <span className="text-caption text-workbench-danger inline-flex items-center gap-[5px] min-w-0">
              <IconAlertTriangle size={14} stroke={1.8} className="shrink-0" />
              <span className="truncate">{t('storyboardEditor.issuesSummary', { count: issues.length, issue: firstIssueLabel(issues[0]) })}</span>
            </span>
          ) : (
            <span className="text-caption text-nomi-ink-60 min-w-0 truncate" data-storyboard-progress="true">
              {t('storyboardEditor.footer.progress', { done: batch.doneCount + batch.excluded.locked, total: plan.shots.length })}
              {excludedReasons.length > 0 ? ` · ${excludedReasons.join(t('storyboardEditor.footer.reasonSeparator'))}${t('storyboardEditor.footer.excludedSuffix')}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-micro text-nomi-ink-40">{t('storyboardEditor.footer.spendNote')}</span>
          <WorkbenchButton
            variant="primary"
            onClick={onRunBatch}
            disabled={busy || batch.runnable.length === 0}
            data-storyboard-batch="true"
          >
            <IconPlayerPlay size={15} stroke={1.8} />
            {t('storyboardEditor.footer.generateRemaining', { count: batch.runnable.length })}
          </WorkbenchButton>
        </div>
      </footer>

      {/* 放大预览：素材库同一 body-portal lightbox（NodeMediaPreviewDialog 挂画布容器在分镜页不可见）。 */}
      {playbackOpen && playbackSequence.length > 0 ? (
        <AssetPreviewDialog asset={playbackSequence[0].asset} sequence={playbackSequence} onClose={() => setPlaybackOpen(false)} />
      ) : previewAsset ? <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewNodeId(null)} /> : mentionPreviewAsset ? <AssetPreviewDialog asset={mentionPreviewAsset} onClose={() => setMentionPreviewAsset(null)} /> : null}
    </section>
  )
}
