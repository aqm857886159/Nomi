/**
 * 老项目画布升级——「请求体差异」表驱动测试（方式参数主人的设计卡 ★9 第 3 条）。
 *
 * 夹具：0.24.1 真实存盘写出的 25 个生成节点（v0.24.1-mode-nodes）。每个节点在修前（origin/main facb9e5d7）发出的请求参数
 * 录在 request-before-mode-params.json（独立验收线 V-mode-params-pr1 录的）；这里用现在的代码对同一个节点再算一遍，逐节点对账：
 *   1. 修前算不出请求的节点（没选模型），现在同样算不出——不多出一个会发的请求；
 *   2. 修前发出去的键现在一个不少、值不变（beforeSend = 主进程补完之后；没有主进程那一步可算的，拿渲染层冻结的参数）；
 *   3. 现在多出来的键只许是「这个节点这一次的方式」自己控件上的默认值（以前是主进程补的，现在渲染层现算）。
 * 改坏法：主人不补本方式默认值 → 多出键的节点集合变，最后一条红；主人多剥一个键 → 第 2 条红；主人补了别的方式的默认值 → 第 3 条红。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { getArchetypeById, specializeArchetypeForVendor } from '../../../../electron/shared/modelArchetypes'
import { declaredModeParams } from '../../../../electron/shared/modelArchetypes/modeParams'
import { loadFixture, readAfterNormalize } from '../../../../tests/fixtures/old-user-data/canvas/canvasModeOldUser.testkit'
import { buildCatalogTaskRequest } from '../runner/catalogTaskActions'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'

type Recorded = {
  throws?: string
  kind?: string
  modelKey?: string
  extras?: Record<string, unknown>
  beforeSend?: Record<string, unknown> | null
}
const recorded = JSON.parse(
  fs.readFileSync(new URL('../../../../tests/fixtures/old-user-data/canvas/v0.24.1-mode-nodes/request-before-mode-params.json', import.meta.url), 'utf8'),
) as { nodes: Record<string, Recorded> }

const json = (value: unknown) => JSON.stringify(value ?? null)

describe('0.24.1 老节点：修前 / 修后的请求体差异（不少键；多出的只许是本方式控件的默认值）', () => {
  const { canvas } = loadFixture()
  const { nodes, edges } = readAfterNormalize(canvas)

  const nowOf = (nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)!
    return buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes, edges }) }).request
  }

  it('前提：夹具 25 个节点，录的和夹具一一对应；14 个算得出请求、11 个算不出（没选模型）', () => {
    expect(Object.keys(recorded.nodes).sort()).toEqual(nodes.map((node) => node.id).sort())
    expect(Object.values(recorded.nodes).filter((entry) => entry.throws)).toHaveLength(11)
    expect(Object.values(recorded.nodes).filter((entry) => !entry.throws)).toHaveLength(14)
  })

  const rows = Object.entries(recorded.nodes)
  it.each(rows)('节点 %s', (nodeId, before) => {
    if (before.throws) {
      expect(() => nowOf(nodeId), '修前算不出请求的节点，现在也不许多出一个请求').toThrow(before.throws.replace(/^throw:/, ''))
      return
    }
    const request = nowOf(nodeId)
    const extras = JSON.parse(JSON.stringify(request.extras)) as Record<string, unknown> // 录的是 JSON：值为 undefined 的键（空参考通道）不算键
    expect(request.kind).toBe(before.kind)
    const baseline = before.beforeSend ?? before.extras!
    const lost = Object.keys(baseline).filter((key) => !(key in extras))
    const changed = Object.keys(baseline).filter((key) => key in extras && json(baseline[key]) !== json(extras[key]))
    expect(lost, '修前发出去的键现在少了').toEqual([])
    expect(changed, '修前发出去的键现在换了值').toEqual([])

    const archetypeRecord = extras.archetype as { id?: string; modeId?: string; variantId?: string } | undefined
    const base = getArchetypeById(archetypeRecord?.id ?? '')!
    expect(base, '前提：认得出档案').toBeTruthy()
    const vendor = typeof extras.modelVendor === 'string' ? extras.modelVendor : ''
    const declared = declaredModeParams({
      archetype: vendor ? specializeArchetypeForVendor(base, vendor) : base,
      variantId: archetypeRecord?.variantId,
      modeId: archetypeRecord?.modeId ?? '',
    })
    expect(declared, '前提：认得出方式').toBeTruthy()
    const modeDefaults = Object.fromEntries(declared!.controls.filter((control) => control.defaultValue !== undefined).map((control) => [control.key, control.defaultValue]))
    const extra = Object.keys(extras).filter((key) => !(key in baseline))
    for (const key of extra) {
      expect(key in modeDefaults, `多出的键 ${key} 不是本方式控件的默认值`).toBe(true)
      expect(json(extras[key]), `多出的键 ${key} 的值不是本方式控件的默认值`).toBe(json(modeDefaults[key]))
    }
  })

  it('多出键的节点集合钉住：6 个 nano-banana 在主进程补完之后逐键相同（没有多出的键），多出键的是另外 7 个（它们没有主进程那一步可算）', () => {
    const withExtra = Object.entries(recorded.nodes).filter(([nodeId, before]) => {
      if (before.throws) return false
      const baseline = before.beforeSend ?? before.extras!
      return Object.keys(JSON.parse(JSON.stringify(nowOf(nodeId).extras)) as Record<string, unknown>).some((key) => !(key in baseline))
    })
    expect(withExtra.filter(([, before]) => before.modelKey === 'nano-banana')).toEqual([])
    expect(withExtra.map(([, before]) => before.modelKey).sort()).toEqual(['eleven-scribe-v2', 'hunyuan3d', 'seedance-2', 'seedance-2', 'seedance-2', 'seedance-2', 'seedance-2'])
  })
})
