// 素材面收敛一次性迁移（2026-07-22 方案一重执行）。
// 旧素材盒把提示词卡记在 per-project localStorage 私账（`nomi.browser.asset-library.v1:<pid>`），
// 与主提示词库互不相通、顶栏浮窗恒空。本迁移把各桶 promptCards 幂等并入主库「我的库」：
// - 去重键 = title+prompt（连续启动/多桶重复不产生重复条目）
// - 成功桶写 migrated 标记；**原桶数据保留不删**（降版本回滚可无损读回）
// - 自定义分类经桶内 promptCategories 映射成 tags；promptType 归一 image|video
// 文件夹/软删的迁移属切片 C/D，各用独立标记，互不影响。
import { addUserPrompt, fetchUserPrompts, type PromptMediaType, type PromptReferenceImage } from '../api/promptLibraryApi'
import { getDesktopBridge, type DesktopAssetFoldersState } from '../../desktop/bridge'
import { logRendererError } from '../../desktop/rendererLog'

export const LEGACY_BUCKET_PREFIX = 'nomi.browser.asset-library.v1:'
export const PROMPTS_MIGRATED_PREFIX = 'nomi.browser.asset-library.migrated-prompts.v1:'
export const FOLDERS_MIGRATED_PREFIX = 'nomi.browser.asset-library.migrated-folders.v1:'

type LegacyPromptCard = {
  title: string
  prompt: string
  promptType: PromptMediaType
  tags: string[]
  referenceImages: PromptReferenceImage[]
}

export type LegacyPromptMigrationDeps = {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>
  listExistingPrompts: () => Promise<{ title: string; prompt: string }[]>
  addPrompt: (input: {
    title?: string
    prompt: string
    promptType: PromptMediaType
    tags?: string[]
    referenceImages?: PromptReferenceImage[]
  }) => Promise<unknown>
  now?: () => string
}

export type LegacyPromptMigrationResult = {
  scannedBuckets: number
  migratedPrompts: number
  duplicatesSkipped: number
  errors: number
}

function dedupeKey(title: string, prompt: string): string {
  return `${title.trim()}\0${prompt.trim()}`
}

export function collectLegacyBucketKeys(storage: LegacyPromptMigrationDeps['storage']): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key && key.startsWith(LEGACY_BUCKET_PREFIX)) keys.push(key)
  }
  return keys
}

/** 宽松解析旧桶的 promptCards（旧数据形状经 normalize 版本演化，只认最小可迁字段）。 */
export function parseLegacyPromptCards(rawBucket: string | null): LegacyPromptCard[] {
  if (!rawBucket) return []
  try {
    const parsed = JSON.parse(rawBucket) as {
      promptCards?: unknown
      promptCategories?: unknown
    }
    const categories = Array.isArray(parsed.promptCategories)
      ? new Map(
          (parsed.promptCategories as { id?: unknown; label?: unknown }[])
            .filter((category) => typeof category?.id === 'string' && typeof category?.label === 'string')
            .map((category) => [String(category.id), String(category.label)]),
        )
      : new Map<string, string>()
    if (!Array.isArray(parsed.promptCards)) return []
    const cards: LegacyPromptCard[] = []
    for (const raw of parsed.promptCards as { title?: unknown; promptCard?: { prompt?: unknown; promptType?: unknown; referenceImages?: unknown } }[]) {
      const card = raw?.promptCard
      const prompt = typeof card?.prompt === 'string' ? card.prompt.trim() : ''
      if (!prompt) continue
      const rawType = typeof card?.promptType === 'string' ? card.promptType : 'image'
      const promptType: PromptMediaType = rawType === 'video' ? 'video' : 'image'
      const tags = ['素材盒迁移']
      const categoryLabel = categories.get(rawType)
      if (categoryLabel && rawType !== 'image' && rawType !== 'video') tags.push(categoryLabel)
      const referenceImages: PromptReferenceImage[] = Array.isArray(card?.referenceImages)
        ? (card.referenceImages as { url?: unknown; title?: unknown; sourceUrl?: unknown }[])
            .filter((reference) => typeof reference?.url === 'string' && reference.url)
            .map((reference) => ({
              url: String(reference.url),
              ...(typeof reference.title === 'string' && reference.title ? { title: reference.title } : {}),
              ...(typeof reference.sourceUrl === 'string' && reference.sourceUrl ? { sourceUrl: reference.sourceUrl } : {}),
            }))
        : []
      cards.push({
        title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : prompt.slice(0, 24),
        prompt,
        promptType,
        tags,
        referenceImages,
      })
    }
    return cards
  } catch {
    return []
  }
}

