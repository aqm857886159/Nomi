import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// 1×1 PNG：生成素材写盘会校验字节，不能拿随手字符串冒充帧图。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const mock = vi.hoisted(() => ({ root: '', ffmpegStarted: vi.fn(), finishFfmpeg: null as null | (() => void) }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root, getAppPath: () => process.cwd(), getName: () => 'Nomi' } }))
vi.mock('../assets/assetEvents', () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn() }))
vi.mock('../export/ensureExecutable', () => ({ ensureExecutable: () => undefined }))
// The real ffmpeg step is the long await this contract is about: hold it open until the test
// has replaced the project, then emit a real PNG where ffmpeg would have written it.
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: (_bin: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() })
  mock.finishFfmpeg = () => { fs.writeFileSync(args[args.length - 1], PNG); child.emit('close', 0) }
  mock.ffmpegStarted()
  return child
} }))

const roots: string[] = []
function temp(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-frame-context-')); roots.push(root); return root }
beforeEach(() => { vi.resetModules(); mock.ffmpegStarted.mockClear(); mock.finishFfmpeg = null; mock.root = temp(); vi.stubEnv("NOMI_SETTINGS_DIR", path.join(mock.root, 'settings')) })
afterEach(() => {
  vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function setup() {
  const { createProject, projectDirById } = await import('../projects/repository')
  const { listProjectAssets } = await import('../assets/projectAssetStore')
  const { extractVideoFrameToAsset } = await import('./extractVideoFrame')
  const project = createProject({ rootPath: temp(), name: 'frames', payload: {} })
  const video = path.join(temp(), 'clip.mp4'); fs.writeFileSync(video, 'video bytes')
  const assets = () => listProjectAssets({ projectId: project.id }).items
  const bumpGeneration = () => {
    const root = projectDirById(project.id)!
    for (const name of fs.readdirSync(path.join(root, '.nomi')).filter((entry) => entry.startsWith('project') && entry.endsWith('.json'))) {
      const target = path.join(root, '.nomi', name)
      const record = JSON.parse(fs.readFileSync(target, 'utf8'))
      fs.writeFileSync(target, JSON.stringify({ ...record, projectGeneration: record.projectGeneration + 1 }))
    }
  }
  return { project, video, assets, bumpGeneration, extractVideoFrameToAsset }
}

async function whileFfmpegRuns(action: () => void): Promise<void> {
  await vi.waitFor(() => expect(mock.ffmpegStarted).toHaveBeenCalled())
  action()
  mock.finishFfmpeg!()
}

it('does not publish an interactive frame once its project action is revoked during ffmpeg', async () => {
  const { project, video, assets, extractVideoFrameToAsset } = await setup()
  let current = true
  const pending = extractVideoFrameToAsset({ videoUrl: video, which: 'first', projectId: project.id }, { assertCurrent() {
    if (!current) throw Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' })
  } })
  await whileFfmpegRuns(() => { current = false })
  await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
  expect(assets()).toEqual([])
})

it('does not publish any frame into a project whose identity was replaced during ffmpeg', async () => {
  const { project, video, assets, bumpGeneration, extractVideoFrameToAsset } = await setup()
  const pending = extractVideoFrameToAsset({ videoUrl: video, which: 'first', projectId: project.id })
  await whileFfmpegRuns(bumpGeneration)
  await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
  expect(assets()).toEqual([])
})

it('keeps explicit original-project background extraction publishing into that project', async () => {
  const { project, video, assets, extractVideoFrameToAsset } = await setup()
  const pending = extractVideoFrameToAsset({ videoUrl: video, which: 'first', projectId: project.id })
  await whileFfmpegRuns(() => undefined)
  await expect(pending).resolves.toMatchObject({ url: expect.stringContaining(project.id) })
  expect(assets()).toHaveLength(1)
})
