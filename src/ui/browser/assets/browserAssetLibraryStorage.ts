import type { NomiBrowserAsset } from './browserAssetData'

export type BrowserAssetLibraryState = {
  folders: NomiBrowserAsset[]
  promptCards: NomiBrowserAsset[]
  promptCategories: BrowserPromptCategory[]
  folderAssignments: Record<string, string | null>
  deletedAssetKeys: string[]
}

export type BrowserPromptCategory = {
  id: string
  label: string
  createdAt: string
}

export type BrowserPromptLibraryItem = {
  id: string
  title: string
  prompt: string
  promptType: string
  referenceImages: Array<{ url: string; title?: string; sourceUrl?: string }>
  savedAt?: string
  status?: NomiBrowserAsset['status']
}

export type SaveBrowserPromptCardInput = {
  projectId: string
  prompt: string
  promptType: string
  title?: string
  referenceImages?: Array<{ url: string; title?: string; sourceUrl?: string }>
}

const BROWSER_ASSET_LIBRARY_STATE_VERSION = 1
const BROWSER_ASSET_LIBRARY_STORAGE_PREFIX = 'nomi.browser.asset-library.v1'
export const BROWSER_ASSET_LIBRARY_UPDATED_EVENT = 'nomi-browser-asset-library-updated'
export const DEFAULT_BROWSER_PROMPT_CATEGORIES: readonly BrowserPromptCategory[] = [
  { id: 'image', label: '图片提示词', createdAt: 'default' },
  { id: 'video', label: '视频提示词', createdAt: 'default' },
]

export const EMPTY_BROWSER_ASSET_LIBRARY_STATE: BrowserAssetLibraryState = {
  folders: [],
  promptCards: [],
  promptCategories: [],
  folderAssignments: {},
  deletedAssetKeys: [],
}

export function browserAssetLibraryKey(projectId: string): string {
  return `${BROWSER_ASSET_LIBRARY_STORAGE_PREFIX}:${projectId || 'global'}`
}

export function normalizeBrowserAssetLibraryState(input: unknown): BrowserAssetLibraryState {
  if (!input || typeof input !== 'object') return EMPTY_BROWSER_ASSET_LIBRARY_STATE
  const raw = input as {
    folders?: unknown
    promptCards?: unknown
    promptCategories?: unknown
    folderAssignments?: unknown
    deletedAssetKeys?: unknown
  }
  const folders = Array.isArray(raw.folders)
    ? raw.folders.filter((asset): asset is NomiBrowserAsset => {
        if (!asset || typeof asset !== 'object') return false
        const candidate = asset as NomiBrowserAsset
        return candidate.type === 'folder' && typeof candidate.id === 'string' && typeof candidate.title === 'string'
      })
    : []
  const promptCategories = Array.isArray(raw.promptCategories)
    ? raw.promptCategories.filter((category): category is BrowserPromptCategory => {
        if (!category || typeof category !== 'object') return false
        const candidate = category as BrowserPromptCategory
        return typeof candidate.id === 'string' && typeof candidate.label === 'string'
      }).map((category) => ({
        id: category.id.trim(),
        label: category.label.trim(),
        createdAt: typeof category.createdAt === 'string' ? category.createdAt : new Date().toISOString(),
      })).filter((category) => category.id && category.label)
    : []
  const promptCards = Array.isArray(raw.promptCards)
    ? raw.promptCards.filter((asset): asset is NomiBrowserAsset => {
        if (!asset || typeof asset !== 'object') return false
        const candidate = asset as NomiBrowserAsset
        return (
          candidate.type === 'prompt' &&
          typeof candidate.id === 'string' &&
          typeof candidate.title === 'string' &&
          Boolean(candidate.promptCard)
        )
      })
    : []
  const folderAssignments =
    raw.folderAssignments && typeof raw.folderAssignments === 'object'
      ? Object.fromEntries(
          Object.entries(raw.folderAssignments as Record<string, unknown>).filter(
            ([key, value]) => key && (value === null || typeof value === 'string'),
          ) as Array<[string, string | null]>,
        )
      : {}
  const deletedAssetKeys = Array.isArray(raw.deletedAssetKeys)
    ? raw.deletedAssetKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
    : []
  return { folders, promptCards, promptCategories, folderAssignments, deletedAssetKeys }
}

export function readBrowserAssetLibraryState(projectId: string): BrowserAssetLibraryState {
  if (typeof window === 'undefined') return EMPTY_BROWSER_ASSET_LIBRARY_STATE
  try {
    const raw = window.localStorage.getItem(browserAssetLibraryKey(projectId))
    if (!raw) return EMPTY_BROWSER_ASSET_LIBRARY_STATE
    return normalizeBrowserAssetLibraryState(JSON.parse(raw))
  } catch {
    return EMPTY_BROWSER_ASSET_LIBRARY_STATE
  }
}

