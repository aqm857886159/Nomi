import i18n from '../../../i18n'

import {
  hostedAssetThumbnailUrl,
  hostedAssetUrl,
  importWorkbenchLocalAssetFile,
  recoverImportedWorkbenchLocalAssetFile,
  type WorkbenchAssetDto,
} from '../../api/assetUploadApi'
import { isProjectImportCancellation, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { surfacePortFailure } from '../../../../electron/shared/surfacePortBinding'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { dropKindFromFile } from '../model/nodeAssetDrop'
import { readVideoDurationSeconds } from '../../../media/videoDurationProbe'
import { getGenerationNodeDefaultSize, getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import { placementOrigin, type CanvasPlacementAnchor } from '../model/canvasPlacement'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  admitMediaImport,
  type MediaImportRejection,
  type StorageCapacity,
} from '../../../../electron/shared/contracts/mediaImportPolicy'
import { readStorageCapacitySnapshot } from '../../assets/storageCapacitySnapshot'
import { ensureAssetImportProgressBridge, useAssetImportProgressStore } from '../store/assetImportProgressStore'

const DATA_URL_FALLBACK_MAX_BYTES = 512 * 1024

export type GenerationAssetImportItem = {
  node: GenerationCanvasNode
  file: File
  kind: 'image' | 'video'
}

/** 被准入闸挡下的一个文件——带机器可读原因与数字，调用方据此说人话（「过大」不可行动）。 */
export type GenerationAssetImportSkip = { fileName: string; rejection: MediaImportRejection }

export type GenerationAssetImportResult = {
  /** Project replacement is a handled cancellation, never an upload failure or fallback request. */
  cancelled?: true
  created: GenerationAssetImportItem[]
  skippedDuplicateCount: number
  /** 准入闸拒收的文件（类型不对 / 硬上限 / 磁盘装不下）。 */
  rejected: GenerationAssetImportSkip[]
  /** 单次拖入超过 MAX_IMPORT_FILES 被截断丢弃的数量（C5：此前静默丢，无任何提示）。 */
  skippedOverLimitCount: number
  /** 上传/落盘失败、最终落 error 态的数量（让调用方提示「N 张导入失败」）。 */
  failedCount: number
}

export type ImportImageFilesOptions = {
  /** 发起导入的那一刻（第一个 await 之前）捕获的原项目生命周期；必传，适配器不再现取当前项目。 */
  projectContext: ProjectExecutionContext
  basePosition: { x: number; y: number }
  categoryId?: string
  createObjectUrl?: (file: File) => string
  revokeObjectUrl?: (url: string) => void
  readImageDimensions?: (url: string) => Promise<ImageDimensions | null>
  readVideoDuration?: (url: string) => Promise<number | null>
  uploadFile?: typeof importWorkbenchLocalAssetFile
  recoverFile?: typeof recoverImportedWorkbenchLocalAssetFile
  exactPosition?: boolean
  /**
   * basePosition 压在第一张卡的哪一点（比例）。不传 = 左上角。拖入传中心：卡的真实尺寸
   * （图片按像素比例）只有这里读完尺寸才知道，所以锚点在这里换算，不在调用方按默认尺寸猜。
   */
  anchor?: CanvasPlacementAnchor
  /** 磁盘余量（省一次 IPC 时可注入；不传则现取）。 */
  capacity?: StorageCapacity | null
}

type ImageDimensions = {
  width: number
  height: number
}

function isValidImageDimensions(value: ImageDimensions | null): value is ImageDimensions {
  return Boolean(
    value &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0,
  )
}

function previewHeightForDimensions(dimensions: ImageDimensions): number {
  const nodeWidth = nodeWidthForDimensions(dimensions)
  const rawHeight = Math.round(nodeWidth * (dimensions.height / dimensions.width))
  return Math.min(520, Math.max(120, rawHeight))
}

function nodeWidthForDimensions(dimensions: ImageDimensions): number {
  const aspectRatio = dimensions.width / dimensions.height
  if (aspectRatio >= 1.75) return 420
  if (aspectRatio <= 0.72) return 260
  return 340
}

function nodeSizeForDimensions(dimensions: ImageDimensions | null): { width: number; height: number } | undefined {
  if (!isValidImageDimensions(dimensions)) return undefined
  return {
    width: nodeWidthForDimensions(dimensions),
    height: previewHeightForDimensions(dimensions) + 188,
  }
}

function imageMetaForDimensions(dimensions: ImageDimensions | null): Record<string, unknown> {
  if (!isValidImageDimensions(dimensions)) return {}
  return {
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    imageAspectRatio: dimensions.width / dimensions.height,
    previewHeight: previewHeightForDimensions(dimensions),
  }
}

/** 画布上看得见的卡面尺寸：图片卡 = 按像素比例的宽 × 预览高；其余用默认卡尺寸。 */
function visibleCardSize(dimensions: ImageDimensions | null): { width: number; height: number } {
  if (!isValidImageDimensions(dimensions)) return getGenerationNodeDefaultSize('asset')
  return { width: nodeWidthForDimensions(dimensions), height: previewHeightForDimensions(dimensions) }
}

function layoutColumns(count: number): number {
  if (count <= 1) return 1
  return Math.min(4, Math.ceil(Math.sqrt(count)))
}

function layoutImportPositions(
  basePosition: { x: number; y: number },
  sizes: Array<{ width: number; height: number } | undefined>,
): Array<{ x: number; y: number }> {
  const columns = layoutColumns(sizes.length)
  const footprints = sizes.map((size) => getGenerationNodeFootprintSize('asset', size))
  const cellWidth = Math.max(...footprints.map((size) => size.width)) + 36
  const cellHeight = Math.max(...footprints.map((size) => size.height)) + 36
  return sizes.map((_, index) => ({
    x: Math.round(basePosition.x + (index % columns) * cellWidth),
    y: Math.round(basePosition.y + Math.floor(index / columns) * cellHeight),
  }))
}

function readBrowserImageDimensions(url: string): Promise<ImageDimensions | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      })
    }
    image.onerror = () => resolve(null)
    image.src = url
  })
}

