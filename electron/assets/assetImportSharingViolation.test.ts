import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeWorkspaceManifest } from '../workspace/workspaceManifest'

// 2026-09-24 Windows 巡检：项目文件夹在同步盘里 / 被杀毒扫描时，别的程序会在文件刚写出时把它打开，
// Windows 上此刻删文件、删目录、改名会 EBUSY/EPERM。旧代码把收尾清理写在 finally 里直接抛，
// 素材明明已经落进项目，用户却看到「本地素材复制失败」。这组测试钉的是整类：
// 共享冲突既不能把「已经落好」改写成失败，也不能让瞬时占用直接打断落盘。
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-import-sharing-')))
// sanitizeName 用真的：假替身不截断，落盘名的截断规则在这里就测不到（2026-09-26 `.bin` 扩展名）。
vi.mock('../projects/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../projects/repository')>(),
  projectDirById: (id: string) => path.join(root, id),
}))
const { copyAssetFile, listProjectAssets, moveAssetFile } = await import('./projectAssetStore')
const { reapAbandonedUploadStaging } = await import('./scratchCleanup')
type Asset = { id: string; data: { absolutePath: string } }
const bytes = Buffer.from('real media bytes for sharing violation')

function sharingViolation(code: 'EBUSY' | 'EPERM', target: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: resource busy or locked, '${target}'`), { code })
}

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root)
  const directory = path.join(root, 'one'); fs.mkdirSync(directory)
  writeWorkspaceManifest(directory, { id: 'one', name: 'one', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1, payload: {} })
})
afterEach(() => { vi.restoreAllMocks() })
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('asset import under Windows sharing violations', () => {
  it('reports a native import as successful when the staging directory cannot be removed afterwards', async () => {
    const source = path.join(root, 'source.png'); fs.writeFileSync(source, bytes)
    const realRm = fs.promises.rm.bind(fs.promises)
    vi.spyOn(fs.promises, 'rm').mockImplementation((async (target: fs.PathLike, options?: fs.RmOptions) => {
      if (path.basename(String(target)).startsWith('.nomi-upload-')) throw sharingViolation('EBUSY', String(target))
      return realRm(target, options)
    }) as typeof fs.promises.rm)

    const asset = await copyAssetFile('one', source, 'photo.png', 'image/png', { kind: 'upload' }) as Asset
    expect(fs.readFileSync(asset.data.absolutePath)).toEqual(bytes)
    expect(listProjectAssets({ projectId: 'one' }).items).toHaveLength(1)
  })

  it('retries a transient sharing violation while linking the staged copy into the project', async () => {
    const source = path.join(root, 'source.png'); fs.writeFileSync(source, bytes)
    const realLink = fs.linkSync.bind(fs)
    let failures = 2
    vi.spyOn(fs, 'linkSync').mockImplementation(((existing: fs.PathLike, target: fs.PathLike) => {
      if (failures > 0) { failures -= 1; throw sharingViolation('EPERM', String(existing)) }
      return realLink(existing, target)
    }) as typeof fs.linkSync)

    const asset = await copyAssetFile('one', source, 'photo.png', 'image/png', { kind: 'upload' }) as Asset
    expect(failures).toBe(0)
    expect(fs.readFileSync(asset.data.absolutePath)).toEqual(bytes)
  })

  it('retries moving a freshly written file that antivirus briefly holds open', () => {
    const source = path.join(root, 'download.png'); fs.writeFileSync(source, bytes)
    const realRename = fs.renameSync.bind(fs)
    let failures = 2
    vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === source && failures > 0) { failures -= 1; throw sharingViolation('EPERM', String(from)) }
      return realRename(from, to)
    }) as typeof fs.renameSync)

    const asset = moveAssetFile('one', source, 'download.png', 'image/png', { kind: 'upload' }) as Asset
    expect(failures).toBe(0)
    expect(fs.readFileSync(asset.data.absolutePath)).toEqual(bytes)
    expect(fs.existsSync(source)).toBe(false)
  })

  it('reaps staging directories abandoned by a killed process, and only those', () => {
    const projectRoot = path.join(root, 'one')
    const abandoned = fs.mkdtempSync(path.join(projectRoot, '.nomi-upload-'))
    const inFlight = fs.mkdtempSync(path.join(projectRoot, '.nomi-upload-'))
    const old = new Date(Date.now() - 60 * 60_000)
    fs.utimesSync(abandoned, old, old)

    reapAbandonedUploadStaging(projectRoot)
    expect(fs.existsSync(abandoned)).toBe(false)
    expect(fs.existsSync(inFlight)).toBe(true)
  })
})
