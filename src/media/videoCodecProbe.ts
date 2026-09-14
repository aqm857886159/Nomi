// 本机视频解码能力探测（启动时跑一次，结果送进主进程）。
//
// 为什么在渲染层探：能不能播是 **Chromium 这个进程** 的事实——同一台 mac 上 Electron 的
// HEVC 硬解开不开，取决于它自己的构建与系统 framework，主进程没法替它回答。
// 探到什么就是什么；探不到主进程自己会回落到保守白名单（多转一次，不会让人播不了）。
import { getDesktopBridge } from '../desktop/bridge'

/** codec 短名 → 探测用的 MIME（含 RFC 6381 codecs 参数；写最常见的 profile 即可）。 */
const PROBE_TYPES: ReadonlyArray<[string, string]> = [
  ['h264', 'video/mp4; codecs="avc1.42E01E"'],
  // Main 10 (10-bit) 与 Main (8-bit) 都探：用户手机拍的 4K 多是 10-bit hvc1。
  ['hevc', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
  ['hevc', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
  ['vp8', 'video/webm; codecs="vp8"'],
  ['vp9', 'video/webm; codecs="vp09.00.10.08"'],
  ['av1', 'video/mp4; codecs="av01.0.05M.08"'],
]

function canPlay(mimeWithCodecs: string): boolean {
  const ms = (globalThis as { MediaSource?: { isTypeSupported?: (t: string) => boolean } }).MediaSource
  if (typeof ms?.isTypeSupported === 'function') {
    try {
      if (ms.isTypeSupported(mimeWithCodecs)) return true
    } catch {
      /* isTypeSupported 对畸形串会抛，当不支持处理 */
    }
  }
  if (typeof document === 'undefined') return false
  try {
    // canPlayType 的 'maybe' 不算数：我们要的是「确定能解」，不确定就转（保守方向）。
    return document.createElement('video').canPlayType(mimeWithCodecs) === 'probably'
  } catch {
    return false
  }
}

/** 探测本机可播的视频 codec 短名集合。 */
export function probeVideoCodecs(): string[] {
  const supported = new Set<string>()
  for (const [name, mime] of PROBE_TYPES) {
    if (canPlay(mime)) supported.add(name)
  }
  return [...supported]
}

/** 探一次并送进主进程。桥不可用（浏览器调试、测试）→ 静默跳过，主进程用保守回落。 */
export async function reportVideoCodecSupport(): Promise<string[]> {
  const codecs = probeVideoCodecs()
  const send = getDesktopBridge()?.assets?.reportVideoCodecs
  if (send) await send({ codecs }).catch(() => {})
  return codecs
}
