import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { addableReferenceKinds, type AssetDropKind } from '../model/nodeAssetDrop'
import { addAssetUrlToNode } from './nodeAssetWrite'
import { applyHumanModeChoice, archetypeModeArraySlots, collectModeInputs, effectiveArchetypeMode, effectiveArchetypeModeWithUpload, resolveArchetypeForModel, type ModeGraph } from './controls/archetypeMeta'
import { FIRST_FRAME_EMPTY_KEY } from './controls/referenceList'
import type { GenerationCanvasEdge } from '../model/generationCanvasTypes'
import type { ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { planReferenceProjection } from '../model/referenceInputSlots'
import { resolveReferenceSlots } from '../runner/referenceSlots'

// 生成框「+」的类测试（协调 2026-11-12 拍板 A：删掉手动切方式后「+」的倒退不修不能合）。
// 全部视频 / 图片档案 × 每个声明过的渠道 × 已放了多少（图 / 视频 / 音频各几件，按真实落格一路放出来）：
//   · 「+」说能加的每一类（addableReferenceKinds），addAssetUrlToNode 真落得下，落下后的方式 = 放之前按「放进去之后」现算的方式，且收得下全部；
//   · 「+」说不能加的每一类，addAssetUrlToNode 真落不下（不写节点）；
//   · 一类都放不下 =「+」置灰、点不开：至少有档案真的走到这一步（穷举不是空转）。
// 同一组输入再走一遍付费卡回写那条（planReferenceProjection）：落到的格和算出的方式必须一样（防两份写入漂移）。
// 起点除了「空节点 + 只上传」，还有 modeForInputs 会分叉的三种（验收 2026-11-12 点名 2）：手选了方式的节点、画布连进来一条首帧边
// （带角色的输入）、首帧格特意空着（firstFrameEmpty）。这三种只跑默认渠道、不比两份写入（漂移清单只按「空节点」那一路钉）。

const KINDS: readonly AssetDropKind[] = ['image', 'video', 'audio']
const VENDORS = [undefined, 'apimart', 'kie', 'official'] as const
const CAP = 16 // 每类最多放到几件（档案上限都在这之下；到 CAP 还能加的照样逐格断言过）

type Node = GenerationCanvasNode

const KNOWN_DRIFT_CLASSES = [
  'audio·用途缺·回写丢了这一件',
  'image·用途缺·回写丢了这一件·只有首尾帧格的摆法',
]

function nodeFor(archetypeId: string, kind: 'video' | 'image', vendor: string | undefined): Node {
  return {
    id: 'n', kind, title: '', position: { x: 0, y: 0 },
    meta: { modelKey: archetypeId, ...(vendor ? { modelVendor: vendor, vendor } : {}), archetype: { id: archetypeId } },
  } as Node
}

function memoryAccess(start: Node) {
  let node = start
  return {
    access: { latestNode: () => node, updateNode: (_id: string, patch: Partial<Node>) => { node = { ...node, ...patch } } },
    current: () => node,
  }
}

/** 起点：在空节点上先摆好什么（节点 meta 改动 + 画布上连进来的上游节点和边）。 */
type Start = { name: string; prepare: (node: Node, archetype: ModelArchetype) => Node; upstream: Node[]; edges: GenerationCanvasEdge[] }
const UPSTREAM: Node = { id: 'up', kind: 'image', title: '', position: { x: 0, y: 0 }, meta: {}, result: { id: 'up-r', type: 'image', url: 'nomi-local://asset/p/up.png', createdAt: 1 } } as Node
const PLAIN: Start = { name: '空节点', prepare: (node) => node, upstream: [], edges: [] }
const FIRST_FRAME_EDGE: Start = { name: '连进来一条首帧边', prepare: (node) => node, upstream: [UPSTREAM], edges: [{ id: 'e-up', source: 'up', target: 'n', mode: 'first_frame' } as GenerationCanvasEdge] }
const FIRST_FRAME_EMPTY: Start = { name: '首帧格特意空着', prepare: (node) => ({ ...node, meta: { ...node.meta, [FIRST_FRAME_EMPTY_KEY]: true } }), upstream: [], edges: [] }
const humanChoice = (modeId: string): Start => ({ name: `手选了 ${modeId}`, prepare: (node, archetype) => ({ ...node, meta: applyHumanModeChoice(node.meta as Record<string, unknown>, archetype, modeId) }), upstream: [], edges: [] })

let currentStart: Start = PLAIN
const graphOf = (node: Node): ModeGraph => ({ nodes: [node, ...currentStart.upstream], edges: currentStart.edges })

/** 节点上每一格此刻装着的上传（格 → 地址），比两条写入落到的格用。 */
function filledSlots(node: Node): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const slot of resolveReferenceSlots(node, [node], [])) {
    const urls = slot.fills.flatMap((fill) => (fill.origin.type === 'upload' && fill.url ? [fill.url] : []))
    if (urls.length) out[slot.slotKind] = urls
  }
  return out
}

