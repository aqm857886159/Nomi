export type ReferenceAssetInput = {
  assetId?: string | null
  assetRefId?: string | null
  url?: string | null
  role?: string | null
  note?: string | null
  name?: string | null
}

export type DynamicReferenceEntry = {
  url: string
  label: string
  assetId?: string | null
  name?: string | null
}

export type NamedReferenceEntry = {
  label: string
  sourceUrl: string
  assetId?: string
  note?: string
}

export type MergedReferenceSheet = {
  url: string
  sourceUrls: string[]
  entries: NamedReferenceEntry[]
}

type MergeReferenceAssetInputsOptions = {
  assetInputs?: unknown
  dynamicEntries?: readonly DynamicReferenceEntry[]
  referenceImages?: readonly string[]
  limit?: number
}

type BuildNamedReferenceEntriesOptions = {
  assetInputs?: readonly ReferenceAssetInput[]
  referenceImages?: readonly string[]
  fallbackPrefix: string
  limit?: number
}

type UploadMergedReferenceSheetOptions = {
  entries: readonly NamedReferenceEntry[]
}

type AppendReferenceAliasSlotPromptOptions = {
  prompt: string
  assetInputs: readonly ReferenceAssetInput[]
  referenceImages: readonly string[]
  enabled: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeReferenceAssetInput(input: unknown): ReferenceAssetInput | null {
  const record = asRecord(input)
  if (!record) return null
  const url = readTrimmedString(record.url)
  if (!url) return null
  const assetId = readTrimmedString(record.assetId)
  const assetRefId = readTrimmedString(record.assetRefId)
  const role = readTrimmedString(record.role)
  const note = readTrimmedString(record.note)
  const name = readTrimmedString(record.name)
  return {
    url,
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    ...(role ? { role } : {}),
    ...(note ? { note } : {}),
    ...(name ? { name } : {}),
  }
}

function buildReferenceLabel(input: {
  assetRefId?: string | null
  name?: string | null
  fallbackPrefix: string
  index: number
}): string {
  const raw = readTrimmedString(input.assetRefId) || readTrimmedString(input.name)
  const normalized = raw
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return normalized || `${input.fallbackPrefix}_${input.index + 1}`
}

export function mergeReferenceAssetInputs(options: MergeReferenceAssetInputsOptions): ReferenceAssetInput[] {
  const limit = Math.max(1, Math.trunc(options.limit || 8))
  const merged: ReferenceAssetInput[] = []
  const seenUrls = new Set<string>()

  const append = (input: unknown) => {
    const normalized = normalizeReferenceAssetInput(input)
    if (!normalized?.url || seenUrls.has(normalized.url)) return
    seenUrls.add(normalized.url)
    merged.push(normalized)
  }

  if (Array.isArray(options.assetInputs)) {
    options.assetInputs.forEach(append)
  }
  if (Array.isArray(options.dynamicEntries)) {
    options.dynamicEntries.forEach((entry) => append({
      url: entry.url,
      assetId: entry.assetId || '',
      assetRefId: entry.label,
      name: entry.name || entry.label,
      role: 'reference',
    }))
  }
  if (Array.isArray(options.referenceImages)) {
    options.referenceImages.forEach((url, index) => append({
      url,
      assetRefId: `${index + 1}`,
      role: 'reference',
    }))
  }

  return merged.slice(0, limit)
}

export function buildNamedReferenceEntries(options: BuildNamedReferenceEntriesOptions): NamedReferenceEntry[] {
  const assetInputs = mergeReferenceAssetInputs({
    assetInputs: options.assetInputs,
    referenceImages: options.referenceImages,
    limit: options.limit,
  })
  return assetInputs.map((input, index) => ({
    label: buildReferenceLabel({
      assetRefId: input.assetRefId,
      name: input.name,
      fallbackPrefix: options.fallbackPrefix,
      index,
    }),
    sourceUrl: String(input.url || '').trim(),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(input.note ? { note: input.note } : {}),
  }))
}

export async function uploadMergedReferenceSheet(
  options: UploadMergedReferenceSheetOptions,
): Promise<MergedReferenceSheet | null> {
  if (options.entries.length <= 1) return null
  throw new Error('多参考图合并尚未接入明确的 reference sheet 服务，禁止静默跳过。')
}

export function appendReferenceAliasSlotPrompt(options: AppendReferenceAliasSlotPromptOptions): string {
  const prompt = String(options.prompt || '').trim()
  if (!options.enabled || options.referenceImages.length === 0) return prompt
  const entries = buildNamedReferenceEntries({
    assetInputs: options.assetInputs,
    referenceImages: options.referenceImages,
    fallbackPrefix: 'ref',
    limit: options.referenceImages.length,
  })
  if (!entries.length) return prompt
  const lines = entries.map((entry, index) => {
    const slotNo = index + 1
    return `参考图 ${slotNo} = @${entry.label}`
  })
  return [prompt, `参考图绑定：\n${lines.join('\n')}`].filter(Boolean).join('\n\n')
}
