import type { Node } from '@xyflow/react'
import type { NanoComicShotItem } from './types'
import type { WorkspaceAssetInput, WorkspaceAssetListItem } from './workspaceTypes'

export function parseRoleCardMentionToken(text: string): { roleNameKey: string } | null {
  const match = text.match(/@([^@\s]+)/)
  return match ? { roleNameKey: match[1] } : null
}

export function readVideoPreviewFromNodeData(node: Node | undefined): { videoUrl?: string; thumbnailUrl?: string } {
  const data = node?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const record = data as Record<string, unknown>
  const directVideoUrl = typeof record.videoUrl === 'string' ? record.videoUrl.trim() : ''
  const directThumbnailUrl = typeof record.videoThumbnailUrl === 'string' ? record.videoThumbnailUrl.trim() : ''
  const videoResults = Array.isArray(record.videoResults) ? record.videoResults : []
  const firstResult = videoResults.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined
  const resultVideoUrl = typeof firstResult?.url === 'string' ? firstResult.url.trim() : ''
  const resultThumbnailUrl = typeof firstResult?.thumbnailUrl === 'string' ? firstResult.thumbnailUrl.trim() : ''
  const videoUrl = directVideoUrl || resultVideoUrl
  const thumbnailUrl = directThumbnailUrl || resultThumbnailUrl || videoUrl
  return {
    ...(videoUrl ? { videoUrl } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}

export function readImagePreviewFromNodeData(node: Node | undefined): { imageUrl?: string } {
  const data = node?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const record = data as Record<string, unknown>
  const directImageUrl = typeof record.imageUrl === 'string' ? record.imageUrl.trim() : ''
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  const imagePrimaryIndexRaw = Number(record.imagePrimaryIndex)
  const primaryResult =
    Number.isFinite(imagePrimaryIndexRaw) && imagePrimaryIndexRaw >= 0 && imagePrimaryIndexRaw < imageResults.length
      ? imageResults[Math.trunc(imagePrimaryIndexRaw)]
      : null
  const primaryResultUrl =
    primaryResult && typeof primaryResult === 'object' && !Array.isArray(primaryResult) && typeof (primaryResult as { url?: unknown }).url === 'string'
      ? String((primaryResult as { url?: string }).url || '').trim()
      : ''
  let fallbackImageUrl = ''
  if (!primaryResultUrl) {
    for (const item of imageResults) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const nextUrl = typeof (item as { url?: unknown }).url === 'string' ? String((item as { url?: string }).url || '').trim() : ''
      if (!nextUrl) continue
      fallbackImageUrl = nextUrl
      break
    }
  }
  let storyboardCellImageUrl = ''
  const storyboardCells = Array.isArray(record.storyboardEditorCells) ? record.storyboardEditorCells : []
  for (const cell of storyboardCells) {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) continue
    const nextUrl = typeof (cell as { imageUrl?: unknown }).imageUrl === 'string'
      ? String((cell as { imageUrl?: string }).imageUrl || '').trim()
      : ''
    if (!nextUrl) continue
    storyboardCellImageUrl = nextUrl
    break
  }
  const imageUrl = directImageUrl || primaryResultUrl || fallbackImageUrl || storyboardCellImageUrl
  return imageUrl ? { imageUrl } : {}
}

export function readRuntimeUpdatedAtMs(record: Record<string, unknown>): number {
  const lastResult = record.lastResult
  if (lastResult && typeof lastResult === 'object' && !Array.isArray(lastResult)) {
    const at = Number((lastResult as Record<string, unknown>).at)
    if (Number.isFinite(at) && at > 0) return Math.trunc(at)
  }
  const updatedAtMs = Date.parse(String(record.updatedAt || '').trim())
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs
  return 0
}

