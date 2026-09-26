import { buildVideoPlaybackUrl } from './videoPlaybackUrl'
import { logRendererError } from '../desktop/rendererLog'

export type VideoPlaybackFailureDiagnostics = {
  rawVideoUrl: string
  playbackUrl: string
  mediaErrorCode: number | null
  mediaErrorMessage: string
  probeMessage: string
}

async function readResponseMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text().catch(() => '')
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: unknown; error?: unknown; code?: unknown }
      const message = typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : ''
      if (message) return message
      const error = typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error.trim() : ''
      if (error) return error
      const code = typeof parsed.code === 'string' && parsed.code.trim() ? parsed.code.trim() : ''
      if (code) return code
    } catch {
      // fall through to raw text
    }
  }
  return trimmed.slice(0, 240)
}

export async function probeVideoPlaybackFailure(rawVideoUrl: string): Promise<string> {
  const playbackUrl = buildVideoPlaybackUrl(rawVideoUrl)
  if (!playbackUrl) return '视频地址为空'

  try {
    const response = await fetch(playbackUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Range: 'bytes=0-0',
      },
    })
    if (response.ok) return ''

    const message = await readResponseMessage(response)
    const statusText = response.status ? String(response.status) : 'unknown'
    return message
      ? `视频代理返回 ${statusText}：${message}`
      : `视频代理返回 ${statusText}`
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'unknown error'
    return `视频代理请求失败：${message}`
  }
}

export async function diagnoseVideoPlaybackFailure(
  rawVideoUrl: string,
  mediaError?: MediaError | null,
): Promise<VideoPlaybackFailureDiagnostics> {
  const playbackUrl = buildVideoPlaybackUrl(rawVideoUrl)
  const probeMessage = await probeVideoPlaybackFailure(rawVideoUrl)
  return {
    rawVideoUrl,
    playbackUrl,
    mediaErrorCode: typeof mediaError?.code === 'number' ? mediaError.code : null,
    mediaErrorMessage: typeof mediaError?.message === 'string' ? mediaError.message : '',
    probeMessage,
  }
}

export function logVideoPlaybackFailure(diagnostics: VideoPlaybackFailureDiagnostics): void {
  logRendererError('video-playback-failed', undefined, {
    source: diagnostics.rawVideoUrl,
    playbackSource: diagnostics.playbackUrl,
    mediaErrorCode: diagnostics.mediaErrorCode,
    mediaErrorMessage: diagnostics.mediaErrorMessage,
    probe: diagnostics.probeMessage,
  })
}

// MediaError.code → 人话。地址已被探针证实可读时，失败一定出在「媒体本身」（解码/格式/传输），
// 不是代理；这些文案绝不甩锅给代理（修旧 fallback「代理无法读取该视频地址」的误导）。
const MEDIA_ERROR_HINTS: Record<number, string> = {
  1: '视频加载被取消',
  2: '视频传输中断（地址可达，但数据没读完）',
  3: '视频解码失败（文件可能损坏，或编码不受支持）',
  4: '视频格式不受支持，或该地址没有返回视频内容',
}

/**
 * 把一次播放失败诊断翻成给用户看的一句话——唯一真相源（UI 各处共用，别再各自手搓 fallback）。
 *
 * 判定顺序遵循诊断本身的因果：
 *  1) 探针报错（probeMessage 非空）= 地址根本读不到（网络/HTTP/代理）→ 探针消息最具体，直接用。
 *  2) 探针成功但 <video> 仍失败 = 地址可读、问题在媒体本身 → 按 MediaError.code 说人话，
 *     绝不再说「代理无法读取该视频地址」（探针刚证明读得到，那句是自相矛盾的谎）。
 */
export function describeVideoPlaybackFailure(diagnostics: VideoPlaybackFailureDiagnostics): string {
  if (diagnostics.probeMessage) return diagnostics.probeMessage
  if (diagnostics.mediaErrorCode && MEDIA_ERROR_HINTS[diagnostics.mediaErrorCode]) {
    return MEDIA_ERROR_HINTS[diagnostics.mediaErrorCode]
  }
  if (diagnostics.mediaErrorMessage) return diagnostics.mediaErrorMessage
  return '视频无法播放（原因未知）'
}
