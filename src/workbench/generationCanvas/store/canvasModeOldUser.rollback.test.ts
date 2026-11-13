/**
 * 老项目画布——「退回旧版本读得开」：0.24.1 的存盘经今天主线读一遍、再存回去，交给 0.24.1 读，节点和参考一张不少、字段不丢。
 *
 * 做不到的一半：0.24.1 的读取函数不在本仓库里，测试里没法直接调它。所以这里分两段：
 *   1. 自动化（本文件）：主线读写后的存盘片段，逐节点逐字段对夹具——除了现状里被加载收敛改写的 3 个 modeId，其余一字不差；
 *      一字不差的节点，0.24.1 读它的结果就是夹具 manifest 里录下的 v0241Reads（0.24.1 自己读出来的，不是手写）；
 *      被改写的 3 个，新的 modeId 必须是该档案里真有的方式（0.24.1 照样认得，钮可点）。
 *   2. 手工（每次改造那一刀跑一次，写进 PR）：把本文件写出的主线存盘片段喂给 0.24.1 导出里的真读取函数，对 v0241Reads。
 *      步骤见 tests/fixtures/old-user-data/README.md「canvas/v0.24.1-mode-nodes」一节。
 * 改造后（第 1 刀起）加一个新标记 archetype.modeChosenBy：旧版本不认识就忽略；本文件的「未知标记」一条把它加在存盘上，
 * 断言主线读写不吞它、不动别的字段（旧版本读到的节点和参考与没有标记时一样）。
 */
import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes'
import { loadFixture, openProject, readAfterNormalize } from '../../../../tests/fixtures/old-user-data/canvas/canvasModeOldUser.testkit'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const REWRITTEN_BY_LOAD = new Set([
  'dc1-video-empty-reference-clicked',
  'dc2-image-edit-pasted-alone',
  'dc6-agent-plan-image-edit-no-refs',
])

type Doc = { nodes: GenerationCanvasNode[]; edges: unknown[]; groups: unknown[] }

describe('老项目画布 · 退回旧版本读得开', () => {
  const { canvas, scenarios } = loadFixture()
  const written = openProject(canvas).saved as unknown as Doc

  it('主线打开后存回的片段：节点、连线、组一个不少，id 一致', () => {
    expect(written.nodes.map((n) => n.id).sort()).toEqual(canvas.nodes.map((n) => n.id).sort())
    expect(written.edges).toEqual(canvas.edges)
    expect(written.groups).toEqual(canvas.groups)
  })

  it('主线读写不丢字段：夹具节点上的每个顶层字段、meta 里的每个键都还在', () => {
    for (const before of canvas.nodes) {
      const after = written.nodes.find((n) => n.id === before.id)!
      for (const key of Object.keys(before)) {
        expect(after, `${before.id} lost top-level field ${key}`).toHaveProperty(key)
      }
      for (const key of Object.keys(before.meta ?? {})) {
        expect(after.meta, `${before.id} lost meta.${key}`).toHaveProperty(key)
      }
    }
  })

  it('除了今天被加载收敛改写的 3 个 modeId，每个节点和夹具一字不差（0.24.1 读它 = manifest 里录下的 0.24.1 读法）', () => {
    for (const scenario of scenarios) {
      const before = canvas.nodes.find((n) => n.id === scenario.nodeId)!
      const after = written.nodes.find((n) => n.id === scenario.nodeId)!
      if (REWRITTEN_BY_LOAD.has(scenario.key)) continue
      expect(after, scenario.key).toEqual(before)
    }
  })

  it('被改写的 3 个：新的方式是该档案里真有的方式，其余字段不动，参考一张不少', () => {
    for (const scenario of scenarios.filter((s) => REWRITTEN_BY_LOAD.has(s.key))) {
      const before = canvas.nodes.find((n) => n.id === scenario.nodeId)!
      const after = written.nodes.find((n) => n.id === scenario.nodeId)!
      const archetype = after.meta!.archetype as { id: string; modeId: string }
      const known = MODEL_ARCHETYPES.find((a) => a.id === archetype.id)!
      expect(known.modes.map((m) => m.id), scenario.key).toContain(archetype.modeId)
      const { archetype: _a, ...beforeRest } = before.meta as Record<string, unknown>
      const { archetype: _b, ...afterRest } = after.meta as Record<string, unknown>
      expect(afterRest, scenario.key).toEqual(beforeRest)
      expect({ ...after, meta: undefined }, scenario.key).toEqual({ ...before, meta: undefined })
    }
  })

  it('只过读取归一（不经加载收敛）的片段与夹具逐节点相等：归一不改节点', () => {
    const normalized = readAfterNormalize(canvas)
    for (const before of canvas.nodes) {
      expect(normalized.nodes.find((n) => n.id === before.id)).toEqual(before)
    }
  })

  it('未知标记：存盘上多一个 archetype.modeChosenBy，主线读写不吞它、不动别的字段（旧版本忽略它）', () => {
    const marked = structuredClone(canvas)
    const target = scenarios.find((s) => s.key === 'dc4-video-firstlast-five-refs')!
    const node = marked.nodes.find((n) => n.id === target.nodeId)!
    ;(node.meta!.archetype as Record<string, unknown>).modeChosenBy = 'human'
    const saved = openProject(marked).saved as unknown as Doc
    expect(saved.nodes.find((n) => n.id === target.nodeId)).toEqual(node)
  })
})
