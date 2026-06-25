/**
 * 离屏测一个音频地址的真实时长（秒）。仿 readVideoDurationSeconds，但用 <audio>。
 * 失败 / 非有限值 / 超时 → null（调用方回退默认时长，绝不把坏地址挂死入轨链路）。
 *
 * 用途：从素材库拖音频进时间轴时，audio clip 不能钉死默认时长——配乐对齐要真实长度。
 * nomi-local:// 由主进程协议处理器接管，<audio src> 直接用 renderUrl 即可（无需 URL 变换）。
 */
export function readAudioDurationSeconds(url: string): Promise<number | null> {
  if (typeof document === 'undefined' || !url.trim()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    let settled = false
    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      audio.removeAttribute('src')
      audio.load()
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), 8000)
    audio.onloadedmetadata = () => {
      const duration = audio.duration
      finish(Number.isFinite(duration) && duration > 0 ? duration : null)
    }
    audio.onerror = () => finish(null)
    audio.src = url.trim()
  })
}
