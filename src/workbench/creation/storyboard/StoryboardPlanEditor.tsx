import React from 'react'
import { deleteStoryboardRows, restoreStoryboardDeletion, type StoryboardDeletion } from './storyboardDeleteUndo'
import { isCanvasTextEditingContext } from '../../generationCanvas/components/useCanvasShortcuts'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconMovie, IconLockOpen, IconPlayerPlay, IconPlus, IconRobot, IconX } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { notify } from '../../../ui/notificationPolicy'
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
import { isEmptyStoryboardPlan, type StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { planDefaultAspect } from '../../generationCanvas/agent/storyboardShotScope'
import { CreationResourceTreeToggle } from '../CreationResourceTreeToggle'
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
  type RowActionContext,
} from './exec/storyboardRowActions'
import { recoverNodeResult } from '../../generationCanvas/runner/recoverTaskActions'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { stableProjectAgentJson } from '../../../../electron/shared/legacyAgentJson'
import { isRunTargetLoaded, readRunProjectRecord } from '../../generationCanvas/runner/runProjectDelivery'
import { canvasNodeToAssetRefs } from '../../assets/assetTypes'
import { AssetPreviewDialog, type AssetPreviewSequenceItem } from '../../assets/AssetPreviewDialog'
import type { AssetRef } from '../../assets/assetTypes'
import { buildStoryboardPlaybackQueue, hiddenGeneratingCount, positionsForAnchorFilter } from './storyboardDInteractions'
import { buildStoryboardReference, isStoryboardReference } from '../../ai/resident/residentReferences'
import StoryboardPlanStrategyPanel from './StoryboardPlanStrategyPanel'
import { resolveGeneratableGate, type StoryboardResolveClient } from './strategyGate'
import { useStoryboardStrategy } from './useStoryboardStrategy'
import { describeBlocker, describeIssue } from './strategyText'
import { storyboardShotId } from '../../generationCanvas/agent/storyboardStrategy'
import { FOCUS_GENERATION_NODE_EVENT } from '../../generationCanvas/nodes/nodeSizing'
import { getDesktopBridge } from '../../../desktop/bridge'

/**
 * 分镜方案编辑器（v5 B：执行面）。表 = 画布节点的表格表示版——行内/批量直接生成，
 * 节点作为副作用按需长到画布（画布=旁路视图）。「确认落画布」及其守卫已删（P1）：
 * 没有单向门，行状态/计数全部从「plan × 画布节点」实时 derive（exec/storyboardRowStatus）。
 * 执行只有 canvas runner 一条通路（exec/storyboardRowActions），spendConfirm/波次/undo 全沿用。
 */

/** 还没有方案时喂给执行计划 hook 的空方案（hook 顺序不能因方案有无而变；空方案 → idle，不发 IPC）。 */
const EMPTY_STRATEGY_PLAN: StoryboardPlan = { title: '', anchors: [], shots: [] }

