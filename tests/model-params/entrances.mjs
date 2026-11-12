import { buildAgentModelEntries } from '../../src/workbench/generationCanvas/agent/availableModels.ts'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../../src/workbench/generationCanvas/agent/plannedNodeMeta.ts'
import { buildNodeModelChangePatch } from '../../src/workbench/generationCanvas/nodes/buildNodeModelChangePatch.ts'
import { applyArchetypeModeSwitch, applyArchetypeVariantSwitch, currentArchetypeMode, currentArchetypeVariant } from '../../src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts'
import { createGenerationNode } from '../../src/workbench/generationCanvas/model/graphOps.ts'
import { planModelSelection, shotKindPatch, updateShotAt } from '../../src/workbench/generationCanvas/agent/storyboardPlanEdits.ts'
import { previewStoryboardPatchShots } from '../../src/workbench/generationCanvas/agent/storyboardPatchShots.ts'
import { planStoryboardFromScript } from '../../electron/capabilityCore/mcpStoryboardPlanner.ts'
import { admitPlanCandidate, ContractCompilationError } from '../../electron/capabilityCore/executionContract.ts'
import { archetypeCompileOptions } from '../../electron/capabilityCore/modelAdmissionSchema.ts'
import { createModuleRegistry } from '../../electron/capabilityCore/moduleRegistry.ts'
import { specializeArchetypeForVariant } from '../../electron/shared/modelArchetypes/index.ts'
import { storyboardShotToCreateNodesArgs } from '../../src/workbench/generationCanvas/agent/storyboardPlan.ts'
import { plannedFirstFrameSlot } from '../../src/workbench/creation/storyboard/shotRow/shotRowModel.ts'
import { composerWrite, referenceModeWrite } from './ui.mjs'
import { defaults, models, surface } from './corpus.mjs'