export function buildPersistedShotVideoPreviewByShotId(input: {
  shots: readonly NanoComicShotItem[]
  nodes: readonly Node[]
  projectId: string
  selectedChapterNo: number | null
  semanticAssets: ReadonlyArray<{
    mediaKind: 'image' | 'video'
    videoUrl?: string
    thumbnailUrl?: string
    chapter?: number
    shotNo?: number
    updatedAt?: string
  }>
}): Record<string, { videoUrl?: string; thumbnailUrl?: string }> {
  const shotIdByShotNo = new Map<number, string>()
  for (const shot of input.shots) {
    shotIdByShotNo.set(shot.shotNo, shot.id)
  }

  const resolved = new Map<string, { videoUrl?: string; thumbnailUrl?: string; updatedAtMs: number }>()
  const assignPreview = (shotId: string, preview: { videoUrl?: string; thumbnailUrl?: string; updatedAtMs: number }) => {
    if (!shotId || !String(preview.videoUrl || '').trim()) return
    const current = resolved.get(shotId)
    if (!current || preview.updatedAtMs >= current.updatedAtMs) {
      resolved.set(shotId, preview)
    }
  }

  for (const asset of input.semanticAssets) {
    if (asset.mediaKind !== 'video') continue
    const shotNo = typeof asset.shotNo === 'number' ? Math.trunc(asset.shotNo) : 0
    if (shotNo <= 0) continue
    const shotId = shotIdByShotNo.get(shotNo) || ''
    if (!shotId) continue
    const chapterNo = typeof asset.chapter === 'number' ? Math.trunc(asset.chapter) : null
    if (input.selectedChapterNo && chapterNo && chapterNo !== input.selectedChapterNo) continue
    const videoUrl = String(asset.videoUrl || '').trim()
    if (!videoUrl) continue
    assignPreview(shotId, {
      videoUrl,
      thumbnailUrl: String(asset.thumbnailUrl || '').trim() || undefined,
      updatedAtMs: Date.parse(String(asset.updatedAt || '').trim()) || 0,
    })
  }

  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const record = readNodeDataRecord(node)
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const sourceShotId = readTrimmedRecordString(record, 'sourceShotId')
    const sourceShotNo = readPositiveRecordNumber(record, ['sourceShotNo', 'shotNo'])
    const shotId = sourceShotId || (sourceShotNo ? (shotIdByShotNo.get(sourceShotNo) || '') : '')
    if (!shotId) continue
    const chapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    if (input.selectedChapterNo && chapterNo && chapterNo !== input.selectedChapterNo) continue
    const preview = readVideoPreviewFromNodeData(node)
    if (!String(preview.videoUrl || '').trim()) continue
    assignPreview(shotId, {
      ...preview,
      updatedAtMs: readRuntimeUpdatedAtMs(record),
    })
  }

  return Object.fromEntries(
    Array.from(resolved.entries()).map(([shotId, preview]) => [
      shotId,
      {
        ...(preview.videoUrl ? { videoUrl: preview.videoUrl } : {}),
        ...(preview.thumbnailUrl ? { thumbnailUrl: preview.thumbnailUrl } : {}),
      },
    ]),
  )
}

export function normalizeWorkspaceAssetInput(input: WorkspaceAssetInput): WorkspaceAssetInput | null {
  const url = String(input.url || '').trim()
  if (!url) return null
  const assetId = String(input.assetId || '').trim()
  const assetRefId = String(input.assetRefId || '').trim()
  const role = typeof input.role === 'string' ? input.role : undefined
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  return {
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    url,
    ...(role ? { role } : {}),
    ...(typeof input.weight === 'number' ? { weight: input.weight } : {}),
    ...(note ? { note } : {}),
    ...(name ? { name } : {}),
  }
}

export function dedupeWorkspaceAssetInputs(items: readonly WorkspaceAssetInput[]): WorkspaceAssetInput[] {
  const seen = new Set<string>()
  const out: WorkspaceAssetInput[] = []
  for (const item of items) {
    const normalized = normalizeWorkspaceAssetInput(item)
    if (!normalized?.url) continue
    const dedupeKey = [
      normalized.assetId || '',
      normalized.assetRefId || '',
      normalized.url,
      normalized.role || '',
      normalized.name || '',
    ].join('::')
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(normalized)
  }
  return out
}