/** 核心迁移（依赖注入，纯逻辑可单测）。桶内任一条失败则不写该桶标记（下次启动重试），已迁条目靠去重键不重复。 */
export async function migrateLegacyPromptCards(deps: LegacyPromptMigrationDeps): Promise<LegacyPromptMigrationResult> {
  const { storage, listExistingPrompts, addPrompt } = deps
  const result: LegacyPromptMigrationResult = { scannedBuckets: 0, migratedPrompts: 0, duplicatesSkipped: 0, errors: 0 }
  const bucketKeys = collectLegacyBucketKeys(storage).filter((key) => {
    const bucketId = key.slice(LEGACY_BUCKET_PREFIX.length)
    return !storage.getItem(`${PROMPTS_MIGRATED_PREFIX}${bucketId}`)
  })
  if (bucketKeys.length === 0) return result
  const seen = new Set<string>()
  try {
    for (const existing of await listExistingPrompts()) seen.add(dedupeKey(existing.title, existing.prompt))
  } catch {
    // 主库读不到时宁可跳过本轮（下次启动重试），不盲迁造重复。
    result.errors += 1
    return result
  }
  for (const bucketKey of bucketKeys) {
    result.scannedBuckets += 1
    const bucketId = bucketKey.slice(LEGACY_BUCKET_PREFIX.length)
    const cards = parseLegacyPromptCards(storage.getItem(bucketKey))
    let bucketFailed = false
    for (const card of cards) {
      const key = dedupeKey(card.title, card.prompt)
      if (seen.has(key)) {
        result.duplicatesSkipped += 1
        continue
      }
      try {
        await addPrompt({
          title: card.title,
          prompt: card.prompt,
          promptType: card.promptType,
          tags: card.tags,
          referenceImages: card.referenceImages,
        })
        seen.add(key)
        result.migratedPrompts += 1
      } catch {
        bucketFailed = true
        result.errors += 1
      }
    }
    if (!bucketFailed) {
      storage.setItem(`${PROMPTS_MIGRATED_PREFIX}${bucketId}`, (deps.now?.() ?? new Date().toISOString()))
    }
  }
  return result
}

// —— 文件夹迁移（切片C）：localStorage 桶 folders+folderAssignments → per-project .nomi/folders.json ——

export type LegacyFolderBucket = {
  folders: { id: string; label: string }[]
  /** renderUrl → folderId（旧键形态 `url:<previewUrl>` 才可映射;`id:`/`prompt:` 键丢弃并计数）。 */
  assignments: Record<string, string>
  droppedAssignmentKeys: number
}

/** 宽松解析旧桶文件夹（旧模型支持嵌套 parentFolderId,新模型拍平为顶层,层级信息不保留）。 */
export function parseLegacyFolders(rawBucket: string | null): LegacyFolderBucket {
  const empty: LegacyFolderBucket = { folders: [], assignments: {}, droppedAssignmentKeys: 0 }
  if (!rawBucket) return empty
  try {
    const parsed = JSON.parse(rawBucket) as { folders?: unknown; folderAssignments?: unknown }
    const folders = Array.isArray(parsed.folders)
      ? (parsed.folders as { id?: unknown; title?: unknown; type?: unknown }[])
          .filter((folder) => folder?.type === 'folder' && typeof folder.id === 'string' && typeof folder.title === 'string' && folder.title.trim())
          .map((folder) => ({ id: String(folder.id), label: String(folder.title).trim() }))
      : []
    const folderIds = new Set(folders.map((folder) => folder.id))
    const assignments: Record<string, string> = {}
    let dropped = 0
    if (parsed.folderAssignments && typeof parsed.folderAssignments === 'object') {
      for (const [key, value] of Object.entries(parsed.folderAssignments as Record<string, unknown>)) {
        if (typeof value !== 'string' || !folderIds.has(value)) continue
        if (key.startsWith('url:')) assignments[key.slice(4)] = value
        else dropped += 1
      }
    }
    return { folders, assignments, droppedAssignmentKeys: dropped }
  } catch {
    return empty
  }
}

export type LegacyFolderMigrationDeps = {
  storage: LegacyPromptMigrationDeps['storage']
  /** 项目不存在（如 'global' 桶）返回 null → 该桶跳过并计数。 */
  getFolders: (projectId: string) => Promise<DesktopAssetFoldersState | null>
  saveFolders: (projectId: string, state: DesktopAssetFoldersState) => Promise<boolean>
  now?: () => string
}

export type LegacyFolderMigrationResult = {
  scannedBuckets: number
  migratedFolders: number
  migratedAssignments: number
  unmappableBuckets: number
  droppedAssignmentKeys: number
  errors: number
}

