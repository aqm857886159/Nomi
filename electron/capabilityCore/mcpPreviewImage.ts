// 交付② · MCP 结果缩略图（Electron 侧生成，纯逻辑经注入桩单测）。
//
// 为什么在这层、为什么可注入：缩略必须用 Electron 的 nativeImage（launcher 是 bare node，禁新依赖），
// 故落在 RPC 结果边界的 App 进程里（rpcServer / stdioServer 进程内 dispatch 之后）。base64 搭 result JSON
// 过河，纯逻辑的 mcpProtocol 只读它拼 content block（不碰 electron，守其纯逻辑单测边界）。
// nativeImage / 读文件 / URL→路径解析全注入 → 本模块自身可裸 node 单测（house 惯例：runTask/now 皆注入）。
//
// 铁律（brief 硬约束）：只取首/主图资产、长边 ≤512、JPEG q≈60、base64 硬顶 ~64KB；任何失败（解析不到 /
// 空图 / 超顶 / 视频无 poster）一律优雅省略（返回 null），绝不塞超大 payload、绝不做视频抽帧。

/** nativeImage 的最小面（只用到这几个 API）。真实注入 electron.nativeImage。 */
export type ThumbnailImage = {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width?: number; height?: number; quality?: string }): ThumbnailImage
  toJPEG(quality: number): Buffer
}
export type ThumbnailImageToolkit = {
  createFromPath(path: string): ThumbnailImage
  createFromBuffer(buffer: Buffer): ThumbnailImage
}

export type ThumbnailBlock = { data: string; mimeType: 'image/jpeg' }

export type BuildThumbnailDeps = {
  toolkit: ThumbnailImageToolkit
  /** URL（nomi-local://…）→ 磁盘绝对路径；解析失败/非本地 → null。真实注入 localProtocol.parseLocalAssetUrl。 */
  readLocalFile: (url: string) => string | null
  /** 读磁盘文件字节（可抛，文件消失时）。真实注入 fs.readFileSync。 */
  readFileBytes: (path: string) => Buffer
  /** 长边上限（px），默认 512。 */
  maxEdge?: number
  /** JPEG 质量 0-100，默认 60。 */
  quality?: number
  /** base64 payload 硬顶（字符数），默认 64KB。超过 → 省略。 */
  maxBase64Bytes?: number
}

const DEFAULT_MAX_EDGE = 512
const DEFAULT_QUALITY = 60
const DEFAULT_MAX_BASE64 = 64 * 1024

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 从 result 里挑出「拿来当缩略图的那张图的本地 URL」：
 * - 生成结果：assets[0]；图 → 用 url；视频 → 仅当有 thumbnailUrl(poster) 才用，否则不出图（不抽帧）。
 * - artifact 投影：preview.url（图片本地链）。
 * 只认单张主资产（brief：一个结果一张缩略图）。
 */
export function pickThumbnailSourceUrl(result: unknown): string | null {
  const value = rec(result)
  const assets = Array.isArray(value.assets) ? (value.assets as Array<Record<string, unknown>>) : []
  const primary = assets[0]
  if (primary) {
    const type = str(primary.type)
    if (type === 'video') {
      // 视频只在有现成 poster 图时出块（本任务不做视频抽帧）。
      const poster = str(primary.thumbnailUrl)
      return poster || null
    }
    // 图/音频/其它：thumbnailUrl 优先（图生成后 = 本地图链），否则 url。音频最终会因非图字节被 nativeImage 判空 → null。
    return str(primary.thumbnailUrl) || str(primary.url) || null
  }
  // artifact 投影：视频只认显式 poster（避免把 mp4 交给 nativeImage）；图片/其它产物兼容 preview。
  // 优先 nomiUrl（恒为 nomi-local://production-preview/… 可解析到磁盘）；preview.url 是签名 HTTP 链，
  // readLocalFile 解不了它——故只当 nomiUrl 缺失时回退 url。
  const preview = rec(value.poster)
  const previewUrl = str(preview.nomiUrl) || str(preview.url)
  if (previewUrl) return previewUrl
  const fallbackPreview = rec(value.preview)
  const fallbackUrl = str(fallbackPreview.nomiUrl) || str(fallbackPreview.url)
  if (fallbackUrl && str(value.kind) !== 'video') return fallbackUrl
  return null
}

/**
 * 生成一张 ≤512px 长边、JPEG q≈60 的缩略图 base64（不含 data: 前缀）。
 * 任何环节失败 → null（调用方据此省略 image content block，结果其余部分不受影响）。
 */
export function buildResultThumbnail(result: unknown, deps: BuildThumbnailDeps): ThumbnailBlock | null {
  const maxEdge = deps.maxEdge ?? DEFAULT_MAX_EDGE
  const quality = deps.quality ?? DEFAULT_QUALITY
  const maxBase64 = deps.maxBase64Bytes ?? DEFAULT_MAX_BASE64
  try {
    const sourceUrl = pickThumbnailSourceUrl(result)
    if (!sourceUrl) return null
    const filePath = deps.readLocalFile(sourceUrl)
    if (!filePath) return null
    const bytes = deps.readFileBytes(filePath)
    if (!bytes || bytes.length === 0) return null
    // createFromBuffer 比 createFromPath 少一次 fs 往返，且路径已由 readLocalFile 校验过越界/符号链接。
    let image = deps.toolkit.createFromBuffer(bytes)
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    if (width <= 0 || height <= 0) return null
    // 只钉长边、等比缩（nativeImage 只给一维时按比例算另一维）；已 ≤maxEdge 则不放大。
    if (width >= height && width > maxEdge) image = image.resize({ width: maxEdge, quality: 'good' })
    else if (height > width && height > maxEdge) image = image.resize({ height: maxEdge, quality: 'good' })
    else if (width === height && width > maxEdge) image = image.resize({ width: maxEdge, quality: 'good' })
    const jpeg = image.toJPEG(quality)
    if (!jpeg || jpeg.length === 0) return null
    const data = jpeg.toString('base64')
    if (data.length > maxBase64) return null // 超顶：宁可省略也不塞超大 payload
    return { data, mimeType: 'image/jpeg' }
  } catch {
    // 读文件/解码/编码任一抛 → 优雅省略。
    return null
  }
}