export function mergeWorkspaceAssetInputs(sections: readonly (readonly WorkspaceAssetInput[])[]): WorkspaceAssetInput[] {
  const out: WorkspaceAssetInput[] = []
  const seenUrls = new Set<string>()
  for (const section of sections) {
    for (const item of section) {
      const normalized = normalizeWorkspaceAssetInput(item)
      if (!normalized?.url) continue
      if (seenUrls.has(normalized.url)) continue
      seenUrls.add(normalized.url)
      out.push(normalized)
    }
  }
  return out
}

export function clipWorkspaceText(input: string, maxLength: number): string {
  const compact = input.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

export function readNodeDataRecord(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {}
}

export function readTrimmedRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function readPositiveRecordNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key])
    if (Number.isFinite(value) && value > 0) {
      return Math.trunc(value)
    }
  }
  return null
}

export function normalizeAssetLookupKey(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[·•,，。:：;；!！?？'"“”‘’\-_/\\|()（）[\]【】<>《》]/g, '')
}

export function dedupeTrimmedTexts(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

export function dedupeTrimmedUrls(urls: readonly string[]): string[] {
  return Array.from(new Set(urls.map((url) => String(url || '').trim()).filter(Boolean)))
}

export function collectWorkspacePromptMentionKeys(promptText: string): {
  directKeys: Set<string>
  roleNameKeys: Set<string>
} {
  const directKeys = new Set<string>()
  const roleNameKeys = new Set<string>()
  const matches = String(promptText || '').match(/@[^\s@]+/g) || []
  for (const match of matches) {
    const trimmed = String(match || '').trim()
    if (!trimmed) continue
    const directKey = normalizeAssetLookupKey(
      trimmed
        .replace(/^@+/, '')
        .replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, ''),
    )
    if (directKey) directKeys.add(directKey)
    const roleMention = parseRoleCardMentionToken(trimmed)
    const roleNameKey = normalizeAssetLookupKey(roleMention?.roleNameKey || '')
    if (roleNameKey) roleNameKeys.add(roleNameKey)
  }
  return { directKeys, roleNameKeys }
}

export function isLikelyVideoUrl(url: string): boolean {
  const normalized = String(url || '').trim().split(/[?#]/, 1)[0]?.toLowerCase() || ''
  if (!normalized) return false
  return (
    normalized.endsWith('.mp4') ||
    normalized.endsWith('.mov') ||
    normalized.endsWith('.webm') ||
    normalized.endsWith('.m4v') ||
    normalized.endsWith('.mkv') ||
    normalized.endsWith('.avi') ||
    normalized.endsWith('.wmv') ||
    normalized.endsWith('.flv') ||
    normalized.endsWith('.m3u8')
  )
}

export function pickWorkspaceFirstFrameImageUrl(input: {
  previewImageUrl?: string
  referenceImageUrls: readonly string[]
  anchorImageUrls: readonly string[]
}): string {
  const candidates = dedupeTrimmedUrls([
    String(input.previewImageUrl || '').trim(),
    ...input.referenceImageUrls,
    ...input.anchorImageUrls,
  ])
  return candidates.find((url) => !isLikelyVideoUrl(url)) || ''
}

export function buildWorkspaceShotVideoBlockReason(input: {
  shot: NanoComicShotItem
  promptText: string
  selectedVideoModel: string
  hasVideoModelOptions: boolean
  chapterAssetItems: readonly WorkspaceAssetListItem[]
}): string | null {
  const promptText = String(input.promptText || '').trim()
  if (!promptText) return '当前片段提示词为空'
  if (!input.hasVideoModelOptions) return '当前没有可用视频模型'
  if (!String(input.selectedVideoModel || '').trim()) return '还没有选择视频模型'
  const resolvedReferences = resolveShotWorkspaceReferences({
    shot: input.shot,
    assetItems: input.chapterAssetItems,
    promptText,
  })
  const hasExistingReferences = (
    resolvedReferences.referenceImageUrls.length > 0 ||
    resolvedReferences.anchorImageUrls.length > 0 ||
    Boolean(
      pickWorkspaceFirstFrameImageUrl({
        previewImageUrl: input.shot.previewImageUrl,
        referenceImageUrls: resolvedReferences.referenceImageUrls,
        anchorImageUrls: resolvedReferences.anchorImageUrls,
      }),
    )
  )
  if (hasExistingReferences || resolvedReferences.missingAssetIds.length > 0) return null
  return '既没有真实参考图，也没有可自动补齐的角色卡/场景资产'
}

export function resolveShotWorkspaceReferences(input: {
  shot: NanoComicShotItem
  assetItems: readonly WorkspaceAssetListItem[]
  promptText?: string
}): {
  referenceImageUrls: string[]
  anchorImageUrls: string[]
  missingAssetIds: string[]
} {
  const roleKeys = new Set(input.shot.castNames.map((name) => normalizeAssetLookupKey(name)).filter(Boolean))
  const locationKey = normalizeAssetLookupKey(input.shot.locationName)
  const propKeys = new Set(input.shot.propNames.map((name) => normalizeAssetLookupKey(name)).filter(Boolean))
  const referenceUrls = [...input.shot.referenceImageUrls]
  const anchorUrls = [...input.shot.anchorImageUrls]
  const missingAssetIds: string[] = []
  const promptMentionKeys = collectWorkspacePromptMentionKeys(input.promptText || '')

  for (const asset of input.assetItems) {
    if (asset.isCurrentChapter === false) continue
    const titleKey = normalizeAssetLookupKey(asset.title)
    if (!titleKey) continue
    const isRoleCard = asset.generationTarget?.kind === 'roleCard'
    const isStyle = asset.id.startsWith('style-')
    const assetLookupKeys = new Set(
      [titleKey, ...dedupeTrimmedTexts(asset.mentionAliases || [])]
        .map((item) => normalizeAssetLookupKey(item))
        .filter(Boolean),
    )
    const matchesRole = roleKeys.has(titleKey)
    const matchesLocation = Boolean(locationKey) && titleKey === locationKey
    const matchesProp = propKeys.has(titleKey)
    const matchesPromptMention = Array.from(assetLookupKeys).some((key) => (
      promptMentionKeys.directKeys.has(key) ||
      (isRoleCard && promptMentionKeys.roleNameKeys.has(key))
    ))
    const matched = isStyle || matchesRole || matchesLocation || matchesProp || matchesPromptMention
    if (!matched) continue
    const imageUrl = String(asset.imageUrl || '').trim()
    if (imageUrl) {
      if (isRoleCard || matchesRole) {
        anchorUrls.push(imageUrl)
      } else {
        referenceUrls.push(imageUrl)
      }
      continue
    }
    if (asset.canGenerate) {
      missingAssetIds.push(asset.id)
    }
  }

  return {
    referenceImageUrls: dedupeTrimmedUrls(referenceUrls),
    anchorImageUrls: dedupeTrimmedUrls(anchorUrls),
    missingAssetIds: Array.from(new Set(missingAssetIds)),
  }
}

export function readImageUrlFromCanvasRunResult(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ''
  const record = result as Record<string, unknown>
  const directImageUrl = typeof record.imageUrl === 'string' ? record.imageUrl.trim() : ''
  if (directImageUrl) return directImageUrl
  const imageResults = Array.isArray(record.imageResults) ? record.imageResults : []
  for (const item of imageResults) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const url = typeof (item as { url?: string }).url === 'string' ? String((item as { url?: string }).url).trim() : ''
    if (url) return url
  }
  return ''
}

export function isAssetVisibleInChapter(input: {
  chapter?: number | null
  chapterStart?: number | null
  chapterEnd?: number | null
  chapterSpan?: readonly number[] | null
  selectedChapterNo: number | null
}): boolean {
  const targetChapter = input.selectedChapterNo
  if (!targetChapter || !Number.isFinite(targetChapter) || targetChapter <= 0) return true
  const chapterSpan = Array.isArray(input.chapterSpan)
    ? input.chapterSpan
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.trunc(value))
    : []
  if (chapterSpan.length > 0) return chapterSpan.includes(targetChapter)
  const chapter = typeof input.chapter === 'number' && Number.isFinite(input.chapter) && input.chapter > 0
    ? Math.trunc(input.chapter)
    : null
  if (chapter) return chapter === targetChapter
  const chapterStart = typeof input.chapterStart === 'number' && Number.isFinite(input.chapterStart) && input.chapterStart > 0
    ? Math.trunc(input.chapterStart)
    : null
  const chapterEnd = typeof input.chapterEnd === 'number' && Number.isFinite(input.chapterEnd) && input.chapterEnd > 0
    ? Math.trunc(input.chapterEnd)
    : null
  if (chapterStart && chapterEnd) return targetChapter >= chapterStart && targetChapter <= chapterEnd
  if (chapterStart) return targetChapter >= chapterStart
  if (chapterEnd) return targetChapter <= chapterEnd
  return true
}

export function classifyCanvasAssetKind(record: Record<string, unknown>, entityKey: string): string {
  const nodeKind = readTrimmedRecordString(record, 'kind')
  const productionLayer = readTrimmedRecordString(record, 'productionLayer')
  if (entityKey.startsWith('video_segment:') || nodeKind === 'video' || nodeKind === 'composeVideo') return '视频片段'
  if (entityKey.startsWith('shot:')) return '分镜节点'
  if (entityKey.startsWith('asset:role-')) return '角色卡'
  if (productionLayer === 'anchors') return '前置资产'
  return '画布资产'
}

export function isWorkspaceImageNode(record: Record<string, unknown>): boolean {
  const nodeKind = readTrimmedRecordString(record, 'kind')
  return nodeKind === 'image' || nodeKind === 'imageEdit' || nodeKind === 'storyboard' || nodeKind === 'storyboardImage'
}

export function isWorkspaceVideoNode(record: Record<string, unknown>): boolean {
  const nodeKind = readTrimmedRecordString(record, 'kind')
  return nodeKind === 'video' || nodeKind === 'composeVideo'
}

export function findMatchingWorkspaceAssetNodeId(input: {
  nodes: readonly Node[]
  projectId: string
  chapterNo: number | null
  targetAsset: WorkspaceAssetListItem
  ensuredVisualRefId?: string
}): string | null {
  const targetNameKey = normalizeAssetLookupKey(input.targetAsset.title)
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    if (!isWorkspaceImageNode(record)) continue
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const nodeChapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    if (input.chapterNo && nodeChapterNo && nodeChapterNo !== input.chapterNo) continue

    if (input.targetAsset.generationTarget?.kind === 'roleCard') {
      const targetCardId = String(input.targetAsset.generationTarget.cardId || '').trim()
      const nodeCardId = readTrimmedRecordString(record, 'roleCardId')
      if (targetCardId && nodeCardId === targetCardId) return nodeId
      const nodeRoleNameKey = normalizeAssetLookupKey(readTrimmedRecordString(record, 'roleName'))
      if (targetNameKey && nodeRoleNameKey === targetNameKey) return nodeId
      continue
    }

    if (input.targetAsset.generationTarget?.kind === 'visualRef') {
      const resolvedRefId = String(input.ensuredVisualRefId || input.targetAsset.generationTarget.refId || '').trim()
      const nodeRefId = readTrimmedRecordString(record, 'visualRefId') || readTrimmedRecordString(record, 'scenePropRefId')
      if (resolvedRefId && nodeRefId === resolvedRefId) return nodeId
      const nodeNameKey = normalizeAssetLookupKey(
        readTrimmedRecordString(record, 'visualRefName') ||
          readTrimmedRecordString(record, 'scenePropRefName') ||
          readTrimmedRecordString(record, 'label') ||
          readTrimmedRecordString(record, 'title'),
      )
      if (targetNameKey && nodeNameKey === targetNameKey) return nodeId
    }
  }
  return null
}

