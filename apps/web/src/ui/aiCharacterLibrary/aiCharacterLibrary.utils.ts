import type { AiCharacterLibraryCharacterDto, AiCharacterLibraryUpsertPayload } from '../../api/server'
import type { CharacterEditorState } from './aiCharacterLibrary.types'

function normalizeEditorValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function formatTime(value?: string | null): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '—'
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return raw
  return new Date(ts).toLocaleString()
}

export function buildEditorState(character?: AiCharacterLibraryCharacterDto | null): CharacterEditorState {
  return {
    ...(character?.id ? { id: character.id } : {}),
    name: normalizeEditorValue(character?.name),
    character_id: normalizeEditorValue(character?.character_id),
    group_number: normalizeEditorValue(character?.group_number),
    identity_hint: normalizeEditorValue(character?.identity_hint),
    gender: normalizeEditorValue(character?.gender),
    age_group: normalizeEditorValue(character?.age_group),
    species: normalizeEditorValue(character?.species),
    era: normalizeEditorValue(character?.era),
    genre: normalizeEditorValue(character?.genre),
    outfit: normalizeEditorValue(character?.outfit),
    distinctive_features: normalizeEditorValue(character?.distinctive_features),
    filter_worldview: normalizeEditorValue(character?.filter_worldview),
    filter_theme: normalizeEditorValue(character?.filter_theme),
    filter_scene: normalizeEditorValue(character?.filter_scene),
    full_body_image_url: normalizeEditorValue(character?.full_body_image_url),
    three_view_image_url: normalizeEditorValue(character?.three_view_image_url),
    expression_image_url: normalizeEditorValue(character?.expression_image_url),
    closeup_image_url: normalizeEditorValue(character?.closeup_image_url),
  }
}

export function buildUpsertPayload(editor: CharacterEditorState, projectId?: string | null): AiCharacterLibraryUpsertPayload {
  return {
    ...(projectId ? { projectId } : {}),
    name: editor.name,
    character_id: editor.character_id,
    group_number: editor.group_number,
    identity_hint: editor.identity_hint,
    gender: editor.gender,
    age_group: editor.age_group,
    species: editor.species,
    era: editor.era,
    genre: editor.genre,
    outfit: editor.outfit,
    distinctive_features: editor.distinctive_features,
    filter_worldview: editor.filter_worldview,
    filter_theme: editor.filter_theme,
    filter_scene: editor.filter_scene,
    full_body_image_url: editor.full_body_image_url,
    three_view_image_url: editor.three_view_image_url,
    expression_image_url: editor.expression_image_url,
    closeup_image_url: editor.closeup_image_url,
  }
}

export function normalizeImportCharacter(raw: unknown): AiCharacterLibraryUpsertPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON 导入数组中的每一项都必须是对象')
  }
  const item = raw as Record<string, unknown>
  return {
    name: normalizeEditorValue(item.name),
    character_id: normalizeEditorValue(item.character_id),
    group_number: normalizeEditorValue(item.group_number),
    identity_hint: normalizeEditorValue(item.identity_hint),
    gender: normalizeEditorValue(item.gender),
    age_group: normalizeEditorValue(item.age_group),
    species: normalizeEditorValue(item.species),
    era: normalizeEditorValue(item.era),
    genre: normalizeEditorValue(item.genre),
    outfit: normalizeEditorValue(item.outfit),
    distinctive_features: normalizeEditorValue(item.distinctive_features),
    filter_worldview: normalizeEditorValue(item.filter_worldview),
    filter_theme: normalizeEditorValue(item.filter_theme),
    filter_scene: normalizeEditorValue(item.filter_scene),
    full_body_image_url: normalizeEditorValue(item.full_body_image_url),
    three_view_image_url: normalizeEditorValue(item.three_view_image_url),
    expression_image_url: normalizeEditorValue(item.expression_image_url),
    closeup_image_url: normalizeEditorValue(item.closeup_image_url),
  }
}

export function parseImportJsonText(text: string): AiCharacterLibraryUpsertPayload[] {
  const rawText = String(text || '').trim()
  if (!rawText) throw new Error('请先填写 JSON')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonCodeFence(rawText))
  } catch {
    throw new Error('JSON 格式错误')
  }
  const items = extractImportItems(parsed)
  if (!items || !items.length) {
    throw new Error('JSON 必须是数组、{ "characters": [...] }，或包在 code/content/payload 中的 JSON / ```json code``` 文本')
  }
  return items.map(normalizeImportCharacter)
}

export function pickPreviewUrl(character: AiCharacterLibraryCharacterDto): string {
  return (
    normalizeEditorValue(character.full_body_image_url) ||
    normalizeEditorValue(character.three_view_image_url) ||
    normalizeEditorValue(character.expression_image_url) ||
    normalizeEditorValue(character.closeup_image_url)
  )
}

export function buildCharacterMeta(character: AiCharacterLibraryCharacterDto): string {
  return [
    normalizeEditorValue(character.identity_hint),
    normalizeEditorValue(character.gender),
    normalizeEditorValue(character.age_group),
    normalizeEditorValue(character.species),
    normalizeEditorValue(character.genre),
  ].filter(Boolean).join(' / ')
}

function stripJsonCodeFence(text: string): string {
  const raw = String(text || '').trim()
  const match = raw.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1] ? match[1].trim() : raw
}

function extractImportItems(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (Array.isArray(record.characters)) return record.characters
  const nestedKeys = ['code', 'content', 'payload', 'data', 'body', 'json']
  for (const key of nestedKeys) {
    const nested = record[key]
    if (typeof nested === 'string') {
      const parsed = JSON.parse(stripJsonCodeFence(nested))
      const next = extractImportItems(parsed)
      if (next?.length) return next
      continue
    }
    const next = extractImportItems(nested)
    if (next?.length) return next
  }
  return null
}
