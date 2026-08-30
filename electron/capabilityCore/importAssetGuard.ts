// 能力核 · 本地文件导入的安全判据（MCP `nomi_import_asset` 的守门人，纯函数可裸测）。
//
// 为什么要一整套判据：这是「让远端 agent 读本机任意文件」的口子——MCP 清单 M2 要的能力真实且必要
// （手绘帧/截图/用户素材进不来，「Agent 端到端」在素材侧就是断的），但口子开歪了就是任意文件读取。
// 故判据集中在此、纯函数、逐条可测；接线层（core.importProjectAsset）只调它，不自己判。
//
// 六条判据（deny 优先，白名单兜底——两头收紧）：
//  ① 必须绝对路径 + 规范化（相对路径/空串一律拒，免得靠 cwd 猜）；
//  ② 扩展名白名单（只收图/视频，文档密钥源码一律不收）；
//  ③ 大小上限（默认 64MB——素材够用，防把内存/磁盘打爆）；
//  ④ 逃逸防护：调用方须传**符号链接解析后**的真实路径，判据对它再查一遍 deny 段；
//  ⑤ 敏感位置 deny-list：`~/.ssh`、`~/.nomi/capability-core`（token 在里面）、钥匙串、浏览器配置等；
//  ⑥ 必须是常规文件（目录/设备/管道拒）。
// 判据不通过一律给**人话原因 + 该怎么办**（A6 错误契约），不吐路径细节以外的系统信息。

import path from 'node:path'

/** 只收这些扩展名（小写比对）。图 + 视频——素材导入的全部合法用途。 */
export const IMPORT_ALLOWED_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.heic',
  '.mp4', '.mov', '.webm', '.m4v',
] as const

/** 默认大小上限（字节）。64MB：4K 图与短视频素材够用，又不至于让单次导入打爆内存/磁盘。 */
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024

/**
 * 敏感路径段 deny-list。命中即拒——**先于白名单判**（哪怕有人把私钥改名叫 .png 也进不来）。
 * 用「路径段」而非子串匹配，免得 `/Users/me/sshots/a.png` 这种正常目录被 `.ssh` 误伤。
 */
const DENY_PATH_SEGMENTS = [
  '.ssh', '.gnupg', '.aws', '.kube', '.docker',
  '.nomi', // ~/.nomi/capability-core 里是 RPC token —— 绝不能被当素材读走
  'keychains', 'library/keychains',
  '.config', '.npmrc', '.netrc', '.env',
  'system', 'private/etc', 'etc',
]

/** deny 段的完整路径前缀形态（macOS 常见敏感根）。 */
const DENY_PREFIXES = ['/etc/', '/private/etc/', '/var/db/', '/System/', '/Library/Keychains/']

export type ImportGuardInput = {
  /** 调用方传入的原始路径（未规范化）。 */
  rawPath: string
  /** **符号链接解析后**的真实绝对路径（接线层用 fs.realpathSync 得到；解析失败则传 null）。 */
  realPath: string | null
  /** 文件字节数（接线层 stat 得到）。 */
  sizeBytes: number | null
  /** 是否常规文件（接线层 stat().isFile()）。 */
  isFile: boolean
  /** 上限覆盖（测试/未来配置用；缺省 IMPORT_MAX_BYTES）。 */
  maxBytes?: number
}

export type ImportGuardVerdict =
  | { ok: true; realPath: string; extension: string }
  | { ok: false; reason: string }

function hasDeniedSegment(absolute: string): boolean {
  const lower = absolute.toLowerCase()
  if (DENY_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))) return true
  const segments = lower.split(/[\\/]+/).filter(Boolean)
  return segments.some((segment) => DENY_PATH_SEGMENTS.includes(segment))
}

/**
 * 判「这个本地文件能不能作为素材导入」。纯函数——所有 I/O（realpath/stat）由接线层先做好传进来，
 * 判据本身零副作用、可逐条单测。
 */
export function checkImportAsset(input: ImportGuardInput): ImportGuardVerdict {
  const raw = String(input.rawPath || '').trim()
  if (!raw) return { ok: false, reason: '没给文件路径。请传本机文件的**绝对路径**（如 /Users/你/Desktop/参考.png）。' }
  if (!path.posix.isAbsolute(raw) && !path.win32.isAbsolute(raw)) {
    return { ok: false, reason: `路径必须是绝对路径（收到「${raw}」）。相对路径依赖当前工作目录、结果不可预期，请传完整路径。` }
  }
  if (!input.realPath) {
    return { ok: false, reason: `找不到这个文件（「${raw}」）。确认路径拼写与文件是否还在原处。` }
  }
  const normalizePortable = (value: string): string => {
    if (path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)) return path.win32.normalize(value)
    return path.posix.normalize(value)
  }
  const real = normalizePortable(input.realPath)
  // ⑤+④：deny 段对**解析后**的真实路径再查一遍——软链指向 ~/.ssh 之类的绕法在此断掉。
  if (hasDeniedSegment(real) || hasDeniedSegment(normalizePortable(raw))) {
    return { ok: false, reason: '这个位置的文件不允许作为素材导入（系统/凭据/配置目录）。请把素材放到普通目录（如桌面或项目文件夹）再导入。' }
  }
  if (!input.isFile) {
    return { ok: false, reason: '这不是一个普通文件（目录、设备或快捷方式无法作为素材导入）。请指向具体的图片或视频文件。' }
  }
  const extension = path.extname(real).toLowerCase()
  if (!(IMPORT_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      reason: `只支持导入图片或视频素材（${IMPORT_ALLOWED_EXTENSIONS.join(' / ')}），收到的是「${extension || '无扩展名'}」。`,
    }
  }
  const max = input.maxBytes ?? IMPORT_MAX_BYTES
  if (typeof input.sizeBytes !== 'number' || input.sizeBytes <= 0) {
    return { ok: false, reason: '这个文件是空的或读不到大小，无法导入。' }
  }
  if (input.sizeBytes > max) {
    const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`
    return { ok: false, reason: `文件太大（${mb(input.sizeBytes)}，上限 ${mb(max)}）。请先压缩或裁剪后再导入。` }
  }
  return { ok: true, realPath: real, extension }
}

/** 扩展名 → contentType（落资产 sidecar 用；未知回落通用二进制由调用方兜）。 */
export function contentTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.bmp': return 'image/bmp'
    case '.tiff': return 'image/tiff'
    case '.heic': return 'image/heic'
    case '.mp4':
    case '.m4v': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    default: return 'application/octet-stream'
  }
}
