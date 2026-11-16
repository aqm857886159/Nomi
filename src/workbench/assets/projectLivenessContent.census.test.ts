// 普查：素材文件存活判定读的「项目内容」有没有漏掉哪个会装文件引用的地方。
// 每个声明为「项目寿命」的 store 字段都必须在 PROJECT_SESSION_FIELD_ROLES 里归了类（扫 / 不装引用 + 理由）；
// 表里不许有已经不存在的字段。新加一个项目寿命字段却没归类 → 这里红，先回 project/workbenchProjectContent.ts 的归类表判它装不装引用。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { storeLifetimeRegistry } from '../project/storeLifetime'
import { MAIN_PROCESS_RECORDS_NOT_LIVE } from './projectLivenessContent'
import type { ProjectAgentAttachmentClaim } from '../../../electron/shared/workbenchInput'
import { PROJECT_SESSION_FIELD_ROLES, readCurrentWorkbenchProjectContent } from '../project/workbenchProjectContent'
import type { WorkbenchProjectPayload } from '../project/projectRecordSchema'

const SRC = path.resolve(__dirname, '../..')

function declaringModules(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : declaringModules(full)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || entry.name === 'storeLifetime.ts') return []
    return fs.readFileSync(full, 'utf8').includes('declareStoreLifetime(') ? [full] : []
  })
}

// 声明寿命的模块在收集阶段（顶层）就载入：冷转换不计进单条用例的超时。
const modules = declaringModules(SRC)
for (const file of modules) await import(/* @vite-ignore */ file)

describe('存活判定的项目内容普查', () => {
  it('每个项目寿命字段都归了类，表里没有过期字段', () => {
    expect(modules.length).toBeGreaterThan(10)
    const declared = new Map<string, Set<string>>()
    for (const declaration of storeLifetimeRegistry()) {
      for (const [field, lifetime] of Object.entries(declaration.fields)) {
        if (lifetime !== 'project') continue
        if (!declared.has(declaration.store)) declared.set(declaration.store, new Set())
        declared.get(declaration.store)!.add(field)
      }
    }
    const unclassified = [...declared].flatMap(([store, fields]) => [...fields].filter((field) => !PROJECT_SESSION_FIELD_ROLES[store]?.[field]).map((field) => `${store}.${field}`))
    const stale = Object.entries(PROJECT_SESSION_FIELD_ROLES).flatMap(([store, roles]) => Object.keys(roles).filter((field) => !declared.get(store)?.has(field)).map((field) => `${store}.${field}`))
    expect(unclassified, '新的项目寿命字段要先在 PROJECT_SESSION_FIELD_ROLES 里判它装不装文件引用').toEqual([])
    expect(stale, 'PROJECT_SESSION_FIELD_ROLES 里有已经不存在的字段').toEqual([])
  })

  it('项目文件的每个字段都有归属：除待删清单外全扫（加字段 → 这里编译不过，先判它）', () => {
    const payloadFields: Record<keyof WorkbenchProjectPayload, 'scanned' | 'not-a-reference'> = {
      workbenchDocuments: 'scanned', activeDocumentId: 'scanned', workbenchDocument: 'scanned', timeline: 'scanned', generationCanvas: 'scanned',
      categories: 'scanned', generationCanvasLastSeq: 'scanned', storyboardDesignsByDocumentId: 'scanned', editingPanelLayout: 'scanned',
      pendingAssetDeletions: 'not-a-reference',
    }
    const written = Object.keys(readCurrentWorkbenchProjectContent())
    // 写盘那份（已加载项目）= 全部 scanned 字段，减去只在读侧迁移用的旧单文档字段。
    expect(written.sort()).toEqual(Object.entries(payloadFields).filter(([key, role]) => role === 'scanned' && key !== 'workbenchDocument').map(([key]) => key).sort())
  })

  it('主进程三份「不算活引用」的数据：助手输入只按身份 claim（assetId + version）存，不带文件地址', () => {
    // 往 claim 里加字段（比如带上地址）→ 这里编译不过 / 红：先回 MAIN_PROCESS_RECORDS_NOT_LIVE 重判它算不算活引用。
    const claimKeys: Record<keyof ProjectAgentAttachmentClaim, true> = { assetId: true, version: true }
    expect(Object.keys(claimKeys).sort()).toEqual(['assetId', 'version'])
    expect(Object.keys(MAIN_PROCESS_RECORDS_NOT_LIVE).sort()).toEqual(['agentConversationHistory', 'agentQueuedInputs', 'productionRunLedger'])
  })
})
