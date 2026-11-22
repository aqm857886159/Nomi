// 普查：素材文件存活判定读的「项目内容」有没有漏掉哪个会装文件引用的地方。
// 每个声明为「项目寿命」的 store 字段都必须在 PROJECT_SESSION_FIELD_ROLES 里归了类（扫 / 不装引用 + 理由）；
// 表里不许有已经不存在的字段。新加一个项目寿命字段却没归类 → 这里红，先回 project/workbenchProjectContent.ts 的归类表判它装不装引用。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { storeLifetimeRegistry } from '../project/storeLifetime'
import { MAIN_PROCESS_RECORDS_NOT_LIVE, readLoadedProjectLivenessContent } from './projectLivenessContent'
import { collectProjectFileReferences, isProjectFileReferenced } from './assetResultDeletion'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { ProjectAgentAttachmentClaim } from '../../../electron/shared/workbenchInput'
import { PROJECT_SESSION_FIELD_ROLES, readCurrentWorkbenchProjectContent } from '../project/workbenchProjectContent'
import type { WorkbenchProjectPayload } from '../project/projectRecordSchema'

const SRC = path.resolve(__dirname, '../..')

// ── 类型见证：字段的类型里有没有装地址的键（url / src / path / uri / href……），由编译器算，不靠人记 ─────────────
// 下面两张表的键集合由类型强制（多一个、少一个都编译不过，`pnpm run check:test-types` 守）：
// 以后给 store 加一个类型里装得下地址的字段，这里先编译不过，逼着判它；判的结果再和归类表对账（上面第三条用例）。
type AddressKey = `${string}${'url' | 'Url' | 'URL' | 'src' | 'Src' | 'path' | 'Path' | 'uri' | 'Uri' | 'href' | 'Href'}${string}`
type Next = [never, 0, 1, 2, 3, 4, 5, 6, 7]
type MayHoldAddress<T, D extends number = 7> =
  [D] extends [never] ? false
    : T extends (...args: never[]) => unknown ? false
    : T extends readonly (infer U)[] ? MayHoldAddress<U, Next[D]>
    : T extends ReadonlyMap<unknown, infer V> ? MayHoldAddress<V, Next[D]>
    : T extends ReadonlySet<infer V> ? MayHoldAddress<V, Next[D]>
    : T extends object ? ([Extract<keyof T, AddressKey>] extends [never]
      ? (true extends { [K in keyof T]-?: MayHoldAddress<T[K], Next[D]> }[keyof T] ? true : false)
      : true)
    : false
type AddressFields<S> = { [K in keyof S]-?: true extends MayHoldAddress<S[K]> ? K : never }[keyof S] & string
/** true = 装得下地址，必须扫；字符串 = 不扫的理由（归类表里同样要写成不装引用）。 */
type AddressVerdicts<S> = Record<AddressFields<S>, true | string>

const WORKBENCH_ADDRESS_FIELDS: AddressVerdicts<ReturnType<typeof useWorkbenchStore.getState>> = {
  timeline: true, storyboardDesignsByDocumentId: true, projectAgentDraftIntent: true, selectedLibraryPrompt: true,
  projectAgentAttachments: true,
  timelineUndoStack: true, timelineRedoStack: true, detachedTimelineClips: true,
  projectAgentRecoveredDrafts: true, // 窗口寿命，不在归类表里；装配口单独读它（recoveredAgentDrafts）
}
const CANVAS_ADDRESS_FIELDS: AddressVerdicts<ReturnType<typeof useGenerationCanvasStore.getState>> = {
  nodes: true, heldNodeOutcomes: true,
  workflowTemplates: '进程寿命的工作流模板，不属于任何项目（不在归类表里）',
  generationAiMessages: '画布 AI 已发出的对话记录：记的是过去说过什么，同助手对话历史',
}

/** 照着字段现值的形状塞一个引用进去：数组加一项、对象加一个键、字符串换成地址、空值换成带地址的对象。 */
function probeLike(current: unknown, url: string): unknown {
  if (Array.isArray(current)) return [...current, { probe: url }]
  if (typeof current === 'string') return `参考 ${url}`
  if (current && typeof current === 'object') return { ...(current as Record<string, unknown>), __probe: { url } }
  return { probe: url }
}

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

  it('类型上装得下地址的字段，要么被扫，要么写明为什么不算活引用（误归成不装引用 → 这里红）', () => {
    const roleOf = (store: string, field: string) => PROJECT_SESSION_FIELD_ROLES[store]?.[field]
    const misclassified = ([['useWorkbenchStore', WORKBENCH_ADDRESS_FIELDS], ['useGenerationCanvasStore', CANVAS_ADDRESS_FIELDS]] as const)
      .flatMap(([store, fields]) => Object.entries(fields as Record<string, true | string>).flatMap(([field, verdict]) => {
        const role = roleOf(store, field)
        if (role === undefined) return [] // 不是项目寿命字段（进程 / 窗口级），不归这张表管
        const scanned = typeof role === 'string'
        // verdict === true：装得下就必须扫；字符串 = 不扫的理由（只能给「过去的记录」这类，且归类表里必须同样写成不装引用）。
        return (verdict === true) === scanned ? [] : [`${store}.${field}`]
      }))
    expect(misclassified, '类型里带 url / src / path 这类键的字段被归成了不装引用（或反过来）：先回归类表重判').toEqual([])
  })

  it('归成扫的每个字段：往里放一个引用，经装配口扫得到；pending 关项目也算，session-undo 关项目不算', () => {
    const projectId = 'census-project'
    const fileRef = { projectId, relativePath: 'assets/generated/census probe.png' }
    const url = `nomi-local://asset/${projectId}/assets/generated/census%20probe.png`
    const stores = { useWorkbenchStore, useGenerationCanvasStore } as const
    const failures: string[] = []
    for (const [storeName, roles] of Object.entries(PROJECT_SESSION_FIELD_ROLES)) {
      for (const [field, role] of Object.entries(roles)) {
        if (typeof role !== 'string') continue
        const store = stores[storeName as keyof typeof stores]
        if (!store) { failures.push(`${storeName}.${field}：归成扫，但装配口不读这个 store`); continue }
        useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] }, projectId)
        const before = (store.getState() as unknown as Record<string, unknown>)[field]
        store.setState({ [field]: probeLike(before, url) } as never)
        const found = (moment: 'alive' | 'ending') => {
          const content = readLoadedProjectLivenessContent(projectId, moment)
          return content ? isProjectFileReferenced(fileRef, collectProjectFileReferences(content.nodes, content.rest)) : null
        }
        const expected = { alive: true, ending: role !== 'session-undo' }
        const actual = { alive: found('alive'), ending: found('ending') }
        if (actual.alive !== expected.alive || actual.ending !== expected.ending) failures.push(`${storeName}.${field}（${role}）：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
        store.setState({ [field]: before } as never)
      }
    }
    expect(failures).toEqual([])
  })

  it('主进程三份「不算活引用」的数据：助手输入只按身份 claim（assetId + version）存，不带文件地址', () => {
    // 往 claim 里加字段（比如带上地址）→ 这里编译不过 / 红：先回 MAIN_PROCESS_RECORDS_NOT_LIVE 重判它算不算活引用。
    const claimKeys: Record<keyof ProjectAgentAttachmentClaim, true> = { assetId: true, version: true }
    expect(Object.keys(claimKeys).sort()).toEqual(['assetId', 'version'])
    expect(Object.keys(MAIN_PROCESS_RECORDS_NOT_LIVE).sort()).toEqual(['agentConversationHistory', 'agentQueuedInputs', 'productionRunLedger'])
  })
})
