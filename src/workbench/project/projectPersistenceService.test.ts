import { describe, expect, it } from 'vitest'
import {
  migratedRecordNeedsPersist,
  workbenchPayloadSemanticEquals,
} from './projectPersistenceService'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'

// 默认画布已是空（删了预设两卡），需要「带节点」差异的用例自带一个显式节点 fixture
// （比依赖默认种子更健壮：默认再变也不影响这些语义相等/写盘判定的断言）。
function payloadWithOneNode(): ReturnType<typeof createDefaultWorkbenchProjectPayload> {
  const payload = createDefaultWorkbenchProjectPayload()
  const node = {
    id: 'n1',
    kind: 'image' as const,
    title: '镜头 1',
    position: { x: 0, y: 0 },
    size: { width: 340, height: 280 },
    prompt: '',
    references: [],
    history: [],
    status: 'idle' as const,
    meta: {},
    categoryId: 'shots',
    shotIndex: 1,
  }
  payload.generationCanvas = { ...payload.generationCanvas, nodes: [node] }
  return payload
}

function makeRecord(overrides: Partial<WorkbenchProjectRecordV1> = {}): WorkbenchProjectRecordV1 {
  return {
    id: overrides.id ?? 'p1',
    name: overrides.name ?? 'Project',
    createdAt: overrides.createdAt ?? 100,
    updatedAt: overrides.updatedAt ?? 200,
    revision: overrides.revision ?? 7,
    savedAt: overrides.savedAt ?? 200,
    version: 1,
    payload: overrides.payload ?? createDefaultWorkbenchProjectPayload(),
  }
}

describe('workbenchPayloadSemanticEquals（语义相等：不靠引用相等）', () => {
  it('内容相同但引用不同的两份 payload 判为相等', () => {
    const a = createDefaultWorkbenchProjectPayload()
    const b = createDefaultWorkbenchProjectPayload()
    expect(a).not.toBe(b) // 不同引用
    expect(workbenchPayloadSemanticEquals(a, b)).toBe(true)
  })

  it('仅 bookkeeping 元字段不同（updatedAt 等 wall-clock）判为相等（不因 Date.now 边界 flaky）', () => {
    const a = createDefaultWorkbenchProjectPayload()
    const b = createDefaultWorkbenchProjectPayload()
    // 模拟两次新建相差 1ms：内容全等，仅 workbenchDocument.updatedAt 不同。
    b.workbenchDocument = { ...b.workbenchDocument, updatedAt: a.workbenchDocument.updatedAt + 1 }
    expect(b.workbenchDocument.updatedAt).not.toBe(a.workbenchDocument.updatedAt)
    expect(workbenchPayloadSemanticEquals(a, b)).toBe(true)
  })

  it('深拷贝（不同对象/数组引用，内容一致）判为相等', () => {
    const a = createDefaultWorkbenchProjectPayload()
    const b = JSON.parse(JSON.stringify(a)) as typeof a
    expect(workbenchPayloadSemanticEquals(a, b)).toBe(true)
  })

  it('对象 key 顺序不同但内容一致判为相等（不靠 JSON 字符串顺序）', () => {
    const a = { ...createDefaultWorkbenchProjectPayload(), generationCanvasLastSeq: 3 }
    const reordered = { generationCanvasLastSeq: 3, ...createDefaultWorkbenchProjectPayload() }
    expect(workbenchPayloadSemanticEquals(a, reordered)).toBe(true)
  })

  it('节点真有变更（如 shotIndex 不同）判为不相等', () => {
    const a = payloadWithOneNode()
    const b = JSON.parse(JSON.stringify(a)) as typeof a
    b.generationCanvas = {
      ...b.generationCanvas,
      nodes: b.generationCanvas.nodes.map((node, i) => (i === 0 ? { ...node, shotIndex: 99 } : node)),
    }
    expect(workbenchPayloadSemanticEquals(a, b)).toBe(false)
  })

  it('节点数量不同判为不相等', () => {
    const a = payloadWithOneNode()
    const b = JSON.parse(JSON.stringify(a)) as typeof a
    b.generationCanvas = { ...b.generationCanvas, nodes: [] }
    expect(workbenchPayloadSemanticEquals(a, b)).toBe(false)
  })
})

describe('migratedRecordNeedsPersist（迁移幂等：真无变更不写盘、不 ++revision）', () => {
  it('迁移返回新引用但内容等价 → 不需要写盘（修 revision 漂移根因）', () => {
    const original = makeRecord({ revision: 706 })
    // 模拟「多道迁移任一返回新引用」：顶层、payload、generationCanvas 全是新对象，但内容一致。
    const upgraded: WorkbenchProjectRecordV1 = {
      ...original,
      payload: {
        ...original.payload,
        generationCanvas: { ...original.payload.generationCanvas, nodes: [...original.payload.generationCanvas.nodes] },
      },
    }
    expect(upgraded).not.toBe(original)
    expect(upgraded.payload).not.toBe(original.payload)
    expect(migratedRecordNeedsPersist(original, upgraded)).toBe(false)
  })

  it('完全同一引用 → 不需要写盘', () => {
    const original = makeRecord()
    expect(migratedRecordNeedsPersist(original, original)).toBe(false)
  })

  it('payload 真有内容变更 → 需要写盘', () => {
    const original = makeRecord({ payload: payloadWithOneNode() })
    const upgraded: WorkbenchProjectRecordV1 = {
      ...original,
      payload: {
        ...original.payload,
        generationCanvas: { ...original.payload.generationCanvas, nodes: [] },
      },
    }
    expect(migratedRecordNeedsPersist(original, upgraded)).toBe(true)
  })

  it('仅 revision/savedAt 等元字段不同、payload 等价 → 不需要写盘（元字段不该自己触发再保存）', () => {
    // 共用同一 payload 内容（深拷贝成新引用），只让 bookkeeping 元字段不同：
    const payload = createDefaultWorkbenchProjectPayload()
    const original = makeRecord({ revision: 5, savedAt: 1000, updatedAt: 1000, payload })
    const upgraded = makeRecord({
      revision: 5,
      savedAt: 9999,
      updatedAt: 9999,
      payload: JSON.parse(JSON.stringify(payload)) as typeof payload,
    })
    expect(upgraded.payload).not.toBe(original.payload)
    expect(migratedRecordNeedsPersist(original, upgraded)).toBe(false)
  })

  it('name 改变 → 需要写盘（名字是用户可见内容）', () => {
    const payload = createDefaultWorkbenchProjectPayload()
    const original = makeRecord({ name: 'Old', payload })
    const upgraded = makeRecord({ name: 'New', payload: JSON.parse(JSON.stringify(payload)) as typeof payload })
    expect(migratedRecordNeedsPersist(original, upgraded)).toBe(true)
  })
})