function fileSignature(file: File): string {
  return [
    file.name || '',
    file.type || '',
    typeof file.size === 'number' ? file.size : 0,
  ].join('|')
}

function deriveLabelFromFileName(fileName: string): string {
  const cleaned = String(fileName || '').replace(/\.[^.]+$/, '').trim()
  return cleaned || i18n.t('generationCommon.defaultTitles.referenceImage')
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (result) resolve(result)
      else reject(new Error('failed to read image data url'))
    }
    reader.onerror = () => reject(new Error('failed to read image data url'))
    reader.readAsDataURL(file)
  })
}

/** 画布素材节点只承载 image / video（无音频节点 archetype）。这条窄化不再写在这里，
 *  由 mediaImportPolicy 的 'generation-canvas' 面声明（带领域理由），此处只负责调它。 */
export function filterImportableMediaFiles(
  files: File[],
  capacity: StorageCapacity | null,
): {
  files: File[]
  skippedDuplicateCount: number
  rejected: GenerationAssetImportSkip[]
} {
  const seen = new Set<string>()
  let skippedDuplicateCount = 0
  const rejected: GenerationAssetImportSkip[] = []
  const out: File[] = []
  for (const file of files) {
    const signature = fileSignature(file)
    if (seen.has(signature)) {
      skippedDuplicateCount += 1
      continue
    }
    seen.add(signature)
    const admission = admitMediaImport(
      'generation-canvas',
      { kind: dropKindFromFile(file), sizeBytes: typeof file.size === 'number' ? file.size : 0 },
      capacity,
    )
    if (!admission.ok) {
      rejected.push({ fileName: file.name || '', rejection: admission })
      continue
    }
    out.push(file)
  }
  return { files: out, skippedDuplicateCount, rejected }
}

type AssetUploadDeps = {
  uploadFile: typeof importWorkbenchLocalAssetFile
  recoverFile: (file: File) => Promise<WorkbenchAssetDto | null>
  probeVideoDuration: (url: string) => Promise<number | null>
}

// 上传失败（无 data-url 兜底）的 File 留存——供节点「重试导入」复用（C3：此前失败即死，只能删了重拖）。
// File 不可持久化故只活在内存，重启即清（重启后节点仍是 error 态，文案引导重新导入）。
const pendingRetryImports = new Map<string, { file: File; kind: 'image' | 'video'; context: ProjectExecutionContext }>()

export function clearPendingRetryImports(): void {
  pendingRetryImports.clear()
}

