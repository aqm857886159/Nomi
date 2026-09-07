import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconMovie, IconLockOpen, IconPlayerPlay, IconPlus, IconRobot, IconWand, IconX } from '@tabler/icons-react'
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
import { planDefaultAspect } from '../../generationCanvas/agent/storyboardAspectScope'
import StoryboardAnchorZone from './anchorZone/StoryboardAnchorZone'
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
import { recoverNodeResult } from '../../generationCanvas/runner/recoverTaskActions'
import { canvasNodeToAssetRefs } from '../../assets/assetTypes'
import { AssetPreviewDialog, type AssetPreviewSequenceItem } from '../../assets/AssetPreviewDialog'
import type { AssetRef } from '../../assets/assetTypes'
import { buildStoryboardPlaybackQueue, hiddenGeneratingCount, positionsForAnchorFilter } from './storyboardDInteractions'
import { buildStoryboardReference } from '../../ai/resident/residentReferences'
import StoryboardPlanStrategyPanel from './StoryboardPlanStrategyPanel'
import { resolveGeneratableGate, type StoryboardResolveClient } from './strategyGate'
import { getDesktopBridge } from '../../../desktop/bridge'

/**
 * 分镜方案编辑器（v5 B：执行面）。表 = 画布节点的表格表示版——行内/批量直接生成，
 * 节点作为副作用按需长到画布（画布=旁路视图）。「确认落画布」及其守卫已删（P1）：
 * 没有单向门，行状态/计数全部从「plan × 画布节点」实时 derive（exec/storyboardRowStatus）。
 * 执行只有 canvas runner 一条通路（exec/storyboardRowActions），spendConfirm/波次/undo 全沿用。
 */

