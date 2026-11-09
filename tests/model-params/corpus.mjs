import { applyBuiltinSeeds } from '../../electron/catalog/seedBuiltins.ts'
import { resolveArchetypeForModel, resolveArchetypeVariant, specializeArchetypeForVariant } from '../../electron/shared/modelArchetypes/index.ts'
import { isParamValueAllowed, numericRangeOf } from '../../electron/shared/videoCapabilities/paramConstraints.ts'

export const intentions = [3, 5, 8, 12, 20]
const state = applyBuiltinSeeds({ version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, '2026-11-09T00:00:00Z').state
export const missing = []
export const models = state.models.filter(model => ['image', 'video'].includes(model.kind)).flatMap(model => {
  const archetype = resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey: model.vendorKey, meta: model.meta })
  if (!archetype) { missing.push({ model: `${model.vendorKey}/${model.modelKey}`, reason: '未验证：缺量具（无档案）' }); return [] }
  const option = { value: model.modelKey, modelKey: model.modelKey, vendor: model.vendorKey, kind: model.kind, label: model.labelZh, meta: model.meta }
  return [{ model, archetype, option }]
})
export function surface(row, modeId = row.archetype.defaultModeId, variantId = resolveArchetypeVariant(row.archetype, { modelId: row.model.modelKey })?.id) {
  const specialized = specializeArchetypeForVariant(row.archetype, variantId)
  const mode = specialized.modes.find(mode => mode.id === modeId) ?? specialized.modes[0]
  return { row, mode, variantId }
}
export const defaults = mode => Object.fromEntries(mode.params.filter(control => control.defaultValue !== undefined).map(control => [control.key, control.defaultValue]))

// One field changes at a time; every declared option/boundary is visited, without an unrelated Cartesian product of fields.
const seedCache = new Map()
export function seeds(target) {
  const cacheKey = identity(target)
  if (seedCache.has(cacheKey)) return seedCache.get(cacheKey)
  const base = defaults(target.mode)
  const inputs = [base, ...intentions.map(duration => ({ ...base, duration }))]
  for (const control of target.mode.params) {
    const values = [...control.options.map(option => option.value), control.min, control.max].filter(value => value !== undefined)
    if (control.type === 'boolean') values.push(false, true)
    if (typeof control.min === 'number') values.push(control.min - 1)
    if (typeof control.max === 'number') values.push(control.max + 1)
    for (const value of values) inputs.push({ ...base, [control.key]: value })
    if (control.type === 'number' && !numericRangeOf(control)) missing.push({ model: target.row.model.modelKey, mode: target.mode.id, key: control.key, reason: '未验证：缺量具（未声明范围）' })
  }
  const result = [...new Map(inputs.map(input => [JSON.stringify(input), input])).values()]
  seedCache.set(cacheKey, result)
  return result
}
export function* cases(axis) {
  if (axis === 'first-frame') {
    for (const test of cases('values')) for (const enabled of [false, true]) yield { ...test, enabled }
    return
  }
  if (axis === 'models' || axis === 'same-kind-models' || axis === 'kinds') {
    for (const from of models) for (const to of models) {
      if (axis === 'kinds' && from.model.kind === to.model.kind) continue
      if (axis === 'same-kind-models' && from.model.kind !== to.model.kind) continue
      const source = surface(from), target = surface(to)
      for (const params of seeds(source)) yield { source, target, params }
    }
    return
  }
  for (const row of models) {
    const variants = row.archetype.variants?.map(variant => variant.id) ?? [undefined]
    if (axis === 'variants' && variants.length < 2) continue
    for (const variantId of ['variants', 'values'].includes(axis) ? variants : [surface(row).variantId]) {
      for (const mode of row.archetype.modes) {
        const source = surface(row, mode.id, variantId)
        const targets = axis === 'modes' ? row.archetype.modes.map(mode => surface(row, mode.id, variantId))
          : axis === 'variants' ? variants.map(id => surface(row, mode.id, id)) : [source]
        for (const target of targets) for (const params of seeds(source)) yield { source, target, params }
      }
    }
  }
}
export function illegal(target, params) {
  return target.mode.params.flatMap(control => {
    const value = params[control.key]
    return value !== undefined && !isParamValueAllowed(control, value) ? [{ key: control.key, value }] : []
  })
}
export const identity = target => `${target.row.model.vendorKey}/${target.row.model.modelKey}/${target.mode.id}/${target.variantId ?? '-'}`
