import React from 'react'
import { getDesktopBridge } from '../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../workbench/project/workbenchProjectSession'
import { parseNomiLocalAssetUrl } from './nomiLocalAssetUrl'

/**
 * 视频胶片条（16 帧横向拼图）懒加载，跨面共享的媒体基建。
 * 用处：时间轴 clip 全条真帧；素材库视频卡取第一格当封面（同一份缓存，不重复抽）。
 * 同源共享一份（key=projectId::url），失败落 failed 由调用方回退占位——绝不冒充。
 * 并发按浏览器报告的逻辑处理器数派生，避免同屏视频无限启动 ffmpeg。
 * 产物落项目缓存区（.nomi/cache/），不进素材库（见 electron/assets/projectCacheFile.ts）。
 */
export type FilmstripEntry =
  | { status: 'ready'; url: string; tiles: number }
  | { status: 'pending' }
  | { status: 'failed' }

const cache = new Map<string, FilmstripEntry>()
const listeners = new Set<() => void>()
const queue: Array<() => void> = []
let running = 0
const MAX_CONCURRENT = navigator.hardwareConcurrency

function notify(): void {
  for (const listener of listeners) listener()
}

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()
    if (job) job()
  }
}

function request(key: string, videoUrl: string, projectId: string): void {
  if (cache.has(key)) return
  cache.set(key, { status: 'pending' })
  const bridge = getDesktopBridge()
  const extract = bridge?.video?.extractFilmstrip
  if (!extract) {
    cache.set(key, { status: 'failed' })
    return
  }
  queue.push(() => {
    running += 1
    extract({ videoUrl, projectId })
      .then((result) => {
        cache.set(key, { status: 'ready', url: result.url, tiles: result.tiles })
      })
      .catch(() => {
        cache.set(key, { status: 'failed' })
      })
      .finally(() => {
        running -= 1
        notify()
        pump()
      })
  })
  pump()
}

export type FilmstripRequest = {
  videoUrl: string
  projectId: string
  key: string
}

/**
 * Resolve the project that is allowed to read/extract this video.
 *
 * "All assets" can show a video from project A while project B is open. The
 * old hook always sent project B to the main process, so its project boundary
 * check correctly rejected A and every cross-project video stayed a blank
 * placeholder. A local URL already carries authoritative ownership; explicit
 * context and the active project are only fallbacks for URLs without it.
 */
export function resolveFilmstripRequest(
  videoUrl: string | null | undefined,
  project: { explicitProjectId?: string | null; activeProjectId?: string | null },
): FilmstripRequest | null {
  const url = typeof videoUrl === 'string' ? videoUrl.trim() : ''
  if (!url) return null
  const urlProjectId = parseNomiLocalAssetUrl(url)?.projectId ?? ''
  const explicitProjectId = typeof project.explicitProjectId === 'string' ? project.explicitProjectId.trim() : ''
  const activeProjectId = typeof project.activeProjectId === 'string' ? project.activeProjectId.trim() : ''
  const projectId = urlProjectId || explicitProjectId || activeProjectId
  return projectId ? { videoUrl: url, projectId, key: `${projectId}::${url}` } : null
}

export function useFilmstrip(
  videoUrl: string | null | undefined,
  explicitProjectId?: string | null,
): FilmstripEntry | null {
  const resolved = resolveFilmstripRequest(videoUrl, {
    explicitProjectId,
    activeProjectId: getActiveWorkbenchProjectId(),
  })
  const url = resolved?.videoUrl ?? ''
  const projectId = resolved?.projectId ?? ''
  const key = resolved?.key ?? ''

  const subscribe = React.useCallback((onStoreChange: () => void) => {
    listeners.add(onStoreChange)
    return () => {
      listeners.delete(onStoreChange)
    }
  }, [])
  const getSnapshot = React.useCallback((): FilmstripEntry | null => (key ? (cache.get(key) ?? null) : null), [key])
  const entry = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  React.useEffect(() => {
    if (!key) return
    request(key, url, projectId)
  }, [key, url, projectId])

  return entry
}

/** 测试用：清缓存与队列。 */
export function resetFilmstripForTests(): void {
  cache.clear()
  queue.length = 0
  running = 0
}