// 单文件「上传→落节点」的单一实现：初次导入与「重试」共用（P1 不造并行版）。返回 true=成功。
async function uploadAndApplyAssetToNode(
  nodeId: string,
  file: File,
  kind: 'image' | 'video',
  deps: AssetUploadDeps,
  context: ProjectExecutionContext,
): Promise<boolean> {
  context.assertCurrent()
  const store = useGenerationCanvasStore.getState()
  ensureAssetImportProgressBridge()
  let hosted: WorkbenchAssetDto | null
  try {
    hosted = await deps.uploadFile(file, deriveLabelFromFileName(file.name), {
      ownerNodeId: nodeId, projectBinding: context.binding, assertCurrent: context.assertCurrent,
    })
  } catch (error) {
    context.assertCurrent()
    if (surfacePortFailure(error).code !== 'capability_execution_failed') throw error
    hosted = await deps.recoverFile(file)
  }
  context.assertCurrent()
  const hostedUrl = hostedAssetUrl(hosted)
  if (!hostedUrl) {
    // 图片可在极小阈值内退化成 data-url 落盘；视频体积过大不做兜底（报错 + 留 File 供重试）。
    const canPersistSmallFallback = kind === 'image' && (typeof file.size === 'number' ? file.size : 0) <= DATA_URL_FALLBACK_MAX_BYTES
    const fallbackResult = canPersistSmallFallback
      ? { id: `local-${nodeId}-${Date.now()}`, type: 'image' as const, url: await readFileDataUrl(file), createdAt: Date.now() }
      : null
    context.assertCurrent()
    if (fallbackResult) pendingRetryImports.delete(nodeId)
    else pendingRetryImports.set(nodeId, { file, kind, context })
    store.updateNode(nodeId, {
      ...(fallbackResult ? { result: fallbackResult, history: [fallbackResult] } : {}),
      status: fallbackResult ? 'success' : 'error',
      error: fallbackResult ? undefined : '本地素材复制失败，可点节点上的「重试导入」',
      meta: {
        ...(useGenerationCanvasStore.getState().nodes.find((c) => c.id === nodeId)?.meta || {}),
        uploadStatus: 'local-only',
        localOnly: true,
        persistable: Boolean(fallbackResult),
        retryableImport: !fallbackResult,
      },
    })
    // 节点已经换成最终形态（成图/失败卡）才丢进度：先丢会让渐显层提前卸载，闪一帧空卡。
    useAssetImportProgressStore.getState().clear(nodeId)
    return Boolean(fallbackResult)
  }
  const videoDuration = kind === 'video' ? await deps.probeVideoDuration(hostedUrl) : null
  const thumbnailUrl = hostedAssetThumbnailUrl(hosted)
  context.assertCurrent()
  const hostedResult = {
    id: `asset-${nodeId}-${hosted?.id || Date.now()}`,
    type: kind,
    url: hostedUrl,
    // 落盘边界派生的画布预览：4K 导入图/视频在画布上挂 ≤1024 预览或 poster，源留给编辑/导出。
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    assetId: hosted?.id,
    raw: { asset: hosted },
    createdAt: Date.now(),
  }
  pendingRetryImports.delete(nodeId)
  store.updateNode(nodeId, {
    result: hostedResult,
    history: [hostedResult],
    status: 'success',
    meta: {
      ...(useGenerationCanvasStore.getState().nodes.find((c) => c.id === nodeId)?.meta || {}),
      source: 'asset-upload',
      uploadStatus: 'uploaded',
      localOnly: false,
      retryableImport: false,
      serverAssetId: hosted?.id,
      ...(videoDuration && videoDuration > 0 ? { videoDuration } : {}),
    },
  })
  useAssetImportProgressStore.getState().clear(nodeId)
  return true
}

/** 节点「重试导入」：复用留存的 File 重新上传（C3）。无留存（重启/已成功）→ 返回 false。 */
export async function retryLocalAssetImport(nodeId: string): Promise<boolean> {
  const pending = pendingRetryImports.get(nodeId)
  if (!pending) return false
  try {
    pending.context.assertCurrent()
    // 重试导入仍然是「拷文件」，不是「排队等模型」：状态留在 idle，真相在 meta.uploadStatus。
    useGenerationCanvasStore.getState().updateNode(nodeId, {
      status: 'idle',
      error: undefined,
      meta: { ...(useGenerationCanvasStore.getState().nodes.find((c) => c.id === nodeId)?.meta || {}), uploadStatus: 'uploading', retryableImport: false },
    })
    return await uploadAndApplyAssetToNode(nodeId, pending.file, pending.kind, {
      uploadFile: importWorkbenchLocalAssetFile,
      recoverFile: recoverImportedWorkbenchLocalAssetFile,
      probeVideoDuration: readVideoDurationSeconds,
    }, pending.context)
  } catch (error) {
    if (!pending.context.signal.aborted && !isProjectImportCancellation(error)) throw error
    return false
  }
}

export { isProjectImportCancellation }