type Cell = { label: string; counts: string; kind: AssetDropKind; problem: string }

function walkArchetype(archetypeId: string, nodeKind: 'video' | 'image', vendor: string | undefined, start: Start = PLAIN) {
  currentStart = start
  const failures: Cell[] = []
  const drift: Array<Cell & { driftClass: string }> = []
  let states = 0
  let reachedLimit = false
  const seen = new Set<string>()
  const blank = nodeFor(archetypeId, nodeKind, vendor)
  const startArchetype = resolveArchetypeForModel({ modelKey: archetypeId, vendorKey: vendor ?? null, meta: blank.meta })!
  const queue: Array<{ node: Node; counts: Record<AssetDropKind, number> }> = [{ node: start.prepare(blank, startArchetype), counts: { image: 0, video: 0, audio: 0 } }]
  let serial = 0
  while (queue.length) {
    const { node, counts } = queue.shift()!
    const key = `${counts.image}/${counts.video}/${counts.audio}`
    if (seen.has(key)) continue
    seen.add(key)
    states += 1
    const archetype = resolveArchetypeForModel({ modelKey: archetypeId, vendorKey: vendor ?? null, meta: node.meta })!
    const offered = addableReferenceKinds(node, graphOf(node))
    if (offered.length === 0) reachedLimit = true
    for (const kind of KINDS) {
      const url = `nomi-local://asset/p/${kind}-${serial += 1}`
      const planned = effectiveArchetypeModeWithUpload(archetype, node, graphOf(node), kind)
      const { access, current } = memoryAccess(node)
      const outcome = addAssetUrlToNode(node.id, kind, url, access, graphOf(node))
      const cell = (problem: string) => ({ label: `${archetypeId}${vendor ? `@${vendor}` : ''}${start === PLAIN ? '' : ` · ${start.name}`}`, counts: key, kind, problem })
      if (offered.includes(kind)) {
        if (outcome.status !== 'added') { failures.push(cell(`「+」给了，落格却是 ${outcome.status}`)); continue }
        const after = current()
        const landed = effectiveArchetypeMode(archetype, after, graphOf(after))
        if (landed.mode.id !== planned.mode.id) failures.push(cell(`落下后方式 ${landed.mode.id} ≠ 现算 ${planned.mode.id}`))
        if (landed.status !== 'ok') failures.push(cell(`落下后方式状态 ${landed.status}`))
        // 收得下全部：画布连进来的、手放的，一件都不能被挤出去（连进来的首帧边也算在内）。
        const inputCount = collectModeInputs(after, graphOf(after)).inputs.length
        if (landed.taken !== inputCount) failures.push(cell(`落下后只收 ${landed.taken}/${inputCount} 件`))
        // 两份写入对照：付费卡回写同一件参考（用途按 schema 可缺；音频再试一次带上它自己的用途 'audio'），落到的格与算出的方式必须一样。
        for (const role of start !== PLAIN ? [] : kind === 'audio' ? (['audio', undefined] as const) : ([undefined] as const)) {
          const projection = planReferenceProjection(node, [{ url, kind, ...(role ? { role } : {}) }], [node], [])
          const viaProjection = { ...node, meta: projection.meta ?? node.meta }
          const projMode = effectiveArchetypeMode(archetype, viaProjection, graphOf(viaProjection)).mode.id
          const a = JSON.stringify(filledSlots(after))
          const b = JSON.stringify(filledSlots(viaProjection))
          if (projMode === landed.mode.id && a === b) continue
          const dropped = !b.includes(url)
          drift.push({ ...cell(`addAssetUrlToNode ${landed.mode.id} ${a} ≠ planReferenceProjection ${projMode} ${b}`), driftClass: `${kind}·用途${role ?? '缺'}·${dropped ? '回写丢了这一件' : '两边摆法不同'}${kind === 'image' && !archetypeModeArraySlots(landed.mode).some((slot) => slot.accept === 'image') ? '·只有首尾帧格的摆法' : ''}` })
        }
        if (counts[kind] < CAP) queue.push({ node: after, counts: { ...counts, [kind]: counts[kind] + 1 } })
      } else if (outcome.status === 'added' || current() !== node) {
        failures.push(cell(`「+」没给，落格却写进去了（${outcome.status}）`))
      }
    }
  }
  return { failures, drift, states, reachedLimit }
}

