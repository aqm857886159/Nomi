// ProductionRun artifact result enrichment. App-side image bytes are converted into one bounded
// native MCP image block; failures omit the optional field without changing the durable result.
import { buildResultThumbnail, type ThumbnailImageToolkit } from './mcpPreviewImage'

/** App 侧富化夹带的内部字段名（协议/文本层剥离时的单一真相源，别再各处硬写字符串）。 */
export const INTERNAL_ENRICH_FIELDS = ['_nomiThumbnail', '_nomiPreviewUrl'] as const

/**
 * 剥掉 result 上 App 侧富化的内部字段（_nomiThumbnail=缩略图 base64、_nomiPreviewUrl=签名链）。
 * 这俩已各有去处（image content block / widget 预览），绝不该原样进文本或 structuredContent
 *（base64 会灌爆终端、也会在 nomiRunData 里重复一份大 payload）。无这些字段则原样返回（不做多余浅拷贝）。
 */
export function stripInternalEnrichFields(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const obj = result as Record<string, unknown>
  if (!INTERNAL_ENRICH_FIELDS.some((field) => field in obj)) return result
  const clone = { ...obj }
  for (const field of INTERNAL_ENRICH_FIELDS) delete clone[field]
  return clone
}

export type EnrichArtifactDeps = {
  toolkit: ThumbnailImageToolkit
  readFileBytes: (path: string) => Buffer
  /** nomi-local URL → 磁盘绝对路径（真实注入 localProtocol.parseLocalAssetUrl）。 */
  resolveLocalFile: (url: string) => string | null
  maxEdge?: number
  quality?: number
  maxBase64Bytes?: number
}

/**
 * 给一次 nomi_get_artifact 的 artifact 投影富化（返回可能带 _nomiThumbnail 的浅拷贝；不改原对象）。
 * Uses buildResultThumbnail（≤512px / JPEG q60 / ≤64KB / 失败优雅省略 / 非图不出图）。
 * 不铸 _nomiPreviewUrl：artifact 投影本身已带 preview.url（签名 HTTP 链），widget 直接用它，无需再签一份。
 */
export function enrichArtifactResult(result: unknown, deps: EnrichArtifactDeps): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const thumb = buildResultThumbnail(result, {
    toolkit: deps.toolkit,
    readLocalFile: deps.resolveLocalFile,
    readFileBytes: deps.readFileBytes,
    ...(deps.maxEdge !== undefined ? { maxEdge: deps.maxEdge } : {}),
    ...(deps.quality !== undefined ? { quality: deps.quality } : {}),
    ...(deps.maxBase64Bytes !== undefined ? { maxBase64Bytes: deps.maxBase64Bytes } : {}),
  })
  if (!thumb) return result
  return { ...(result as Record<string, unknown>), _nomiThumbnail: thumb }
}