/** 合并语义：同 id 文件夹跳过、已有归属不覆盖（幂等 + 不毁现有数据）。 */
export async function migrateLegacyFolders(deps: LegacyFolderMigrationDeps): Promise<LegacyFolderMigrationResult> {
  const { storage, getFolders, saveFolders } = deps
  const result: LegacyFolderMigrationResult = {
    scannedBuckets: 0,
    migratedFolders: 0,
    migratedAssignments: 0,
    unmappableBuckets: 0,
    droppedAssignmentKeys: 0,
    errors: 0,
  }
  const bucketKeys = collectLegacyBucketKeys(storage).filter((key) => {
    const bucketId = key.slice(LEGACY_BUCKET_PREFIX.length)
    return !storage.getItem(`${FOLDERS_MIGRATED_PREFIX}${bucketId}`)
  })
  for (const bucketKey of bucketKeys) {
    result.scannedBuckets += 1
    const projectId = bucketKey.slice(LEGACY_BUCKET_PREFIX.length)
    const legacy = parseLegacyFolders(storage.getItem(bucketKey))
    result.droppedAssignmentKeys += legacy.droppedAssignmentKeys
    if (legacy.folders.length === 0 && Object.keys(legacy.assignments).length === 0) {
      storage.setItem(`${FOLDERS_MIGRATED_PREFIX}${projectId}`, deps.now?.() ?? new Date().toISOString())
      continue
    }
    try {
      const current = await getFolders(projectId)
      if (!current) {
        // 项目定位不到（'global' 桶/已删项目）：无家可归,丢弃并计数（诚实标注,原桶仍保留）。
        result.unmappableBuckets += 1
        storage.setItem(`${FOLDERS_MIGRATED_PREFIX}${projectId}`, deps.now?.() ?? new Date().toISOString())
        continue
      }
      const existingIds = new Set(current.folders.map((folder) => folder.id))
      const mergedFolders = [...current.folders]
      for (const folder of legacy.folders) {
        if (existingIds.has(folder.id)) continue
        mergedFolders.push({ id: folder.id, label: folder.label, order: mergedFolders.length })
        existingIds.add(folder.id)
        result.migratedFolders += 1
      }
      const mergedAssignments = { ...current.assignments }
      for (const [renderUrl, folderId] of Object.entries(legacy.assignments)) {
        if (mergedAssignments[renderUrl]) continue
        mergedAssignments[renderUrl] = folderId
        result.migratedAssignments += 1
      }
      const saved = await saveFolders(projectId, { version: 1, folders: mergedFolders, assignments: mergedAssignments })
      if (saved) {
        storage.setItem(`${FOLDERS_MIGRATED_PREFIX}${projectId}`, deps.now?.() ?? new Date().toISOString())
      } else {
        result.errors += 1
      }
    } catch {
      result.errors += 1
    }
  }
  return result
}

let migrationStarted = false

/** 应用启动时跑一次（幂等，重复调用/重复启动都安全）。桌面运行时不在（纯 web 预览）则跳过。 */
export function runAssetSurfaceMigrations(): void {
  if (migrationStarted) return
  migrationStarted = true
  if (typeof window === 'undefined') return
  const bridge = getDesktopBridge()
  if (bridge?.promptLibrary) {
    void migrateLegacyPromptCards({
      storage: window.localStorage,
      listExistingPrompts: () => fetchUserPrompts(),
      addPrompt: (input) => addUserPrompt(input),
    })
      .then((result) => {
        if (result.migratedPrompts > 0 || result.errors > 0) {
          console.info('[nomi:migration] 素材盒提示词卡并入主提示词库:', JSON.stringify(result))
        }
      })
      .catch((error) => {
        logRendererError('asset-prompt-card-migration-failed', error)
      })
  }
  if (bridge?.assets?.foldersGet && bridge?.assets?.foldersSave) {
    void migrateLegacyFolders({
      storage: window.localStorage,
      getFolders: async (projectId) => {
        const result = await bridge.assets.foldersGet!({ projectId })
        return result?.ok ? result.state : null
      },
      saveFolders: async (projectId, state) => {
        const result = await bridge.assets.foldersSave!({ projectId, state })
        return Boolean(result?.ok)
      },
    })
      .then((result) => {
        if (result.migratedFolders > 0 || result.unmappableBuckets > 0 || result.errors > 0) {
          console.info('[nomi:migration] 素材盒文件夹转正进素材库:', JSON.stringify(result))
        }
      })
      .catch((error) => {
        logRendererError('asset-folder-migration-failed', error)
      })
  }
}
