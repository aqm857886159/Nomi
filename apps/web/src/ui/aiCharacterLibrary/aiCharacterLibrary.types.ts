import type { ChangeEvent } from 'react'
import type {
  AiCharacterLibraryCharacterDto,
  AiCharacterLibrarySyncStateDto,
  AiCharacterLibraryUpsertPayload,
} from '../../api/server'

export type AiCharacterLibraryManagementPanelProps = {
  className?: string
  opened: boolean
  projectId?: string | null
  canEdit?: boolean
}

export type CharacterEditorState = {
  id?: string
  name: string
  character_id: string
  group_number: string
  identity_hint: string
  gender: string
  age_group: string
  species: string
  era: string
  genre: string
  outfit: string
  distinctive_features: string
  filter_worldview: string
  filter_theme: string
  filter_scene: string
  full_body_image_url: string
  three_view_image_url: string
  expression_image_url: string
  closeup_image_url: string
}

export type AiCharacterLibraryState = {
  search: string
  currentProjectOnly: boolean
  page: number
  pageSize: number
  loading: boolean
  saving: boolean
  importing: boolean
  deletingId: string
  items: AiCharacterLibraryCharacterDto[]
  total: number
  syncState: AiCharacterLibrarySyncStateDto | null
  editor: CharacterEditorState | null
  importText: string
}

export type AiCharacterLibraryActions = {
  onSearchChange: (value: string) => void
  onCurrentProjectOnlyChange: (value: boolean) => void
  onPageChange: (value: number) => void
  onPageSizeChange: (value: number) => void
  onReload: () => void
  onCreate: () => void
  onEdit: (character: AiCharacterLibraryCharacterDto) => void
  onDelete: (character: AiCharacterLibraryCharacterDto) => void
  onImportFileLoad: (event: ChangeEvent<HTMLInputElement>) => void
  onImportTextChange: (value: string) => void
  onImportSubmit: () => void
  onEditorChange: (next: CharacterEditorState | null) => void
  onEditorSubmit: () => void
}

export type AiCharacterLibraryDerived = {
  effectiveProjectId?: string
  totalPages: number
  pageStart: number
  pageEnd: number
}

export type AiCharacterLibraryEditorPayload = AiCharacterLibraryUpsertPayload