export function findMatchingWorkspaceVideoNodeId(input: {
  nodes: readonly Node[]
  projectId: string
  chapterNo: number | null
  sourceEntityKey: string
}): string | null {
  const targetEntityKey = String(input.sourceEntityKey || '').trim()
  if (!targetEntityKey) return null
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    if (!isWorkspaceVideoNode(record)) continue
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const nodeChapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    if (input.chapterNo && nodeChapterNo && nodeChapterNo !== input.chapterNo) continue
    const entityKey = readTrimmedRecordString(record, 'sourceEntityKey')
    if (entityKey === targetEntityKey) return nodeId
  }
  return null
}

export function collectWorkspaceReferenceSourceNodeIds(input: {
  nodes: readonly Node[]
  projectId: string
  referenceUrls: readonly string[]
}): string[] {
  const orderedUrls = dedupeTrimmedUrls(input.referenceUrls).filter((url) => !isLikelyVideoUrl(url))
  if (orderedUrls.length === 0) return []

  const nodeIdByImageUrl = new Map<string, string>()
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    if (!isWorkspaceImageNode(record)) continue
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const imageUrl = String(readImagePreviewFromNodeData(node).imageUrl || '').trim()
    if (!imageUrl || nodeIdByImageUrl.has(imageUrl)) continue
    nodeIdByImageUrl.set(imageUrl, nodeId)
  }

  const seenNodeIds = new Set<string>()
  const orderedNodeIds: string[] = []
  for (const url of orderedUrls) {
    const nodeId = nodeIdByImageUrl.get(url)
    if (!nodeId || seenNodeIds.has(nodeId)) continue
    seenNodeIds.add(nodeId)
    orderedNodeIds.push(nodeId)
  }
  return orderedNodeIds
}

