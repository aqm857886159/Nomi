import React from 'react'
import WorkbenchShell from './WorkbenchShell'
import ProjectLibraryPage from './library/ProjectLibraryPage'
import { CanvasAssistantPanel, GenerationCanvas } from './generationCanvasV2'
import { ToastHost } from '../ui/toast'
import StatsModelCatalogManagement from '../ui/stats/system/modelCatalog/StatsModelCatalogManagement'
import {
  createLocalProject,
  listLocalProjects,
  type LocalProjectSummary,
} from './library/localProjectStore'
import { createWorkbenchProjectPersistenceService } from './project/projectPersistenceService'
import { useWorkspaceEvents } from './useWorkspaceEvents'
import { DesignDrawer } from '../design'
import { toast } from '../ui/toast'

type AppView = 'library' | 'studio'

export default function NomiStudioApp(): JSX.Element {
  const [view, setView] = React.useState<AppView>('library')
  const [projects, setProjects] = React.useState<LocalProjectSummary[]>(() => listLocalProjects())
  const [activeProject, setActiveProject] = React.useState<LocalProjectSummary | null>(null)
  const [generationAiCollapsed, setGenerationAiCollapsed] = React.useState(true)
  const [modelCatalogOpened, setModelCatalogOpened] = React.useState(false)
  const hydratingProjectRef = React.useRef(false)
  const activeProjectIdRef = React.useRef<string | null>(null)
  const initialHydrationAttemptedRef = React.useRef(false)
  const projectPersistenceServiceRef = React.useRef<ReturnType<typeof createWorkbenchProjectPersistenceService> | null>(null)

  React.useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.setAttribute('data-mantine-color-scheme', 'light')
  }, [])

  React.useEffect(() => {
    const handleOpenModelCatalog = () => setModelCatalogOpened(true)
    window.addEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
    return () => window.removeEventListener('nomi-open-model-catalog', handleOpenModelCatalog)
  }, [])

  const refreshProjects = React.useCallback(() => {
    setProjects(listLocalProjects())
  }, [])

  if (projectPersistenceServiceRef.current === null) {
    projectPersistenceServiceRef.current = createWorkbenchProjectPersistenceService({
      refreshProjects,
      setActiveProject,
      setView,
      onSaveError: (error) => {
        console.error('project save error', error)
        toast('项目保存失败，请检查网络连接', 'error')
      },
    })
  }

  const hydrateProject = React.useCallback(async (projectId: string) => {
    const service = projectPersistenceServiceRef.current
    if (!service) return false
    hydratingProjectRef.current = true
    try {
      const hydrated = await service.hydrateProject(projectId)
      if (!hydrated) return false
      activeProjectIdRef.current = hydrated.id
      setActiveProject(hydrated)
      setView('studio')
    } finally {
      hydratingProjectRef.current = false
    }
    return true
  }, [])

  const openProject = React.useCallback((projectId: string) => {
    void hydrateProject(projectId)
  }, [hydrateProject])

  const newProject = React.useCallback(async () => {
    const project = createLocalProject()
    refreshProjects()
    void hydrateProject(project.id)
  }, [hydrateProject, refreshProjects])

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
      } else {
        refreshProjects()
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : '项目恢复失败'
      console.error(message)
    }).finally(() => {
      hydratingProjectRef.current = false
    })
  }, [projects, refreshProjects])

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
        refreshProjects()
      },
      onSaveError: (error) => {
        console.error('project save error', error)
        toast('项目保存失败，请检查网络连接', 'error')
      },
    })
  }, [activeProject, refreshProjects])

  useWorkspaceEvents(activeProject?.id, (type) => {
    if (type === 'canvas.updated' || type === 'timeline.updated' || type === 'creation.updated') {
      void hydrateProject(activeProject!.id)
    }
  })

  const backToLibrary = React.useCallback(() => {
    refreshProjects()
    setView('library')
  }, [refreshProjects])

  if (view === 'library') {
    return (
      <>
        <ProjectLibraryPage
          projects={projects}
          onOpenProject={openProject}
          onNewProject={() => void newProject()}
        />
        <ToastHost className="nomi-studio-app__toast-host" />
      </>
    )
  }

  return (
    <div className="nomi-studio-app" aria-label="Nomi Studio">
      <WorkbenchShell
        generation={<GenerationCanvas />}
        generationAiLayout={generationAiCollapsed ? 'overlay' : 'sidebar'}
        generationAi={<CanvasAssistantPanel defaultCollapsed onCollapsedChange={setGenerationAiCollapsed} />}
        onBackToLibrary={backToLibrary}
        onOpenModelCatalog={() => setModelCatalogOpened(true)}
      />
      <DesignDrawer
        className="nomi-model-catalog-drawer"
        opened={modelCatalogOpened}
        onClose={() => setModelCatalogOpened(false)}
        position="right"
        size={560}
        zIndex={4000}
        withinPortal
      >
        <StatsModelCatalogManagement className="nomi-model-catalog-drawer__content" compact />
      </DesignDrawer>
      <ToastHost className="nomi-studio-app__toast-host" />
    </div>
  )
}