export async function importLocalMediaFilesToGenerationCanvas(
  inputFiles: File[],
  options: ImportImageFilesOptions,
): Promise<GenerationAssetImportResult> {
  const context = options.projectContext
  try {
    context.assertCurrent()
    return await importFilesInProject(inputFiles, options, context)
  } catch (error) {
    if (!context.signal.aborted && !isProjectImportCancellation(error)) throw error
    return { cancelled: true, created: [], skippedDuplicateCount: 0, rejected: [], skippedOverLimitCount: 0, failedCount: 0 }
  }
}

async function importFilesInProject(
  inputFiles: File[],
  options: ImportImageFilesOptions,
  context: ProjectExecutionContext,
): Promise<GenerationAssetImportResult> {
  const createObjectUrl = options.createObjectUrl ?? ((file: File) => URL.createObjectURL(file))
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url))
  const readImageDimensions = options.readImageDimensions ?? readBrowserImageDimensions
  const probeVideoDuration = options.readVideoDuration ?? readVideoDurationSeconds
  const uploadFile = options.uploadFile ?? importWorkbenchLocalAssetFile
  const recoverFile = options.recoverFile ?? recoverImportedWorkbenchLocalAssetFile
  const capacity = options.capacity !== undefined ? options.capacity : await readStorageCapacitySnapshot(context.binding.projectId)
  context.assertCurrent()
  const filtered = filterImportableMediaFiles(inputFiles, capacity)
  const created: GenerationAssetImportItem[] = []
  // 单次拖入上限：超出截断（C5：此前 .slice(0,8) 静默丢，无提示）。
  const MAX_IMPORT_FILES = 8
  const accepted = filtered.files.slice(0, MAX_IMPORT_FILES)
  const skippedOverLimitCount = filtered.files.length - accepted.length
  if (!accepted.length) {
    return {
      created,
      skippedDuplicateCount: filtered.skippedDuplicateCount,
      rejected: filtered.rejected,
      skippedOverLimitCount,
      failedCount: 0,
    }
  }

  const prepared = await Promise.all(accepted.map(async (file) => {
    const kind = dropKindFromFile(file) === 'video' ? 'video' as const : 'image' as const
    // 视频不在导入时离屏读尺寸（节点渲染的 onLoadedMetadata 会回填 W/H + 真实时长，单源 catch-all）；
    // 图片仍即时读尺寸以定节点初始大小。
    let dimensions: ImageDimensions | null = null
    if (kind === 'image') {
      const objectUrl = createObjectUrl(file)
      try { dimensions = await readImageDimensions(objectUrl) }
      finally { revokeObjectUrl(objectUrl) }
      context.assertCurrent()
    }
    const size = nodeSizeForDimensions(dimensions)
    return { file, kind, dimensions, size }
  }))
  context.assertCurrent()
  const positions = layoutImportPositions(
    options.anchor
      ? placementOrigin({ point: options.basePosition, anchor: options.anchor }, visibleCardSize(prepared[0]?.dimensions ?? null))
      : options.basePosition,
    prepared.map((item) => item.size),
  )

  prepared.forEach(({ dimensions, file, kind, size }, index) => {
    context.assertCurrent()
    const node = useGenerationCanvasStore.getState().addNode({
      kind: 'asset',
      title:
        file.name ||
        i18n.t(
          kind === 'video'
            ? 'generationCommon.defaultTitles.referenceVideo'
            : 'generationCommon.defaultTitles.referenceImage',
        ),
      prompt: '',
      position: positions[index],
      categoryId: options.categoryId,
      exactPosition: options.exactPosition,
    })
    context.assertCurrent()
    useGenerationCanvasStore.getState().updateNode(node.id, {
      ...(size ? { size } : {}),
      // 'queued' 是生成词表里的「排队等模型」；导入只是在拷文件，套上它整套生成过程反馈就会误挂上来。
      // 导入中的唯一真相是 meta.uploadStatus:'uploading'。
      status: 'idle',
      meta: {
        ...(node.meta || {}),
        source: 'local-drop',
        fileName: file.name,
        uploadStatus: 'uploading',
        ...imageMetaForDimensions(dimensions),
      },
    }, { persist: false })
    created.push({ node, file, kind })
  })

  let failedCount = 0
  await Promise.all(created.map(async ({ node, file, kind }) => {
    const ok = await uploadAndApplyAssetToNode(node.id, file, kind, { uploadFile, recoverFile, probeVideoDuration }, context)
    if (!ok) failedCount += 1
  }))

  return {
    created,
    skippedDuplicateCount: filtered.skippedDuplicateCount,
    rejected: filtered.rejected,
    skippedOverLimitCount,
    failedCount,
  }
}
