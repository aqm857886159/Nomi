import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { ConfirmDialogHost, confirmDialog, NomiLoadingMark } from '../design'
import ProjectLibraryPage from './library/ProjectLibraryPage'
import { SettingsDialog } from './settings/SettingsDialog'
import { useSettingsDialogController } from './settings/useSettingsDialogController'
import {
  createLocalProject,
  deleteLocalProject,
  renameLocalProject,
  useLocalProjects,
  type LocalProjectSummary,
} from './library/localProjectStore'
import type { WorkbenchProjectPersistenceService } from './project/projectPersistenceService'
import { useWorkspaceEvents } from './useWorkspaceEvents'
import { useWorkbenchStore, type WorkspaceMode } from './workbenchStore'
import {
  clearCommittedProposal,
  hydrateCommittedProposalReceipt,
  recoverPendingProposalReceipt,
} from './generationCanvas/agent/proposalUndo'
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore'
import { readGenerationCanvasSnapshot } from './generationCanvas/agent/generationCanvasTools'
import { readDocumentSurface, writeDocumentSurface } from './project/documentSurfaceHandlers'
import {
  captureCanvasDeleteRawEvidence,
  captureCanvasWriteRawEvidence,
  executeCanvasWriteTarget,
} from './generationCanvas/agent/canvasWriteTarget'
import { canvasDeleteSemanticInputSchema } from '../../electron/shared/agentCapabilities/canvasDelete'
import {
  executeTimelineReadTarget,
  executeTimelineWriteTarget,
  type TimelineWriteTargetExecution,
} from './timeline/agent/timelineCapabilityTarget'
import {
  executeAssetReadTarget,
  executeExportReadTarget,
  executeExportWriteTarget,
} from './timeline/agent/phase4CapabilityTargets'
import { FOCUS_GENERATION_NODE_EVENT } from './generationCanvas/nodes/nodeSizing'
import { focusCanvasNodeWhenReady } from './deepLinkFocus'
import { projectAgentClient } from './ai/projectAgentClient'
import { projectAgentProjectionStore } from './ai/projectAgentProjectionStore'
import { initReviewEventBridge } from './generationCanvas/reviewEventBridge'
import { initComfyuiProgressBridge } from './generationCanvas/comfyuiProgressBridge'
import { initResultUrlRelocalizeBridge } from './generationCanvas/resultUrlRelocalizeBridge'
import { setCanvasEventProjectIdProvider } from './generationCanvas/events/canvasEventEmitter'
import { handleCapabilityApply, registerCapabilityApplyHandler } from './capability/capabilityApplyHandler'
import { cn } from '../utils/cn'
import { toast } from '../ui/toast'
import { setDesktopActiveProjectId } from '../desktop/activeProject'
import { getDesktopBridge } from '../desktop/bridge'
import { useHasTextModel } from './library/useHasTextModel'
import { SplashIntro } from './onboarding/SplashIntro'
import { hasSeenSplash, markSplashSeen, hasSeenJourneyTour } from './onboarding/onboardingState'
import { buildStudioUrl } from '../utils/appRoutes'
import { openWorkspaceFromLibrary } from './library/openWorkspaceFlow'
import { lazyWithChunkBoundary } from '../ui/chunkBoundary'
import { releaseWorkbenchProjectRuntimeState } from './project/releaseWorkbenchProjectSession'
import { useSpendConfirmStore } from './generationCanvas/spend/spendConfirm'
import { runAssetSurfaceMigrations } from './assets/assetSurfaceMigration'
import { useProductionRunStore } from './production/productionRunStore'
import { ProductionCanvasLandingHost } from './production/ProductionCanvasLandingHost'
import { ProjectHydrationSupersededError, createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurface } from './project/projectCanvasReadSurface'
import { hydrateWorkbenchProjectWithRecovery } from './project/projectHydrationRecovery'
import { runProjectAssetHealthCheck } from './generationCanvas/runner/projectAssetHealthCheck'
import { abandonPendingCanvasWrite } from './generationCanvas/events/canvasWriteBoundary'
import { SurfacePortWireError } from '../../electron/shared/surfacePortBinding'
import DeconstructionPanelHost from './generationCanvas/nodes/DeconstructionPanelHost'
import { FeedbackShareHost } from '../ui/community/FeedbackShareHost'
type AppView = 'library' | 'studio'
// 项目创建规格：所有创建入口拼装项目的单一真相源（P1）。
// 各入口各自决定 workspaceMode / seedKey / 创建+刷新+hydrate 的编排时约定不统一——
// 「落地视图不确定」「新建空白被当 legacy 迁移删默认节点」根子都在分头拼装。
type ProjectCreationSpec = {
  /** 落地视图：必填，每个入口显式声明，杜绝继承上一个项目残留 mode（审计 A11）。*/
  workspaceMode: WorkspaceMode
  name?: string
  templateId?: string
  /** 播种身份（如 example:xxx）；带 seedKey 的项目永不被空壳 GC 回收。*/
  seedKey?: string
}
type ProjectPersistenceModule = typeof import('./project/projectPersistenceService')

