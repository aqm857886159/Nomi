import { buildVideoPlaybackUrl } from './videoPlaybackUrl'

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
  console.error('[nomi-video-playback-failure]', diagnostics)
}
