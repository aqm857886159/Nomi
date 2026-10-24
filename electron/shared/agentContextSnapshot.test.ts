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

/** 与生产构造器 `buildResidentContextSnapshot` 同形：每条句柄的定位器都带整份选区。 */
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

type Payload = {
  total: number
  listed: number
  omitted?: number
  omittedNote?: string
  handles: Array<{ targetId: string; display: { title: string } }>
}

function payloadOf(text: string): Payload {
  return JSON.parse(text.slice(text.indexOf('\n') + 1)) as Payload
}

/** 账本不变式：total = listed + omitted；列出的恰好是快照的前 listed 条；写出来的数与文本里真有的数一致。 */
function expectBalanced(snapshot: AgentContextSnapshot, text: string): Payload {
  const payload = payloadOf(text)
  expect(payload.total).toBe(snapshot.handles.length)
  expect(payload.handles).toHaveLength(payload.listed)
  expect(payload.listed + (payload.omitted ?? 0)).toBe(snapshot.handles.length)
  expect(payload.handles.map((handle) => handle.targetId)).toEqual(snapshot.handles.slice(0, payload.listed).map((handle) => handle.targetId))
  if (payload.listed < payload.total) {
    expect(payload.omitted, '少了就必须明说少了几个').toBe(payload.total - payload.listed)
    expect(payload.omittedNote, '少了就必须告诉模型去哪补读').toEqual(expect.stringContaining('look_at_canvas'))
  } else {
    expect(payload.omitted, '没少就不出 omitted').toBeUndefined()
    expect(payload.omittedNote).toBeUndefined()
  }
  expect(text.length).toBeLessThanOrEqual(HARD_LIMIT)
  return payload
}

describe('formatAgentContextSnapshot · 选区投影的账', () => {
  it.each([1, 12, 16, 40, 256])('选 %i 个节点：列全，或者明写总数与未列出数量', (count) => {
    const snapshot = canvasSnapshot(count)
    const text = formatAgentContextSnapshot(snapshot)
    const payload = expectBalanced(snapshot, text)
    // 不比旧版差：旧版固定只给前 16 条的上限，现在任何规模都至少给到这个数。
    expect(payload.listed).toBeGreaterThanOrEqual(Math.min(count, 16))
  })

  it.each([1, 12, 16])('选 %i 个节点：一个不少（事故里 12 个只收到 7 个、16 个只收到 6 个）', (count) => {
    const snapshot = canvasSnapshot(count)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(count)
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

  it('每个节点的标题都很长时，宁可把所有标题都截短也先把条目列全', () => {
    const snapshot = canvasSnapshot(30, (index) => `${index + 1}-${'镜'.repeat(400)}`)
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.listed).toBe(30)
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

  it('定位器是句柄意思的一部分，任何一档都不丢：20 个导演镜头共用一个节点 id，只有定位器里的镜头名能区分它们', () => {
    const shots = Array.from({ length: 20 }, (_, index): AgentContextHandle => ({
      id: `director-shot:dir-1/shot-${index}`, kind: 'canvasNode', targetId: 'dir-1', revision: 'dplan-abc',
      locator: { type: 'custom', key: 'director.shot', value: `shot-${index}` },
      display: { title: `${index + 1}-${'镜'.repeat(300)}` }, intentRole: 'target',
    }))
    const snapshot: AgentContextSnapshot = { version: 1, handles: shots }
    const text = formatAgentContextSnapshot(snapshot)
    const payload = expectBalanced(snapshot, text)
    expect(payload.listed).toBe(20)
    for (let index = 0; index < 20; index += 1) expect(text).toContain(`"key":"director.shot","value":"shot-${index}"`)
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

  it('混合句柄超过预算时同样明说：截的是尾巴，账照平', () => {
    const clips = Array.from({ length: 200 }, (_, index): AgentContextHandle => ({
      id: `timeline-clip:clip-${index}`, kind: 'timelineClip', targetId: `clip-${index}`, revision: 'timeline-abc',
      locator: { type: 'timeRange', startMs: index * 1000, endMs: index * 1000 + 900 },
      display: { title: `片段${index + 1}`, subtitle: 'video' }, intentRole: 'target',
    }))
    const snapshot: AgentContextSnapshot = { version: 1, handles: [...canvasSnapshot(20).handles, ...clips] }
    const payload = expectBalanced(snapshot, formatAgentContextSnapshot(snapshot))
    expect(payload.total).toBe(220)
    expect(payload.omitted).toBeGreaterThan(0)
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

  it('确定性：同一份快照永远投影成同一段文字，截断提示是固定句子（不含会变的数字）', () => {
    const forty = canvasSnapshot(40)
    expect(formatAgentContextSnapshot(forty)).toBe(formatAgentContextSnapshot(canvasSnapshot(40)))
    const noteOf = (count: number) => payloadOf(formatAgentContextSnapshot(canvasSnapshot(count))).omittedNote
    expect(noteOf(40)).toBeTruthy()
    expect(noteOf(40)).toBe(noteOf(256))
    expect(noteOf(40)).not.toMatch(/\d/)
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