export default function StoryboardPlanEditor({ projectId }: { projectId?: string | null }): JSX.Element | null {
  const { t } = useTranslation()
  const activeDesign = useWorkbenchStore((s) => {
    const designs = s.activeDocumentId ? s.storyboardDesignsByDocumentId[s.activeDocumentId] ?? [] : []
    return designs.find((design) => design.id === s.activeStoryboardId) ?? designs[0] ?? null
  })
  const plan = activeDesign?.plan ?? null
  const designId = activeDesign?.id ?? ''
  const legacySetStoryboardPlan = useWorkbenchStore((s) => s.setStoryboardPlan)
  const setStoryboardPlan = React.useMemo(() => (next: StoryboardPlan) => {
    if (activeDesign) legacySetStoryboardPlan(next, activeDesign.documentId, activeDesign.id)
  }, [activeDesign, legacySetStoryboardPlan])
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setActiveStoryboardId = useWorkbenchStore((s) => s.setActiveStoryboardId)
  const selectedDocumentId = useWorkbenchStore((s) => s.activeDocumentId)
  const activeDocumentId = selectedDocumentId
  const setProjectAgentReferences = useWorkbenchStore((s) => s.setProjectAgentReferences)
  const canvasNodes = useGenerationCanvasStore((s) => s.nodes)
  // 图片/视频模型清单各拉一次，按镜头种类传给镜行的模型选择器 + 参数控件（完整 option 供解析 archetype 参数）。
  const videoModelOptions = useModelOptionsState('video', 'any-published').options
  const imageModelOptions = useModelOptionsState('image', 'any-published').options
  // 行内/批量生成的重入闸（生成本身异步、确认卡在别处；按钮点两下不重复 materialize）。
  const [busy, setBusy] = React.useState(false)
  const [actionFeedback, setActionFeedback] = React.useState<{ designId: string | null; message: string } | null>(null)
  const reportFailure = (message: string): void => {
    notify({ identity: `storyboard:${activeDocumentId}:${designId}`, reason: 'edit-action', level: 'inline', type: 'error', message,
      present: (value) => setActionFeedback({ designId, message: value }),
    })
  }
  // 放大预览：存 nodeId（不存快照），渲染时从画布节点现取结果——重生成后再开永远是最新图。
  const [previewNodeId, setPreviewNodeId] = React.useState<string | null>(null)
  const [filterAnchorId, setFilterAnchorId] = React.useState<string | null>(null)
  const storyboardRowFocus = useWorkbenchStore((state) => state.storyboardRowFocus)
  React.useEffect(() => {
    if (storyboardRowFocus?.designId === designId) setFilterAnchorId(null)
  }, [storyboardRowFocus, designId])
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
  const deletedPlanUndoRef = React.useRef<(StoryboardDeletion & { projectId: typeof projectId; documentId: string; designId: string }) | null>(null)
  const editorRef = React.useRef<HTMLElement>(null)
  const deletedFocusRef = React.useRef<Element | null>(null)
  const lastEditorFocusRef = React.useRef<Element | null>(null)
  React.useLayoutEffect(() => {
    const removedFocus = deletedFocusRef.current
    deletedFocusRef.current = null
    const active = document.activeElement
    // Original confirmation resolves before its exit animation removes the focused button.
    // Restore only that departing control or orphaned body focus, never a new live input.
    const closingConfirmation = removedFocus?.matches('[data-confirm-dialog-confirm="true"]')
    if (removedFocus && ((!removedFocus.isConnected && active === document.body)
      || (closingConfirmation && (active === removedFocus || active === document.body)))
      && editorRef.current?.offsetParent !== null) editorRef.current?.focus({ preventScroll: true })
  }, [plan])
  const currentTargetRef = React.useRef({ projectId, activeDocumentId, designId, plan })
  currentTargetRef.current = { projectId, activeDocumentId, designId, plan }
  const onUndo = (event: React.KeyboardEvent<HTMLElement>): void => {
    const root = editorRef.current
    if (event.defaultPrevented || event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)
      || event.key.toLowerCase() !== 'z' || !deletedPlanUndoRef.current || !plan
      || !root || root.offsetParent === null || !(event.target instanceof Node) || !root.contains(event.target)
      || isCanvasTextEditingContext(event.target, document.activeElement)) return
    event.preventDefault()
    if (deletedPlanUndoRef.current.projectId !== projectId || deletedPlanUndoRef.current.documentId !== activeDocumentId
      || deletedPlanUndoRef.current.designId !== designId) {
      deletedPlanUndoRef.current = null
      reportFailure(t('storyboardEditor.exec.actionFailed'))
      return
    }
    try {
      const next = restoreStoryboardDeletion(plan, deletedPlanUndoRef.current, useGenerationCanvasStore.getState())
      deletedPlanUndoRef.current = null
      setStoryboardPlan(next)
    } catch { reportFailure(t('storyboardEditor.exec.actionFailed')) }
  }

  const firstIssueLabel = (issue: PlanIssue): string => {
    if (issue.kind === 'anchor-not-consumable') return issue.correction
    switch (issue.kind) {
      case 'no-shots': return t('storyboardEditor.issue.noShots')
      case 'empty-shot-prompt': return t('storyboardEditor.issue.emptyPrompt', { index: issue.shotIndex })
      case 'dangling-ref': return t('storyboardEditor.issue.danglingRef', { index: issue.shotIndex })
      case 'anchor-no-name': return t('storyboardEditor.issue.anchorNoName')
    }
  }

  // 行执行态：plan × 画布节点的实时 derive（F2：组头/标题/footer 计数同一份，禁静态快照）。
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

  // 执行计划（Generation Strategy Resolver）：**查一次**，面板、行内警示、闸各取所需。
  // hook 必须在 `if (!plan) return null` 之前（React hook 顺序），所以没方案时喂空方案 → idle。
  const strategyClient = React.useMemo<StoryboardResolveClient | null>(
    () => getDesktopBridge()?.generationStrategy ?? null,
    [],
  )
  const strategyState = useStoryboardStrategy(plan ?? EMPTY_STRATEGY_PLAN, projectId, strategyClient)
  // 行内警示（D1，返工 7）：超上限 / 低于下限在**表格行上**就看得见，不用点开面板才知道。
  // 句子与面板同源（strategyText），行上只放最短的一句 + 完整理由挂 title。
  const durationWarnings = React.useMemo(() => {
    if (strategyState.status !== 'ready') return undefined
    const rendered = new Map<string, { kind: 'overflow' | 'underflow'; text: string; detail: string }>()
    for (const [shotId, warning] of strategyState.warnings) {
      rendered.set(shotId, {
        kind: warning.kind,
        text: warning.kind === 'overflow' ? t('storyboardEditor.strategy.rowOverflow') : t('storyboardEditor.strategy.rowUnderflow'),
        detail: describeIssue(t, warning.issue),
      })
    }
    return rendered
  }, [strategyState, t])

  if (!plan) return null

  const issues = validatePlan(plan).filter(issue => issue.kind !== 'anchor-not-consumable')
  // 刚建出来、一个字都还没写的空白起手式**不报错**（2026-09-21 真机截图：新建方案一落地，
  // 底栏立刻红着「2 处待处理」、两行也带红边）。那两条「提示词为空」说的是真的，但此刻它们
  // 不是「你做错了」，而是「你还没开始」——在用户动手之前先给一片红，是把起点说成了失败。
  // 拦截不变：`issues` 仍然拦住生成（下面的生成动作照读它），只是**不在这一刻冲他喊**。
  const untouched = isEmptyStoryboardPlan(plan)
  const visibleIssues = untouched ? [] : issues
  const emptyPromptShots = new Set(visibleIssues.filter((i) => i.kind === 'empty-shot-prompt').map((i) => i.shotIndex))
  const noNameAnchorIds = new Set(visibleIssues.filter((i) => i.kind === 'anchor-no-name').map((i) => i.anchorId))

  // 动作统一包一层：失败原因回当前方案（生成失败本身落在节点卡片，这里只兜 materialize/确认前异常）。
  // 回调的返回值放宽成 `unknown`：这些执行口 2026-09-22 起会**回报结局**（用户同意 / 取消 /
  // 没得跑，见 `generationRunOutcome.ts`），而编辑器这一侧是用户自己在点按钮——他自己知道点了什么，
  // 不需要读那一格。要读它的是 Agent 那条路（`storyboardPresent.ts`）。
  const runAction = async (action: (context: RowActionContext) => Promise<unknown>): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    setActionFeedback(null)
    try {
      await withProjectAction(async project => {
        project.assertCurrent()
        if (projectId && project.binding.projectId !== projectId) throw new Error('Storyboard project changed')
        project.assertCurrent()
        const gesture = { source: 'user' as const, txnId: crypto.randomUUID(), canWrite: () => { project.assertCurrent(); return !project.signal.aborted } }
        const capturedContent = stableProjectAgentJson(JSON.parse(JSON.stringify(plan)))
        const assertAuthorCurrent = async () => {
          const designs = isRunTargetLoaded(project.binding)
            ? useWorkbenchStore.getState().storyboardDesignsByDocumentId
            : (await readRunProjectRecord(project.binding))?.payload.storyboardDesignsByDocumentId
          const current = designs?.[activeDocumentId]?.find(value => value.id === designId)
          if (!current || stableProjectAgentJson(JSON.parse(JSON.stringify(current.plan))) !== capturedContent) {
            throw new Error('Storyboard target changed')
          }
        }
        const assertCurrent = async () => {
          project.assertCurrent()
          await assertAuthorCurrent()
          project.assertCurrent()
        }
        await assertCurrent()
        await action({ ...execCtx, gesture, assertCurrent, assertAuthorCurrent })
      }, () => { throw new Error(t('storyboardEditor.exec.actionFailed')) })
    } catch (error: unknown) {
      reportFailure(error instanceof Error && error.message ? error.message : t('storyboardEditor.exec.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 落画布/生成前的执行计划闸（D3 B 段，切片 4）：真正会 materialize 新节点的动作（单镜 / 多选 / 整批）
   * 先过 resolve——存在「原样生成即截断/无模型」的阻断（超上限未拆、低于下限未并、模型缺失）就拦下，
   * 给出第一条机器理由；效率合并（建议式）不拦。
   *
   * **作用域 = 本次真的要 materialize 的那些镜头**（返工 1）：resolve 照旧按整份方案算（合并建议
   * 依赖真实相邻关系），但判断只看 `shotIds`。第 7 镜超限拦不住单点第 3 镜——上一版把整份方案的
   * 任意一条阻断套在单镜生成上，用户会被一条与他无关的镜头挡住。
   *
   * resolve 通道不可用（无 bridge/能力核未起）→ fail-open 放行（生成合法性另有 main 侧契约钳值兜底；
   * 本闸是建议级拦截，不是安全边界）。
   */
  const resolveClient = (): StoryboardResolveClient | null => getDesktopBridge()?.generationStrategy ?? null
  const guardMaterialize = async (
    scope: readonly StoryboardRowRuntime[],
    action: (context: RowActionContext) => Promise<unknown>,
  ): Promise<void> => {
    await runAction(async context => {
      const shotIds = scope.map((runtime) => storyboardShotId(runtime.shot))
      const blocker = await resolveGeneratableGate(plan, projectId, resolveClient(), shotIds)
      if (blocker) {
        reportFailure(describeBlocker(t, blocker))
        return
      }
      await action(context)
    })
  }

  const execCtx = { documentId: activeDocumentId, designId, plan }
  const onStoryboardShotSelect = (shot: StoryboardPlan['shots'][number]): void => {
    const reference = buildStoryboardReference('shot', shot.index, t('storyboardEditor.row.selectAria', { index: shot.index }), 'selected shot', shot.shotId ? {documentId:activeDocumentId,designId,shotId:shot.shotId} : undefined)
    setProjectAgentReferences((current) => [
      ...current.filter((item) => !isStoryboardReference(item)),
      reference,
    ])
  }
  const placed = rows.length > 0 && rows.every(row => row.exec.node &&
    (!(row.shot.shotKind !== 'image' && row.shot.keyframe?.enabled) || row.exec.keyframeNode)) &&
    anchorCards.every(card => card.anchor.carrier === 'text' || card.anchor.referenceUrl || card.anchor.referenceSourceNodeId || card.node)
  const onPlaceOnCanvas = (): void => {
    if (placed) {
      const nodeId = rows[0]?.exec.node?.id
      flushSync(() => setWorkspaceMode('generation'))
      // 「查看画布」= 带我去看**这一批**落在哪儿，不是「打开第 1 镜开始改」。
      // 所以只跳不选（`select: false`）：选中第 1 镜会浮出它那张 composer，
      // 而 composer 比卡本身宽，正好盖住紧挨着的第 2 镜——用户点「查看」却看不见第二个。
      if (nodeId) window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId, select: false } }))
      return
    }
    void runAction(context => runStoryboardBatch(context, rows, { groupTitle: plan.title, placementOnly: true }))
  }
  const onGenerateRow = (runtime: StoryboardRowRuntime): void => {
    void guardMaterialize([runtime], context => generateShotRow(context, runtime.shot, runtime.mode))
  }
  const onRunBatch = (): void => {
    const running = batch.runnable
    // 「本次跳过」的作用域就是这一批：批次一发出去，标记立刻清空（§2.10）。
    setSkippedShotIds(new Set())
    void guardMaterialize(running, context => runStoryboardBatch(context, running))
  }
  const onRunSelected = (selected: StoryboardRowRuntime[]): void => {
    if (selected.length === 0) return
    setSkippedShotIds(new Set())
    void guardMaterialize(selected, context => runStoryboardBatch(context, selected))
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
      ...current.filter((item) => !isStoryboardReference(item)),
      ...runtimes.map((runtime) => buildStoryboardReference(
        'shot',
        runtime.shot.index,
        t('storyboardEditor.row.selectAria', { index: runtime.shot.index }),
        'agent handoff',
        runtime.shot.shotId ? {documentId:activeDocumentId,designId,shotId:runtime.shot.shotId} : undefined,
      )),
    ])
  }
  const onLockSelected = (runtimes: StoryboardRowRuntime[]): void => {
    for (const runtime of runtimes) if (runtime.exec.node) toggleNodeLock(runtime.exec.node.id)
  }
  const onRegenerateRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.node
    if (node) void runAction(context => regenerateShotRow(context, runtime.shot, node, runtime.mode))
  }
  /**
   * 可找回行的**免费**续查：走画布同一条 `recoverNodeResult`（query IPC，不铸付费令牌、不弹花费确认）。
   * 刻意**不**包进 `runAction`——那一层是给付费执行用的（busy 闸 + 原地错误），而找回要轮询到十分钟，
   * 把整张表锁住十分钟是另一个 bug；节点自己会翻 running / 出片 / 退回可找回，行状态跟着 derive 回来。
   */
  const onRecoverRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.recoverableNode
    if (node) withProjectAction((project) => { void recoverNodeResult(node.id, project) })
  }
  const onVariantsRow = (runtime: StoryboardRowRuntime): void => {
    const node = runtime.exec.node
    if (node) void runAction(context => generateShotRowVariants(context, runtime.shot, node, runtime.mode))
  }
  // 锁定开关：同步写 meta（不花钱不确认）；状态经 derive 立刻回流行/组头/footer。
  const onToggleLockRow = (runtime: StoryboardRowRuntime): void => {
    if (runtime.exec.node) toggleNodeLock(runtime.exec.node.id)
  }
  // 参考已变「用新图重跑」：一键补跑（花钱确认照过；首帧行按波次连跑），绝不自动跑。
  const onRerunFreshRefsRow = (runtime: StoryboardRowRuntime): void => {
    void runAction(context => rerunShotRowWithFreshRefs(context, runtime.shot, runtime.exec, runtime.mode))
  }
  // 参考卡就地生成/重生成/锁定（B3）：同一执行通路；重生成后引用镜经「参考已变」提示补跑。
  const onGenerateAnchor = (runtime: AnchorCardRuntime): void => {
    void runAction(context => generateAnchorCard(context, runtime.anchor))
  }
  const onRegenerateAnchor = (runtime: AnchorCardRuntime): void => {
    const node = runtime.node
    if (node) void runAction(context => regenerateAnchorCard(context, runtime.anchor, node))
    else void runAction(context => generateAnchorCard(context, runtime.anchor))
  }
  const onRecoverAnchor = (runtime: AnchorCardRuntime): void => {
    const node = runtime.node
    if (node) withProjectAction((project) => { void recoverNodeResult(node.id, project) })
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
      // `grid-cols-1` 不是装饰，是 W-03 的根因修法（2026-09-17 实测）：这张 grid 从来没写过列模板，
      // 于是浏览器给它一条**隐式 `auto` 列 = max-content**——最长的那一行（页脚 min-content 702px、
      // 批量条那句提示 max-content 795px）把整列撑到 707px，五个行块连同分镜表全被一起拉宽，
      // 再被这里的 `overflow-hidden` 从右边剪掉：1280 视口 + Agent 面板展开时 29–33 个叶子越界。
      // 表格自己的 min-content 只有 417px，完全装得下 —— 它是被撑的，不是撑人的那个。
      // `grid-cols-1` = `repeat(1, minmax(0,1fr))`，把列钉回容器宽，各行自己去 truncate / 滚动。
      className="relative w-full h-full min-h-0 grid grid-cols-1 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] border border-workbench-border rounded-workbench bg-workbench-surface-solid shadow-workbench-md overflow-hidden"
      ref={editorRef}
      tabIndex={-1}
      onKeyDown={onUndo}
      onFocusCapture={event => { if (event.target instanceof Element) lastEditorFocusRef.current = event.target }}
      data-storyboard-editor="true"
    >
      <header className="flex items-center justify-between gap-3 h-12 px-4 border-b border-nomi-line">
        <div className="flex items-center gap-2 min-w-0">
          {/* 左栏收起时的展开钮：住标题左边、把标题挤开一格（收起态它是 L1 常驻）。 */}
          <CreationResourceTreeToggle placement="panel" />
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
          <WorkbenchButton size="sm" disabled={busy || rows.length === 0} onClick={onPlaceOnCanvas} data-place-storyboard={designId}>
            {t(placed ? 'storyboardEditor.viewOnCanvas' : 'storyboardEditor.placeOnCanvas')}
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

      {/* 分镜行按**这块**的可用宽度分档（容器查询），不按视口宽——Agent 面板开/关才是真正的变量，
          视口宽只是它的一个远因。`container-type:inline-size` 同时把"内容反过来撑宽容器"这条路堵死，
          于是上面那条 `grid-cols-1` 有了第二道保险。容器起名 `storyboard`，免得被别处的容器截胡。 */}
      <div className="overflow-y-auto px-4 py-4 flex flex-col gap-4 [container-name:storyboard] [container-type:inline-size]" data-storyboard-scroll="true">
        {/* 执行计划审阅条（切片 3）：主进程同源 resolve 的合并/拆条建议 + 阻断问题，逐条采纳即改方案。
            同一份 resolve 结果还喂给表格行的行内警示（D1：摩擦在行上，提示就在行上）。 */}
        <StoryboardPlanStrategyPanel plan={plan} state={strategyState} onChange={setStoryboardPlan} />
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
              durationWarnings={durationWarnings}
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
                const current = currentTargetRef.current
                if (current.plan !== plan || current.projectId !== projectId || current.activeDocumentId !== activeDocumentId
                  || current.designId !== designId || !editorRef.current || editorRef.current.offsetParent === null) {
                  reportFailure(t('storyboardEditor.exec.actionFailed'))
                  return
                }
                try {
                  const ids = selected.flatMap(runtime => [runtime.exec.node?.id, runtime.exec.keyframeNode?.id]).filter((id): id is string => Boolean(id))
                  const deletion = deleteStoryboardRows(plan, selected.map(runtime => runtime.shot), ids, useGenerationCanvasStore.getState())
                  const focused = document.activeElement
                  deletedFocusRef.current = focused && (editorRef.current.contains(focused) || focused.matches('[data-confirm-dialog-confirm="true"]'))
                    ? focused : focused === document.body ? lastEditorFocusRef.current : null
                  deletedPlanUndoRef.current = { ...deletion.undo, projectId, documentId: activeDocumentId, designId }
                  setStoryboardPlan(deletion.plan)
                } catch { reportFailure(t('storyboardEditor.exec.actionFailed')) }
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
          {visibleIssues.length > 0 ? (
            <span className="text-caption text-workbench-danger inline-flex items-center gap-[5px] min-w-0" data-storyboard-issues={visibleIssues.length}>
              <IconAlertTriangle size={14} stroke={1.8} className="shrink-0" />
              <span className="truncate">{t('storyboardEditor.issuesSummary', { count: visibleIssues.length, issue: firstIssueLabel(visibleIssues[0]) })}</span>
            </span>
          ) : (
            <span className="text-caption text-nomi-ink-60 min-w-0 truncate" data-storyboard-progress="true">
              {t('storyboardEditor.footer.progress', { done: batch.doneCount + batch.excluded.locked, total: plan.shots.length })}
              {excludedReasons.length > 0 ? ` · ${excludedReasons.join(t('storyboardEditor.footer.reasonSeparator'))}${t('storyboardEditor.footer.excludedSuffix')}` : ''}
            </span>
          )}
        </div>
        {/* 右端只留主动作。这里原本还挂着一句 `footer.spendNote`——而它**逐字**就是上面那条
            提示行（`spendHint`）的后半句「每次生成前确认花费 / Cost is confirmed before every
            generation」，同一屏写了两遍。它住在 `shrink-0` 的组里，所以永远不让位：英文下白占
            约 220px（中文约 110px），而左边那句**有行动价值**的进度/问题摘要正是靠 `truncate`
            在这点宽度上被切掉的——1280 + Agent 面板展开时 EN 被切 426px，连「还差几张参考卡」
            都看不见；1680 宽屏也仍被切 26px。让位顺序反了：零行动价值的重复说明不让，
            要用户去做事的那句反而让。删掉重复的那句就是修在根因（R2「有行动价值吗，没有删」）。
            2026-09-26 提示行里那半句也删了：用户自己点的单行生成不再弹花钱确认卡，承诺不成立。 */}
        <div className="flex items-center gap-2.5 shrink-0">
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

      {actionFeedback?.designId === designId ? <p role="status" data-storyboard-action-feedback className="px-3 py-2 text-caption text-workbench-danger">{actionFeedback.message}</p> : null}

      {/* 放大预览：素材库同一 body-portal lightbox（NodeMediaPreviewDialog 挂画布容器在分镜页不可见）。 */}
      {playbackOpen && playbackSequence.length > 0 ? (
        <AssetPreviewDialog asset={playbackSequence[0].asset!} sequence={playbackSequence} onClose={() => { setPlaybackOpen(false); setPlaybackRows(null) }} />
      ) : previewAsset ? <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewNodeId(null)} /> : mentionPreviewAsset ? <AssetPreviewDialog asset={mentionPreviewAsset} onClose={() => setMentionPreviewAsset(null)} /> : null}
    </section>
  )
}
