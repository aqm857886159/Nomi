import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererWarn: vi.fn(), logRendererError: vi.fn(), logRendererInfo: vi.fn() }))

import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopBridge } from '../../desktop/bridge'
import { quarantineOfRecord } from './projectNormalize'
import { readLocalProjectAsync, renameLocalProject, saveProjectRecord, takeQuarantineNotice } from './projectRepository'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import { quarantineWriteResult } from '../../../electron/projects/projectQuarantine'

/**
 * 「一项不合格不丢作品」的盘上证明：真目录 + 主进程真的隔离区写函数（含 IPC 包络），IPC 用 structuredClone 模拟。
 * 设计卡 ★9 A3 / A5，以及第 2 轮独立验收找到的三条路：列表页改名、一次超过 20 项、隔离区写一半 / 排在项目文件之后。
 */
let dir = ''
let projectN = 0
let projectId = ''
const file = () => path.join(dir, 'project.json')
const qdir = () => path.join(dir, '.nomi', 'quarantine')
const readDisk = () => JSON.parse(fs.readFileSync(file(), 'utf8'))
const qbodies = () => (fs.existsSync(qdir()) ? fs.readdirSync(qdir()).map(name => fs.readFileSync(path.join(qdir(), name), 'utf8')) : [])

function installBridge() {
  const read = () => (fs.existsSync(file()) ? JSON.parse(fs.readFileSync(file(), 'utf8')) : null)
  const order: string[] = []
  const save = vi.fn(async (_id: string, record: unknown) => {
    order.push('project.json')
    const previous = read() ?? {}
    const tmp = `${file()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ name: previous.name ?? 'P', ...(structuredClone(record) as object) }))
    fs.renameSync(tmp, file())
    return { ok: true as const, value: read() }
  })
  const quarantineWrite = vi.fn(async (_id: string, items: unknown) => {
    order.push('quarantine')
    return quarantineWriteResult(dir, structuredClone(items))
  })
  vi.mocked(getDesktopBridge).mockReturnValue({ projects: { save, quarantineWrite, readAsync: vi.fn(async () => read()), read: vi.fn(() => read()) } } as unknown as DesktopBridge)
  return { save, quarantineWrite, order }
}

const base = createDefaultWorkbenchProjectPayload()
const documentId = base.activeDocumentId!
const shot = (prompt: string) => ({ index: 1, durationSec: 3, anchorIds: [], prompt })
const design = (id: string, title: string, prompt: string, over: Record<string, unknown> = {}) => ({
  id, documentId, title, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1,
  plan: { title: 'p', anchors: [], shots: [shot(prompt)] }, ...over,
})
const withDesigns = (list: unknown[]) => ({ ...base, storyboardDesignsByDocumentId: { [documentId]: list } })
const record = (payload: unknown, revision = 1) => ({ id: projectId, name: 'P', createdAt: 1, updatedAt: 1, revision, version: 1, payload })
const designIdsOnDisk = () => ((readDisk().payload.storyboardDesignsByDocumentId?.[documentId] ?? []) as Array<{ id: string }>).map(d => d.id)
const lockQuarantine = () => { fs.mkdirSync(qdir(), { recursive: true }); fs.chmodSync(qdir(), 0o500) }
const unlockQuarantine = () => fs.chmodSync(qdir(), 0o755)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-no-lost-work-'))
  projectN += 1
  projectId = `p${projectN}` // 每条用新 id：模块里「欠着 / 没说过」按项目 id 记
  vi.mocked(getDesktopBridge).mockReset()
})
afterEach(() => {
  try { unlockQuarantine() } catch { /* not created */ }
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('saving with one unsavable item', () => {
  it('saves the canvas change, revision+1, and keeps the raw item in quarantine — quarantine is written BEFORE project.json', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([design('good', 'G', 'G')]), 4)))
    const { order } = installBridge()
    const nodes = [{ id: 'n1', kind: 'image', title: 'new', position: { x: 0, y: 0 } }]
    const saved = await saveProjectRecord(projectId, { ...withDesigns([design('good', 'G', 'G'), design('bad', '私有标题', 'NEW-BAD', { status: 'x' })]), generationCanvas: { ...base.generationCanvas, nodes } } as never)
    expect(readDisk().revision).toBe(5)
    expect(readDisk().payload.generationCanvas.nodes).toEqual(nodes)
    expect(designIdsOnDisk()).toEqual(['good'])
    expect(qbodies().some(b => b.includes('NEW-BAD'))).toBe(true)
    expect(order).toEqual(['quarantine', 'project.json'])
    expect(quarantineOfRecord(saved)).toHaveLength(1)
  })

  it('a project with nothing wrong never touches quarantine', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(base)))
    const { quarantineWrite } = installBridge()
    await saveProjectRecord(projectId, base)
    expect(quarantineWrite).not.toHaveBeenCalled()
  })

  it('quarantine cannot be written (EPERM) → this save does not overwrite project.json, and says why', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([design('good', 'G', 'G')]), 4)))
    installBridge()
    lockQuarantine()
    const before = fs.readFileSync(file(), 'utf8')
    const error = await saveProjectRecord(projectId, withDesigns([design('good', 'G', 'G'), design('bad', 'B', 'NEW-BAD', { status: 'x' })]) as never).then(() => null, (e: unknown) => e)
    expect((error as { reason?: { kind?: string } })?.reason?.kind).toBe('write-denied')
    expect(fs.readFileSync(file(), 'utf8')).toBe(before)
    // 杀毒放手后下一次保存照常：内容进隔离区，项目文件才写。
    unlockQuarantine()
    await saveProjectRecord(projectId, withDesigns([design('good', 'G', 'G'), design('bad', 'B', 'NEW-BAD', { status: 'x' })]) as never)
    expect(qbodies().some(b => b.includes('NEW-BAD'))).toBe(true)
  })

  it('the same unsavable content is announced once, not on every autosave; changed content is announced again', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([]))))
    installBridge()
    const bad = (prompt: string) => withDesigns([design('bad', 'B', prompt, { status: 'x' })]) as never
    await saveProjectRecord(projectId, bad('v1'))
    expect(takeQuarantineNotice(projectId)).toHaveLength(1)
    await saveProjectRecord(projectId, bad('v1'))
    await saveProjectRecord(projectId, bad('v1'))
    expect(takeQuarantineNotice(projectId)).toEqual([])
    await saveProjectRecord(projectId, bad('v2'))
    expect(takeQuarantineNotice(projectId).map(n => n.origin)).toEqual(['save'])
  })
})

describe('opening a project that already holds a bad item', () => {
  it('opens it, drops only that item, keeps the raw item in quarantine, and announces it once', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([design('good', 'G', 'G'), design('bad', 'B', 'OLD-BAD', { status: 'x' })]), 3)))
    installBridge()
    const opened = await readLocalProjectAsync(projectId)
    expect(opened?.payload.storyboardDesignsByDocumentId?.[documentId]?.map(item => item.id)).toEqual(['good'])
    expect(qbodies().some(b => b.includes('OLD-BAD'))).toBe(true)
    const notice = takeQuarantineNotice(projectId)
    expect(notice.map(n => [n.origin, n.relativePath.startsWith('.nomi/quarantine/')])).toEqual([['open', true]])
    await readLocalProjectAsync(projectId)
    expect(takeQuarantineNotice(projectId)).toEqual([])
  })

  it('quitting Nomi and reopening the same project (bad item still in project.json) tells the creator again — once per session', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([design('bad', 'B', 'OLD-BAD', { status: 'x' })]))))
    installBridge()
    await readLocalProjectAsync(projectId)
    expect(takeQuarantineNotice(projectId)).toHaveLength(1)
    // 新会话 = 模块重新载入（「本次会话说过」只在内存里）。隔离区里那份已经在了（fresh=false），打开时照样要说。
    const bridgeObject = vi.mocked(getDesktopBridge)()
    vi.resetModules()
    // eslint-disable-next-line no-restricted-syntax -- 重启模拟：新会话 = 模块重新载入，只能动态 import
    vi.mocked((await import('../../desktop/bridge')).getDesktopBridge).mockReturnValue(bridgeObject)
    // eslint-disable-next-line no-restricted-syntax -- 重启模拟：同上
    const next = await import('./projectRepository')
    await next.readLocalProjectAsync(projectId)
    expect(next.takeQuarantineNotice(projectId).map(n => n.origin)).toEqual(['open'])
    await next.readLocalProjectAsync(projectId)
    expect(next.takeQuarantineNotice(projectId)).toEqual([])
  })

  it('25 bad items on open → all 25 recoverable after the next save (no 20-item cap)', async () => {
    const list = Array.from({ length: 25 }, (_, i) => design(`d${i}`, `分镜${i}`, `BAD-${i}-END`, { status: 'x' }))
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns(list))))
    installBridge()
    const opened = await readLocalProjectAsync(projectId)
    await saveProjectRecord(projectId, opened!.payload)
    const q = qbodies().join('\n')
    expect(list.filter((_, i) => q.includes(`BAD-${i}-END`))).toHaveLength(25)
  })

  it('quarantine fails on open (EPERM) → the next save does not overwrite; close → reopen still finds the item on disk', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([design('good', 'G', 'G'), design('bad', 'B', 'OLD-BAD', { status: 'x' })]))))
    installBridge()
    lockQuarantine()
    const opened = await readLocalProjectAsync(projectId)
    expect(opened).toBeTruthy() // 隔离区写不进不挡打开
    await expect(saveProjectRecord(projectId, opened!.payload)).rejects.toBeTruthy()
    expect(fs.readFileSync(file(), 'utf8')).toContain('OLD-BAD')
    // 关窗（保存失败时关窗被取消，见 useProjectWindowLifecycle）→ 重开：盘上那一份还在。
    await readLocalProjectAsync(projectId)
    expect(fs.readFileSync(file(), 'utf8')).toContain('OLD-BAD')
    unlockQuarantine()
    const reopened = await readLocalProjectAsync(projectId)
    await saveProjectRecord(projectId, reopened!.payload)
    expect(fs.readFileSync(file(), 'utf8')).not.toContain('OLD-BAD')
    expect(qbodies().some(b => b.includes('OLD-BAD'))).toBe(true)
  })

  it('a later save by any caller (e.g. deleting an asset) first stashes the open-time item that is still owed', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([design('bad', 'B', 'OLD-BAD', { status: 'x' })]))))
    const { order } = installBridge()
    lockQuarantine()
    const opened = await readLocalProjectAsync(projectId)
    unlockQuarantine()
    order.length = 0
    await saveProjectRecord(projectId, opened!.payload)
    expect(order).toEqual(['quarantine', 'project.json'])
    expect(qbodies().some(b => b.includes('OLD-BAD'))).toBe(true)
  })
})

describe('renaming from the project library', () => {
  it('a bad storyboard on disk survives a rename byte for byte (rename does not rewrite content)', async () => {
    fs.writeFileSync(file(), JSON.stringify(record(withDesigns([design('g', 'G', 'G'), design('d1', '旧坏项', 'OLD-BAD', { status: 'x' })]))))
    installBridge()
    const payloadBefore = JSON.stringify(readDisk().payload)
    await renameLocalProject(projectId, '新名字')
    expect(readDisk().name).toBe('新名字')
    expect(readDisk().revision).toBe(2)
    expect(JSON.stringify(readDisk().payload)).toBe(payloadBefore)
    expect(designIdsOnDisk()).toEqual(['g', 'd1'])
  })
})
