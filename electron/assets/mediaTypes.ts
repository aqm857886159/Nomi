// 媒体类型单一真相源 —— 「扩展名 ↔ contentType ↔ kind」唯一一张表。
//
// 为什么存在:这套映射从前散在 5 处各自维护、已漂移的表(AssetLibraryPanel.UPLOAD_ACCEPT /
// importAudioToLibrary.AUDIO_EXTENSIONS / workspaceFileIndex.CONTENT_TYPES /
// assetPaths.contentTypeFromPath / assetPaths.extensionFromMime),最窄的那处悄悄决定一个上传的
// 音频能否进库——导致 .m4a/.aac/.ogg/.flac「上传成功却静默蒸发」。这里收口成一张表,各消费者派生。
//
// 纯模块:只做字符串运算,不碰 node:fs / node:path,因此 renderer(src/)也能直接 import
// (已有 src→electron 值导入先例:export/exportTypes、catalog/*Vendor)。

export type MediaKind = 'image' | 'video' | 'audio' | 'model3d' | 'document' | 'text'

export type MediaTypeEntry = {
  /** 带前导点、小写,如 ".mp3"。 */
  ext: string
  contentType: string
  kind: MediaKind
}

/** 唯一真相源。新增格式只改这里。 */
export const MEDIA_TYPES: readonly MediaTypeEntry[] = [
  // text
  { ext: '.md', contentType: 'text/markdown', kind: 'text' },
  { ext: '.markdown', contentType: 'text/markdown', kind: 'text' },
  { ext: '.txt', contentType: 'text/plain', kind: 'text' },
  { ext: '.json', contentType: 'application/json', kind: 'text' },
  { ext: '.csv', contentType: 'text/csv', kind: 'text' },
  // image
  { ext: '.png', contentType: 'image/png', kind: 'image' },
  { ext: '.jpg', contentType: 'image/jpeg', kind: 'image' },
  { ext: '.jpeg', contentType: 'image/jpeg', kind: 'image' },
  { ext: '.webp', contentType: 'image/webp', kind: 'image' },
  { ext: '.gif', contentType: 'image/gif', kind: 'image' },
  { ext: '.avif', contentType: 'image/avif', kind: 'image' },
  { ext: '.svg', contentType: 'image/svg+xml', kind: 'image' },
  { ext: '.bmp', contentType: 'image/bmp', kind: 'image' },
  { ext: '.ico', contentType: 'image/x-icon', kind: 'image' },
  { ext: '.tiff', contentType: 'image/tiff', kind: 'image' },
  { ext: '.heic', contentType: 'image/heic', kind: 'image' },
  // video
  { ext: '.mp4', contentType: 'video/mp4', kind: 'video' },
  { ext: '.webm', contentType: 'video/webm', kind: 'video' },
  { ext: '.mov', contentType: 'video/quicktime', kind: 'video' },
  { ext: '.m4v', contentType: 'video/x-m4v', kind: 'video' },
  { ext: '.ogv', contentType: 'video/ogg', kind: 'video' },
  { ext: '.avi', contentType: 'video/x-msvideo', kind: 'video' },
  { ext: '.mkv', contentType: 'video/x-matroska', kind: 'video' },
  { ext: '.mpeg', contentType: 'video/mpeg', kind: 'video' },
  // audio
  { ext: '.mp3', contentType: 'audio/mpeg', kind: 'audio' },
  { ext: '.wav', contentType: 'audio/wav', kind: 'audio' },
  { ext: '.m4a', contentType: 'audio/mp4', kind: 'audio' },
  { ext: '.aac', contentType: 'audio/aac', kind: 'audio' },
  { ext: '.ogg', contentType: 'audio/ogg', kind: 'audio' },
  { ext: '.oga', contentType: 'audio/ogg', kind: 'audio' },
  { ext: '.flac', contentType: 'audio/flac', kind: 'audio' },
  { ext: '.opus', contentType: 'audio/opus', kind: 'audio' },
  { ext: '.weba', contentType: 'audio/webm', kind: 'audio' },
  // model3d
  { ext: '.glb', contentType: 'model/gltf-binary', kind: 'model3d' },
  // document
  { ext: '.pdf', contentType: 'application/pdf', kind: 'document' },
  { ext: '.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  { ext: '.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' },
]

// 派生索引(模块加载一次,O(1) 查)。
const BY_EXT = new Map<string, MediaTypeEntry>(MEDIA_TYPES.map((e) => [e.ext, e]))
// 反查:同一 contentType 可能多扩展名(jpg/jpeg),取表中第一条作规范扩展名。
const BY_CONTENT_TYPE = new Map<string, MediaTypeEntry>()
for (const entry of MEDIA_TYPES) {
  if (!BY_CONTENT_TYPE.has(entry.contentType)) BY_CONTENT_TYPE.set(entry.contentType, entry)
}

/** 规范化为带前导点的小写扩展名。接受 ".MP3" / "mp3" / "song.MP3" / "/a/b.flac" 等。 */
export function normalizeExtension(input: string): string {
  const raw = String(input || '').trim().toLowerCase()
  if (!raw) return ''
  const lastDot = raw.lastIndexOf('.')
  // 无点 → 视为纯扩展名(补点);有点 → 取最后一段(兼容文件名/路径)。
  const ext = lastDot >= 0 ? raw.slice(lastDot) : `.${raw}`
  return ext
}

/** 扩展名/文件名/路径 → kind;未知返回 null。 */
export function mediaKindFromExtension(input: string): MediaKind | null {
  return BY_EXT.get(normalizeExtension(input))?.kind ?? null
}

/** 扩展名/文件名/路径 → contentType;未知返回 null。 */
export function contentTypeFromExtension(input: string): string | null {
  return BY_EXT.get(normalizeExtension(input))?.contentType ?? null
}

/** contentType → 规范扩展名(不含点,如 "mp3");未知返回 null。带 charset 参数也能认。 */
export function extensionFromContentType(contentType: string): string | null {
  const type = String(contentType || '').split(';')[0]?.trim().toLowerCase()
  if (!type) return null
  return BY_CONTENT_TYPE.get(type)?.ext.replace(/^\./, '') ?? null
}

/** 某 kind 的全部扩展名(不含点),如 audio → ['mp3','wav',...]。 */
export function extensionsForKind(kind: MediaKind): string[] {
  return MEDIA_TYPES.filter((e) => e.kind === kind).map((e) => e.ext.replace(/^\./, ''))
}

/**
 * **文件头魔数 → contentType**；认不出返回 null。
 *
 * 为什么需要它（2026-08-20 用户报「素材上传失败(HTTP 413)」，那还是段 2 秒的视频）：
 * 上传前判「这是图/视频/音频」全靠**文件名的扩展名**，而扩展名认不出时
 * `mediaKindFromContentType` 会**一律当图片**（它的兜底就是 return 'image'）。于是
 * `.mkv` / `.bin`（落盘时扩展名缺失的兜底）/ 没扩展名的文件里的视频，会被当图片送进
 * 图片通道 —— KIE 的 file-base64-upload 是把整个文件 base64 塞进 JSON body 的，
 * 一段几 MB 的视频就能把请求体顶爆 → 反代直接 413。文件多小都没用，路走错了。
 *
 * 文件名是人和服务商起的，字节是事实。扩展名认不出时就读头几个字节，别猜。
 */
const MAX_FTYP_BOX_BYTES = 4096

function isoBmffContentType(bytes: Uint8Array): string | null {
  const ascii = (start: number, length = 4) => String.fromCharCode(...bytes.subarray(start, start + length))
  const uint32 = (start: number) => ((bytes[start] * 0x1000000) + (bytes[start + 1] << 16)
    + (bytes[start + 2] << 8) + bytes[start + 3]) >>> 0
  if (bytes.length < 16 || ascii(4) !== 'ftyp') return null
  const size32 = uint32(0)
  let boxSize = size32
  let majorOffset = 8
  if (size32 === 1) {
    if (bytes.length < 24) return null
    boxSize = uint32(8) * 0x100000000 + uint32(12)
    majorOffset = 16
  } else if (size32 === 0) boxSize = bytes.length
  if (!Number.isSafeInteger(boxSize) || boxSize < majorOffset + 8 || boxSize > bytes.length
    || boxSize > MAX_FTYP_BOX_BYTES || (boxSize - majorOffset) % 4 !== 0) return null
  const major = ascii(majorOffset)
  let avif = major === 'avif' || major === 'avis'
  let heic = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(major)
  for (let offset = majorOffset + 8; offset + 4 <= boxSize && !(avif && heic); offset += 4) {
    const brand = ascii(offset)
    avif ||= brand === 'avif' || brand === 'avis'
    heic ||= ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)
  }
  if (avif) return 'image/avif'
  if (heic) return 'image/heic'
  if (major === 'M4A ' || major === 'M4B ') return 'audio/mp4'
  if (major === 'M4V ' || major === 'M4VH' || major === 'M4VP') return 'video/x-m4v'
  return major === 'qt  ' ? 'video/quicktime' : 'video/mp4'
}

