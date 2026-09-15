// MCP / Agent 素材导入被准入闸挡下时，模型拿到的是什么。
//
// 2026-09-15：这条路此前走 localFileCopy 的 `copyPathAsPlayableAsset`，**跳过准入闸**，
// 所以「被拒」这件事在 Agent 侧根本不存在。接到唯一 owner（importLocalFile）之后它会发生，
// 于是必须钉住：拒绝不许静默转进成一句「导入失败」——那会让模型原地重试同一个文件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MediaImportRejectedError } from '../assets/localFileImport'
import type { MediaImportRejection } from '../shared/contracts/mediaImportPolicy'

const importLocalFile = vi.hoisted(() => vi.fn())
vi.mock('../assets/localFileImport', async (importOriginal) => {
  const original = await importOriginal<typeof import('../assets/localFileImport')>()
  return { ...original, importLocalFile }
})

let projectsRoot = ''

async function loadCore() {
  return await import('./core')
}

describe('MCP 素材导入的拒绝路径', () => {
  beforeEach(() => {
    projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-import-reject-'))
    process.env.NOMI_PROJECTS_DIR = projectsRoot
    importLocalFile.mockReset()
  })
  afterEach(() => {
    fs.rmSync(projectsRoot, { recursive: true, force: true })
    delete process.env.NOMI_PROJECTS_DIR
  })

  it.each<[MediaImportRejection, RegExp[]]>([
    [
      { reason: 'no-disk-space', fileBytes: 12 * 1024 * 1024, freeBytes: 3 * 1024 * 1024, neededBytes: 25 * 1024 * 1024 },
      [/12\.0MB/, /3\.0MB/, /25\.0MB/],
    ],
    [
      { reason: 'over-hard-cap', fileBytes: 40 * 1024 * 1024, capBytes: 30 * 1024 * 1024, because: '附件整份随请求进模型上下文' },
      [/40\.0MB/, /30\.0MB/, /附件整份随请求进模型上下文/],
    ],
    [
      { reason: 'unsupported-kind', kind: 'audio', accepted: ['image', 'video'], narrowedBecause: '画布节点只有图/视频两种落点' },
      [/audio/, /image\/video/, /画布节点只有图\/视频两种落点/],
    ],
  ])('把 $reason 翻成带数字的一句话，而不是「导入失败」', async (rejection, patterns) => {
    const { mcpImportRejectionMessage } = await import('./mcpImportRejectionMessage')
    const message = mcpImportRejectionMessage('海边.mp4', rejection)
    expect(message).toContain('海边.mp4')
    for (const pattern of patterns) expect(message).toMatch(pattern)
    // 反向断言：一句不带数字的「导入失败」正是这条测试要挡的东西。
    expect(message).not.toBe('导入失败')
  })

  it('准入闸挡下时，importProjectAsset 抛出的是那一支自己的数字，不是被吞掉的通用错误', async () => {
    const { createNamedProject, importProjectAsset } = await loadCore()
    const project = createNamedProject('拒绝路径')
    const source = path.join(projectsRoot, 'clip.mp4')
    fs.writeFileSync(source, Buffer.alloc(2048, 7))
    importLocalFile.mockRejectedValueOnce(new MediaImportRejectedError(
      { reason: 'no-disk-space', fileBytes: 2048, freeBytes: 1024, neededBytes: 5120 },
      'clip.mp4',
    ))

    await expect(importProjectAsset({ projectId: project.id, path: source })).rejects.toThrow(/磁盘放不下/)
    expect(importLocalFile).toHaveBeenCalledTimes(1)
    // 走的是唯一那条落盘路，且明确允许按路径导入（MCP 给的是磁盘路径而不是字节）。
    expect(importLocalFile.mock.calls[0][0]).toMatchObject({ projectId: project.id, kind: 'imported' })
    expect(importLocalFile.mock.calls[0][1]).toEqual({ allowSourcePath: true })
  })
})
