import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LANE_DEFERRED_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js'
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs'
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js'
import { capabilityContractById } from '../../electron/shared/agentCapabilities/registry.js'
import { modelToolCapabilityId } from '../../electron/shared/agentCapabilities/modelFacingTools.js'
import { verbEffectExpectedByContract, verbMutates, verbBillable } from '../../electron/shared/agentCapabilities/verbDeclaration.js'

for (const spec of LANE_DEFERRED_TOOL_CATALOG) {
  test(`${spec.name}: deferred effect preserves its canonical approval and replay boundary`, () => {
    const contract = capabilityContractById(spec.contractId)!
    // 一个动词恰好一个效果，且与契约对账（装配期不变量 A1 的运行期镜像）。
    assert.equal(spec.effect, verbEffectExpectedByContract(contract))
    for (const operation of Object.keys(spec.operationCapabilityIds ?? {})) {
      const actual = capabilityContractById(modelToolCapabilityId(spec, { operation }))!
      assert.ok(actual)
      assert.ok(actual.effect === 'read' || verbMutates(spec.effect), `${operation}: cannot advertise replay-safe writes`)
      assert.ok(actual.effect !== 'paid' || verbBillable(spec.effect), `${operation}: cannot hide spending`)
      assert.ok(actual.effectClass !== 'irreversible' || spec.effect === 'irreversible')
    }
  })
}

test('irreversible tools assemble as non-replayable writes; a value outside the effect vocabulary is rejected at assembly', () => {
  const spec = LANE_DEFERRED_TOOL_CATALOG.find(spec => spec.name === 'delete_from_canvas')!
  const [tool] = createLaneTools([bindLaneTool({ ...spec, effect: 'irreversible' }, async () => ({ ok: true, text: 'fixture' }))])
  assert.equal(tool!.replay, 'never')
  assert.throws(() => createLaneTools([bindLaneTool({ ...spec,
    effect: 'undoable' as never,
  }, async () => ({ ok: true, text: 'fixture' }))]), /declares effect "undoable"/)
})
