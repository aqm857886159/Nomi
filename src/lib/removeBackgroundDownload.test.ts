// 抠图首次下载：一条总进度（不按资源来回跳）、卡住会停、失败分得清原因。
import { describe, expect, it } from 'vitest'
import { createDownloadTracker, type DownloadProgress } from './removeBackgroundDownload'

const ROOT = 'https://mirror.test/data/1.7.0/dist/'
const MANIFEST = {
  '/models/m': { size: 6 },
  '/ort/a.wasm': { size: 4 },
  '/ort/unused': { size: 999 },
}

function streamOf(parts: number[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(sink) {
      if (i >= parts.length) { sink.close(); return }
      sink.enqueue(new Uint8Array(parts[i]))
      i += 1
    },
  })
}

function setup(options: { hang?: boolean } = {}) {
  let clock = 0
  const progress: DownloadProgress[] = []
  const tracker = createDownloadTracker({
    publicPath: ROOT,
    resourceKeys: ['/models/m', '/ort/a.wasm'],
    stallMs: 60_000,
    now: () => clock,
    onProgress: (p) => progress.push(p),
    baseFetch: async (input, init) => {
      const url = String(input)
      if (url.endsWith('resources.json')) return new Response(JSON.stringify(MANIFEST))
      if (url.includes('hang') || options.hang) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }
      if (url.includes('model')) return new Response(streamOf([3, 3]))
      if (url.includes('wasm')) return new Response(streamOf([2, 2]))
      if (url.includes('down')) throw new TypeError('Failed to fetch')
      return new Response('other')
    },
  })
  return { tracker, progress, tick: (ms: number) => { clock += ms } }
}

describe('createDownloadTracker', () => {
  it('总进度按清单里要用的几样资源的字节总数算，从 0 单调走到 100%（报告形态：同一个分母）', async () => {
    const { tracker, progress } = setup()
    await tracker.fetch(`${ROOT}resources.json`)
    await (await tracker.fetch(`${ROOT}model-chunk`)).blob()
    await (await tracker.fetch(`${ROOT}wasm-chunk`)).blob()
    expect(progress.map((p) => p.total)).toEqual([10, 10, 10, 10])
    expect(progress.map((p) => p.received)).toEqual([3, 6, 8, 10])
  })

  it('下载中 60 秒一个字节都没收到：中止在途请求，并把这次失败标成「卡住」', async () => {
    const { tracker, tick } = setup()
    const pending = tracker.fetch(`${ROOT}hang-chunk`)
    tick(59_000)
    expect(tracker.checkStall()).toBe(false)
    tick(2_000)
    expect(tracker.checkStall()).toBe(true)
    await expect(pending).rejects.toThrow()
    expect(tracker.failure()).toBe('download-stalled')
  })

  it('没有在途请求时不判卡住（推理那一段本来就没有字节进来）', () => {
    const { tracker, tick } = setup()
    tick(10 * 60_000)
    expect(tracker.checkStall()).toBe(false)
    expect(tracker.failure()).toBeNull()
  })

  it('镜像连不上：标成「下载失败」，和卡住分开说', async () => {
    const { tracker } = setup()
    await expect(tracker.fetch(`${ROOT}down-chunk`)).rejects.toThrow()
    expect(tracker.failure()).toBe('download-failed')
    tracker.reset()
    expect(tracker.failure()).toBeNull()
  })

  it('镜像根以外的请求原样放行（blob: 地址、别的站点不计数）', async () => {
    const { tracker, progress } = setup()
    const response = await tracker.fetch('blob:nomi/whatever')
    expect(await response.text()).toBe('other')
    expect(progress).toEqual([])
  })
})
