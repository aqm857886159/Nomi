import {
  recoverUploadedWorkbenchServerAssetFile,
  uploadWorkbenchServerAssetFile,
  type ServerAssetDto,
} from '../../api/assetUploadApi'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export const GENERATION_CANVAS_IMAGE_IMPORT_MAX_BYTES = 30 * 1024 * 1024

export type GenerationAssetImportItem = {
  node: GenerationCanvasNode
  file: File
  localUrl: string
}

export type GenerationAssetImportResult = {
  created: GenerationAssetImportItem[]
  skippedDuplicateCount: number
  skippedTooLargeCount: number
}

export type ImportImageFilesOptions = {
  basePosition: { x: number; y: number }
  createObjectUrl?: (file: File) => string
  revokeObjectUrl?: (url: string) => void
  readImageDimensions?: (url: string) => Promise<ImageDimensions | null>
  uploadFile?: typeof uploadWorkbenchServerAssetFile
  recoverFile?: typeof recoverUploadedWorkbenchServerAssetFile
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
  return cleaned || '参考图片'
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

function getHostedUrl(asset: ServerAssetDto | null | undefined): string {
  return typeof asset?.data?.url === 'string' ? asset.data.url.trim() : ''
}

export function filterImportableImageFiles(files: File[]): {
  files: File[]
  skippedDuplicateCount: number
  skippedTooLargeCount: number
} {
  const seen = new Set<string>()
  let skippedDuplicateCount = 0
  let skippedTooLargeCount = 0
  const out: File[] = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const signature = fileSignature(file)
    if (seen.has(signature)) {
      skippedDuplicateCount += 1
      continue
    }
    seen.add(signature)
    if ((typeof file.size === 'number' ? file.size : 0) > GENERATION_CANVAS_IMAGE_IMPORT_MAX_BYTES) {
      skippedTooLargeCount += 1
      continue
    }
    out.push(file)
  }
  return { files: out, skippedDuplicateCount, skippedTooLargeCount }
}

export async function importImageFilesToGenerationCanvas(
  inputFiles: File[],
  options: ImportImageFilesOptions,
): Promise<GenerationAssetImportResult> {
  const createObjectUrl = options.createObjectUrl ?? ((file: File) => URL.createObjectURL(file))
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url))
  const readImageDimensions = options.readImageDimensions ?? readBrowserImageDimensions
  const uploadFile = options.uploadFile ?? uploadWorkbenchServerAssetFile
  const recoverFile = options.recoverFile ?? recoverUploadedWorkbenchServerAssetFile
  const filtered = filterImportableImageFiles(inputFiles)
  const created: GenerationAssetImportItem[] = []

  await Promise.all(filtered.files.slice(0, 8).map(async (file, index) => {
    const localUrl = createObjectUrl(file)
    const dimensions = await readImageDimensions(localUrl)
    const persistableUrl = await readFileDataUrl(file)
    const size = nodeSizeForDimensions(dimensions)
    const node = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: file.name || '参考图片',
      prompt: '',
      position: {
        x: Math.max(40, Math.round(options.basePosition.x + index * 28)),
        y: Math.max(40, Math.round(options.basePosition.y + index * 28)),
      },
    })
    const result = {
      id: `local-${node.id}-${Date.now()}`,
      type: 'image' as const,
      url: persistableUrl,
      createdAt: Date.now(),
    }
    useGenerationCanvasStore.getState().updateNode(node.id, {
      result,
      history: [result],
      ...(size ? { size } : {}),
      status: 'success',
      meta: {
        ...(node.meta || {}),
        source: 'local-drop',
        fileName: file.name,
        localOnly: true,
        uploadStatus: 'uploading',
        ...imageMetaForDimensions(dimensions),
      },
    })
    created.push({ node, file, localUrl })
  }))

  await Promise.all(created.map(async ({ node, file, localUrl }) => {
    let hosted: ServerAssetDto | null = null
    try {
      hosted = await uploadFile(file, deriveLabelFromFileName(file.name), { ownerNodeId: node.id })
    } catch {
      hosted = await recoverFile(file)
    }
    const hostedUrl = getHostedUrl(hosted)
    if (!hostedUrl) {
      useGenerationCanvasStore.getState().updateNode(node.id, {
        meta: {
          ...(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)?.meta || {}),
          uploadStatus: 'local-only',
          localOnly: true,
        },
      })
      return
    }
    const hostedResult = {
      id: `asset-${node.id}-${hosted?.id || Date.now()}`,
      type: 'image' as const,
      url: hostedUrl,
      assetId: hosted?.id,
      raw: { asset: hosted },
      createdAt: Date.now(),
    }
    useGenerationCanvasStore.getState().updateNode(node.id, {
      result: hostedResult,
      history: [hostedResult],
      status: 'success',
      meta: {
        ...(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)?.meta || {}),
        source: 'asset-upload',
        uploadStatus: 'uploaded',
        localOnly: false,
        serverAssetId: hosted?.id,
      },
    })
    revokeObjectUrl(localUrl)
  }))

  return {
    created,
    skippedDuplicateCount: filtered.skippedDuplicateCount,
    skippedTooLargeCount: filtered.skippedTooLargeCount,
  }
}