// 懒加载点位全部走容错域（审计 A5）：chunk 失败只降级该区域，不再拖死整个 app。
const WorkbenchShell = lazyWithChunkBoundary('工作台', () => import('./WorkbenchShell'))
const HandbookPanel = lazyWithChunkBoundary('上手手册', () =>
  import('./onboarding/HandbookPanel').then((module) => ({
    default: module.HandbookPanel,
  })),
)
const GenerationCanvas = lazyWithChunkBoundary(
  '生成画布',
  () => import('./generationCanvas/components/GenerationCanvas'),
)
const SpendConfirmDialog = lazyWithChunkBoundary('付费确认', () =>
  import('./generationCanvas/spend/SpendConfirmDialog').then((module) => ({
    default: module.SpendConfirmDialog,
  })),
)
const JourneyTourController = lazyWithChunkBoundary('引导旅途', () =>
  import('./onboarding/JourneyTourController').then((module) => ({
    default: module.JourneyTourController,
  })),
)
const NomiBrowserDialog = lazyWithChunkBoundary('浏览器', () =>
  import('../ui/browser/dialog/NomiBrowserDialog').then((module) => ({
    default: module.NomiBrowserDialog,
  })),
)
function GenerationCanvasLoading(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn('w-full h-full bg-workbench-bg grid place-items-center')}
      aria-label={t('studio.generationCanvasLoading')}
    >
      {/* pending 规范 #1:懒加载占位不再空白,给可见品牌 spinner */}
      <NomiLoadingMark size={28} label={t('studio.generationCanvasLoading')} />
    </div>
  )
}

