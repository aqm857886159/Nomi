// 选区投影的账：模型收到的文本要么列全，要么明说「共几个、列了几个、几个没列」，**不许静默少**。
//
// 事故（2026-10-21 设计准备线用生产函数实测）：画布选 12 个节点模型只收到 7 个，选 16 个以上只收到 6 个，
// 没有任何标记。直接原因有三个叠在一起：每条句柄的定位器都带着整份选区（O(N²) 字节）、投影只取前 16 条、
// 6000 字预算在最丰富的一档上一条条往回砍尾巴。这里把「账」写成不变式，对 N 档、长标题、混合句柄逐个钉住。
import { describe, expect, it } from 'vitest'
import {
  formatAgentContextSnapshot,
  projectAgentContextSnapshot,
  type AgentContextHandle,
  type AgentContextSnapshot,
} from './agentContextSnapshot'

const HARD_LIMIT = 6000

/** 与生产构造器 `resolveResidentSelection` 同形：每条句柄的定位器都带整份选区。 */
function canvasSnapshot(count: number, title = (index: number) => `镜头${index + 1}`): AgentContextSnapshot {
  const ids = Array.from({ length: count }, (_, index) => `gen-v2-image-lw9x${index.toString(36).padStart(3, '0')}-ab${index.toString(36).padStart(2, '0')}z`)
  return {
    version: 1,
    handles: ids.map((id, index): AgentContextHandle => ({
      id: `canvas-node:${id}`,
      kind: 'canvasNode',
      targetId: id,
      revision: '8',
      locator: { type: 'canvasSelection', nodeIds: ids },
      display: { title: title(index), subtitle: 'image' },
      intentRole: 'subject',
    })),
  }
}

function compactSnapshot(count: number, subtitleLength: number): AgentContextSnapshot {
  return {
    version: 1,
    handles: Array.from({ length: count }, (_, index): AgentContextHandle => ({
      id: `node-${index}`,
      kind: 'canvasNode',
      targetId: `target-${index}`,
      revision: '1',
      display: { title: `镜头${index}`, subtitle: 's'.repeat(subtitleLength) },
      intentRole: 'subject',
    })),
  }
}

function kindSnapshot(kind: AgentContextHandle['kind'], count: number): AgentContextSnapshot {
  return {
    version: 1,
    handles: Array.from({ length: count }, (_, index): AgentContextHandle => ({
      id: `${kind}-${index}`,
      kind,
      targetId: `${kind}-target-${index}`,
      revision: '1',
      display: { title: `${kind} ${index}`, subtitle: kind },
      intentRole: 'subject',
    })),
  }
}

type Payload = {
  total: number
  listed: number
  omitted?: number
  omittedByKind?: Array<{ kind: string; count: number }>
  omittedNote?: string
  handles: Array<{ kind: string; targetId: string; display: { title: string; subtitle?: string } }>
}

function payloadOf(text: string): Payload {
  return JSON.parse(text.slice(text.indexOf('\n') + 1)) as Payload
}

/** 账本不变式：total = listed + omitted；列出的句柄保持快照顺序；写出来的数与文本里真有的数一致。 */
function expectBalanced(snapshot: AgentContextSnapshot, text: string): Payload {
  const payload = payloadOf(text)
  expect(payload.total).toBe(snapshot.handles.length)
  expect(payload.handles).toHaveLength(payload.listed)
  expect(payload.listed + (payload.omitted ?? 0)).toBe(snapshot.handles.length)
  let cursor = 0
  for (const handle of payload.handles) {
    const found = snapshot.handles.findIndex((candidate, index) => index >= cursor && candidate.kind === handle.kind && candidate.targetId === handle.targetId)
    expect(found, `列出的 ${handle.kind}/${handle.targetId} 必须来自快照且保持顺序`).toBeGreaterThanOrEqual(cursor)
    cursor = found + 1
  }
  if (payload.listed < payload.total) {
    expect(payload.omitted, '少了就必须明说少了几个').toBe(payload.total - payload.listed)
    expect(payload.omittedNote, '少了就必须告诉模型去哪补读').toEqual(expect.stringContaining('omittedByKind'))
  } else {
    expect(payload.omitted, '没少就不出 omitted').toBeUndefined()
    expect(payload.omittedNote).toBeUndefined()
  }
  expect(text.length).toBeLessThanOrEqual(HARD_LIMIT)
  return payload
}

