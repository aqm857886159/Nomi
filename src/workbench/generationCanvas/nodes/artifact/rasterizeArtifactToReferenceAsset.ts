// 「固化为参考图」：agent-artifact 的 SVG 产物 → 栅格化成 PNG → 落成画布 asset 节点。
//
// 为什么需要它：参考消费链路（generationReferenceResolver / referenceSlots）统一从
// `node.result.url` 取图（referenceUrl.ts 的 resultUrl），不读 meta.artifact——所以 SVG 手绘产物
// 要能被下游当参考图连线，必须有一个 result.url = PNG 的 asset 节点。本模块就是那条桥：
//   SVG 文本 → <img> 载入 → canvas 栅格化 → PNG blob → importWorkbenchLocalAssetFile 落盘 →
//   addNode(kind:'asset') + updateNode(result:{type:'image', url})。
//
// 安全：只栅格化 SVG（无脚本执行面——<img> 渲染 SVG 不执行内联 script）；内容来自 Agent 交付且
// 无外部引用。glb/markdown/table/html 的"参考化"语义不同（3D 截图 / 渲染帧），P1。
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import type { AgentArtifactMeta } from '../../model/artifactMeta'
import type { WorkbenchAssetDto } from '../../../api/assetUploadApi'
import { hostedAssetUrl } from '../../../api/assetUploadApi'

export type ReferenceAssetDeps = {
  /** 从产物 URL 取文件文本（nomi-local:// 可 fetch）。 */
  readText: (url: string) => Promise<string>
  /** SVG 文本 → 栅格化 PNG blob（依赖注入，node 单测不碰 canvas）。 */
  rasterizeSvgToPngBlob: (svgText: string) => Promise<Blob | null>
  /** 落盘资产。真实实现 importWorkbenchLocalAssetFile。 */
  uploadFile: (file: File, name?: string) => Promise<WorkbenchAssetDto>
}

const realDeps: ReferenceAssetDeps = {
  readText: (url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`read-failed:${response.status}`)
    return response.text()
  }),
  rasterizeSvgToPngBlob: async (svgText) => {
    const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('rasterize-failed'))
        image.src = blobUrl
      })
      const img = await loaded
      // 从 SVG 的 viewBox/宽高取画布尺寸；无尺寸信息回退默认（构图线稿常用 16:9 或 4:3）。
      const naturalWidth = img.naturalWidth || 960
      const naturalHeight = img.naturalHeight || 540
      const scale = Math.min(1, 4096 / Math.max(naturalWidth, naturalHeight)) // 防超大图撑爆 canvas
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // 白底（透明 SVG 落 PNG 时在浅色画布上看不见线稿；参考图喂模型也常要实体底）。
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  },
  uploadFile: async (file, name) => {
    const { importWorkbenchLocalAssetFile } = await import('../../../api/assetUploadApi')
    return importWorkbenchLocalAssetFile(file, name)
  },
}

export type RasterizeArtifactResult =
  | { ok: true; nodeId: string; url: string }
  | { ok: false; reason: string }

/** 把 agent-artifact 的 SVG 产物固化成画布参考图（asset 节点）。依赖注入便于单测。 */
export async function rasterizeArtifactToReferenceAsset(
  artifact: AgentArtifactMeta,
  deps: ReferenceAssetDeps = realDeps,
): Promise<RasterizeArtifactResult> {
  if (artifact.fileType !== 'svg') {
    return { ok: false, reason: `unsupported-file-type:${artifact.fileType}` }
  }
  let svgText: string
  try {
    svgText = await deps.readText(artifact.url)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'read-failed' }
  }
  let pngBlob: Blob | null
  try {
    pngBlob = await deps.rasterizeSvgToPngBlob(svgText)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'rasterize-failed' }
  }
  if (!pngBlob) return { ok: false, reason: 'rasterize-failed' }

  const baseName = artifactFileNameFallback(artifact.url) || '参考图'
  const pngFile = new File([pngBlob], `${baseName}.png`, { type: 'image/png' })
  let asset: WorkbenchAssetDto
  try {
    asset = await deps.uploadFile(pngFile, pngFile.name)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'upload-failed' }
  }
  const hostedUrl = hostedAssetUrl(asset)
  if (!hostedUrl) return { ok: false, reason: 'no-hosted-url' }

  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({
    kind: 'asset',
    title: pngFile.name,
    prompt: '',
    categoryId: 'shots',
  })
  const hostedResult = {
    id: `ref-${node.id}`,
    type: 'image' as const,
    url: hostedUrl,
    assetId: asset.id,
    raw: { asset },
    createdAt: Date.now(),
  }
  store.updateNode(node.id, {
    result: hostedResult,
    history: [hostedResult],
    status: 'success',
    meta: { ...(node.meta || {}), source: 'artifact-reference', fileName: pngFile.name },
  })
  return { ok: true, nodeId: node.id, url: hostedUrl }
}

/** 从产物 URL 取文件名（去目录去扩展名；空则空串）。 */
function artifactFileNameFallback(url: string): string {
  const cleaned = url.replace(/^.*\/(?=[^/]*$)/, '').replace(/\.svg$/i, '')
  return cleaned && cleaned !== 'asset' ? cleaned : ''
}
