export type ChapterWorkspaceDetail = {
  bookId: string
  projectId: string
  chapter: number
  title: string
  content: string
  startLine: number
  endLine: number
  summary?: string | null
  keywords?: string[]
  coreConflict?: string | null
  characters?: Array<{ name: string; description?: string }>
  props?: Array<{
    name: string
    description?: string
    narrativeImportance?: 'critical' | 'supporting' | 'background'
    visualNeed?: 'must_render' | 'shared_scene_only' | 'mention_only'
    functionTags?: Array<'plot_trigger' | 'combat' | 'threat' | 'identity_marker' | 'continuity_anchor' | 'transaction' | 'environment_clutter'>
    reusableAssetPreferred?: boolean
    independentlyFramable?: boolean
  }>
  scenes?: Array<{ name: string; description?: string }>
  locations?: Array<{ name: string; description?: string }>
}

export type ChapterProductionRequestState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  updatedAtLabel: string
  updatedAtMs: number
}

export type WorkspaceChecklistItem = {
  key: string
  title: string
  detail: string
  actionLabel?: string
  actionLoading?: boolean
  action?: () => void
}

export type ShotVideoRuntimeState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  updatedAtLabel: string
  updatedAtMs: number
  taskId?: string
  videoUrl?: string
  thumbnailUrl?: string
}

export type ChapterScriptRuntimeState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  updatedAtLabel: string
  updatedAtMs: number
}

export type WorkspaceAssetInput = {
  assetId?: string
  assetRefId?: string
  url?: string
  role?: 'target' | 'reference' | 'character' | 'scene' | 'prop' | 'product' | 'style' | 'context' | 'mask'
  weight?: number
  note?: string
  name?: string
}

export type WorkspaceAssetListItem = {
  id: string
  title: string
  subtitle: string
  kindLabel: string
  statusLabel: string
  canGenerate?: boolean
  generationTarget?:
    | {
        kind: 'roleCard'
        cardId?: string
        roleName: string
        description?: string
      }
    | {
        kind: 'visualRef'
        refId?: string
        category: 'scene_prop' | 'spell_fx'
        name: string
        description?: string
        tags?: string[]
      }
  imageUrl?: string
  videoUrl?: string
  entityKey?: string
  mentionAliases?: readonly string[]
  note?: string
  chapterNo?: number | null
  isCurrentChapter?: boolean
}
