// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalProjectSummary } from './localProjectStore'

const state = vi.hoisted(() => ({
  projects: [] as LocalProjectSummary[],
  inspections: {} as Record<string, unknown>,
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && typeof params.name === 'string' ? `${key}:${params.name}` : key,
  }),
}))
vi.mock('../../ui/app-shell/shell/ShellFrame', () => ({
  ShellFrame: ({ topBar, children }: { topBar: React.ReactNode; children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, topBar, children),
}))
vi.mock('../../ui/app-shell/shell/ShellTopBar', () => ({ ShellTopBar: () => null }))
vi.mock('../../ui/app-shell/UpdateNotices', () => ({ UpdateNotices: () => null }))
vi.mock('./localProjectStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./localProjectStore')>()),
  useLocalProjects: () => ({
    projects: state.projects,
    projectsError: null,
    projectsLoading: false,
    refreshProjects: () => undefined,
  }),
}))
vi.mock('./projectSyncInspectStore', () => ({
  librarySyncInspect: { request: () => undefined, set: () => undefined },
  useLibrarySyncInspections: () => state.inspections,
}))
vi.mock('../../ui/onboarding/onboardingModelAvailability', () => ({
  useOnboardingModelAvailability: () => ({
    loading: false,
    hasUsableModelConnection: true,
    apimartCounts: { total: 0 },
  }),
}))

import ProjectLibraryPage from './ProjectLibraryPage'

function makeProject(id: string, extra: Partial<LocalProjectSummary> = {}): LocalProjectSummary {
  return {
    id,
    name: `Project ${id}`,
    createdAt: 1,
    updatedAt: 1,
    version: 2,
    rootPath: `projects/${id}`,
    source: 'native',
    ...extra,
  } as LocalProjectSummary
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('ProjectLibraryPage source filter visibility and card action placement', () => {
  let root: Root
  let container: HTMLDivElement
  let onOpenProject: ReturnType<typeof vi.fn<(projectId: string) => void>>
  let onDeleteProject: ReturnType<typeof vi.fn<(project: LocalProjectSummary) => void>>

  const renderPage = () => {
    act(() => {
      root.render(
        <ProjectLibraryPage
          onOpenProject={onOpenProject}
          onDeleteProject={onDeleteProject}
          onRenameProject={() => undefined}
          onNewProject={() => undefined}
          onRevealProjectFolder={() => undefined}
        />,
      )
    })
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    onOpenProject = vi.fn<(projectId: string) => void>()
    onDeleteProject = vi.fn<(project: LocalProjectSummary) => void>()
    state.projects = []
    state.inspections = {}
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('hides the source filter pill when there are only local projects, while still rendering project cards', () => {
    state.projects = [makeProject('local-1', { name: 'Alpha' }), makeProject('local-2', { name: 'Beta' })]
    renderPage()

    expect(container.querySelector('[aria-label="library.sourceFilter"]')).toBeNull()
    expect(container.querySelectorAll('[data-project-card="true"]')).toHaveLength(2)
  })

  it('keeps the source filter visible when folder projects exist even if a search matches only local projects', () => {
    state.projects = [
      makeProject('local-1', { name: 'Sunrise Scene', source: 'native' }),
      makeProject('folder-1', { name: 'External Studio', source: 'folder' }),
    ]
    renderPage()

    expect(container.querySelector('[aria-label="library.sourceFilter"]')).not.toBeNull()

    const searchInput = container.querySelector<HTMLInputElement>('input[type="search"]')
    expect(searchInput).not.toBeNull()
    act(() => {
      setInputValue(searchInput!, 'Sunrise')
    })

    expect(container.querySelector('[aria-label="library.sourceFilter"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-project-card="true"]')).toHaveLength(1)
  })

  it('resets sourceFilter back to all automatically when the last external folder project is removed', () => {
    state.projects = [
      makeProject('local-1', { name: 'Local Film', source: 'native' }),
      makeProject('folder-1', { name: 'Mounted Folder', source: 'folder' }),
    ]
    renderPage()

    const filterGroup = container.querySelector('[aria-label="library.sourceFilter"]')
    expect(filterGroup).not.toBeNull()
    const buttons = [...filterGroup!.querySelectorAll('button')]
    const folderButton = buttons.find((button) => button.textContent?.includes('library.folders'))
    expect(folderButton).toBeTruthy()

    act(() => {
      folderButton!.click()
    })
    expect(container.querySelectorAll('[data-project-card="true"]')).toHaveLength(1)
    expect(container.querySelector('[data-project-id="folder-1"]')).not.toBeNull()

    state.projects = [makeProject('local-1', { name: 'Local Film', source: 'native' })]
    renderPage()

    expect(container.querySelector('[aria-label="library.sourceFilter"]')).toBeNull()
    const visibleCards = [...container.querySelectorAll('[data-project-card="true"]')]
    expect(visibleCards).toHaveLength(1)
    expect(visibleCards[0]?.getAttribute('data-project-id')).toBe('local-1')
  })

  it('removes the delete button from the cover overlay and places it in the title-row action cluster for both normal and unavailable cards', () => {
    const normal = makeProject('normal-1', { name: 'Normal Film' })
    const missing = makeProject('missing-1', { name: 'Missing Folder', source: 'folder', missing: true })
    const unreadable = makeProject('broken-1', { name: 'Broken Manifest', unreadableReason: 'corrupt-manifest' })
    state.projects = [normal, missing, unreadable]
    renderPage()

    for (const project of [normal, missing, unreadable]) {
      const card = container.querySelector<HTMLElement>(`[data-project-card="true"][data-project-id="${project.id}"]`)
      expect(card).not.toBeNull()

      const cover = card!.querySelector<HTMLElement>('.aspect-video')
      expect(cover).not.toBeNull()
      expect(cover!.querySelector(`button[aria-label="library.deleteNamedProject:${project.name}"]`)).toBeNull()

      const deleteButton = card!.querySelector<HTMLButtonElement>(
        `button[aria-label="library.deleteNamedProject:${project.name}"]`,
      )
      expect(deleteButton).not.toBeNull()
      expect(cover!.contains(deleteButton)).toBe(false)
      expect(deleteButton!.getAttribute('title')).toBe('library.deleteProject')
      expect(deleteButton!.className).toContain('group-focus-within:opacity-100')
      expect(deleteButton!.className).not.toMatch(/(?:^|\s)bg-workbench-danger-soft(?:\s|$)/)
      expect(deleteButton!.className).toContain('hover:bg-workbench-danger-soft')
      expect(deleteButton!.className).toContain('hover:text-workbench-danger')

      if (project.id === 'normal-1') {
        const renameButton = card!.querySelector<HTMLButtonElement>(`[data-project-rename="${project.id}"]`)
        expect(renameButton).not.toBeNull()
        expect(deleteButton!.parentElement).toBe(renameButton!.parentElement)
      }

      act(() => {
        deleteButton!.click()
      })
    }

    expect(onDeleteProject).toHaveBeenCalledTimes(3)
    expect(onDeleteProject.mock.calls.map((call) => call[0].id)).toEqual(['normal-1', 'missing-1', 'broken-1'])
    expect(onOpenProject).not.toHaveBeenCalled()
  })
})