describe('formatAgentContextSnapshot · 选区投影的账', () => {
  it('画布节点的列出数只能是 0 或全部：N=1…200 以及 5000', () => {
    for (const count of [...Array.from({ length: 200 }, (_, index) => index + 1), 5000]) {
      const snapshot = canvasSnapshot(count)
      const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
      expect([0, count]).toContain(payload.listed)
      if (payload.listed === count) expect(payload.omitted).toBeUndefined()
      else expect(payload.omittedByKind).toEqual([{ kind: 'canvasNode', count }])
    }
  })

  it('画布选 10 个且放得下：10 个全列，没有省略说明', () => {
    const snapshot = canvasSnapshot(10)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(10)
    expect(payload.omittedNote).toBeUndefined()
  })

  it.each([1, 12, 16])('选 %i 个节点：一个不少（事故里 12 个只收到 7 个、16 个只收到 6 个）', (count) => {
    const snapshot = canvasSnapshot(count)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(count)
    expect(payload.omitted).toBeUndefined()
  })

  it.each([40, 256])('选 %i 个节点放不下：画布整类不列并按类明说剩余账', (count) => {
    const snapshot = canvasSnapshot(count)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(0)
    expect(payload.omittedByKind).toEqual([{ kind: 'canvasNode', count }])
  })

  it('首档列不全但较省档能列全：列全并保留能列全的最丰富档细节，不先整类不列', () => {
    const snapshot = compactSnapshot(40, 160)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(40)
    expect(payload.omitted).toBeUndefined()
    expect(payload.handles[0]?.display.subtitle).toBeUndefined()
    expect(payload.handles[0]?.display.title).toBe('镜头0')
  })

  it('混选首档列不全但较省档能列全：画布和时间轴都全列，不先把画布整类不列', () => {
    const clips = Array.from({ length: 5 }, (_, index): AgentContextHandle => ({
      id: `timeline-clip:clip-${index}`, kind: 'timelineClip', targetId: `clip-${index}`, revision: 'timeline-abc',
      locator: { type: 'timeRange', startMs: index * 1000, endMs: index * 1000 + 900 },
      display: { title: `片段${index + 1}`, subtitle: 'video' }, intentRole: 'target',
    }))
    const snapshot: AgentContextSnapshot = { version: 1, handles: [...compactSnapshot(30, 160).handles, ...clips] }
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(35)
    expect(payload.omitted).toBeUndefined()
  })

  it('不再把整份选区抄进每一条句柄：每个节点 id 在文本里至多出现两次（句柄 id + targetId）', () => {
    const snapshot = canvasSnapshot(12)
    const text = formatAgentContextSnapshot(snapshot)
    for (const handle of snapshot.handles) expect(text.split(handle.targetId).length - 1).toBeLessThanOrEqual(2)
  })

  it('一个超长标题的节点挤不掉其余节点：标题被截，条目一条不丢', () => {
    const snapshot = canvasSnapshot(24, (index) => (index === 3 ? '长'.repeat(20_000) : `镜头${index + 1}`))
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(24)
    expect(payload.handles[3]?.display.title.endsWith('…')).toBe(true)
    expect(payload.handles[4]?.display.title).toBe('镜头5')
  })

  it('每个节点的标题都很长时，连最省档也列不全，画布整类不列并明说省略数量', () => {
    const snapshot = canvasSnapshot(150, (index) => `${index + 1}-${'镜'.repeat(400)}`)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(0)
    expect(payload.omittedByKind).toEqual([{ kind: 'canvasNode', count: 150 }])
  })

  it('画布节点省略时指向 look_at_canvas，并提醒核对发送后选区是否变化', () => {
    const payload = expectBalanced(kindSnapshot('canvasNode', 150), formatAgentContextSnapshot(kindSnapshot('canvasNode', 150)))
    expect(payload.omitted).toBeGreaterThan(0)
    expect(payload.omittedNote).toContain('call look_at_canvas')
    expect(payload.omittedNote).toContain('selection changed after send')
    expect(payload.omittedNote).not.toContain('shrink the selection')
    // 核对的是画布这一类的数，不是整份快照的 total：混选时 total 还含时间轴等别的类，拿它比必然对不上。
    expect(payload.omittedNote).toContain('canvasNode count in omittedByKind')
    expect(payload.omittedNote).not.toContain('snapshot total')
  })

  it('只有时间轴片段省略时保留缩小或分批指引，不暗示 look_at_canvas', () => {
    const snapshot = kindSnapshot('timelineClip', 150)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.omitted).toBeGreaterThan(0)
    expect(payload.omittedNote).toContain('omitted kinds without a selected-marker reader')
    expect(payload.omittedNote).toContain('shrink the selection')
    expect(payload.omittedNote).toContain('send it in batches')
    expect(payload.omittedNote).not.toContain('look_at_canvas')
  })

  it('画布与时间轴同时省略时把两条按类型指引都写入同一说明', () => {
    const snapshot: AgentContextSnapshot = {
      version: 1,
      handles: [...kindSnapshot('canvasNode', 40).handles, ...kindSnapshot('timelineClip', 150).handles],
    }
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBeGreaterThan(0)
    expect(payload.omittedByKind).toEqual([
      { kind: 'canvasNode', count: 40 },
      { kind: 'timelineClip', count: expect.any(Number) },
    ])
    expect(payload.omittedByKind?.find((item) => item.kind === 'timelineClip')?.count).toBeGreaterThan(0)
    expect(payload.omittedByKind?.find((item) => item.kind === 'timelineClip')?.count).toBeLessThan(150)
    expect(payload.omittedNote).toContain('call look_at_canvas')
    expect(payload.omittedNote).toContain('shrink the selection')
  })

  it('5000 个句柄仍在线性账本内：总数、列数和按类省略数相等', () => {
    const snapshot: AgentContextSnapshot = {
      version: 1,
      handles: Array.from({ length: 5000 }, (_, index): AgentContextHandle => ({
        id: `canvas-node:${index}`,
        kind: index % 2 ? 'canvasNode' : 'image',
        targetId: `target-${index}`,
        revision: '1',
        display: { title: `标题${index}`, subtitle: 'image' },
        intentRole: 'subject',
      })),
    }
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.total).toBe(5000)
    expect(payload.listed + (payload.omitted ?? 0)).toBe(5000)
    expect(payload.omittedByKind?.reduce((sum, item) => sum + item.count, 0)).toBe(payload.omitted)
    const listedByKind = new Map<string, number>()
    for (const handle of payload.handles) listedByKind.set(handle.kind, (listedByKind.get(handle.kind) ?? 0) + 1)
    const expectedByKind = ['image', 'canvasNode'].map((kind) => ({
      kind,
      count: snapshot.handles.filter((handle) => handle.kind === kind).length - (listedByKind.get(kind) ?? 0),
    })).filter(({ count }) => count > 0)
    expect(payload.omittedByKind).toEqual(expectedByKind)
  })

  it('文稿、时间轴片段、画布节点、导演镜头混在一起：账同样平，文稿锚点仍在第一条', () => {
    const canvas = canvasSnapshot(8).handles
    const snapshot: AgentContextSnapshot = {
      version: 1,
      handles: [
        {
          id: 'document:doc-1', kind: 'document', targetId: 'doc-1', revision: '11',
          locator: { type: 'documentAnchor', anchor: { kind: 'range', from: 1, to: 9, selectedTextHash: 'h' } },
          display: { title: '品牌脚本' }, intentRole: 'source',
        },
        ...canvas,
        ...Array.from({ length: 8 }, (_, index): AgentContextHandle => ({
          id: `timeline-clip:clip-${index}`, kind: 'timelineClip', targetId: `clip-${index}`, revision: 'timeline-abc',
          locator: { type: 'timeRange', startMs: index * 1000, endMs: index * 1000 + 900 },
          display: { title: `片段${index + 1}`, subtitle: 'video' }, intentRole: 'target',
        })),
        ...Array.from({ length: 4 }, (_, index): AgentContextHandle => ({
          id: `director-shot:dir-1/shot-${index}`, kind: 'canvasNode', targetId: 'dir-1', revision: '8',
          locator: { type: 'custom', key: 'directorShot', value: `shot-${index}` },
          display: { title: `镜头 ${index + 1}`, subtitle: '3D 预演' }, intentRole: 'target',
        })),
      ],
    }
    const text = formatAgentContextSnapshot(snapshot)
    const payload = expectBalanced(snapshot, text)
    expect(text).toContain('documentAnchor')
    expect(payload.handles[0]?.targetId).toBe('doc-1')
    expect(payload.listed).toBe(snapshot.handles.length)
  })

  it('定位器是句柄意思的一部分：较省档列全时仍保留每个镜头名', () => {
    const shots = Array.from({ length: 20 }, (_, index): AgentContextHandle => ({
      id: `director-shot:dir-1/shot-${index}`, kind: 'canvasNode', targetId: 'dir-1', revision: 'dplan-abc',
      locator: { type: 'custom', key: 'director.shot', value: `shot-${index}` },
      display: { title: `${index + 1}-${'镜'.repeat(300)}` }, intentRole: 'target',
    }))
    const snapshot: AgentContextSnapshot = { version: 1, handles: shots }
    const text = formatAgentContextSnapshot(snapshot)
    const payload = expectBalanced(snapshot, text)
    expect(payload.listed).toBe(20)
    for (let index = 0; index < payload.listed; index += 1) expect(text).toContain(`"key":"director.shot","value":"shot-${index}"`)
  })

  it('选区定位器里没有对应句柄的 id 不会被当成「重复」而吞掉', () => {
    const [first] = canvasSnapshot(1).handles
    const snapshot: AgentContextSnapshot = {
      version: 1,
      handles: [{ ...first!, locator: { type: 'canvasSelection', nodeIds: [first!.targetId, 'gen-v2-orphan-not-a-handle'] } }],
    }
    const text = formatAgentContextSnapshot(snapshot)
    expect(text).toContain('gen-v2-orphan-not-a-handle')
    expect(text.split(first!.targetId).length - 1).toBe(2)
  })

  it('混合句柄超过预算时列出前缀，账按省略后缀的类计数', () => {
    const clips = Array.from({ length: 200 }, (_, index): AgentContextHandle => ({
      id: `timeline-clip:clip-${index}`, kind: 'timelineClip', targetId: `clip-${index}`, revision: 'timeline-abc',
      locator: { type: 'timeRange', startMs: index * 1000, endMs: index * 1000 + 900 },
      display: { title: `片段${index + 1}`, subtitle: 'video' }, intentRole: 'target',
    }))
    const snapshot: AgentContextSnapshot = { version: 1, handles: [...canvasSnapshot(20).handles, ...clips] }
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.total).toBe(220)
    expect(payload.listed).toBeGreaterThan(0)
    expect(payload.omittedByKind?.reduce((sum, item) => sum + item.count, 0)).toBe(payload.omitted)
    expect(payload.omittedByKind?.every((item) => !('readTool' in item))).toBe(true)
  })

  it('混选时没有单独实时读工具的类也按前缀和类账说明', () => {
    const snapshot: AgentContextSnapshot = {
      version: 1,
      handles: [
        ...canvasSnapshot(40).handles,
        ...Array.from({ length: 80 }, (_, index): AgentContextHandle => ({
          id: `web-selection:${index}`, kind: 'webSelection', targetId: `web-${index}`, revision: '1',
          locator: { type: 'custom', key: 'web', value: 'x'.repeat(400) }, display: { title: `网页选择 ${index}` }, intentRole: 'source',
        })),
      ],
    }
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBeGreaterThan(0)
    expect(payload.omittedByKind?.reduce((sum, item) => sum + item.count, 0)).toBe(payload.omitted)
  })

  it('病态输入（每个字段 5 万字、256 条）：硬上限不破、仍是合法 JSON、账照平', () => {
    const huge = 'x'.repeat(20_000)
    const snapshot: AgentContextSnapshot = {
      version: 1,
      handles: Array.from({ length: 256 }, (_, index): AgentContextHandle => ({
        id: `${huge}-${index}`, kind: 'canvasNode', targetId: `${huge}-target-${index}`, revision: huge,
        locator: { type: 'canvasSelection', nodeIds: Array.from({ length: 16 }, (_, node) => `${huge}-node-${index}-${node}`) },
        display: { title: huge, subtitle: huge }, intentRole: 'source',
      })),
    }
    const text = formatAgentContextSnapshot(snapshot)
    const payload = payloadOf(text)
    expect(text.length).toBeLessThanOrEqual(HARD_LIMIT)
    expect(payload.total).toBe(256)
    expect(payload.listed + (payload.omitted ?? 0)).toBe(256)
    expect(payload.handles).toHaveLength(payload.listed)
    expect(payload.omitted).toBeGreaterThan(0)
  })

  it('确定性：同一份快照投影两次文本完全相同，截断提示固定且不含数字', () => {
    const forty = canvasSnapshot(40)
    expect(formatAgentContextSnapshot(forty)).toBe(formatAgentContextSnapshot(forty))
    const note = payloadOf(formatAgentContextSnapshot(forty)).omittedNote
    expect(note).toBeTruthy()
    expect(note).not.toMatch(/\d/)
  })

  it('空快照什么都不出', () => {
    expect(formatAgentContextSnapshot(undefined)).toBe('')
    expect(formatAgentContextSnapshot({ version: 1, handles: [] })).toBe('')
    expect(projectAgentContextSnapshot(undefined)).toEqual({ text: '', total: 0, listed: 0, omitted: 0, truncated: false })
  })
})

describe('projectAgentContextSnapshot · 给渲染层的事实', () => {
  it('列全时 truncated=false、omitted=0，text 与 formatAgentContextSnapshot 逐字一致', () => {
    const snapshot = canvasSnapshot(12)
    const projection = projectAgentContextSnapshot(snapshot)
    expect(projection).toMatchObject({ total: 12, listed: 12, omitted: 0, truncated: false })
    expect(projection.text).toBe(formatAgentContextSnapshot(snapshot))
  })

  it('截断时给出 total / listed / omitted，且与文本里写的数一致；列出的是快照的前 listed 条', () => {
    const snapshot = canvasSnapshot(256)
    const projection = projectAgentContextSnapshot(snapshot)
    const payload = payloadOf(projection.text)
    expect(projection.truncated).toBe(true)
    expect(projection.total).toBe(256)
    expect(projection.listed).toBe(payload.listed)
    expect(projection.omitted).toBe(payload.omitted)
    expect(projection.listed + projection.omitted).toBe(256)
  })
})
