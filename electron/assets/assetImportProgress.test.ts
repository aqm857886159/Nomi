import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./assetEvents', () => ({ broadcastAssetImportProgress: vi.fn(async () => {}) }))

import { broadcastAssetImportProgress } from './assetEvents'
import { copyFileWithProgress, createAssetImportProgressReporter } from './assetImportProgress'

const workdirs: string[] = []
function workdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-import-progress-'))
  workdirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of workdirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.mocked(broadcastAssetImportProgress).mockClear()
})

describe('拷贝流上报的字节就是渐显的进度', () => {
  it('字节单调递增、最后一条正好是总字节，拷出来的内容逐字相同', async () => {
    const dir = workdir()
    const source = path.join(dir, 'source.bin')
    const target = path.join(dir, 'target.bin')
    const bytes = Buffer.alloc(512 * 1024, 7)
    fs.writeFileSync(source, bytes)
    const seen: number[] = []
    await copyFileWithProgress(source, target, (copied, total) => {
      expect(total).toBe(bytes.byteLength)
      seen.push(copied)
    })
    expect(seen.length).toBeGreaterThan(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(seen.at(-1)).toBe(bytes.byteLength)
    expect(fs.readFileSync(target).equals(bytes)).toBe(true)
  })

  it('没有 onProgress 的调用方不绕流，拷贝行为不变', async () => {
    const dir = workdir()
    const source = path.join(dir, 'source.bin')
    const target = path.join(dir, 'target.bin')
    fs.writeFileSync(source, 'plain')
    await copyFileWithProgress(source, target)
    expect(fs.readFileSync(target, 'utf8')).toBe('plain')
  })
})

describe('进度上报器', () => {
  it('拷贝还没开始就先广播一次 0 + 预览 URL，让节点立刻有一帧可显', () => {
    const reporter = createAssetImportProgressReporter({ projectId: 'p1', nodeId: 'n1', totalBytes: 1_000, previewUrl: 'nomi-local://p1/x.preview.jpg' })
    reporter.announce()
    expect(broadcastAssetImportProgress).toHaveBeenCalledWith({
      projectId: 'p1', nodeId: 'n1', copiedBytes: 0, totalBytes: 1_000, previewUrl: 'nomi-local://p1/x.preview.jpg',
    })
  })

  it('中途按节流丢掉密集事件，但 100% 那条无条件送达', () => {
    const reporter = createAssetImportProgressReporter({ projectId: 'p1', nodeId: 'n1', totalBytes: 1_000 })
    reporter.announce()
    for (let copied = 1; copied < 1_000; copied += 1) reporter.report(copied, 1_000)
    reporter.report(1_000, 1_000)
    const calls = vi.mocked(broadcastAssetImportProgress).mock.calls.map(([payload]) => payload.copiedBytes)
    expect(calls.length).toBeLessThan(10)
    expect(calls.at(-1)).toBe(1_000)
  })

  it('视频先转码再拷贝时，标签仍然报**用户选的那个文件**的大小，不跳成中间件的大小', () => {
    // 325.7 MB 的源 → 归一化出 68.1 MB 的可播 MP4 → 拷的是后者。
    const reporter = createAssetImportProgressReporter({ projectId: 'p1', nodeId: 'n1', totalBytes: 341_510_929 })
    reporter.announce()
    reporter.report(71_400_000, 71_400_000)
    const payloads = vi.mocked(broadcastAssetImportProgress).mock.calls.map(([payload]) => payload)
    expect(payloads.every((payload) => payload.totalBytes === 341_510_929)).toBe(true)
    expect(payloads.at(-1)?.copiedBytes).toBe(341_510_929)
  })

  it('预览迟到时补发的那条不把比例往回拨', () => {
    const reporter = createAssetImportProgressReporter({ projectId: 'p1', nodeId: 'n1', totalBytes: 1_000 })
    reporter.announce()
    reporter.report(1_000, 1_000)
    reporter.setPreviewUrl('nomi-local://p1/late.preview.jpg')
    const last = vi.mocked(broadcastAssetImportProgress).mock.calls.at(-1)?.[0]
    expect(last?.copiedBytes).toBe(1_000)
    expect(last?.previewUrl).toBe('nomi-local://p1/late.preview.jpg')
  })
})