export function contentTypeFromMagicBytes(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i]
  const ascii = (start: number, text: string) =>
    [...text].every((ch, i) => at(start + i) === ch.charCodeAt(0))
  if (bytes.length < 12) return null
  // ISO-BMFF：AVIF/HEIC 与 mp4/mov 共用 ftyp；major 与 compatible brands 都是格式声明。
  if (ascii(4, 'ftyp')) {
    return isoBmffContentType(bytes)
  }
  // Matroska / WebM 共用 EBML 头；认证边界必须按 DocType 区分，不能把 MKV 伪装成 WebM。
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) {
    const docTypeWindow = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096))).toLowerCase()
    if (docTypeWindow.includes('matroska')) return 'video/x-matroska'
    return 'video/webm'
  }
  // RIFF 容器：第 8 字节起的 form type 决定是 avi / wav / webp。
  if (ascii(0, 'RIFF')) {
    if (ascii(8, 'AVI ')) return 'video/x-msvideo'
    if (ascii(8, 'WAVE')) return 'audio/wav'
    if (ascii(8, 'WEBP')) return 'image/webp'
  }
  if (ascii(0, 'OggS')) {
    const window = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)))
    if (window.includes('OpusHead')) return 'audio/opus'
    if (window.toLowerCase().includes('theora')) return 'video/ogg'
    return 'audio/ogg'
  }
  if (ascii(0, 'fLaC')) return 'audio/flac'
  if (ascii(0, 'ID3')) return 'audio/mpeg'
  if (at(0) === 0xff && (at(1) & 0xf6) === 0xf0) return 'audio/aac' // ADTS AAC
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return 'audio/mpeg' // 裸 MPEG 音频帧同步字
  if (at(0) === 0x89 && ascii(1, 'PNG')) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (ascii(0, 'GIF8')) return 'image/gif'
  if (ascii(0, 'BM')) return 'image/bmp'
  if ((ascii(0, 'II') && at(2) === 0x2a && at(3) === 0x00)
    || (ascii(0, 'MM') && at(2) === 0x00 && at(3) === 0x2a)) return 'image/tiff'
  if (at(0) === 0x00 && at(1) === 0x00 && at(2) === 0x01 && at(3) === 0x00) return 'image/x-icon'
  return null
}

