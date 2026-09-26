import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeWorkspaceManifest } from '../workspace/workspaceManifest'
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-import-dedup-')))
// sanitizeName 用真的：假替身不截断，落盘名的截断规则在这里就测不到（2026-09-26 `.bin` 扩展名）。
vi.mock('../projects/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../projects/repository')>(),
  projectDirById: (id: string) => path.join(root, id),
}))
const { writeAsset, copyAssetFile, listProjectAssets } = await import('./projectAssetStore')
type Asset = { id: string; data: { absolutePath: string; url: string } }
const bytes = Buffer.from('same media bytes')
const write = async (project = 'one', content = bytes, name = 'sample.png', kind = 'upload') => await writeAsset(project, content, name, 'image/png', { kind }) as Asset
beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root)
  for (const id of ['one', 'two']) {
    const directory = path.join(root, id); fs.mkdirSync(directory)
    writeWorkspaceManifest(directory, { id, name: id, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
      immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1, payload: {} })
  }
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
describe('project upload content identity', () => {
  it('reuses the same bytes across successive imports and different filenames', async () => {
    const first = await write()
    expect((await write('one', bytes, 'renamed.png')).id).toBe(first.id)
    expect(listProjectAssets({ projectId: 'one' }).items).toHaveLength(1)
  })
  it('converges concurrent native copies and bytes imports without losing content', async () => {
    const source = path.join(root, 'source.png'); fs.writeFileSync(source, bytes)
    const pending = [copyAssetFile('one', source, 'native.png', 'image/png', { kind: 'upload' }), copyAssetFile('one', source, 'native.png', 'image/png', { kind: 'upload' })]
    const direct = await write()
    const copies = await Promise.all(pending) as Asset[]
    expect(copies.map(asset => asset.id)).toEqual([direct.id, direct.id])
    expect(fs.readFileSync(copies[0].data.absolutePath)).toEqual(bytes)
    expect(listProjectAssets({ projectId: 'one' }).items).toHaveLength(1)
  })
  it('reuses concurrent native imports and preserved metadata across module reload', async () => {
    const source = path.join(root, 'audio.wav'); fs.writeFileSync(source, bytes)
    const copies = await Promise.all([1, 2].map(() => copyAssetFile('one', source, 'audio.wav', 'audio/wav', { kind: 'upload', title: 'original' }))) as Asset[]
    expect(copies[0].id).toBe(copies[1].id)
    vi.resetModules()
    const reloaded = await import('./projectAssetStore')
    const repeated = await reloaded.writeAsset('one', bytes, 'renamed.wav', 'audio/wav', { kind: 'upload', title: 'replacement' }) as Asset & { data: { title: string } }
    expect(repeated.id).toBe(copies[0].id)
    expect(repeated.data.title).toBe('original')
    expect(fs.readdirSync(path.join(root, 'one')).some(name => name.startsWith('.nomi-upload-'))).toBe(false)
  })
  it('reuses a legacy upload concurrently through bytes and native entry points', async () => {
    const legacyDir = path.join(root, 'one/assets/imported/2026-09-09')
    fs.mkdirSync(legacyDir, { recursive: true })
    const original = path.join(legacyDir, 'original.png')
    fs.writeFileSync(original, bytes)
    fs.writeFileSync(`${original}.meta`, JSON.stringify({ kind: 'upload', title: 'kept' }))
    const source = path.join(root, 'renamed.png'); fs.writeFileSync(source, bytes)
    const [direct, native] = await Promise.all([write(), copyAssetFile('one', source, 'renamed.png', 'image/png', { kind: 'upload' })]) as Asset[]
    expect(direct.data.absolutePath).toBe(original)
    expect(native.id).toBe(direct.id)
    expect(JSON.parse(fs.readFileSync(`${original}.meta`, 'utf8')).contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(listProjectAssets({ projectId: 'one' }).items).toHaveLength(1)
  })
  it('invalidates legacy hash metadata when same-size file content changes', async () => {
    const legacyDir = path.join(root, 'one/assets/imported/2026-09-09')
    fs.mkdirSync(legacyDir, { recursive: true })
    const original = path.join(legacyDir, 'original.png')
    fs.writeFileSync(original, bytes)
    fs.writeFileSync(`${original}.meta`, JSON.stringify({ kind: 'upload' }))
    expect((await write()).data.absolutePath).toBe(original)
    fs.writeFileSync(original, Buffer.alloc(bytes.length, 65))
    fs.utimesSync(original, 1, 1)
    const reimport = await write()
    expect(reimport.data.absolutePath).not.toBe(original)
    expect(fs.readFileSync(reimport.data.absolutePath)).toEqual(bytes)
    expect(listProjectAssets({ projectId: 'one' }).items).toHaveLength(2)
  })
  it('keeps same-name different bytes and project ownership distinct', async () => {
    const first = await write()
    expect((await write('one', Buffer.from('different media bytes'))).id).not.toBe(first.id)
    expect((await write('two')).id).not.toBe(first.id)
    expect(listProjectAssets({ projectId: 'one' }).items).toHaveLength(2)
  })
  it.each(['null', '[]', '42', '"text"'])('ignores non-record legacy sidecar %s without blocking unrelated imports', async (json) => {
    const directory = path.join(root, 'one/assets/imported/2026-09-09')
    fs.mkdirSync(directory, { recursive: true })
    const original = path.join(directory, 'original.png')
    fs.writeFileSync(original, bytes)
    fs.writeFileSync(`${original}.meta`, json)
    const imported = await write()
    expect(fs.readFileSync(imported.data.absolutePath)).toEqual(bytes)
    expect(fs.readFileSync(`${original}.meta`, 'utf8')).toBe(json)
  })
  it('preserves externally changed content in a new hash directory and restores original content separately', async () => {
    const first = await write()
    expect((await write()).id).toBe(first.id)
    const changed = Buffer.alloc(bytes.length, 65)
    fs.writeFileSync(first.data.absolutePath, changed)
    const second = await write()
    expect(second.id).not.toBe(first.id)
    expect(fs.readFileSync(first.data.absolutePath)).toEqual(changed)
    expect(fs.readFileSync(second.data.absolutePath)).toEqual(bytes)
    expect((await write()).id).toBe(second.id)
  })
  it('preserves invalid new sidecars and creates a usable import without treating them as records', async () => {
    const first = await write()
    fs.writeFileSync(`${first.data.absolutePath}.meta`, 'null')
    const second = await write()
    expect(second.id).not.toBe(first.id)
    expect(fs.readFileSync(`${first.data.absolutePath}.meta`, 'utf8')).toBe('null')
    expect(fs.readFileSync(second.data.absolutePath)).toEqual(bytes)
  })
  it('does not deduplicate independent generated outputs or change their synchronous contract', () => {
    const jpeg = fs.readFileSync(path.join(__dirname, '../providerAdapter/__fixtures__/certification-media/valid.jpg'))
    const first = writeAsset('one', jpeg, 'result.jpg', 'image/jpeg', { kind: 'generated' }) as Asset
    const second = writeAsset('one', jpeg, 'result.jpg', 'image/jpeg', { kind: 'generated' }) as Asset
    expect(first).not.toBeInstanceOf(Promise)
    expect(second.id).not.toBe(first.id)
  })
  it('preserves independent non-upload captures', async () => {
    expect((await write('one', bytes, 'capture.png', 'browser-capture')).id).not.toBe((await write('one', bytes, 'capture.png', 'browser-capture')).id)
  })
})