export function buildCanvasWorkspaceAssetItems(input: {
  nodes: readonly Node[]
  projectId: string
  selectedChapterNo: number | null
}): WorkspaceAssetListItem[] {
  const items: WorkspaceAssetListItem[] = []
  const seen = new Set<string>()
  for (const node of input.nodes) {
    if (node.type === 'groupNode') continue
    const nodeId = String(node.id || '').trim()
    if (!nodeId) continue
    const record = readNodeDataRecord(node)
    const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
    if (sourceProjectId !== input.projectId) continue
    const entityKey = readTrimmedRecordString(record, 'sourceEntityKey')
    const { imageUrl } = readImagePreviewFromNodeData(node)
    const { videoUrl, thumbnailUrl } = readVideoPreviewFromNodeData(node)
    const prompt = readTrimmedRecordString(record, 'prompt')
    const label = [
      readTrimmedRecordString(record, 'label'),
      readTrimmedRecordString(record, 'title'),
      readTrimmedRecordString(record, 'visualRefName'),
      readTrimmedRecordString(record, 'scenePropRefName'),
      readTrimmedRecordString(record, 'roleName'),
      nodeId,
    ].find(Boolean) || nodeId
    const chapterNo = readPositiveRecordNumber(record, ['materialChapter', 'chapter'])
    const isCurrentChapter = isAssetVisibleInChapter({
      chapter: chapterNo,
      selectedChapterNo: input.selectedChapterNo,
    })
    const dedupeKey = entityKey || `node:${nodeId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    items.push({
      id: `canvas-${nodeId}`,
      title: label,
      subtitle: clipWorkspaceText(
        [
          readTrimmedRecordString(record, 'stateDescription'),
          readTrimmedRecordString(record, 'summary'),
          prompt,
        ].find(Boolean) || '当前 flow 已写入节点',
        72,
      ),
      kindLabel: classifyCanvasAssetKind(record, entityKey),
      statusLabel: videoUrl ? '已落视频' : imageUrl ? '已落图' : '已写入画布',
      imageUrl: String(thumbnailUrl || imageUrl || '').trim() || undefined,
      videoUrl: videoUrl || undefined,
      entityKey: entityKey || undefined,
      mentionAliases: dedupeTrimmedTexts([
        label,
        readTrimmedRecordString(record, 'visualRefName'),
        readTrimmedRecordString(record, 'scenePropRefName'),
        readTrimmedRecordString(record, 'roleName'),
        readTrimmedRecordString(record, 'assetRefId'),
        entityKey,
      ]),
      note: [
        readTrimmedRecordString(record, 'creationStage'),
        readTrimmedRecordString(record, 'approvalStatus'),
      ].filter(Boolean).join(' · ') || undefined,
      chapterNo,
      isCurrentChapter,
    })
  }
  return items.sort((left, right) => {
    const leftCurrent = left.isCurrentChapter ? 1 : 0
    const rightCurrent = right.isCurrentChapter ? 1 : 0
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent
    const leftChapter = typeof left.chapterNo === 'number' ? left.chapterNo : 0
    const rightChapter = typeof right.chapterNo === 'number' ? right.chapterNo : 0
    if (leftChapter !== rightChapter) return rightChapter - leftChapter
    return left.title.localeCompare(right.title, 'zh-Hans-CN')
  })
}

export function mergeWorkspaceAssetListItems(
  baseItems: readonly WorkspaceAssetListItem[],
  canvasItems: readonly WorkspaceAssetListItem[],
): WorkspaceAssetListItem[] {
  const merged = new Map<string, WorkspaceAssetListItem>()
  const getKey = (item: WorkspaceAssetListItem): string => {
    if (item.entityKey) return `entity:${item.entityKey}`
    return `item:${item.id}`
  }
  for (const item of baseItems) {
    merged.set(getKey(item), item)
  }
  for (const item of canvasItems) {
    const key = getKey(item)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, item)
      continue
    }
    const mergedImageUrl = item.imageUrl || existing.imageUrl
    const mergedVideoUrl = item.videoUrl || existing.videoUrl
    merged.set(key, {
      ...existing,
      imageUrl: mergedImageUrl,
      videoUrl: mergedVideoUrl,
      entityKey: item.entityKey || existing.entityKey,
      mentionAliases: dedupeTrimmedTexts([
        ...(existing.mentionAliases || []),
        ...(item.mentionAliases || []),
      ]),
      statusLabel: item.statusLabel || existing.statusLabel,
      note: item.note || existing.note,
      chapterNo: item.chapterNo ?? existing.chapterNo,
      isCurrentChapter: item.isCurrentChapter ?? existing.isCurrentChapter,
      canGenerate:
        existing.canGenerate === undefined
          ? undefined
          : existing.canGenerate && !mergedImageUrl && !mergedVideoUrl,
    })
  }
  return Array.from(merged.values())
}

export function buildWorkspaceRoleCardPrompt(input: {
  roleName: string
  description?: string
  chapterNo: number
  chapterTitle?: string
}): string {
  return [
    `角色卡设定图，角色名：${input.roleName}。`,
    input.chapterTitle ? `章节：第${input.chapterNo}章《${input.chapterTitle}》` : `章节：第${input.chapterNo}章。`,
    input.description ? `角色说明：${input.description}` : '',
    '要求：三视图角色卡，空背景或纯背景，不要场景元素，不要文字，不要 logo。',
    '必须稳定呈现角色年龄段、脸型、发型、服饰层次和主体色，适合作为后续分镜与视频连续性锚点。',
  ].filter(Boolean).join('\n')
}

export function buildWorkspaceVisualRefPrompt(input: {
  name: string
  description?: string
  chapterNo: number
  chapterTitle?: string
  category: 'scene_prop' | 'spell_fx'
}): string {
  const visualKind = input.category === 'spell_fx' ? '特效参考图' : '场景/道具参考图'
  return [
    `${visualKind}，名称：${input.name}。`,
    input.chapterTitle ? `章节：第${input.chapterNo}章《${input.chapterTitle}》` : `章节：第${input.chapterNo}章。`,
    input.description ? `剧情说明：${input.description}` : '',
    '要求：主体明确、构图稳定、视觉识别点清晰，适合作为后续分镜和视频片段的复用锚点。',
    input.category === 'spell_fx'
      ? '强调特效形态、运动趋势、材质与发光层次，不要塞入无关环境。'
      : '优先明确空间结构、主体道具轮廓和材质关系，不要漂成泛化插图。',
  ].filter(Boolean).join('\n')
}