export default function StoryboardPlanEditor({ projectId }: { projectId?: string | null }): JSX.Element | null {
  const { t } = useTranslation()
  const plan = useWorkbenchStore((s) => {
    const designs = s.activeDocumentId ? s.storyboardDesignsByDocumentId[s.activeDocumentId] ?? [] : []
    return (designs.find((design) => design.id === s.activeStoryboardId) ?? designs[0])?.plan ?? null
  })
  const setStoryboardPlan = useWorkbenchStore((s) => s.setStoryboardPlan)
  const deleteStoryboardDesign = useWorkbenchStore((s) => s.deleteStoryboardDesign)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setActiveStoryboardId = useWorkbenchStore((s) => s.setActiveStoryboardId)
  const activeDocumentId = useWorkbenchStore((s) => s.activeDocumentId)
  const activeStoryboardId = useWorkbenchStore((s) => s.activeStoryboardId)
  const setProjectAgentReferences = useWorkbenchStore((s) => s.setProjectAgentReferences)
  const setProjectAgentDraft = useWorkbenchStore((s) => s.setProjectAgentDraft)
  const setProjectAgentDockCollapsed = useWorkbenchStore((s) => s.setProjectAgentDockCollapsed)
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
  const [playbackRows, setPlaybackRows] = React.useState<StoryboardRowRuntime[] | null>(null)
  const [mentionPreviewAsset, setMentionPreviewAsset] = React.useState<AssetRef | null>(null)
  // 锚区两态（v6 §2.2）：一次切全部，不做逐张展开（那会多出"哪几张是展开的"这个状态）。
  const [anchorsExpanded, setAnchorsExpanded] = React.useState(false)
  /**
   * 「本次跳过」（v6 §2.10）。作用域是**这一批**：跑完自动清空——它是一次性的批次筛选，
   * 不是持久属性（持久的那个叫「锁定」）。owner 在这里而不是表里，因为 footer 的「将跑 N 镜」
   * 必须与它同一份 derive（合同 §9.3：不许 footer 自己再减一次）。
   */
  const [skippedShotIds, setSkippedShotIds] = React.useState<ReadonlySet<string>>(new Set())
  // 选中的行（表上报）——footer 的「交给 Agent 改」与多选浮条读同一份，不各存一份。
  const [selectedRuntimes, setSelectedRuntimes] = React.useState<StoryboardRowRuntime[]>([])
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
  const batch = React.useMemo(() => deriveStoryboardBatch(rows, skippedShotIds), [rows, skippedShotIds])
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
  const playbackQueue = React.useMemo(() => buildStoryboardPlaybackQueue(playbackRows ?? rows), [playbackRows, rows])
  const playbackSequence = React.useMemo<AssetPreviewSequenceItem[]>(
    () => playbackQueue.map((item) => {
      const asset = item.mediaUrl
        ? {
            id: `${item.runtime.exec.node?.id ?? item.shot.index}:storyboard-playback`,
            kind: item.mediaKind ?? 'image',
            name: t('storyboardEditor.playback.shotLabel', { index: item.shot.index }),
            renderUrl: item.mediaUrl,
            source: 'canvas' as const,
            origin: { source: 'canvas' as const, nodeId: item.runtime.exec.node?.id ?? `storyboard-shot-${item.shot.index}` },
          }
        : {
            id: `storyboard-empty-${item.shot.index}`,
            kind: 'image' as const,
            name: t('storyboardEditor.playback.shotLabel', { index: item.shot.index }),
            renderUrl: '',
            source: 'project' as const,
            origin: { source: 'project' as const, projectId: '', relativePath: '' },
          }
      const audio = item.audioUrl
        ? {
            id: `${item.runtime.exec.node?.id ?? item.shot.index}:storyboard-audio`,
            kind: 'audio' as const,
            name: t('storyboardEditor.playback.audioForShot', { index: item.shot.index }),
            renderUrl: item.audioUrl,
            source: 'canvas' as const,
            origin: { source: 'canvas' as const, nodeId: item.runtime.exec.node?.id ?? `storyboard-shot-${item.shot.index}` },
          }
        : undefined
      return { asset, audio, durationSec: item.durationSec, playable: item.playable, label: t('storyboardEditor.playback.notGeneratedShot', { index: item.shot.index }) }
    }),
    [playbackQueue, t],
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

  /**
   * 落画布/生成前的执行计划闸（D3 B 段，切片 4）：真正会 materialize 新节点的动作（单镜生成 / 整批）
   * 先过 resolve——存在「原样生成即截断/无模型」的阻断（超上限未拆、低于下限未并、模型缺失）就拦下，
   * 给出第一条机器理由；效率合并（建议式）不拦。resolve 通道不可用（无 bridge/能力核未起）→ fail-open 放行
   * （生成合法性另有 main 侧契约钳值兜底；本闸是建议级拦截，不是安全边界）。
   */
  const resolveClient = (): StoryboardResolveClient | null => getDesktopBridge()?.generationStrategy ?? null
  const guardMaterialize = async (action: () => Promise<void>): Promise<void> => {
    const blocker = await resolveGeneratableGate(plan, projectId, resolveClient())
    if (blocker) {
      toast(blocker, 'error')
      return
    }
    await runAction(action)
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
    void guardMaterialize(() => generateShotRow(execCtx, runtime.shot, runtime.mode))
  }
  const onRunBatch = (): void => {
    const running = batch.runnable
    // 「本次跳过」的作用域就是这一批：批次一发出去，标记立刻清空（§2.10）。
    setSkippedShotIds(new Set())
    void guardMaterialize(() => runStoryboardBatch(execCtx, running))
  }
  const onRunSelected = (selected: StoryboardRowRuntime[]): void => {
    if (selected.length === 0) return
    setSkippedShotIds(new Set())
    void guardMaterialize(() => runStoryboardBatch(execCtx, selected))
  }
  const onToggleSkip = (shotId: string): void => {
    setSkippedShotIds((previous) => {
      const next = new Set(previous)
      if (next.has(shotId)) next.delete(shotId)
      else next.add(shotId)
      return next
    })
  }
  /**
   * 「交给 Agent 改」（§2.7）：把选中的镜头挂成常驻 Agent 的引用，用户接着用人话说要改什么。
   * 改表本身走现役 canonical 工具（`nomi_canvas_plan(operation=patch_shots)`），
   * 「就地预览 + 确认卡」的交互语义在 Agent 侧，本合同只保证入口可见。
   */
  const onAgentHandoff = (runtimes: StoryboardRowRuntime[]): void => {
    if (runtimes.length === 0) return
    setProjectAgentReferences((current) => [
      ...current.filter((item) => !/^storyboard:(?:shot|result):\d+$/.test(item.value ?? '')),
      ...runtimes.map((runtime) => buildStoryboardReference(
        'shot',
        runtime.shot.index,
        t('storyboardEditor.row.selectAria', { index: runtime.shot.index }),
        'agent handoff',
      )),
    ])
    toast(t('storyboardEditor.agentHandoff.toast', { count: runtimes.length }), 'info')
  }
  const onLockSelected = (runtimes: StoryboardRowRuntime[]): void => {
    for (const runtime of runtimes) if (runtime.exec.node) toggleNodeLock(runtime.exec.node.id)
  }
  /** 「从原稿重新拆分镜」：把请求交给常驻 Agent（分镜规划 Skill），不在这里另写一条拆镜逻辑。 */
  const onResplitFromScript = (): void => {
    setProjectAgentDockCollapsed(false)
    setProjectAgentDraft(t('storyboardEditor.resplitDraft'))
  }
  const onRegenerateRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.node
    if (node) void runAction(() => regenerateShotRow(execCtx, runtime.shot, node, runtime.mode))
  }
  /**
   * 可找回行的**免费**续查：走画布同一条 `recoverNodeResult`（query IPC，不铸付费令牌、不弹花费确认）。
   * 刻意**不**包进 `runAction`——那一层是给付费执行用的（busy 闸 + 失败 toast），而找回要轮询到十分钟，
   * 把整张表锁住十分钟是另一个 bug；节点自己会翻 running / 出片 / 退回可找回，行状态跟着 derive 回来。
   */
  const onRecoverRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.recoverableNode
    if (node) void recoverNodeResult(node.id)
  }
  const onVariantsRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.node
    if (node) void runAction(() => generateShotRowVariants(execCtx, runtime.shot, node, runtime.mode))
  }
  // 锁定开关：同步写 meta（不花钱不确认）；状态经 derive 立刻回流行/组头/footer。
  const onToggleLockRow = (runtime: StoryboardRowRuntime): void => {
    if (runtime.exec.node) toggleNodeLock(runtime.exec.node.id)
  }
  // 参考已变「用新图重跑」：一键补跑（花钱确认照过；首帧行按波次连跑），绝不自动跑。
  const onRerunFreshRefsRow = (runtime: StoryboardRowRuntime): void => {
    void runAction(() => rerunShotRowWithFreshRefs(execCtx, runtime.shot, runtime.exec, runtime.mode))
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
  const onRecoverAnchor = (runtime: AnchorCardRuntime): void => {
    if (runtime.node) void recoverNodeResult(runtime.node.id)
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
  const onStartPlayback = (selectedRows: StoryboardRowRuntime[] = rows): void => {
    if (selectedRows.length === 0) return
    const selectedQueue = buildStoryboardPlaybackQueue(selectedRows)
    const skipped = selectedQueue.filter((item) => !item.playable).length
    if (skipped > 0) toast(t('storyboardEditor.playback.skipped', { count: skipped }), 'info')
    setPlaybackRows(selectedRows)
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
  if (batch.excluded.recoverable > 0) excludedReasons.push(t('storyboardEditor.footer.reasonRecoverable', { count: batch.excluded.recoverable }))
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
          {/* 「从原稿重新拆分镜」（§2.7 入口 1）：旧分镜表"写完剧本一键转化"的心智在这里延续——
              只是执行者从确定性代码换成了 Agent，入口位置不变。 */}
          <WorkbenchButton
            variant="default"
            size="sm"
            data-storyboard-script-to-shots="true"
            onClick={onResplitFromScript}
          >
            <IconWand size={14} stroke={1.7} />
            {t('storyboardEditor.resplitFromScript')}
          </WorkbenchButton>
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
        {/* 执行计划审阅条（切片 3）：主进程同源 resolve 的合并/拆条建议 + 阻断问题，逐条采纳即改方案。 */}
        <StoryboardPlanStrategyPanel projectId={projectId} plan={plan} onChange={setStoryboardPlan} />
        <StoryboardAnchorZone
          cards={anchorCards}
          aspect={planDefaultAspect(plan)}
          imageModelOptions={imageModelOptions}
          noNameAnchorIds={noNameAnchorIds}
          filterAnchorId={filterAnchorId}
          expanded={anchorsExpanded}
          onToggleExpanded={setAnchorsExpanded}
          onUpdateAnchor={(anchorId, patch) => setStoryboardPlan(updateAnchor(plan, anchorId, patch))}
          onChangeKind={(anchorId, kind) => setStoryboardPlan(changeAnchorKind(plan, anchorId, kind))}
          onRemoveAnchor={(anchorId) => setStoryboardPlan(removeAnchor(plan, anchorId))}
          onGenerateAnchor={onGenerateAnchor}
          onRegenerateAnchor={onRegenerateAnchor}
          onRecoverAnchor={onRecoverAnchor}
          onToggleLockAnchor={onToggleLockAnchor}
          onOpenPreviewAnchor={onOpenPreviewAnchor}
          onFilterByAnchor={setFilterAnchorId}
          onAddAnchor={() => setStoryboardPlan(addAnchor(plan))}
        />

        <section>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-body-sm font-medium text-nomi-ink-80">{t('storyboardEditor.storyboardHeading', { count: filterAnchorId ? visibleRows.length : plan.shots.length })}</div>
            <button
              type="button"
              onClick={() => onStartPlayback(rows)}
              disabled={rows.length === 0}
              aria-label={t('storyboardEditor.playback.aria')}
              data-storyboard-play-all="true"
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
              onSelectionChange={setSelectedRuntimes}
              skippedShotIds={skippedShotIds}
              onToggleSkip={onToggleSkip}
              onAgentHandoff={onAgentHandoff}
              onLockSelected={onLockSelected}
              onGenerateRow={onGenerateRow}
              onRegenerateRow={onRegenerateRow}
              onRecoverRow={onRecoverRow}
              onVariantsRow={onVariantsRow}
              onToggleLockRow={onToggleLockRow}
              onOpenPreviewRow={onOpenPreviewRow}
              onRerunFreshRefsRow={onRerunFreshRefsRow}
              onJumpToAnchor={onJumpToAnchor}
              onSaveResultAsReference={onSaveResultAsReference}
              onSetResultAsFirstFrame={onSetResultAsFirstFrame}
              onGenerateSelected={(selected) => onRunSelected(selected)}
              onDeleteSelected={(selected) => {
                const ids = selected.flatMap((runtime) => [runtime.exec.node?.id, runtime.exec.keyframeNode?.id]).filter((id): id is string => Boolean(id))
                deletedPlanUndoRef.current = { plan, canvasSteps: ids.length }
                ids.forEach((id) => useGenerationCanvasStore.getState().deleteNode(id))
                const selectedIds = new Set(selected.map((runtime) => runtime.shot.shotId ?? `index:${runtime.shot.index}`))
                setStoryboardPlan({ ...plan, shots: plan.shots.filter((shot) => !selectedIds.has(shot.shotId ?? `index:${shot.index}`)).map((shot, index) => ({ ...shot, index: index + 1 })) })
              }}
              onPlayGroup={onStartPlayback}
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
          {/* 「选中 N 镜 · 交给 Agent 改」（§2.7 入口 1/3，footer 常驻）。 */}
          <WorkbenchButton
            variant="default"
            size="sm"
            data-storyboard-agent-handoff="footer"
            disabled={selectedRuntimes.length === 0}
            onClick={() => onAgentHandoff(selectedRuntimes)}
          >
            <IconRobot size={14} stroke={1.7} />
            {t('storyboardEditor.agentHandoff.footer', { count: selectedRuntimes.length })}
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
        <AssetPreviewDialog asset={playbackSequence[0].asset!} sequence={playbackSequence} onClose={() => { setPlaybackOpen(false); setPlaybackRows(null) }} />
      ) : previewAsset ? <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewNodeId(null)} /> : mentionPreviewAsset ? <AssetPreviewDialog asset={mentionPreviewAsset} onClose={() => setMentionPreviewAsset(null)} /> : null}
    </section>
  )
}
