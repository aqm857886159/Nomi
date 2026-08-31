import type { CanvasWorkflowTemplate } from '../generationCanvas/plugins/canvasWorkflowTemplates'
import { isCanvasWorkflowTemplate } from '../generationCanvas/plugins/canvasWorkflowTemplates'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'
import { listLocalProjects } from '../project/projectRepository'

/** User-owned, app-level workflow library entry. The template remains an immutable snapshot. */
export type WorkflowLibraryEntry = {
  id: string
  version: 1
  name: string
  description: string
  tags: string[]
  sourceProjectId?: string
  sourceProjectName?: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  favorite?: boolean
  template: CanvasWorkflowTemplate
}

const STORAGE_KEY = 'nomi:workflow-library:v1'
export const WORKFLOW_LIBRARY_UPDATED_EVENT = 'nomi-workflow-library-updated'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'object' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

function dispatchUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKFLOW_LIBRARY_UPDATED_EVENT))
}

function normalizeEntry(value: unknown): WorkflowLibraryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<WorkflowLibraryEntry>
  if (typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.name !== 'string' || !raw.name.trim()) return null
  if (!isCanvasWorkflowTemplate(raw.template)) return null
  const now = Date.now()
  return {
    id: raw.id.trim(),
    version: 1,
    name: raw.name.trim(),
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())).map((tag) => tag.trim()) : [],
    ...(typeof raw.sourceProjectId === 'string' && raw.sourceProjectId.trim() ? { sourceProjectId: raw.sourceProjectId.trim() } : {}),
    ...(typeof raw.sourceProjectName === 'string' && raw.sourceProjectName.trim() ? { sourceProjectName: raw.sourceProjectName.trim() } : {}),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    ...(typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt) ? { lastUsedAt: raw.lastUsedAt } : {}),
    favorite: raw.favorite === true,
    template: clone(raw.template),
  }
}

export function readWorkflowLibrary(): WorkflowLibraryEntry[] {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const entry = normalizeEntry(item)
      return entry ? [entry] : []
    })
  } catch {
    return []
  }
}

function writeWorkflowLibrary(entries: readonly WorkflowLibraryEntry[]): void {
  const target = storage()
  if (!target) return
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(entries.map(clone)))
    dispatchUpdated()
  } catch {
    // A full/disabled browser store must not block saving the project-local template.
  }
}

export function saveWorkflowToLibrary(input: {
  template: CanvasWorkflowTemplate
  name?: string
  description?: string
  tags?: readonly string[]
  sourceProjectId?: string
  sourceProjectName?: string
  now?: number
}): WorkflowLibraryEntry | null {
  if (!isCanvasWorkflowTemplate(input.template)) return null
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
  const name = String(input.name || input.template.name || '').trim()
  if (!name) return null
  const entry: WorkflowLibraryEntry = {
    id: input.template.id,
    version: 1,
    name,
    description: String(input.description || '').trim(),
    tags: [...new Set((input.tags || []).map((tag) => String(tag).trim()).filter(Boolean))],
    ...(input.sourceProjectId?.trim() ? { sourceProjectId: input.sourceProjectId.trim() } : {}),
    ...(input.sourceProjectName?.trim() ? { sourceProjectName: input.sourceProjectName.trim() } : {}),
    createdAt: now,
    updatedAt: now,
    template: clone({ ...input.template, name }),
  }
  const next = readWorkflowLibrary().filter((candidate) => candidate.id !== entry.id)
  writeWorkflowLibrary([entry, ...next])
  return entry
}

export function saveWorkflowFromCurrentProject(template: CanvasWorkflowTemplate): WorkflowLibraryEntry | null {
  const sourceProjectId = getActiveWorkbenchProjectId() || undefined
  const sourceProjectName = sourceProjectId ? listLocalProjects().find((project) => project.id === sourceProjectId)?.name : undefined
  return saveWorkflowToLibrary({ template, sourceProjectId, sourceProjectName })
}

export function updateWorkflowLibraryEntry(
  id: string,
  patch: Partial<Pick<WorkflowLibraryEntry, 'name' | 'description' | 'tags' | 'favorite'>>,
  now = Date.now(),
): WorkflowLibraryEntry | null {
  const current = readWorkflowLibrary()
  const index = current.findIndex((entry) => entry.id === id)
  if (index < 0) return null
  const existing = current[index]
  const name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : existing.name
  const nextEntry: WorkflowLibraryEntry = {
    ...existing,
    name,
    description: typeof patch.description === 'string' ? patch.description.trim() : existing.description,
    tags: patch.tags ? [...new Set(patch.tags.map((tag) => String(tag).trim()).filter(Boolean))] : existing.tags,
    ...(typeof patch.favorite === 'boolean' ? { favorite: patch.favorite } : {}),
    updatedAt: now,
    template: clone({ ...existing.template, name }),
  }
  current[index] = nextEntry
  writeWorkflowLibrary(current)
  return nextEntry
}

export function markWorkflowLibraryEntryUsed(id: string, now = Date.now()): WorkflowLibraryEntry | null {
  const current = readWorkflowLibrary()
  const index = current.findIndex((entry) => entry.id === id)
  if (index < 0) return null
  const nextEntry = { ...current[index], lastUsedAt: now }
  current[index] = nextEntry
  writeWorkflowLibrary(current)
  return nextEntry
}

export function deleteWorkflowLibraryEntry(id: string): boolean {
  const current = readWorkflowLibrary()
  const next = current.filter((entry) => entry.id !== id)
  if (next.length === current.length) return false
  writeWorkflowLibrary(next)
  return true
}

export function searchWorkflowLibrary(
  entries: readonly WorkflowLibraryEntry[],
  options: { query?: string; filter?: 'all' | 'recent' | 'favorites' } = {},
): WorkflowLibraryEntry[] {
  const query = String(options.query || '').trim().toLocaleLowerCase()
  const filtered = entries.filter((entry) => {
    if (options.filter === 'favorites' && !entry.favorite) return false
    if (options.filter === 'recent' && !entry.lastUsedAt) return false
    if (!query) return true
    const haystack = [entry.name, entry.description, ...entry.tags, ...(entry.sourceProjectName ? [entry.sourceProjectName] : [])]
      .join('\n')
      .toLocaleLowerCase()
    return haystack.includes(query)
  })
  return [...filtered].sort((left, right) => (
    (right.lastUsedAt || right.updatedAt) - (left.lastUsedAt || left.updatedAt)
  ))
}