const options = models.map(row => row.option)
const entries = buildModelEntryIndex(buildAgentModelEntries(options))
export const planOf = shot => ({ title: 'parameter ruler', anchors: [], shots: [shot] })
export const shotOf = (target, params) => ({ index: 1, shotKind: target.row.model.kind, durationSec: params.duration ?? 5, anchorIds: [], prompt: '纸船慢慢漂过窗前', modelKey: target.row.model.modelKey, modelVendor: target.row.model.vendorKey, modeId: target.mode.id, params: { ...params } })
const metaOf = (target, params) => ({ ...params, modelKey: target.row.model.modelKey, modelVendor: target.row.model.vendorKey, archetype: { id: target.row.archetype.id, modeId: target.mode.id, ...(target.variantId ? { variantId: target.variantId } : {}) } })
function selectedSurface(row, meta) {
  const variant = currentArchetypeVariant(row.archetype, meta)?.id
  const specialized = specializeArchetypeForVariant(row.archetype, variant)
  return surface(row, currentArchetypeMode(specialized, meta).id, variant)
}
function savedShot(shot, target) {
  if (!shot.modelKey) {
    const video = target.row.model.kind === 'video'
    const result = storyboardShotToCreateNodesArgs(planOf(shot), shot, { [video ? 'defaultVideoModelKey' : 'defaultImageModelKey']: target.row.model.modelKey, [video ? 'defaultVideoModelVendor' : 'defaultImageModelVendor']: target.row.model.vendorKey })
    const projected = result.nodes.find(node => !node.storyboardKeyframe)
    if (projected?.modelKey !== target.row.model.modelKey) throw new Error('production fallback did not select fixture default')
  }
  return { saved: { ...defaults(target.mode), ...(shot.params ?? {}), ...(shot.shotKind === 'video' ? { duration: shot.durationSec } : {}) }, target, shot, receipt: shot }
}
const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true }
const draftRegistries = new Map()
export function draftRegistry(target) {
  const key = `${target.row.model.vendorKey}/${target.row.model.modelKey}`
  if (!draftRegistries.has(key)) draftRegistries.set(key, createModuleRegistry([{
    moduleId: 'generation.single-shot', version: '1.0.0', inputKinds: ['text'], outputKinds: [target.row.model.kind], modes: ['ruler'], parameterSchema: {}, assetInputSchema: {},
    providers: [{ providerId: target.row.model.vendorKey, models: [{ modelId: target.row.model.modelKey, modes: ['ruler'], parameterSchema: {}, capabilities }] }],
  }]))
  return draftRegistries.get(key)
}
export const entrances = [
  { id: 'canvas-model', axis: 'same-kind-models', write({ source, target, params }) {
    const node = { ...createGenerationNode({ id: 'ruler', kind: source.row.model.kind }), meta: metaOf(source, params) }
    const result = buildNodeModelChangePatch({ node, nodes: [node], edges: [], modelOptions: options, value: target.row.option.value, vendor: target.row.option.vendor })
    return { saved: result.meta, target: selectedSurface(target.row, result.meta), receipt: result }
  } },
  { id: 'canvas-mode', axis: 'modes', write({ source, target, params }) {
    const saved = applyArchetypeModeSwitch(metaOf(source, params), source.row.archetype, target.mode.id)
    return { saved, target: selectedSurface(target.row, saved), receipt: saved }
  } },
  { id: 'canvas-variant', axis: 'variants', write({ source, target, params }) {
    const saved = applyArchetypeVariantSwitch(metaOf(source, params), source.row.archetype, target.variantId)
    return { saved, target: selectedSurface(target.row, saved), receipt: saved }
  } },
  { id: 'storyboard-model', axis: 'same-kind-models', write({ source, target, params }) {
    const next = updateShotAt(planOf(shotOf(source, params)), 0, planModelSelection(target.row.model.modelKey, target.row.model.vendorKey)).shots[0]
    return savedShot(next, surface(target.row))
  } },
  { id: 'storyboard-kind', axis: 'kinds', write({ source, target, params }) {
    const old = shotOf(source, params)
    return savedShot(updateShotAt(planOf(old), 0, shotKindPatch(old, target.row.model.kind)).shots[0], surface(target.row))
  } },
  { id: 'storyboard-mode', axis: 'modes', write({ source, target, params }) {
    const old = shotOf(source, params)
    const patch = composerWrite(old, source.row.option, props => props.onModeChange(target.mode.id))
    return savedShot(updateShotAt(planOf(old), 0, patch).shots[0], target)
  } },
  { id: 'storyboard-reference-mode', axis: 'modes', write({ source, target, params }) {
    const old = shotOf(source, params)
    const patch = referenceModeWrite(old, source.row.option, target.mode.id)
    return savedShot(updateShotAt(planOf(old), 0, patch).shots[0], target)
  } },
  { id: 'storyboard-duration', axis: 'values', write({ source, target, params }) {
    const old = shotOf(source, defaults(source.mode))
    const patch = composerWrite(old, source.row.option, props => props.onChange({ kind: 'duration', value: params.duration ?? 5 }))
    return { ...savedShot(updateShotAt(planOf(old), 0, patch).shots[0], target), input: { ...defaults(source.mode), duration: params.duration ?? 5 } }
  } },
  { id: 'agent-patch', axis: 'models', write({ source, target, params }) {
    const old = shotOf(source, params)
    const result = previewStoryboardPatchShots(planOf(old), { operation: 'patch_shots', select: { kind: 'all' }, patch: { modelKey: target.row.model.modelKey, modelVendor: target.row.model.vendorKey, shotKind: target.row.model.kind, durationSec: params.duration ?? 5 } })
    return savedShot(result.nextPlan.shots[0], surface(target.row))
  } },
  { id: 'agent-node', axis: 'values', write({ target, params }) {
    const saved = buildPlannedNodeMeta({ modelKey: target.row.model.modelKey, modelVendor: target.row.model.vendorKey, modeId: target.mode.id, variantId: target.variantId, params }, entries)
    if (!saved) throw new Error('seeded model missing from agent entry index')
    return { saved, target: selectedSurface(target.row, saved), receipt: saved }
  } },
  { id: 'agent-draft', axis: 'values', write({ target, params }) {
    const candidate = candidateFor(target, params)
    try {
      const result = admitPlanCandidate(candidate, draftRegistry(target), archetypeCompileOptions(candidate, target.row.model))
      return { saved: result.parameters, target, receipt: result }
    } catch (error) {
      if (!(error instanceof ContractCompilationError) || !error.rejection) throw error
      return { saved: null, target, rejection: error.rejection, receipt: error, explanation: [] }
    }
  } },
  { id: 'deterministic-planner', axis: 'values', only: test => test.target.row.model.kind === 'video', write({ target, params }) {
    // Supply the selected context as well: today's planner ignores it. The missing model-aware allocation is what this measures.
    let result
    try { result = planStoryboardFromScript({ projectId: 'ruler', scriptText: '纸船慢慢漂过窗前', targetDurationSeconds: params.duration ?? 5, modelKey: target.row.model.modelKey, modeId: target.mode.id }) }
    catch (error) {
      if (!/目标时长|拟镜/.test(error.message)) throw error
      return { saved: null, target, refusedDuration: params.duration ?? 5, explanation: [], refusal: error.message }
    }
    return { saved: { duration: result.shots[0].durationSeconds }, target, input: { duration: params.duration ?? 5 }, receipt: result, shots: result.shots }
  } },
  { id: 'first-frame', axis: 'first-frame', only: test => test.target.row.model.kind === 'video', write({ source, target, params, enabled }) {
    const old = { ...shotOf(source, params), keyframe: { enabled: !enabled, prompt: '静态首帧' } }
    const next = updateShotAt(planOf(old), 0, shotKindPatch(old, enabled ? 'image-video' : 'video')).shots[0]
    const selected = surface(target.row)
    return { ...savedShot(next, selected), firstFrameSupported: !enabled || Boolean(plannedFirstFrameSlot(selected.mode, next)) }
  } },
]


export const candidateFor = (target, params) => ({ candidateId: 'ruler', revision: 1, moduleId: 'generation.single-shot', providerId: target.row.model.vendorKey, modelId: target.row.model.modelKey, mode: 'ruler', modeId: target.mode.id, variantId: target.variantId, prompt: '纸船慢慢漂过窗前', references: [], parameters: params })
