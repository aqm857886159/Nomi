import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ConfirmDialogHost, confirmDialog, NomiLoadingMark } from '../design'
import ProjectLibraryPage from './library/ProjectLibraryPage'
import {
  createLocalProject,
  deleteLocalProject,
  useLocalProjects,
  type LocalProjectSummary,
} from './library/localProjectStore'
import type { WorkbenchProjectPersistenceService } from './project/projectPersistenceService'
import { useWorkspaceEvents } from './useWorkspaceEvents'
import { useWorkbenchStore, type WorkspaceMode } from './workbenchStore'
import { swapGenerationAiProject } from './generationCanvas/store/generationAiConversation'
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore'
import {
  flushConversationsNow,
  initConversationPersistence,
  loadProjectConversations,
} from './ai/conversationPersistence'
import { initReviewEventBridge } from './generationCanvas/reviewEventBridge'
import { setCanvasEventProjectIdProvider } from './generationCanvas/events/canvasEventEmitter'
import { registerCapabilityApplyHandler } from './capability/capabilityApplyHandler'
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
import { useFilePreviewStore } from './explorer/useFilePreviewStore'
import { dispatchGlobalAssetPopoverOpen } from '../ui/browser/overlay/globalAssetPopoverEvents'

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
const OnboardingFloatingPanel = lazyWithChunkBoundary('模型设置面板', () =>
  import('../ui/onboarding/OnboardingFloatingPanel').then((module) => ({
    default: module.OnboardingFloatingPanel,
  })),
)
const AssetLibraryPanel = lazyWithChunkBoundary('素材库', () =>
  import('./assets/AssetLibraryPanel').then((module) => ({
    default: module.AssetLibraryPanel,
  })),
)
const PromptLibraryPanel = lazyWithChunkBoundary('提示词库', () =>
  import('./promptLibrary/PromptLibraryPanel').then((module) => ({
    default: module.PromptLibraryPanel,
  })),
)
const SkillLibraryPanel = lazyWithChunkBoundary('技能库', () =>
  import('./skillLibrary/SkillLibraryPanel').then((module) => ({
    default: module.SkillLibraryPanel,
  })),
)
const HandbookPanel = lazyWithChunkBoundary('上手手册', () =>
  import('./onboarding/HandbookPanel').then((module) => ({
    default: module.HandbookPanel,
  })),
)
const GenerationCanvas = lazyWithChunkBoundary(
  '生成画布',
  () => import('./generationCanvas/components/GenerationCanvas'),
)
const CanvasAssistantEntry = lazyWithChunkBoundary(
  'AI 助手入口',
  () => import('./generationCanvas/components/CanvasAssistantEntry'),
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
const FilePreviewPanel = lazyWithChunkBoundary('文件预览', () =>
  import('./explorer/FilePreviewPanel').then((module) => ({
    default: module.FilePreviewPanel,
  })),
)
const NomiBrowserDialog = lazyWithChunkBoundary('浏览器', () =>
  import('../ui/browser/dialog/NomiBrowserDialog').then((module) => ({
    default: module.NomiBrowserDialog,
  })),
)
const GlobalAssetFloatingWindow = lazyWithChunkBoundary('全局素材浮窗', () =>
  import('../ui/browser/window/GlobalAssetFloatingWindow').then((module) => ({
    default: module.GlobalAssetFloatingWindow,
  })),
)

function GenerationCanvasLoading(): JSX.Element {
  return (
    <div className={cn('w-full h-full bg-workbench-bg grid place-items-center')} aria-label="生成画布加载中">
      {/* pending 规范 #1:懒加载占位不再空白,给可见品牌 spinner */}
      <NomiLoadingMark size={28} label="生成画布加载中" />
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
  const navigate = useNavigate()
  const location = useLocation()
  const [view, setView] = React.useState<AppView>('library')
  const { projects, refreshProjects } = useLocalProjects()
  const [activeProject, setActiveProject] = React.useState<LocalProjectSummary | null>(null)
  const generationAiCollapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const [modelCatalogOpened, setModelCatalogOpened] = React.useState(false)
  const [assetLibraryOpened, setAssetLibraryOpened] = React.useState(false)
  const [promptLibraryOpened, setPromptLibraryOpened] = React.useState(false)
  const [skillLibraryOpened, setSkillLibraryOpened] = React.useState(false)
  const [handbookOpened, setHandbookOpened] = React.useState(false)
  const [browserOpened, setBrowserOpened] = React.useState(false)
  const [browserMounted, setBrowserMounted] = React.useState(false)
  const hasPendingSpendConfirm = useSpendConfirmStore((state) => Boolean(state.pending))
  const filePreviewOpen = useFilePreviewStore((state) => state.open)
  // 首启开屏：仅首次未看过时自动放；看过后可经项目库「看看 Nomi」重看。
  const [splashDone, setSplashDone] = React.useState(() => hasSeenSplash())
  const [journeyTourControllerMounted, setJourneyTourControllerMounted] = React.useState(false)
  const { hasTextModel, refresh: refreshModelStatus } = useHasTextModel()
  // 模型接入面板关闭后重查（用户可能刚接完模型 → 状态条/弱入口要立即翻面）
  React.useEffect(() => {
    if (!modelCatalogOpened) refreshModelStatus()
  }, [modelCatalogOpened, refreshModelStatus])
  const hydratingProjectRef = React.useRef(false)
  const activeProjectIdRef = React.useRef<string | null>(null)
  const initialHydrationAttemptedRef = React.useRef(false)
  const projectPersistenceModuleRef = React.useRef<ProjectPersistenceModule | null>(null)
  const projectPersistenceServiceRef = React.useRef<WorkbenchProjectPersistenceService | null>(null)
  const projectPersistenceUnbindRef = React.useRef<(() => void) | null>(null)
  const hardReloadingRef = React.useRef(false)
  const browserOpenedRef = React.useRef(false)
  const pendingCloseRequestRef = React.useRef<string | null>(null)
  const routeProjectId = React.useMemo(() => readProjectIdFromSearch(location.search), [location.search])
  const activeProjectPersistenceKey = activeProject ? `${activeProject.id}\u0000${activeProject.name}` : ''

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
        title: '关闭 Nomi？',
        message: '当前窗口将关闭，未完成的生成或导出任务可能会中断。',
        confirmLabel: '关闭',
        cancelLabel: '取消',
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
  }, [])

  React.useEffect(() => {
    const handleOpenModelCatalog = () => setModelCatalogOpened(true)
    window.addEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
    return () => window.removeEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
  }, [])

  React.useEffect(() => {
    const handleOpenAssetLibrary = () => setAssetLibraryOpened(true)
    window.addEventListener('nomi-open-asset-library', handleOpenAssetLibrary)
    return () => window.removeEventListener('nomi-open-asset-library', handleOpenAssetLibrary)
  }, [])

  React.useEffect(() => {
    const handleOpenPromptLibrary = () => setPromptLibraryOpened(true)
    window.addEventListener('nomi-open-prompt-library', handleOpenPromptLibrary)
    return () => window.removeEventListener('nomi-open-prompt-library', handleOpenPromptLibrary)
  }, [])

  React.useEffect(() => {
    const handleOpenSkillLibrary = () => setSkillLibraryOpened(true)
    window.addEventListener('nomi-open-skill-library', handleOpenSkillLibrary)
    return () => window.removeEventListener('nomi-open-skill-library', handleOpenSkillLibrary)
  }, [])

  React.useEffect(() => {
    const handleOpenHandbook = () => setHandbookOpened(true)
    window.addEventListener('nomi-open-handbook', handleOpenHandbook)
    return () => window.removeEventListener('nomi-open-handbook', handleOpenHandbook)
  }, [])

  React.useEffect(() => {
    const handleOpenBrowser = () => {
      dispatchGlobalAssetPopoverOpen(false)
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
        setView,
        onSaveError: (error) => {
          console.error('project save error', error)
          toast('项目保存失败，请检查本地磁盘权限', 'error')
        },
      })
      projectPersistenceServiceRef.current = service
    }
    return { module, service }
  }, [])

  React.useEffect(() => {
    setDesktopActiveProjectId(activeProject?.id)
  }, [activeProject?.id])

  // S1b-3:对话消息变化 → 防抖落盘(projectId 在冲刷时刻取,防切换期错绑)。
  React.useEffect(() => initConversationPersistence(() => activeProjectIdRef.current ?? null), [])
  // S4-2b:技术自检广播 → 节点 meta(⚠ 投影数据源)。
  React.useEffect(() => initReviewEventBridge(), [])
  // S5-a:画布影子事件的 projectId(flush 时刻取值,防切换期错绑)。
  React.useEffect(() => setCanvasEventProjectIdProvider(() => activeProjectIdRef.current ?? null), [])
  // 能力核 A 模式实时桥:注册处理器,接主进程转发来的外部 MCP 画布读/写/付费确认(所见即所得)。
  React.useEffect(() => registerCapabilityApplyHandler(), [])

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
      const projectId = activeProjectIdRef.current
      flushConversationsNow(projectId)
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
      const { module, service } = await ensureProjectPersistenceService()
      hydratingProjectRef.current = true
      try {
        const hydrated = await service.hydrateProject(projectId)
        if (!hydrated) {
          toast('找不到项目文件，可能已被删除，请刷新项目库', 'error')
          refreshProjects()
          return false
        }
        // S1 治串台:切项目时交换两个 AI 面板的对话桶(存旧载新),气泡不再跨项目漂移。
        const prevProjectId = activeProjectIdRef.current ?? null
        if (prevProjectId !== hydrated.id) {
          // 先冲刷旧项目的落盘(取消挂起防抖,防把新项目内容写进旧文件)。
          flushConversationsNow(prevProjectId)
          useWorkbenchStore.getState().swapCreationAiProject(prevProjectId, hydrated.id)
          swapGenerationAiProject(prevProjectId, hydrated.id)
          void loadProjectConversations(hydrated.id)
        }
        activeProjectIdRef.current = hydrated.id
        // 同步喂全局（不等 effect 滞后一拍）：切项目瞬间拖图上传时 resolveProjectId 取的就是新项目，
        // 不再误写进旧项目目录 / 编错 projectId 致渲染 404（C2 修，对齐 activeProjectIdRef 同步口径）。
        setDesktopActiveProjectId(hydrated.id)
        setActiveProject(hydrated)
        setView('studio')
        const migrationDiag = module.consumeCategoryMigrationDiagnostic()
        if (migrationDiag && (migrationDiag.migratedNodes > 0 || migrationDiag.categoriesSeeded)) {
          toast(`项目已升级到目录树：${migrationDiag.migratedNodes} 个节点已归类`, 'success')
        }
        navigate(buildStudioUrl(hydrated.id), {
          replace: options.replaceUrl ?? false,
        })
      } finally {
        hydratingProjectRef.current = false
      }
      return true
    },
    [ensureProjectPersistenceService, navigate, refreshProjects],
  )

  const openProject = React.useCallback(
    (projectId: string) => {
      // 常规打开默认落「生成」画布。显式设，避免继承上一个示例残留的 creation
      // （WorkbenchShell 挂载在 URL 无 step 时会沿用 store 当前模式）。
      useWorkbenchStore.getState().setWorkspaceMode('generation')
      void hydrateProject(projectId)
    },
    [hydrateProject],
  )

  const openWorkspaceFolder = React.useCallback(async () => {
    await openWorkspaceFromLibrary({
      bridge: getDesktopBridge(),
      hydrateProject,
      refreshProjects,
      confirmInitialize: async (rootPath) =>
        confirmDialog({
          title: '初始化为 Nomi 项目',
          message: `${rootPath}\n\nNomi 会创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/。`,
          confirmLabel: '初始化',
        }),
      showMessage: (message, tone) => toast(message, tone || 'error'),
    })
  }, [hydrateProject, refreshProjects])

  const revealProjectFolder = React.useCallback((projectId: string) => {
    const bridge = getDesktopBridge()
    if (!bridge?.workspace?.revealProjectFolder) {
      toast('当前运行环境不支持打开项目文件夹', 'error')
      return
    }
    void bridge.workspace.revealProjectFolder({ projectId }).catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : '打开项目文件夹失败'
      toast(message, 'error')
    })
  }, [])

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
      toast('新建项目失败，请检查本地磁盘权限', 'error')
    })
  }, [createAndOpenProject])

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
      toast('打开示例项目失败，请检查本地磁盘权限', 'error')
    })
  }, [createAndOpenProject])

  // 接完模型（目录变更广播）→ 状态重查，让缺模型状态条/弱入口即时翻面
  // （面板还开着时也更新，不必等用户关面板）。
  React.useEffect(() => {
    const handleCatalogChanged = () => refreshModelStatus()
    window.addEventListener('nomi-model-catalog-changed', handleCatalogChanged)
    return () => window.removeEventListener('nomi-model-catalog-changed', handleCatalogChanged)
  }, [refreshModelStatus])

  const closeModelCatalog = React.useCallback(() => {
    setModelCatalogOpened(false)
  }, [])

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
        title: isExternal ? '从库移除项目' : '删除项目',
        message: isExternal
          ? `确定从项目库移除「${project.name}」吗？这只解除绑定，你的原始文件夹和文件不会被删除。`
          : `确定删除「${project.name}」吗？项目文件夹和本地资源会从磁盘永久删除，无法恢复。`,
        confirmLabel: isExternal ? '从库移除' : '删除',
        danger: true,
      })
      if (!confirmed) return
      try {
        deleteLocalProject(project.id)
        if (activeProjectIdRef.current === project.id) {
          activeProjectIdRef.current = null
          setDesktopActiveProjectId(null)
          setActiveProject(null)
          setView('library')
          navigate(buildStudioUrl(), { replace: true })
        }
        toast(isExternal ? '已从库移除' : '项目已删除', 'success')
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : '项目删除失败'
        console.error(message)
        toast(message, 'error')
      }
    },
    [navigate],
  )

  React.useEffect(() => {
    if (initialHydrationAttemptedRef.current) return
    initialHydrationAttemptedRef.current = true
    if (!routeProjectId) return
    let cancelled = false
    hydratingProjectRef.current = true
    void ensureProjectPersistenceService()
      .then(({ service }) => service.hydrateInitialProject(projects))
      .then((hydrated) => {
        if (cancelled) return
        if (hydrated) {
          activeProjectIdRef.current = hydrated.id
          setDesktopActiveProjectId(hydrated.id)
          setActiveProject(hydrated)
          setView('studio')
          navigate(buildStudioUrl(hydrated.id), { replace: true })
        } else {
          if (routeProjectId) navigate(buildStudioUrl(), { replace: true })
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error && error.message ? error.message : '项目恢复失败'
        console.error(message)
      })
      .finally(() => {
        if (!cancelled) hydratingProjectRef.current = false
      })
    return () => {
      cancelled = true
      hydratingProjectRef.current = false
    }
  }, [ensureProjectPersistenceService, navigate, projects, routeProjectId])

  React.useEffect(() => {
    if (!initialHydrationAttemptedRef.current || hydratingProjectRef.current) return
    if (!routeProjectId || routeProjectId === activeProjectIdRef.current) return
    void hydrateProject(routeProjectId, { replaceUrl: true }).then((ok) => {
      if (!ok) navigate(buildStudioUrl(), { replace: true })
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
          toast('项目保存失败，请检查本地磁盘权限', 'error')
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
  }, [activeProject, activeProjectPersistenceKey, ensureProjectPersistenceService, refreshProjects])

  useWorkspaceEvents(view === 'studio' ? activeProject?.id : null, (type) => {
    if (type === 'canvas.updated' || type === 'timeline.updated' || type === 'creation.updated') {
      void hydrateProject(activeProject!.id)
    }
  })

  const backToLibrary = React.useCallback(() => {
    const previousProjectId = activeProjectIdRef.current
    flushConversationsNow(previousProjectId)
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
  }, [navigate, refreshProjects])

  const handleRenameProject = React.useCallback(
    (newName: string) => {
      if (!activeProject) return
      const trimmed = newName.trim() || '未命名 Nomi 项目'
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
          toast('项目重命名保存失败', 'error')
        })
    },
    [activeProject, ensureProjectPersistenceService],
  )

  const globalBrowserDialog = browserOpened || browserMounted ? (
    <React.Suspense key="global-browser-dialog" fallback={null}>
      <NomiBrowserDialog opened={browserOpened} onClose={closeBrowser} />
    </React.Suspense>
  ) : null
  const globalAssetFloatingWindow = (
    <React.Suspense key="global-asset-floating-window" fallback={null}>
      <GlobalAssetFloatingWindow />
    </React.Suspense>
  )

  const viewContent = view === 'library' ? (
      <>
        <ProjectLibraryPage
          projects={projects}
          onOpenProject={openProject}
          onDeleteProject={deleteProject}
          onNewProject={() => void newProject()}
          onOpenFolder={() => void openWorkspaceFolder()}
          onRevealProjectFolder={revealProjectFolder}
          onOpenModelCatalog={() => setModelCatalogOpened(true)}
          onPlayJourneyTour={playJourneyTour}
          journeyTourSeen={hasSeenJourneyTour()}
          onReplaySplash={() => setSplashDone(false)}
          hasTextModel={hasTextModel}
        />
        {!splashDone ? (
          <SplashIntro
            onDone={() => {
              markSplashSeen()
              setSplashDone(true)
            }}
          />
        ) : null}
        {/* 模型接入面板也要在首页可用：全新安装零模型时，「30 秒体验」会派发
                    nomi-open-model-catalog 引导接入；之前此面板只挂在 studio 视图 →
                    首页派发事件无人响应，用户卡死（冷启动 J3 P0）。 */}
        {modelCatalogOpened ? (
          <React.Suspense fallback={null}>
            <OnboardingFloatingPanel opened={modelCatalogOpened} onClose={closeModelCatalog} />
          </React.Suspense>
        ) : null}
        {/* 付费确认卡提全局：外部 MCP 想在「非当前项目」生成时，用户停在项目库首页也能弹卡确认
                    （治静默黑洞，用户拍板 A）。同一全局 store，库/studio 任一时刻只一个分支渲染、不双弹。 */}
        {hasPendingSpendConfirm ? (
          <React.Suspense fallback={null}>
            <SpendConfirmDialog />
          </React.Suspense>
        ) : null}
        <ConfirmDialogHost />
      </>
    ) : (
      <div className={cn('nomi-studio-app w-full h-screen min-h-0 bg-nomi-bg')} aria-label="Nomi Studio">
        <WorkbenchShell
          generation={
            <React.Suspense fallback={<GenerationCanvasLoading />}>
              {/* relative 包一层:S2b 计划 overlay 与画布同坐标系,且不喂巨壳 */}
              <div className={cn('relative w-full h-full')}>
                <GenerationCanvas />
                {hasPendingSpendConfirm ? (
                  <React.Suspense fallback={null}>
                    <SpendConfirmDialog />
                  </React.Suspense>
                ) : null}
              </div>
            </React.Suspense>
          }
          generationAiLayout={generationAiCollapsed ? 'overlay' : 'sidebar'}
          generationAi={
            <React.Suspense fallback={null}>
              <CanvasAssistantEntry defaultCollapsed />
            </React.Suspense>
          }
          projectId={activeProject?.id ?? null}
          projectName={activeProject?.name}
          onBackToLibrary={backToLibrary}
          onOpenModelCatalog={() => setModelCatalogOpened(true)}
          onRenameProject={handleRenameProject}
        />

        {modelCatalogOpened ? (
          <React.Suspense fallback={null}>
            <OnboardingFloatingPanel opened={modelCatalogOpened} onClose={closeModelCatalog} />
          </React.Suspense>
        ) : null}

        {assetLibraryOpened ? (
          <React.Suspense fallback={null}>
            <AssetLibraryPanel
              opened={assetLibraryOpened}
              onClose={() => setAssetLibraryOpened(false)}
              projectId={activeProject?.id ?? null}
            />
          </React.Suspense>
        ) : null}

        {promptLibraryOpened ? (
          <React.Suspense fallback={null}>
            <PromptLibraryPanel opened={promptLibraryOpened} onClose={() => setPromptLibraryOpened(false)} />
          </React.Suspense>
        ) : null}

        {skillLibraryOpened ? (
          <React.Suspense fallback={null}>
            <SkillLibraryPanel opened={skillLibraryOpened} onClose={() => setSkillLibraryOpened(false)} />
          </React.Suspense>
        ) : null}

        {handbookOpened ? (
          <React.Suspense fallback={null}>
            <HandbookPanel opened={handbookOpened} onClose={() => setHandbookOpened(false)} />
          </React.Suspense>
        ) : null}

        {filePreviewOpen ? (
          <React.Suspense fallback={null}>
            <FilePreviewPanel />
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
      {globalAssetFloatingWindow}
      {viewContent}
    </>
  )
}