export function writeBrowserAssetLibraryState(projectId: string, state: BrowserAssetLibraryState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      browserAssetLibraryKey(projectId),
      JSON.stringify({
        version: BROWSER_ASSET_LIBRARY_STATE_VERSION,
        folders: state.folders,
        promptCards: state.promptCards,
        promptCategories: state.promptCategories,
        folderAssignments: state.folderAssignments,
        deletedAssetKeys: state.deletedAssetKeys,
      }),
    )
  } catch {
    // Storage is best effort; assets themselves are still on disk.
  }
}

export function readBrowserPromptLibraryItems(projectId: string): BrowserPromptLibraryItem[] {
  const state = readBrowserAssetLibraryState(projectId)
  return state.promptCards.flatMap((asset): BrowserPromptLibraryItem[] => {
    if (asset.type !== 'prompt' || asset.source !== 'transcript') return []
    if (asset.status === 'loading' || asset.status === 'error') return []
    const prompt = asset.promptCard?.prompt?.trim() || ''
    if (!prompt) return []
    const referenceImages = (asset.promptCard?.referenceImages ?? []).filter(
      (reference): reference is { url: string; title?: string; sourceUrl?: string } =>
        Boolean(reference?.url?.trim()),
    )
    return [
      {
        id: asset.id,
        title: asset.title,
        prompt,
        promptType: asset.promptCard?.promptType ?? 'image',
        referenceImages,
        savedAt: asset.promptCard?.savedAt,
        status: asset.status,
      },
    ]
  })
}

export function readBrowserPromptCategories(projectId: string): BrowserPromptCategory[] {
  const custom = readBrowserAssetLibraryState(projectId).promptCategories
  const seen = new Set(DEFAULT_BROWSER_PROMPT_CATEGORIES.map((category) => category.id))
  return [
    ...DEFAULT_BROWSER_PROMPT_CATEGORIES,
    ...custom.filter((category) => {
      if (seen.has(category.id)) return false
      seen.add(category.id)
      return true
    }),
  ]
}

export function createBrowserPromptCategory(projectId: string, label: string): BrowserPromptCategory | null {
  const normalized = label.trim()
  if (!normalized) return null
  const id = `custom:${normalized.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5:_-]/gi, '') || Date.now()}`
  const current = readBrowserAssetLibraryState(projectId)
  const categories = readBrowserPromptCategories(projectId)
  if (categories.some((category) => category.label === normalized || category.id === id)) return null
  const category = { id, label: normalized, createdAt: new Date().toISOString() }
  writeBrowserAssetLibraryState(projectId, {
    ...current,
    promptCategories: [...current.promptCategories, category],
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, { detail: { projectId } }))
  }
  return category
}

export function promptTypeLabel(
  promptType: SaveBrowserPromptCardInput['promptType'],
  categories?: readonly { id: string; label: string }[],
): string {
  const category = categories?.find((item) => item.id === promptType)
  if (category) return category.label
  return promptType === 'video' ? '视频提示词' : '图片提示词'
}

function promptCardTitle(prompt: string, title?: string): string {
  const normalizedTitle = title?.trim()
  if (normalizedTitle) return normalizedTitle.slice(0, 48)
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ')
  return normalizedPrompt ? normalizedPrompt.slice(0, 48) : '保存的提示词'
}

function createPromptCardId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return `manual-prompt-${random}`
}

function upsertPromptCard(current: readonly NomiBrowserAsset[], asset: NomiBrowserAsset): NomiBrowserAsset[] {
  return [asset, ...current.filter((item) => item.id !== asset.id)]
}

export function saveBrowserPromptCard(input: SaveBrowserPromptCardInput): NomiBrowserAsset | null {
  const prompt = input.prompt.trim()
  if (!prompt) return null
  const savedAt = new Date().toISOString()
  const referenceImages = (input.referenceImages ?? []).filter((reference) => reference.url.trim())
  const categories = readBrowserPromptCategories(input.projectId)
  const label = promptTypeLabel(input.promptType, categories)
  const previewUrl = referenceImages[0]?.url
  const asset: NomiBrowserAsset = {
    id: createPromptCardId(),
    type: 'prompt',
    source: 'transcript',
    title: promptCardTitle(prompt, input.title),
    subtitle: label,
    tags: [label, '手动保存'],
    previewUrl,
    previewMediaType: previewUrl ? 'image' : undefined,
    status: 'ready',
    createdAt: savedAt,
    updatedAt: savedAt,
    promptCard: {
      referenceImages,
      prompt,
      promptType: input.promptType,
      savedAt,
    },
  }
  const current = readBrowserAssetLibraryState(input.projectId)
  writeBrowserAssetLibraryState(input.projectId, {
    ...current,
    promptCards: upsertPromptCard(current.promptCards, asset),
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, { detail: { projectId: input.projectId } }))
  }
  return asset
}