/** 与项目当前真实 decoder/probe 边界一致；识别到但不在此集合中的格式必须报 unsupported。 */
export const CERTIFIABLE_MEDIA_CONTENT_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp',
  'video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'video/x-matroska',
  'video/ogg', 'video/x-msvideo', 'video/mpeg',
  'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/opus',
  'audio/webm', 'audio/flac',
  'model/gltf-binary',
]);

export function isCertifiableMediaContentType(contentType: string): boolean {
  return CERTIFIABLE_MEDIA_CONTENT_TYPES.has(String(contentType || '').toLowerCase().split(';', 1)[0].trim())
}

/**
 * 素材真实 contentType 的**唯一判定顺序**：有字节时先信文件头（字节事实优先于错误扩展名），
 * 文件头认不出再用扩展名，最后才 octet-stream。没有字节时走扩展名快路。
 */
export function resolveContentType(fileNameOrPath: string, bytes?: Uint8Array): string {
  const byExt = contentTypeFromExtension(fileNameOrPath)
  const bySniff = bytes ? contentTypeFromMagicBytes(bytes) : null
  return bySniff ?? byExt ?? 'application/octet-stream'
}

/**
 * 为 <input accept> 生成属性值。
 * macOS/Chromium 对纯 `image/*`/`video/*`/`audio/*` 通配常因 MIME 映射不到而把文件灰掉,
 * MDN 推荐通配 + 显式扩展名一起列。这里据传入 kind 自动两者都给。
 */
export function acceptAttrForKinds(kinds: MediaKind[]): string {
  const wildcards = kinds
    .filter((k) => k === 'image' || k === 'video' || k === 'audio')
    .map((k) => `${k}/*`)
  const exts = MEDIA_TYPES.filter((e) => kinds.includes(e.kind)).map((e) => e.ext)
  return [...wildcards, ...exts].join(',')
}
