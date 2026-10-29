// 拆解取消（2026-10-27，第一刀；设计卡 docs/plan/2026-10-27-deconstruct-cancel.md）· 本机重活那一层。
// 拆解的停止信号一路交到下载 / ffprobe / ffmpeg 子进程：停了就杀子进程（spawn 的 signal），
// 取出来的音轨、联系表不写缓存；一开始就停了的，一个子进程都不起。抽帧那一层见 extractVideoFrameProjectContext.test.ts。
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  spawns: [] as Array<{ signal?: AbortSignal; finish: (stdout?: string) => void }>,
  probeSignals: [] as Array<AbortSignal | undefined>,
  resolveSignals: [] as Array<AbortSignal | undefined>,
  cacheWrites: [] as string[],
}))
// 子进程替身照 Node 的样子：abort 即杀，先 `error`（AbortError）再 `close`；finish = ffmpeg 正常写完。
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: (_bin: string, args: string[], options?: { signal?: AbortSignal }) => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  const finish = (stdout = '') => {
    const out = args[args.length - 1]
    if (out && out !== '-') fs.writeFileSync(out, 'bytes')
    if (stdout) child.stdout.emit('data', stdout)
    child.emit('close', 0)
  }
  options?.signal?.addEventListener('abort', () => {
    child.emit('error', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    child.emit('close', null)
  }, { once: true })
  mock.spawns.push({ signal: options?.signal, finish })
  return child
} }))
vi.mock('../export/ffmpegRunner', () => ({ resolveFfmpegPath: () => '/isolated/ffmpeg' }))
vi.mock('../export/ensureExecutable', () => ({ ensureExecutable: () => undefined }))
vi.mock('../export/mediaProbe', () => ({
  probeMediaMetadata: vi.fn(async (_file: string, options?: { signal?: AbortSignal }) => { mock.probeSignals.push(options?.signal); return { durationSeconds: 12, hasAudio: true, fps: 25 } }),
}))
vi.mock('../assets/projectCacheFile', () => ({
  writeProjectCacheFile: (_projectId: string, _bytes: Buffer, kind: string) => { mock.cacheWrites.push(kind); return { url: `nomi-local://isolated/${kind}` } },
}))
vi.mock('./extractVideoFrame', () => ({
  resolveVideoLocalPath: vi.fn(async (_url: string, _projectId: string, signal?: AbortSignal) => { mock.resolveSignals.push(signal); return { filePath: '/isolated/clip.mp4', cleanup: () => undefined } }),
}))
vi.mock('../logging/logger', () => ({ logInfo: vi.fn() }))

import { extractAudioTrack, resetAudioTrackCacheForTests } from './extractAudioTrack'
import { detectShotCuts } from './detectShotCuts'

const payload = { videoUrl: 'nomi-local://isolated/clip.mp4', projectId: 'isolated' }
// 真实 ffmpeg 输出形状（同 detectShotCuts.test.ts 的样本）：2 秒处一刀。
const DETECT_STDOUT = 'frame:0    pts:20480   pts_time:2\nlavfi.scene_score=0.673689\n'
const untilSpawned = (count: number) => vi.waitFor(() => expect(mock.spawns.length).toBeGreaterThanOrEqual(count))

beforeEach(() => {
  mock.spawns.length = 0
  mock.probeSignals.length = 0
  mock.resolveSignals.length = 0
  mock.cacheWrites.length = 0
  resetAudioTrackCacheForTests()
})

describe('取音轨', () => {
  it('同一个信号交到下载、ffprobe、ffmpeg；跑到一半停了：杀子进程、不写缓存', async () => {
    const controller = new AbortController()
    const pending = extractAudioTrack(payload, { signal: controller.signal })
    await untilSpawned(1)
    expect(mock.resolveSignals).toEqual([controller.signal])
    expect(mock.probeSignals).toEqual([controller.signal])
    expect(mock.spawns[0]?.signal).toBe(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.cacheWrites).toEqual([])
  })

  it('ffmpeg 恰好写完、信号同一拍到：不写缓存、不交出去', async () => {
    const controller = new AbortController()
    const pending = extractAudioTrack(payload, { signal: controller.signal })
    await untilSpawned(1)
    mock.spawns[0]!.finish()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.cacheWrites).toEqual([])
  })

  it('一开始就停了：下载、探测、子进程一个都不起', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(extractAudioTrack(payload, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.resolveSignals).toEqual([])
    expect(mock.probeSignals).toEqual([])
    expect(mock.spawns).toEqual([])
  })

  it('对照：不停就照常写缓存、交出音轨', async () => {
    const pending = extractAudioTrack(payload, { signal: new AbortController().signal })
    await untilSpawned(1)
    mock.spawns[0]!.finish()
    await expect(pending).resolves.toMatchObject({ hasAudio: true, url: 'nomi-local://isolated/audio-track' })
    expect(mock.cacheWrites).toEqual(['audio-track'])
  })
})

describe('找切点', () => {
  it('同一个信号交到下载、ffprobe、检测那一趟 ffmpeg；检测中途停了：杀子进程，联系表那一趟不起', async () => {
    const controller = new AbortController()
    const pending = detectShotCuts(payload, { signal: controller.signal })
    await untilSpawned(1)
    expect(mock.resolveSignals).toEqual([controller.signal])
    expect(mock.probeSignals).toEqual([controller.signal])
    expect(mock.spawns[0]?.signal).toBe(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.spawns).toHaveLength(1)
    expect(mock.cacheWrites).toEqual([])
  })

  it('检测跑完、联系表那一趟跑到一半停了：杀子进程、不写缓存', async () => {
    const controller = new AbortController()
    const pending = detectShotCuts(payload, { signal: controller.signal })
    await untilSpawned(1)
    mock.spawns[0]!.finish(DETECT_STDOUT)
    await untilSpawned(2)
    expect(mock.spawns[1]?.signal).toBe(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.cacheWrites).toEqual([])
  })

  it('联系表恰好写完、信号同一拍到：不写缓存、不交出去', async () => {
    const controller = new AbortController()
    const pending = detectShotCuts(payload, { signal: controller.signal })
    await untilSpawned(1)
    mock.spawns[0]!.finish(DETECT_STDOUT)
    await untilSpawned(2)
    mock.spawns[1]!.finish()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.cacheWrites).toEqual([])
  })

  it('一开始就停了：下载、探测、子进程一个都不起', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(detectShotCuts(payload, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.resolveSignals).toEqual([])
    expect(mock.probeSignals).toEqual([])
    expect(mock.spawns).toEqual([])
  })

  it('对照：不停就照常交出切点与联系表', async () => {
    const pending = detectShotCuts(payload, { signal: new AbortController().signal })
    await untilSpawned(1)
    mock.spawns[0]!.finish(DETECT_STDOUT)
    await untilSpawned(2)
    mock.spawns[1]!.finish()
    await expect(pending).resolves.toMatchObject({ cuts: [{ seconds: 2 }], sheetUrl: 'nomi-local://isolated/shot-cuts' })
    expect(mock.cacheWrites).toEqual(['shot-cuts'])
  })
})
