import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import WorkbenchShell from './WorkbenchShell'
import ProjectLibraryPage from './library/ProjectLibraryPage'
import { CanvasAssistantPanel, GenerationCanvas } from './generationCanvasV2'
import { ToastHost } from '../ui/toast'
import StatsModelCatalogManagement from '../ui/stats/system/modelCatalog/StatsModelCatalogManagement'
import {
  createLocalProject,
  deleteLocalProject,
  useLocalProjects,
  type LocalProjectSummary,
} from './library/localProjectStore'
import { buildStoryDocument, type TryNowExample } from './library/tryNowExamples'
import { useWorkbenchStore } from './workbenchStore'
import { requestStoryboardPlanning } from './generationCanvasV2/agent/storyboardLauncher'
import { createWorkbenchProjectPersistenceService } from './project/projectPersistenceService'
import { readCurrentWorkbenchProjectPayload } from './project/workbenchProjectSession'
import { useWorkspaceEvents } from './useWorkspaceEvents'
import { DesignDrawer } from '../design'
import { cn } from '../utils/cn'
import { toast } from '../ui/toast'
import { setDesktopActiveProjectId } from '../desktop/activeProject'
import { buildStudioUrl } from '../utils/appRoutes'

type AppView = 'library' | 'studio'

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
  const { projects } = useLocalProjects()
  const [activeProject, setActiveProject] = React.useState<LocalProjectSummary | null>(null)
  const [generationAiCollapsed, setGenerationAiCollapsed] = React.useState(true)
  const [modelCatalogOpened, setModelCatalogOpened] = React.useState(false)
  const hydratingProjectRef = React.useRef(false)
  const activeProjectIdRef = React.useRef<string | null>(null)
  const initialHydrationAttemptedRef = React.useRef(false)
  const projectPersistenceServiceRef = React.useRef<ReturnType<typeof createWorkbenchProjectPersistenceService> | null>(null)
  const routeProjectId = React.useMemo(() => readProjectIdFromSearch(location.search), [location.search])
  const activeProjectPersistenceKey = activeProject ? `${activeProject.id}\u0000${activeProject.name}` : ''

  React.useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.setAttribute('data-mantine-color-scheme', 'light')
  }, [])

  React.useEffect(() => {
    const handleOpenModelCatalog = () => setModelCatalogOpened(true)
    window.addEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
    return () => window.removeEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
  }, [])

  if (projectPersistenceServiceRef.current === null) {
    projectPersistenceServiceRef.current = createWorkbenchProjectPersistenceService({
      setActiveProject,
      setView,
      onSaveError: (error) => {
        console.error('project save error', error)
        toast('项目保存失败，请检查本地磁盘权限', 'error')
      },
    })
  }

  React.useEffect(() => {
    setDesktopActiveProjectId(activeProject?.id)
  }, [activeProject?.id])

  const hydrateProject = React.useCallback(async (projectId: string, options: { replaceUrl?: boolean } = {}) => {
    const service = projectPersistenceServiceRef.current
    if (!service) return false
    hydratingProjectRef.current = true
    try {
      const hydrated = await service.hydrateProject(projectId)
      if (!hydrated) return false
      activeProjectIdRef.current = hydrated.id
      setActiveProject(hydrated)
      setView('studio')
      navigate(buildStudioUrl(hydrated.id), { replace: options.replaceUrl ?? false })
    } finally {
      hydratingProjectRef.current = false
    }
    return true
  }, [navigate])

  const openProject = React.useCallback((projectId: string) => {
    void hydrateProject(projectId)
  }, [hydrateProject])

  const newProject = React.useCallback(async () => {
    const project = createLocalProject()
    void hydrateProject(project.id)
  }, [hydrateProject])

  /**
   * Try-Now hero handler (C6). Creates a fresh project, hydrates it,
   * stuffs the example story into the creation workbench document, then
   * dispatches a storyboard request so the demo runs end-to-end with a
   * single click. We delay the storyboard event until after the project
   * has hydrated and the creation editor has mounted, otherwise the
   * canvas-assistant listener might not be attached yet.
   */
  const tryExample = React.useCallback(async (example: TryNowExample) => {
    const project = createLocalProject(example.projectName)
    const hydrated = await hydrateProject(project.id)
    if (!hydrated) return
    const doc = buildStoryDocument(example.story, example.projectName)
    const store = useWorkbenchStore.getState()
    store.setWorkbenchDocument(doc)
    store.setWorkspaceMode('creation')
    // Allow the creation editor + canvas assistant panel to mount before
    // dispatching, so the storyboard listener actually picks up the event.
    window.setTimeout(() => {
      requestStoryboardPlanning({ storyText: example.story, source: `library-try-now:${example.id}` })
    }, 200)
  }, [hydrateProject])

  const deleteProject = React.useCallback((project: LocalProjectSummary) => {
    const confirmed = window.confirm(`确定删除「${project.name}」吗？项目文件夹和本地资源会一起删除。`)
    if (!confirmed) return
    try {
      deleteLocalProject(project.id)
      if (activeProjectIdRef.current === project.id) {
        activeProjectIdRef.current = null
        setActiveProject(null)
        setView('library')
        navigate(buildStudioUrl(), { replace: true })
      }
      toast('项目已删除', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '项目删除失败'
      console.error(message)
      toast(message, 'error')
    }
  }, [navigate])

  React.useEffect(() => {
    if (initialHydrationAttemptedRef.current) return
    initialHydrationAttemptedRef.current = true
    const service = projectPersistenceServiceRef.current
    if (!service) return
    hydratingProjectRef.current = true
    void service.hydrateInitialProject(projects).then((hydrated) => {
      if (hydrated) {
        activeProjectIdRef.current = hydrated.id
        setActiveProject(hydrated)
        setView('studio')
        navigate(buildStudioUrl(hydrated.id), { replace: true })
      } else {
        if (routeProjectId) navigate(buildStudioUrl(), { replace: true })
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : '项目恢复失败'
      console.error(message)
    }).finally(() => {
      hydratingProjectRef.current = false
    })
  }, [navigate, projects, routeProjectId])

  React.useEffect(() => {
    if (!initialHydrationAttemptedRef.current || hydratingProjectRef.current) return
    if (!routeProjectId || routeProjectId === activeProjectIdRef.current) return
    void hydrateProject(routeProjectId, { replaceUrl: true }).then((ok) => {
      if (!ok) navigate(buildStudioUrl(), { replace: true })
    })
  }, [hydrateProject, navigate, routeProjectId])

  React.useEffect(() => {
    if (!activeProject?.id) return
    const service = projectPersistenceServiceRef.current
    if (!service) return undefined
    return service.bindProjectPersistence({
      project: activeProject,
      isHydrating: () => hydratingProjectRef.current,
      canPersist: () => activeProjectIdRef.current === activeProject.id,
      onSaved: (saved) => {
        setActiveProject(saved)
      },
      onSaveError: (error) => {
        console.error('project save error', error)
        toast('项目保存失败，请检查本地磁盘权限', 'error')
      },
    })
  }, [activeProjectPersistenceKey])

  useWorkspaceEvents(view === 'studio' ? activeProject?.id : null, (type) => {
    if (type === 'canvas.updated' || type === 'timeline.updated' || type === 'creation.updated') {
      void hydrateProject(activeProject!.id)
    }
  })

  const backToLibrary = React.useCallback(() => {
    setView('library')
    navigate(buildStudioUrl(), { replace: false })
  }, [navigate])

  const handleRenameProject = React.useCallback((newName: string) => {
    if (!activeProject) return
    const trimmed = newName.trim() || '未命名 Nomi 项目'
    if (trimmed === activeProject.name) return
    const renamed: LocalProjectSummary = { ...activeProject, name: trimmed }
    // Update React state so AppBar reflects the new name immediately
    setActiveProject(renamed)
    // Persist the new name with the current in-memory canvas/timeline/document
    // state (NOT a re-read from disk — that would be stale). This updates the
    // project file on disk AND publishes the new summary so the project library
    // card refreshes via SWR.
    const service = projectPersistenceServiceRef.current
    if (service) {
      void service.persistProject(renamed, readCurrentWorkbenchProjectPayload())
        .catch((error: unknown) => {
          console.error('project rename save error', error)
          toast('项目重命名保存失败', 'error')
        })
    }
  }, [activeProject])

  if (view === 'library') {
    return (
      <>
        <ProjectLibraryPage
          projects={projects}
          onOpenProject={openProject}
          onDeleteProject={deleteProject}
          onNewProject={() => void newProject()}
          onTryExample={(example) => void tryExample(example)}
        />
        <ToastHost />
      </>
    )
  }

  return (
    <div className={cn('nomi-studio-app w-full h-screen min-h-0 bg-nomi-bg')} aria-label="Nomi Studio">
      <WorkbenchShell
        generation={<GenerationCanvas />}
        generationAiLayout={generationAiCollapsed ? 'overlay' : 'sidebar'}
        generationAi={<CanvasAssistantPanel defaultCollapsed onCollapsedChange={setGenerationAiCollapsed} />}
        projectName={activeProject?.name}
        onBackToLibrary={backToLibrary}
        onOpenModelCatalog={() => setModelCatalogOpened(true)}
        onRenameProject={handleRenameProject}
      />
      <DesignDrawer
        className={cn('nomi-model-catalog-drawer')}
        opened={modelCatalogOpened}
        onClose={() => setModelCatalogOpened(false)}
        position="right"
        size={560}
        zIndex={4000}
        withinPortal
      >
        <StatsModelCatalogManagement className={cn('nomi-model-catalog-drawer__content')} compact />
      </DesignDrawer>
      <ToastHost />
    </div>
  )
}