function readProjectIdFromSearch(search: string): string | null {
  try {
    const value = new URLSearchParams(search).get('projectId')
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

export default function NomiStudioApp(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [view, setView] = React.useState<AppView>('library')
  const { projects, refreshProjects } = useLocalProjects()
  const [activeProject, setActiveProject] = React.useState<LocalProjectSummary | null>(null)
  const settingsDialogController = useSettingsDialogController()
  const [handbookOpened, setHandbookOpened] = React.useState(false)
  const [browserOpened, setBrowserOpened] = React.useState(false)
  const [browserMounted, setBrowserMounted] = React.useState(false)
  const hasPendingSpendConfirm = useSpendConfirmStore((state) => Boolean(state.pending))
  // 首启开屏：仅首次未看过时自动放；看过后可经设置「关于」→「重看开屏动画」重看。
  const [splashDone, setSplashDone] = React.useState(() => hasSeenSplash())
  const [journeyTourControllerMounted, setJourneyTourControllerMounted] = React.useState(false)
  const { hasTextModel, refresh: refreshModelStatus } = useHasTextModel()
  const hydratingProjectRef = React.useRef(false)
  const hydrationSequenceRef = React.useRef(0)
  const activeProjectIdRef = React.useRef<string | null>(null)
  const initialHydrationAttemptedRef = React.useRef(false)
  const projectPersistenceModuleRef = React.useRef<ProjectPersistenceModule | null>(null)
  const projectPersistenceServiceRef = React.useRef<WorkbenchProjectPersistenceService | null>(null)
  const projectPersistenceUnbindRef = React.useRef<(() => void) | null>(null)
  const hardReloadingRef = React.useRef(false)
  const browserOpenedRef = React.useRef(false)
  const pendingCloseRequestRef = React.useRef<string | null>(null)
  const projectAgentSubscriptionRef = React.useRef<string | null>(null)
  const projectAgentPatchUnbindRef = React.useRef<(() => void) | null>(null)
  const routeProjectId = React.useMemo(() => readProjectIdFromSearch(location.search), [location.search])
  const activeProjectPersistenceKey = activeProject ? `${activeProject.id}\u0000${activeProject.name}` : ''
  const [projectSurface] = React.useState(() =>
    createProjectCanvasReadSurfaceCoordinator({
      getSurfaceBridge: () => getDesktopBridge()?.surface ?? null,
      createSurfaceInstanceId: () => globalThis.crypto.randomUUID(),
    }),
  )

  React.useEffect(() => {
    browserOpenedRef.current = browserOpened
  }, [browserOpened])

  React.useEffect(() => {
    const windowBridge = getDesktopBridge()?.window
    if (!windowBridge?.onCloseRequest) return undefined
    return windowBridge.onCloseRequest((payload) => {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : ''
      if (!requestId) return
      if (pendingCloseRequestRef.current) {
        windowBridge.cancelClose?.(requestId)
        return
      }
      pendingCloseRequestRef.current = requestId
      void confirmDialog({
        title: t('studio.closeTitle'),
        message: t('studio.closeMessage'),
        confirmLabel: t('common.close'),
        cancelLabel: t('common.cancel'),
        tone: 'info',
      })
        .then((confirmed) => {
          const latestWindowBridge = getDesktopBridge()?.window
          if (confirmed) latestWindowBridge?.confirmClose?.(requestId)
          else latestWindowBridge?.cancelClose?.(requestId)
        })
        .finally(() => {
          if (pendingCloseRequestRef.current === requestId) pendingCloseRequestRef.current = null
        })
    })
  }, [t])

  // 素材面收敛一次性迁移（幂等）：旧素材盒 localStorage 提示词卡并入主提示词库。
  React.useEffect(() => {
    runAssetSurfaceMigrations()
  }, [])

  React.useEffect(() => {
    const handleOpenHandbook = () => setHandbookOpened(true)
    window.addEventListener('nomi-open-handbook', handleOpenHandbook)
    return () => window.removeEventListener('nomi-open-handbook', handleOpenHandbook)
  }, [])

  React.useEffect(() => {
    const handleOpenBrowser = () => {
      setBrowserMounted(true)
      setBrowserOpened(true)
    }
    window.addEventListener('nomi-open-browser', handleOpenBrowser)
    return () => window.removeEventListener('nomi-open-browser', handleOpenBrowser)
  }, [])

  React.useEffect(() => {
    if (browserOpened) setBrowserMounted(true)
  }, [browserOpened])

  const ensureProjectPersistenceService = React.useCallback(async () => {
    let module = projectPersistenceModuleRef.current
    if (!module) {
      module = await import('./project/projectPersistenceService')
      projectPersistenceModuleRef.current = module
    }
    let service = projectPersistenceServiceRef.current
    if (!service) {
      service = module.createWorkbenchProjectPersistenceService({
        setActiveProject,
      })
      projectPersistenceServiceRef.current = service
    }
    return { module, service }
  }, [])

  React.useEffect(() => {
    setDesktopActiveProjectId(activeProject?.id)
  }, [activeProject?.id])

  React.useEffect(() => {
    try {
      const unbind = projectAgentClient.onPatch((patch) => {
        if (projectAgentProjectionStore.applyPatch(patch)) return
        const subscriptionId = projectAgentSubscriptionRef.current
        if (!subscriptionId) return
        void projectAgentClient
          .snapshot(subscriptionId)
          .then((snapshot) => {
            projectAgentProjectionStore.applySnapshot(snapshot)
          })
          .catch(() => undefined)
      })
      projectAgentPatchUnbindRef.current = unbind
      return () => {
        unbind()
        if (projectAgentPatchUnbindRef.current === unbind) projectAgentPatchUnbindRef.current = null
      }
    } catch {
      return undefined
    }
  }, [])
  React.useEffect(() => initReviewEventBridge(), [])
  React.useEffect(() => initComfyuiProgressBridge(), [])
  React.useEffect(() => initResultUrlRelocalizeBridge(), [])
  React.useEffect(() => setCanvasEventProjectIdProvider(() => activeProjectIdRef.current ?? null), [])
  React.useEffect(() => registerCapabilityApplyHandler(), [])
  // B4 只读 Surface 端口复用同一 coordinator binding，不复制项目真相。
  React.useEffect(
    () =>
      registerProjectCanvasReadSurface(
        projectSurface,
        readGenerationCanvasSnapshot,
        readDocumentSurface,
        writeDocumentSurface,
        ({ operation, input, nodeId }) => {
          try {
            if (operation === 'delete_canvas_nodes') {
              return captureCanvasDeleteRawEvidence(
                readGenerationCanvasSnapshot(),
                canvasDeleteSemanticInputSchema.parse(input),
              )
            }
            return captureCanvasWriteRawEvidence(
              readGenerationCanvasSnapshot(),
              operation === 'set_node_prompt' ? (nodeId ?? '') : { operation, input },
            )
          } catch (error) {
            const code =
              error && typeof error === 'object' && (error as { code?: unknown }).code === 'capability_target_stale'
                ? 'capability_target_stale'
                : 'capability_input_invalid'
            throw new SurfacePortWireError(code)
          }
        },
        (request) => executeCanvasWriteTarget(request, readGenerationCanvasSnapshot),
        ({ input }) => executeTimelineReadTarget(input),
        (request) => executeTimelineWriteTarget(request as TimelineWriteTargetExecution),
        {
          readAsset: executeAssetReadTarget,
          readExport: executeExportReadTarget,
          writeExport: executeExportWriteTarget,
        },
      ),
    [projectSurface],
  )

  // E2E 仅在 __nomiE2E=1 时暴露真实能力 handler；生产不置标志且没有并行实现。
  // R13 由页面上下文用真实 payload 驱动同一条确认管线。
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('__nomiE2E') === '1') {
        ;(window as unknown as { __nomiCapabilityApply?: unknown }).__nomiCapabilityApply = handleCapabilityApply
        ;(
          window as unknown as { __nomiSpendConfirmE2E?: (request: Record<string, unknown>) => Promise<boolean> }
        ).__nomiSpendConfirmE2E = async (request) => {
          const rememberHosting = request.rememberHosting === true
          const { rememberHosting: _rememberHosting, ...pendingRequest } = request
          if (pendingRequest.hostingDisclosure && typeof pendingRequest.hostingDisclosure === 'object') {
            const disclosure = pendingRequest.hostingDisclosure as Record<string, unknown>
            pendingRequest.hostingDisclosure = {
              ...disclosure,
              onRemember: rememberHosting
                ? async () => {
                    const policy = getDesktopBridge()?.settings?.automationPolicy
                    if (!policy) return
                    const current = await policy.get()
                    await policy.set({ ...current, anonymousAssetHosting: 'allow' })
                    ;(window as unknown as { __nomiSpendRemembered?: boolean }).__nomiSpendRemembered = true
                  }
                : undefined,
            }
          }
          return useSpendConfirmStore.getState().requestConfirm(pendingRequest as never)
        }
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])

  React.useEffect(() => {
    const handleHardReloadShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isReloadShortcut = key === 'f5' || ((event.ctrlKey || event.metaKey) && key === 'r')
      if (!isReloadShortcut) return
      const desktop = getDesktopBridge()
      if (!desktop?.app?.hardReloadWindow) return
      event.preventDefault()
      event.stopPropagation()
      if (hardReloadingRef.current) return
      hardReloadingRef.current = true
      void import('./project/workbenchProjectSession')
        .then(({ persistActiveWorkbenchProjectNow }) => persistActiveWorkbenchProjectNow())
        .catch((error: unknown) => {
          console.error('hard reload save error', error)
        })
        .finally(() => {
          desktop.app?.hardReloadWindow?.()
        })
    }
    window.addEventListener('keydown', handleHardReloadShortcut, { capture: true })
    return () => window.removeEventListener('keydown', handleHardReloadShortcut, { capture: true })
  }, [])

  const hydrateProject = React.useCallback(
    async (projectId: string, options: { replaceUrl?: boolean } = {}) => {
      // This call synchronously invokes Surface suspend. Its ACK is deliberately
      // the first await: neither a lazy import nor readLocalProjectAsync may run
      // while the outgoing project's main route is still executable.
      const surfaceEpoch = projectSurface.beginHydration()
      const hydrationSequence = ++hydrationSequenceRef.current
      hydratingProjectRef.current = true
      // The old/new Canvas must not accept user writes between disk hydration
      // and receipt recovery. React unmounts the studio before the first await;
      // it is exposed again only after Host open + pending compensation finish.
      setView('library')
      try {
        await surfaceEpoch.waitUntilSuspended()
        surfaceEpoch.assertCurrent()
        const previousSubscription = projectAgentSubscriptionRef.current
        if (previousSubscription) {
          await projectAgentClient.release(previousSubscription).catch(() => undefined)
          projectAgentSubscriptionRef.current = null
          projectAgentProjectionStore.clear()
        }
        abandonPendingCanvasWrite()
        clearCommittedProposal()
        const { module, service } = await ensureProjectPersistenceService()
        surfaceEpoch.assertCurrent()
        const hydrated = await hydrateWorkbenchProjectWithRecovery({ projectId, service, guard: surfaceEpoch, t })
        if (!hydrated) {
          surfaceEpoch.assertCurrent()
          refreshProjects()
          return false
        }
        surfaceEpoch.assertCurrent()
        // Sole home for "switching projects collapses the left rail": cutover flips view to 'library'
        // mid-hydration (above), remounting the sidebar so its transition effect can't see the switch.
        if ((activeProjectIdRef.current ?? null) !== hydrated.id) useWorkbenchStore.getState().setSidebarCollapsed(true)
        activeProjectIdRef.current = hydrated.id
        // 同步喂全局（不等 effect 滞后一拍）：切项目瞬间拖图上传时 resolveProjectId 取的就是新项目，
        // 不再误写进旧项目目录 / 编错 projectId 致渲染 404（C2 修，对齐 activeProjectIdRef 同步口径）。
        setDesktopActiveProjectId(hydrated.id)
        setActiveProject(hydrated)
        surfaceEpoch.assertCurrent()
        const committedBinding = await surfaceEpoch.commitCanvasRead(hydrated.id)
        surfaceEpoch.assertCurrent()
        if (committedBinding) {
          const opened = await projectAgentClient.open(committedBinding.binding)
          surfaceEpoch.assertCurrent()
          projectAgentSubscriptionRef.current = opened.subscriptionId
          projectAgentProjectionStore.install(opened.subscriptionId, opened.subscriptionEpoch, opened.snapshot)
          hydrateCommittedProposalReceipt(opened.proposalReceipt)
          await recoverPendingProposalReceipt()
          surfaceEpoch.assertCurrent()
          // The Host snapshot is the sole display source after cutover.
        }
        surfaceEpoch.assertCurrent()
        setView('studio')
        navigate(buildStudioUrl(hydrated.id), { replace: options.replaceUrl ?? false })
        // Only start background repairs after main has acknowledged the exact
        // committed Surface; the guard prevents any late write after a switch.
        void runProjectAssetHealthCheck(hydrated.id, surfaceEpoch).catch(() => {})
        const migrationDiag = module.consumeCategoryMigrationDiagnostic(surfaceEpoch)
        if (migrationDiag && (migrationDiag.migratedNodes > 0 || migrationDiag.categoriesSeeded)) {
          toast(t('studio.migrationComplete', { count: migrationDiag.migratedNodes }), 'success')
        }
      } catch (error) {
        if (error instanceof ProjectHydrationSupersededError) throw error
        console.error('project Surface hydration failed', error)
        return false
      } finally {
        if (hydrationSequenceRef.current === hydrationSequence) hydratingProjectRef.current = false
      }
      return true
    },
    [ensureProjectPersistenceService, navigate, projectSurface, refreshProjects, t],
  )

  const openProject = React.useCallback(
    (projectId: string) => {
      // 常规打开默认落「生成」画布。显式设，避免继承上一个示例残留的 creation
      // （WorkbenchShell 挂载在 URL 无 step 时会沿用 store 当前模式）。
      useWorkbenchStore.getState().setWorkspaceMode('generation')
      void hydrateProject(projectId).catch((error: unknown) => {
        if (!(error instanceof ProjectHydrationSupersededError)) console.error('project hydrate failed', error)
      })
    },
    [hydrateProject],
  )

  React.useEffect(() => {
    const onDeepLink = getDesktopBridge()?.app?.onProductionDeepLink
    if (!onDeepLink) return undefined
    return onDeepLink((payload) => {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : ''
      const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : ''
      const nodeId = typeof payload?.nodeId === 'string' ? payload.nodeId.trim() : ''
      // 只要有 projectId 就该跳。**曾经这里要求必须有 runId**，于是工程级 `nomi://project/{id}`
      // （每条生成结果都在给用户的那个链接）和节点级链接点了**毫无反应**——连窗口都不亮一下。
      // 三种形状各自的归宿：run→任务中心、node→画布并选中那一镜、纯工程→打开项目即可。
      if (!projectId) return
      void (async () => {
        useWorkbenchStore.getState().setWorkspaceMode('generation')
        if (activeProjectIdRef.current !== projectId) {
          const opened = await hydrateProject(projectId, { replaceUrl: true })
          if (!opened) return
        }
        if (runId) {
          // 深链落到制作任务的新家：任务中心（不再展开画布助手面板——制作已从那儿搬走）。
          window.dispatchEvent(new CustomEvent('nomi-open-task-center'))
          await useProductionRunStore.getState().navigateTo(projectId, runId, payload.artifactId)
          return
        }
        if (nodeId) {
          // 「指着看」：复用画布既有的聚焦通道（切到该节点所在分类页签 + 选中 + 平移到视野 + 闪一下），
          // 不自造第二套选中逻辑（P1）。刚 hydrate 完节点可能还没进 store，等它出现再派。
          await focusCanvasNodeWhenReady({
            nodeId,
            hasNode: () => useGenerationCanvasStore.getState().nodes.some((node) => node.id === nodeId),
            dispatch: (id) =>
              window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: id } })),
            waitFrame: () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
          })
        }
      })().catch((error) => console.error('deep link navigation failed', error))
    })
  }, [hydrateProject])

  const openWorkspaceFolder = React.useCallback(async () => {
    try {
      await openWorkspaceFromLibrary({
        bridge: getDesktopBridge(),
        hydrateProject,
        refreshProjects,
        confirmInitialize: async (rootPath) =>
          confirmDialog({
            title: t('studio.initializeTitle'),
            message: t('studio.initializeMessage', { path: rootPath }),
            confirmLabel: t('common.initialize'),
          }),
        showMessage: (message, tone) => toast(message, tone || 'error'),
      })
    } catch (error: unknown) {
      if (!(error instanceof ProjectHydrationSupersededError)) throw error
    }
  }, [hydrateProject, refreshProjects, t])

  const revealProjectFolder = React.useCallback(
    (projectId: string) => {
      const bridge = getDesktopBridge()
      if (!bridge?.workspace?.revealProjectFolder) {
        toast(t('studio.folderUnsupported'), 'error')
        return
      }
      void bridge.workspace.revealProjectFolder({ projectId }).catch((error: unknown) => {
        const message = error instanceof Error && error.message ? error.message : t('studio.openFolderFailed')
        toast(message, 'error')
      })
    },
    [t],
  )

  // 创建并打开项目的单一编排点（收口创建入口的重复拼装，P1）：
  // 落地视图 → 建项目 → 刷新库 → hydrate，按 spec 统一走一遍。落地视图是 spec 必填字段，
  // 由调用方显式声明（审计 A11）；seedKey 决定是否参与空壳 GC（带 seedKey 永不回收）。
  // 桌面端 createLocalProject 经 IPC 落到 ~/Documents/Nomi Projects 自动文件夹，Web 端落
  // localStorage；要绑定自选目录走「打开文件夹」（openWorkspaceFolder，另一条带 rootPath 的路径）。
  const createAndOpenProject = React.useCallback(
    async (spec: ProjectCreationSpec): Promise<{ projectId: string; opened: boolean }> => {
      useWorkbenchStore.getState().setWorkspaceMode(spec.workspaceMode)
      const project = createLocalProject(spec.name, spec.templateId, spec.seedKey ? { seedKey: spec.seedKey } : {})
      refreshProjects()
      const opened = await hydrateProject(project.id)
      return { projectId: project.id, opened }
    },
    [hydrateProject, refreshProjects],
  )

  const newProject = React.useCallback(() => {
    // 「新建项目」：默认位置建项目，落「创作」区（CTA「从一段文字或想法开始」）。
    void createAndOpenProject({ workspaceMode: 'creation' }).catch((error) => {
      console.error('new project error', error)
      toast(t('studio.newProjectFailed'), 'error')
    })
  }, [createAndOpenProject, t])

  // 引导旅途：建一个 seedKey 隔离的示例项目（永不 GC、不脏用户真项目）→ 进 studio →
  // 激活 tour，JourneyTourController 用预置数据回放整条流水线。
  const playJourneyTour = React.useCallback(() => {
    setJourneyTourControllerMounted(true)
    void (async () => {
      const [{ DEMO_PROJECT_NAME, DEMO_PROJECT_SEED_KEY }, { useJourneyTourStore }] = await Promise.all([
        import('./onboarding/demoProject'),
        import('./onboarding/journeyTourStore'),
      ])
      const result = await createAndOpenProject({
        workspaceMode: 'creation',
        name: DEMO_PROJECT_NAME,
        seedKey: DEMO_PROJECT_SEED_KEY,
      })
      if (result.opened) useJourneyTourStore.getState().start()
    })().catch((error) => {
      console.error('journey tour project error', error)
      toast(t('studio.demoProjectFailed'), 'error')
    })
  }, [createAndOpenProject, t])

  // 接完模型（目录变更广播）→ 状态重查，让缺模型状态条/弱入口即时翻面
  // （面板还开着时也更新，不必等用户关面板）。
  React.useEffect(() => {
    const handleCatalogChanged = () => refreshModelStatus()
    window.addEventListener('nomi-model-catalog-changed', handleCatalogChanged)
    return () => window.removeEventListener('nomi-model-catalog-changed', handleCatalogChanged)
  }, [refreshModelStatus])

  const closeBrowser = React.useCallback(() => {
    setBrowserOpened(false)
  }, [])

  const deleteProject = React.useCallback(
    async (project: LocalProjectSummary) => {
      // 应用内确认框（审计 A7）：原生 window.confirm 脱设计系统、E2E 测不到、
      // Electron/macOS 有焦点丢失史。
      // 文案按来源如实区分（真删盘只对 native；外部「打开文件夹」只解绑、不删用户文件）。
      const isExternal = project.source === 'folder'
      const confirmed = await confirmDialog({
        title: isExternal ? t('studio.removeProjectTitle') : t('studio.deleteProjectTitle'),
        message: isExternal
          ? t('studio.removeProjectMessage', { name: project.name })
          : t('studio.deleteProjectMessage', { name: project.name }),
        confirmLabel: isExternal ? t('studio.removeProject') : t('common.delete'),
        danger: true,
      })
      if (!confirmed) return
      try {
        if (activeProjectIdRef.current === project.id) {
          // Deleting the open project must first receive main's release ACK;
          // otherwise its old canvas-read route could outlive the project.
          await projectSurface.releaseCurrent()
          const subscriptionId = projectAgentSubscriptionRef.current
          if (subscriptionId) {
            await projectAgentClient.release(subscriptionId).catch(() => undefined)
            projectAgentSubscriptionRef.current = null
            projectAgentProjectionStore.clear()
          }
        }
        deleteLocalProject(project.id)
        if (activeProjectIdRef.current === project.id) {
          activeProjectIdRef.current = null
          setDesktopActiveProjectId(null)
          setActiveProject(null)
          setView('library')
          navigate(buildStudioUrl(), { replace: true })
        }
        toast(isExternal ? t('studio.projectRemoved') : t('studio.projectDeleted'), 'success')
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : t('studio.projectDeleteFailed')
        console.error(message)
        toast(message, 'error')
      }
    },
    [navigate, projectSurface, t],
  )

  // 列表页「双击改名」：只改名不动内容；若改的正是当前打开的项目，同步顶栏显示名（activeProject）。
  const renameLibraryProject = React.useCallback(
    (projectId: string, name: string) => {
      try {
        const record = renameLocalProject(projectId, name)
        if (record && activeProjectIdRef.current === projectId) {
          setActiveProject((prev) => (prev && prev.id === projectId ? { ...prev, name: record.name } : prev))
        }
      } catch (error: unknown) {
        console.error('project rename error', error)
        toast(t('studio.renameFailed'), 'error')
      }
    },
    [t],
  )

  React.useEffect(() => {
    if (initialHydrationAttemptedRef.current) return
    initialHydrationAttemptedRef.current = true
    if (!routeProjectId) return
    let cancelled = false
    void hydrateProject(routeProjectId, { replaceUrl: true })
      .then((opened) => {
        if (!cancelled && !opened) navigate(buildStudioUrl(), { replace: true })
      })
      .catch((error: unknown) => {
        if (error instanceof ProjectHydrationSupersededError) return
        const message = error instanceof Error && error.message ? error.message : t('studio.projectRestoreFailed')
        console.error(message)
      })
    return () => {
      cancelled = true
    }
  }, [hydrateProject, navigate, routeProjectId, t])

  React.useEffect(() => {
    if (!initialHydrationAttemptedRef.current || hydratingProjectRef.current) return
    if (!routeProjectId || routeProjectId === activeProjectIdRef.current) return
    void hydrateProject(routeProjectId, { replaceUrl: true })
      .then((ok) => {
        if (!ok) navigate(buildStudioUrl(), { replace: true })
      })
      .catch((error: unknown) => {
        if (!(error instanceof ProjectHydrationSupersededError)) console.error('project hydrate failed', error)
      })
  }, [hydrateProject, navigate, routeProjectId])

  React.useEffect(() => {
    if (!activeProject?.id) return
    let disposed = false
    let unbind: (() => void) | undefined
    void ensureProjectPersistenceService().then(({ service }) => {
      if (disposed || activeProjectIdRef.current !== activeProject.id) return
      const rawUnbind = service.bindProjectPersistence({
        project: activeProject,
        isHydrating: () => hydratingProjectRef.current,
        canPersist: () => activeProjectIdRef.current === activeProject.id,
        onSaved: (saved) => {
          if (activeProjectIdRef.current === activeProject.id) {
            setActiveProject(saved)
          } else {
            refreshProjects()
          }
        },
        onSaveError: (error) => {
          console.error('project save error', error)
          toast(t('studio.projectSaveFailed'), 'error')
        },
      })
      let unbound = false
      unbind = () => {
        if (unbound) return
        unbound = true
        rawUnbind()
      }
      projectPersistenceUnbindRef.current = unbind
    })
    return () => {
      disposed = true
      if (unbind && projectPersistenceUnbindRef.current === unbind) {
        projectPersistenceUnbindRef.current = null
      }
      unbind?.()
    }
  }, [activeProject, activeProjectPersistenceKey, ensureProjectPersistenceService, refreshProjects, t])

  useWorkspaceEvents(view === 'studio' ? activeProject?.id : null, (type) => {
    if (type === 'canvas.updated' || type === 'timeline.updated' || type === 'creation.updated') {
      void hydrateProject(activeProject!.id).catch((error: unknown) => {
        if (!(error instanceof ProjectHydrationSupersededError)) console.error('project hydrate failed', error)
      })
    }
  })

  const backToLibrary = React.useCallback(async () => {
    try {
      await projectSurface.releaseCurrent()
    } catch (error: unknown) {
      console.error('project Surface release failed', error)
      return
    }
    const previousSubscription = projectAgentSubscriptionRef.current
    if (previousSubscription) {
      await projectAgentClient.release(previousSubscription).catch(() => undefined)
      projectAgentSubscriptionRef.current = null
      projectAgentProjectionStore.clear()
    }
    const unbindPersistence = projectPersistenceUnbindRef.current
    projectPersistenceUnbindRef.current = null
    unbindPersistence?.()
    activeProjectIdRef.current = null
    setDesktopActiveProjectId(null)
    setActiveProject(null)
    setView('library')
    navigate(buildStudioUrl(), { replace: false })
    releaseWorkbenchProjectRuntimeState()
    refreshProjects()
  }, [navigate, projectSurface, refreshProjects])

  const handleRenameProject = React.useCallback(
    (newName: string) => {
      if (!activeProject) return
      const trimmed = newName.trim() || t('appBar.untitledProject')
      if (trimmed === activeProject.name) return
      const renamed: LocalProjectSummary = {
        ...activeProject,
        name: trimmed,
      }
      // Update React state so AppBar reflects the new name immediately
      setActiveProject(renamed)
      // Persist the new name with the current in-memory canvas/timeline/document
      // state (NOT a re-read from disk — that would be stale). This updates the
      // project file on disk AND publishes the new summary so the project library
      // card refreshes via SWR.
      void ensureProjectPersistenceService()
        .then(async ({ service }) => {
          const { readCurrentWorkbenchProjectPayload } = await import('./project/workbenchProjectSession')
          return service.persistProject(renamed, readCurrentWorkbenchProjectPayload())
        })
        .catch((error: unknown) => {
          console.error('project rename save error', error)
          toast(t('studio.renameFailed'), 'error')
        })
    },
    [activeProject, ensureProjectPersistenceService, t],
  )

  const globalBrowserDialog =
    browserOpened || browserMounted ? (
      <React.Suspense key="global-browser-dialog" fallback={null}>
        <NomiBrowserDialog opened={browserOpened} onClose={closeBrowser} />
      </React.Suspense>
    ) : null
  const settingsDialog = settingsDialogController.opened ? (
    <SettingsDialog
      initialTab={settingsDialogController.initialTab}
      initialSection={settingsDialogController.initialSection}
      productionPolicyRequirement={settingsDialogController.productionPolicyRequirement}
      onClose={settingsDialogController.closeSettings}
      onReplaySplash={() => setSplashDone(false)}
    />
  ) : null
  const viewContent =
    view === 'library' ? (
      <>
        <ProjectLibraryPage
          projects={projects}
          onOpenProject={openProject}
          onDeleteProject={deleteProject}
          onRenameProject={renameLibraryProject}
          onNewProject={() => void newProject()}
          onOpenFolder={() => void openWorkspaceFolder()}
          onRevealProjectFolder={revealProjectFolder}
          onOpenModelCatalog={settingsDialogController.openModelSettings}
          onOpenSettings={settingsDialogController.openDefaultSettings}
          onPlayJourneyTour={playJourneyTour}
          journeyTourSeen={hasSeenJourneyTour()}
          hasTextModel={hasTextModel}
        />
        {settingsDialog}
        <ConfirmDialogHost />
      </>
    ) : (
      <div className={cn('nomi-studio-app w-full h-screen min-h-0 bg-nomi-bg')} aria-label={t('studio.aria')}>
        <WorkbenchShell
          generation={
            <React.Suspense fallback={<GenerationCanvasLoading />}>
              {/* relative 包一层:S2b 计划 overlay 与画布同坐标系,且不喂巨壳 */}
              <div className={cn('relative w-full h-full')}>
                <GenerationCanvas />
                {/* P4 S5 画布落地 host（跟着画布常驻）：poll 活跃多镜 Run 喂占位三态 + 进度通知 + 删节点上报 detach。 */}
                <ProductionCanvasLandingHost projectId={activeProject?.id ?? null} />
                {/* 拆解面板宿主：为占着右槽的源视频渲染就近停靠面板（互斥共占，收起态状态留槽不丢）。 */}
                <DeconstructionPanelHost />
              </div>
            </React.Suspense>
          }
          projectId={activeProject?.id ?? null}
          projectName={activeProject?.name}
          onBackToLibrary={backToLibrary}
          onOpenModelCatalog={settingsDialogController.openModelSettings}
          onOpenSettings={settingsDialogController.openDefaultSettings}
          onRenameProject={handleRenameProject}
        />

        {settingsDialog}

        {handbookOpened ? (
          <React.Suspense fallback={null}>
            <HandbookPanel opened={handbookOpened} onClose={() => setHandbookOpened(false)} />
          </React.Suspense>
        ) : null}

        {journeyTourControllerMounted ? (
          <React.Suspense fallback={null}>
            <JourneyTourController onStartReal={newProject} />
          </React.Suspense>
        ) : null}

        <ConfirmDialogHost />
      </div>
    )

  return (
    <>
      {globalBrowserDialog}
      {viewContent}
      <FeedbackShareHost />
      {/* 付费确认卡挂在公共根：制作任务的家是任务中心（顶栏常驻、创作/生成/预览都能开），
          门的兜底决策必须在任一视图都弹得出来。原先库页一处、生成区插槽内一处——创作/预览视图
          下根本没挂载，在那儿点确认永远没反应（本轮走查实测抓出）。单一挂载，不留并行版（P1）。 */}
      {hasPendingSpendConfirm ? (
        <React.Suspense fallback={null}>
          <SpendConfirmDialog />
        </React.Suspense>
      ) : null}
      {/* 开屏动画提到视图之外（原先只挂在库页分支）：重放入口已归位到设置「关于」，
          而设置在库页和 studio 都能开——不提上来的话从 studio 点「重看开屏动画」不会有任何反应。 */}
      {!splashDone ? (
        <SplashIntro
          onDone={() => {
            markSplashSeen()
            setSplashDone(true)
          }}
        />
      ) : null}
    </>
  )
}
