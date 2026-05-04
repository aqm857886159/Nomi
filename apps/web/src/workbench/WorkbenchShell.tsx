import React from 'react'
import './workbench.css'
import './workbench-ai.css'
import NomiAppBar from './nomi/NomiAppBar'
import { isWorkspaceMode, useWorkbenchStore, type WorkspaceMode } from './workbenchStore'

const CreationWorkspace = React.lazy(() => import('./creation/CreationWorkspace'))
const GenerationWorkspace = React.lazy(() => import('./generation/GenerationWorkspace'))
const PreviewWorkspace = React.lazy(() => import('./preview/PreviewWorkspace'))

type WorkbenchShellProps = {
  generation: React.ReactNode
  generationAi?: React.ReactNode
  generationAiLayout?: 'sidebar' | 'overlay'
  onBackToLibrary?: () => void
  onOpenModelCatalog?: () => void
}

const STEP_PARAM_BY_MODE: Record<WorkspaceMode, string> = {
  creation: 'create',
  generation: 'generate',
  preview: 'preview',
}

const MODE_BY_STEP_PARAM: Record<string, WorkspaceMode> = {
  create: 'creation',
  creation: 'creation',
  generate: 'generation',
  generation: 'generation',
  preview: 'preview',
}

function readWorkspaceModeFromUrl(): WorkspaceMode {
  if (typeof window === 'undefined') return 'generation'
  try {
    const step = String(new URL(window.location.href).searchParams.get('step') || '').trim()
    return MODE_BY_STEP_PARAM[step] || 'generation'
  } catch {
    return 'generation'
  }
}

function writeWorkspaceModeToUrl(mode: WorkspaceMode): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const step = STEP_PARAM_BY_MODE[mode]
  if (url.searchParams.get('step') === step) return
  url.searchParams.set('step', step)
  window.history.replaceState(null, '', url.toString())
}

export default function WorkbenchShell({ generation, generationAi, generationAiLayout = 'sidebar', onBackToLibrary, onOpenModelCatalog }: WorkbenchShellProps): JSX.Element {
  const workspaceMode = useWorkbenchStore((state) => state.workspaceMode)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)

  React.useEffect(() => {
    const initialMode = readWorkspaceModeFromUrl()
    setWorkspaceMode(initialMode)
    writeWorkspaceModeToUrl(initialMode)

    const onPopState = () => {
      setWorkspaceMode(readWorkspaceModeFromUrl())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [setWorkspaceMode])

  const handleWorkspaceModeChange = React.useCallback((mode: WorkspaceMode) => {
    if (!isWorkspaceMode(mode)) return
    setWorkspaceMode(mode)
    writeWorkspaceModeToUrl(mode)
  }, [setWorkspaceMode])

  return (
    <div className="workbench-shell" data-workspace-mode={workspaceMode}>
      <NomiAppBar
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={handleWorkspaceModeChange}
        onBackToLibrary={onBackToLibrary}
        onOpenModelCatalog={onOpenModelCatalog}
      />

      <main className="workbench-shell__body">
        <React.Suspense fallback={<div className="workbench-shell__loading" aria-label="工作区加载中" />}>
          <div className="workbench-shell__workspace" hidden={workspaceMode !== 'creation'}>
            <CreationWorkspace />
          </div>
          <div className="workbench-shell__workspace" hidden={workspaceMode !== 'generation'}>
            <GenerationWorkspace canvas={generation} aiSidebar={generationAi} aiLayout={generationAiLayout} />
          </div>
          <div className="workbench-shell__workspace" hidden={workspaceMode !== 'preview'}>
            <PreviewWorkspace />
          </div>
        </React.Suspense>
      </main>
    </div>
  )
}
