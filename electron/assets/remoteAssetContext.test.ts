import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ root: '', fetch: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root, getAppPath: () => process.cwd() } }))
vi.mock('../hardenedFetch', () => ({ hardenedFetch: mock.fetch }))
vi.mock('./assetEvents', () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn() }))
const roots: string[] = []
function temp() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-remote-context-')); roots.push(root); return root }
afterEach(() => { vi.clearAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

it.each(['upload', 'generated'] as const)('rejects %s publication after identity changes during download', async kind => {
  mock.root = temp()
  const { createProject, projectDirById } = await import('../projects/repository')
  const { importRemoteAsset, listProjectAssets } = await import('./projectAssetStore')
  const project = createProject({ rootPath: temp(), name: 'remote', payload: {} })
  const root = projectDirById(project.id)!
  mock.fetch.mockImplementation(async () => {
    for (const name of fs.readdirSync(path.join(root, '.nomi')).filter(name => name.startsWith('project') && name.endsWith('.json'))) {
      const target = path.join(root, '.nomi', name)
      const record = JSON.parse(fs.readFileSync(target, 'utf8'))
      fs.writeFileSync(target, JSON.stringify({ ...record, projectGeneration: record.projectGeneration + 1 }))
    }
    return { bytes: Buffer.from('remote content'), contentType: 'application/octet-stream' }
  })
  const target = { projectId: project.id, url: 'https://example.com/file.bin' }
  await expect(importRemoteAsset(kind === 'generated' ? { ...target, kind, expectedKind: 'image' } : { ...target, kind, expectedKind: null }))
    .rejects.toMatchObject({ code: 'project_binding_stale' })
  expect(listProjectAssets({ projectId: project.id }).items).toEqual([])
})

it('revokes interactive downloads without cancelling explicit background imports', async () => {
  mock.root = temp()
  const { createProject } = await import('../projects/repository')
  const { importRemoteAsset, listProjectAssets } = await import('./projectAssetStore')
  const project = createProject({ rootPath: temp(), name: 'remote', payload: {} })
  let current = true
  // 生成产物要过落盘关口（字节就是说好的那一类）：用一张真 PNG，不是认不出的字节。
  const png = fs.readFileSync(path.join(__dirname, '../providerAdapter/__fixtures__/certification-media/valid.png'))
  mock.fetch.mockImplementation(async () => {
    current = false
    return { bytes: png, contentType: 'application/octet-stream' }
  })
  const payload = { projectId: project.id, url: 'https://example.com/file.bin', kind: 'generated' as const, expectedKind: 'image' as const }
  await expect(importRemoteAsset(payload, { assertCurrent() {
    if (!current) throw Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' })
  } })).rejects.toMatchObject({ code: 'project_binding_stale' })
  expect(listProjectAssets({ projectId: project.id }).items).toEqual([])
  await expect(importRemoteAsset(payload)).resolves.toMatchObject({ projectId: project.id })
  expect(listProjectAssets({ projectId: project.id }).items).toHaveLength(1)
})