const cases = MODEL_ARCHETYPES.flatMap((archetype) => {
  if (archetype.kind !== 'video' && archetype.kind !== 'image') return []
  // 只看收得下参考的档案（一格都没有的，「+」本来就不在，参考行灰着说原因）。
  if (!archetype.modes.some((mode) => mode.slots.some((slot) => ['first_frame', 'last_frame', 'image_ref', 'video_ref', 'audio_ref'].includes(slot.kind)))) return []
  return VENDORS.map((vendor) => ({ id: archetype.id, kind: archetype.kind as 'video' | 'image', vendor }))
})

describe('生成框「+」：给哪几类 ⇄ 真落得下（全部档案 × 渠道 × 已放数量）', () => {
  const results = cases.map((entry) => ({ entry, ...walkArchetype(entry.id, entry.kind, entry.vendor) }))

  it('穷举不是空转：覆盖到视频与图片档案，且有档案真的放到一类都放不下（「+」置灰）', () => {
    expect(cases.some((entry) => entry.kind === 'video')).toBe(true)
    expect(cases.some((entry) => entry.kind === 'image')).toBe(true)
    expect(results.reduce((sum, result) => sum + result.states, 0)).toBeGreaterThan(200)
    expect(results.some((result) => result.reachedLimit)).toBe(true)
  })

  for (const result of results) {
    const { entry } = result
    it(`${entry.id}${entry.vendor ? `@${entry.vendor}` : ''}：「+」给的每一类都落得下、方式跟着现算；不给的都落不下`, () => {
      expect(result.failures).toEqual([])
    })
  }

  // 两份写入对照（协调 2026-11-12：合并留后续，本 PR 先钉住）。付费卡回写那条（planReferenceProjection）按「用途」找格，
  // 生成框入口按「种类」找格：用途缺省 = 通用参考时，只有首帧 / 尾帧格的摆法、音频格都不认它，这一件就被回写丢掉。
  // 这条断言把漂移钉成下面这几类（逐格原样列在报告「门」那节）：多出新的一类就红；合并修好之后也会红，提醒删掉这份清单。
  it('两份写入的漂移只有已知的这几类', () => {
    const classes = [...new Set(results.flatMap((result) => result.drift.map((cell) => cell.driftClass)))].sort()
    // 逐格清单（写报告用）：NOMI_DRIFT_DUMP=<文件> 时把每一类的格数、档案和全部格写出去。
    if (process.env.NOMI_DRIFT_DUMP) writeFileSync(process.env.NOMI_DRIFT_DUMP, JSON.stringify(results.flatMap((r) => r.drift), null, 1))
    if (process.env.NOMI_DRIFT_DUMP) writeFileSync(`${process.env.NOMI_DRIFT_DUMP}.summary.json`, JSON.stringify(classes.map((c) => ({ c, cells: results.flatMap((r) => r.drift).filter((cell) => cell.driftClass === c).length, archetypes: [...new Set(results.flatMap((r) => r.drift).filter((cell) => cell.driftClass === c).map((cell) => cell.label.split('@')[0]))] })), null, 1))
    expect(classes).toEqual(KNOWN_DRIFT_CLASSES)
  })

  // 另三种起点（只默认渠道）：手选了方式（档案里每一种带格的方式各一遍）、连进来一条首帧边、首帧格特意空着。
  const startCases = cases.filter((entry) => entry.vendor === undefined).flatMap((entry) => {
    const archetype = MODEL_ARCHETYPES.find((candidate) => candidate.id === entry.id)!
    const choices = archetype.modes.filter((mode) => mode.slots.length > 0).map((mode) => humanChoice(mode.id))
    return [...choices, FIRST_FRAME_EDGE, ...(entry.kind === 'video' ? [FIRST_FRAME_EMPTY] : [])].map((start) => ({ entry, start }))
  })
  const startResults = startCases.map(({ entry, start }) => ({ entry, start, ...walkArchetype(entry.id, entry.kind, entry.vendor, start) }))

  it('另三种起点不是空转：手选、首帧边、首帧空着都覆盖到，且各自真走出了状态', () => {
    for (const prefix of ['手选了', '连进来一条首帧边', '首帧格特意空着']) {
      const hit = startResults.filter((result) => result.start.name.startsWith(prefix))
      expect(hit.length, prefix).toBeGreaterThan(0)
      expect(hit.reduce((sum, result) => sum + result.states, 0), prefix).toBeGreaterThan(20)
    }
  })

  for (const result of startResults) {
    it(`${result.entry.id} · ${result.start.name}：「+」给的每一类都落得下、方式跟着现算；不给的都落不下`, () => {
      expect(result.failures).toEqual([])
    })
  }

  it('空的视频节点：「+」给音频（文生视频也能直接放音频，放了就是全能参考）', () => {
    const seedance = cases.find((entry) => entry.id === 'seedance-2' && entry.vendor === 'apimart')!
    const node = nodeFor(seedance.id, 'video', seedance.vendor)
    currentStart = PLAIN
    expect(addableReferenceKinds(node, graphOf(node))).toContain('audio')
  })
})
