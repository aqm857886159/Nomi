import React from 'react'
import {
  createAiCharacterLibraryCharacter,
  deleteAiCharacterLibraryCharacter,
  importAiCharacterLibraryJson,
  listAiCharacterLibraryCharacters,
  updateAiCharacterLibraryCharacter,
  type AiCharacterLibraryCharacterDto,
  type AiCharacterLibraryUpsertPayload,
} from '../api/server'
import { toast } from './toast'
import AiCharacterLibraryManagementView from './aiCharacterLibrary/AiCharacterLibraryManagementView'
import { buildEditorState, buildUpsertPayload, parseImportJsonText } from './aiCharacterLibrary/aiCharacterLibrary.utils'
import type {
  AiCharacterLibraryManagementPanelProps,
  AiCharacterLibraryState,
} from './aiCharacterLibrary/aiCharacterLibrary.types'

function emptyState(): AiCharacterLibraryState {
  return {
    search: '',
    currentProjectOnly: false,
    page: 1,
    pageSize: 10,
    loading: false,
    saving: false,
    importing: false,
    deletingId: '',
    items: [],
    total: 0,
    syncState: null,
    editor: null,
    importText: '',
  }
}

export default function AiCharacterLibraryManagementPanel(props: AiCharacterLibraryManagementPanelProps): JSX.Element {
  const { className, opened, projectId, canEdit = false } = props
  const importFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [state, setState] = React.useState<AiCharacterLibraryState>(() => ({
    ...emptyState(),
    currentProjectOnly: Boolean(projectId),
  }))

  const effectiveProjectId = state.currentProjectOnly ? (projectId || undefined) : undefined
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize))
  const pageStart = state.total > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const pageEnd = state.total > 0 ? Math.min(state.total, state.page * state.pageSize) : 0

  const reload = React.useCallback(async () => {
    if (!opened) return
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const result = await listAiCharacterLibraryCharacters({
        q: state.search,
        page: state.page,
        pageSize: state.pageSize,
        ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
      })
      setState((prev) => ({
        ...prev,
        items: Array.isArray(result.characters) ? result.characters : [],
        total: typeof result.total === 'number' && Number.isFinite(result.total) ? result.total : 0,
        syncState: result.syncState ?? null,
        loading: false,
      }))
    } catch (err: unknown) {
      console.error('list ai character library failed', err)
      setState((prev) => ({ ...prev, items: [], total: 0, loading: false }))
      toast(err instanceof Error ? err.message : '加载角色库失败', 'error')
    }
  }, [effectiveProjectId, opened, state.page, state.pageSize, state.search])

  React.useEffect(() => {
    if (!projectId) {
      setState((prev) => ({ ...prev, currentProjectOnly: false }))
    }
  }, [projectId])

  React.useEffect(() => {
    if (!opened) return
    void reload()
  }, [opened, reload])

  React.useEffect(() => {
    setState((prev) => {
      if (prev.page <= totalPages) return prev
      return { ...prev, page: totalPages }
    })
  }, [totalPages])

  const setField = React.useCallback(<K extends keyof AiCharacterLibraryState>(key: K, value: AiCharacterLibraryState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmitEditor = React.useCallback(async () => {
    const editor = state.editor
    if (!editor) return
    const upsertPayload: AiCharacterLibraryUpsertPayload = buildUpsertPayload(editor, effectiveProjectId)
    if (!upsertPayload.name && !upsertPayload.identity_hint && !upsertPayload.character_id) {
      toast('至少填写 名称 / identity_hint / character_id 之一', 'error')
      return
    }
    setField('saving', true)
    try {
      if (editor.id) {
        await updateAiCharacterLibraryCharacter(editor.id, upsertPayload)
        toast('角色库记录已更新', 'success')
      } else {
        await createAiCharacterLibraryCharacter(upsertPayload)
        toast('角色库记录已创建', 'success')
      }
      setField('editor', null)
      await reload()
    } catch (err: unknown) {
      console.error('save ai character library failed', err)
      toast(err instanceof Error ? err.message : '保存角色库记录失败', 'error')
    } finally {
      setField('saving', false)
    }
  }, [effectiveProjectId, reload, setField, state.editor])

  const handleDelete = React.useCallback(async (character: AiCharacterLibraryCharacterDto) => {
    if (!canEdit) return
    const label = character.name || character.identity_hint || character.character_id || character.id
    if (!window.confirm(`确定删除角色库记录「${label}」？`)) return
    setField('deletingId', character.id)
    try {
      await deleteAiCharacterLibraryCharacter(character.id)
      toast('角色库记录已删除', 'success')
      await reload()
    } catch (err: unknown) {
      console.error('delete ai character library failed', err)
      toast(err instanceof Error ? err.message : '删除角色库记录失败', 'error')
    } finally {
      setField('deletingId', '')
    }
  }, [canEdit, reload, setField])

  const handleImport = React.useCallback(async () => {
    if (!canEdit) return
    let characters: AiCharacterLibraryUpsertPayload[]
    try {
      characters = parseImportJsonText(state.importText)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'JSON 解析失败', 'error')
      return
    }
    setField('importing', true)
    try {
      const result = await importAiCharacterLibraryJson({
        ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
        characters,
      })
      toast(`导入完成：新增 ${result.importedCharacters}，更新 ${result.updatedCharacters}`, 'success')
      setState((prev) => ({ ...prev, importText: '', page: 1 }))
      await reload()
    } catch (err: unknown) {
      console.error('import ai character library json failed', err)
      toast(err instanceof Error ? err.message : 'JSON 导入失败', 'error')
    } finally {
      setField('importing', false)
    }
  }, [canEdit, effectiveProjectId, reload, setField, state.importText])

  const handleImportFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setField('importText', text)
    } catch (err: unknown) {
      console.error('read import file failed', err)
      toast(err instanceof Error ? err.message : '读取导入文件失败', 'error')
    } finally {
      event.currentTarget.value = ''
    }
  }, [setField])

  return (
    <AiCharacterLibraryManagementView
      className={className}
      canEdit={canEdit}
      currentProjectOnly={state.currentProjectOnly}
      onCurrentProjectOnlyChange={(value) => setField('currentProjectOnly', value)}
      onReload={() => void reload()}
      loading={state.loading}
      search={state.search}
      onSearchChange={(value) => setField('search', value)}
      pageSize={state.pageSize}
      onPageSizeChange={(value) => setField('pageSize', value)}
      total={state.total}
      pageStart={pageStart}
      pageEnd={pageEnd}
      syncState={state.syncState}
      importing={state.importing}
      onImportFileLoad={handleImportFileChange}
      onImportSubmit={() => void handleImport()}
      importText={state.importText}
      onImportTextChange={(value) => setField('importText', value)}
      importFileInputRef={importFileInputRef}
      items={state.items}
      deletingId={state.deletingId}
      onDelete={handleDelete}
      onEdit={(character) => setField('editor', buildEditorState(character))}
      saving={state.saving}
      editor={state.editor}
      onEditorChange={(next) => setField('editor', next)}
      onEditorSubmit={() => void handleSubmitEditor()}
      totalPages={totalPages}
      onPageChange={(value) => setField('page', value)}
      page={state.page}
      effectiveProjectId={effectiveProjectId}
    />
  )
}
