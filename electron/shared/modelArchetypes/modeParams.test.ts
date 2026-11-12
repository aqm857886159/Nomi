import { describe, expect, it } from 'vitest'
import { buildWireDefaultsFor } from '../../../scripts/gen-archetype-wire-defaults'
import { getArchetypeById, MODEL_ARCHETYPES, specializeArchetypeForVariant, specializeArchetypeForVendor } from './index'
import { declaredModeParams, effectiveModeParams, modeWhenUnrecorded } from './modeParams'
import { modeTransportFor } from '../videoCapabilities/modeTransport'
import type { ArchetypeMode, ModelArchetype } from './types'

/** 档案 × 它单独声明过的供应商（含通用 "*"）——方式参数 owner 吃的是已按供应商特化的档案。 */
function vendorSpecializations(): Array<{ vendor: string; archetype: ModelArchetype }> {
  const out: Array<{ vendor: string; archetype: ModelArchetype }> = []
  for (const base of MODEL_ARCHETYPES) {
    const vendors = new Set<string>(['*'])
    for (const mode of base.modes) {
      for (const key of Object.keys(mode.vendorParams ?? {})) vendors.add(key)
      for (const key of Object.keys(mode.vendorTransportTaskKind ?? {})) vendors.add(key)
    }
    for (const vendor of vendors) out.push({ vendor, archetype: vendor === '*' ? base : specializeArchetypeForVendor(base, vendor) })
  }
  return out
}

/** 节点上可能存着的东西：这个档案每个方式的每个控件各一个非默认值 + 一批不归档案管的混装键。 */
function storedEverything(archetype: ModelArchetype): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    prompt: '一个镜头', modelKey: 'm', nodeId: 'n', idempotencyKey: 'k',
    referenceImages: ['https://assets.example.com/a.png'],
    archetype: { id: archetype.id, modeId: archetype.defaultModeId },
  }
  for (const mode of archetype.modes) {
    for (const control of mode.params) {
      if (control.key in stored) continue
      stored[control.key] = control.options.find((option) => option.value !== control.defaultValue)?.value ?? control.defaultValue ?? 'stored'
    }
  }
  return stored
}

const declaredKeys = (mode: ArchetypeMode) => new Set([...mode.params.map((control) => control.key), ...Object.keys(mode.fixedParams ?? {})])
const governedKeys = (archetype: ModelArchetype) => new Set(archetype.modes.flatMap((mode) => [...declaredKeys(mode)]))

describe('effectiveModeParams：这个方式这次发哪些参数', () => {
  it('2026-08-26 走查：现算成首帧方式时越界的比例收窄成 adaptive，存盘不改；回到文生还是 16:9', () => {
    const V25 = getArchetypeById('volcengine-seedance-2-5')!
    const ratioOptionsOf = (modeId: string) => V25.modes.find((m) => m.id === modeId)!.params.find((p) => p.key === 'ratio')!.options.map((o) => o.value)
    expect(ratioOptionsOf('t2v').length).toBeGreaterThan(1)
    expect(ratioOptionsOf('first')).toEqual(['adaptive'])
    const meta = { archetype: { id: V25.id, modeId: 't2v' }, ratio: '16:9', resolution: '1080p' }
    expect(effectiveModeParams({ archetype: V25, modeId: 'first', stored: meta }).params.ratio).toBe('adaptive')
    expect(meta.ratio).toBe('16:9')
    expect(effectiveModeParams({ archetype: V25, modeId: 't2v', stored: meta }).params.ratio).toBe('16:9')
    expect(effectiveModeParams({ archetype: V25, modeId: 'first', stored: meta }).params.resolution).toBe('1080p')
  })

  it('创作者那一幕：文生存了比例，现算成首帧（首帧不收比例）→ 比例不发；回到文生比例还在', () => {
    const wan = getArchetypeById('wan-3.0-apimart')!
    const first = wan.modes.find((mode) => mode.id === 'first')!
    const t2v = wan.modes.find((mode) => mode.id === 't2v')!
    const t2vSize = t2v.params.find((control) => control.key === 'size')!
    expect(first.params.some((control) => control.key === 'size')).toBe(false)
    const stored = { size: t2vSize.options.find((option) => option.value !== t2vSize.defaultValue)!.value }
    const sent = effectiveModeParams({ archetype: wan, modeId: 'first', stored })
    expect(sent.params).not.toHaveProperty('size')
    expect(sent.dropped).toEqual(['size'])
    expect(effectiveModeParams({ archetype: wan, modeId: 't2v', stored }).params.size).toBe(stored.size)
  })

  it('全目录：幂等（过两遍 = 过一遍）、不写回（输入冻结也不抛、原样不变）、管辖外的键原样', () => {
    for (const { archetype } of vendorSpecializations()) {
      const stored = Object.freeze(storedEverything(archetype))
      const before = JSON.stringify(stored)
      for (const mode of archetype.modes) {
        const once = effectiveModeParams({ archetype, modeId: mode.id, stored })
        const twice = effectiveModeParams({ archetype, modeId: mode.id, stored: once.params })
        expect(twice.params, `${archetype.id}/${mode.id}`).toEqual(once.params)
        expect(twice.dropped).toEqual([])
        for (const key of ['prompt', 'modelKey', 'nodeId', 'idempotencyKey', 'referenceImages', 'archetype']) {
          if (!governedKeys(archetype).has(key)) expect(once.params[key], `${archetype.id}/${mode.id}/${key}`).toEqual(stored[key])
        }
      }
      expect(JSON.stringify(stored)).toBe(before)
    }
  })

  it('普查：全部档案 × 供应商 × 方式，发出去的键 ⊆ 本方式声明 ∪ 不归档案管的键', () => {
    const bad: string[] = []
    for (const { vendor, archetype } of vendorSpecializations()) {
      const governed = governedKeys(archetype)
      const stored = storedEverything(archetype)
      for (const mode of archetype.modes) {
        const declared = declaredKeys(mode)
        for (const key of Object.keys(effectiveModeParams({ archetype, modeId: mode.id, stored }).params)) {
          if (governed.has(key) && !declared.has(key)) bad.push(`${archetype.id}@${vendor}/${mode.id}: ${key}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('控件没有默认值就不填（键不存在）；有默认值且存值缺才填', () => {
    let checked = 0
    for (const archetype of MODEL_ARCHETYPES) {
      for (const mode of archetype.modes) {
        const sent = effectiveModeParams({ archetype, modeId: mode.id, stored: {} }).params
        for (const control of mode.params) {
          if (control.defaultValue === undefined) { expect(sent, `${archetype.id}/${mode.id}/${control.key}`).not.toHaveProperty(control.key); checked++ }
          else expect(sent[control.key]).toEqual(mode.fixedParams?.[control.key] ?? control.defaultValue)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('固定参数最后铺：盖掉节点残留的旧判别值，archetypeInput 子袋里同样覆盖', () => {
    const archetype = MODEL_ARCHETYPES.find((candidate) => candidate.modes.some((mode) => Object.keys(mode.fixedParams ?? {}).length))!
    const mode = archetype.modes.find((candidate) => Object.keys(candidate.fixedParams ?? {}).length)!
    const [key, value] = Object.entries(mode.fixedParams!)[0]!
    const sent = effectiveModeParams({ archetype, modeId: mode.id, stored: { [key]: 'stale', archetypeInput: { [key]: 'stale', image_urls: ['u'] } } }).params
    expect(sent[key]).toBe(value)
    expect(sent.archetypeInput).toEqual({ [key]: value, image_urls: ['u'] })
  })

  it('方式认不出 → 原样返回（不剥、不填）', () => {
    const archetype = getArchetypeById('wan-3.0-apimart')!
    expect(effectiveModeParams({ archetype, modeId: 'no-such-mode', stored: { size: 'x', duration: 3 } })).toEqual({ params: { size: 'x', duration: 3 }, dropped: [] })
  })

  it('变体：按变体特化后的控件收窄（与参数面板同一份声明）', () => {
    const withVariants = MODEL_ARCHETYPES.filter((archetype) => (archetype.variants ?? []).some((variant) => variant.paramOverrides))
    expect(withVariants.length).toBeGreaterThan(0)
    for (const archetype of withVariants) {
      for (const variant of archetype.variants ?? []) {
        const specialized = specializeArchetypeForVariant(archetype, variant.id)
        for (const mode of specialized.modes) {
          expect(declaredModeParams({ archetype, variantId: variant.id, modeId: mode.id })?.controls).toEqual(mode.params)
        }
      }
    }
  })
})

describe('modeWhenUnrecorded：没有方式记录时的主方式（规则原样来自生成脚本）', () => {
  it('全目录逐 (档案, 供应商, 任务类型)：按主方式取出的默认值与生成脚本的桥接表逐字相同', () => {
    const diffs: string[] = []
    let compared = 0
    for (const base of MODEL_ARCHETYPES) {
      const table = buildWireDefaultsFor([base])[base.id] ?? {}
      for (const { vendor, archetype } of vendorSpecializations().filter((entry) => entry.archetype.id === base.id)) {
        const vendorKey = vendor === '*' ? null : vendor
        const kinds = new Set(archetype.modes.flatMap((mode) => [modeTransportFor(mode, archetype, vendorKey), modeTransportFor(mode, archetype, null)]))
        for (const taskKind of kinds) {
          const perKind = table[taskKind] as Record<string, Record<string, unknown>> | undefined
          const legacy = (vendorKey ? perKind?.[vendorKey] : undefined) ?? perKind?.['*'] ?? {}
          const mode = modeWhenUnrecorded(archetype, taskKind, vendorKey)
          const owned = mode ? effectiveModeParams({ archetype, modeId: mode.id, stored: {} }).params : {}
          compared++
          if (JSON.stringify(Object.entries(owned).sort()) !== JSON.stringify(Object.entries(legacy).sort())) {
            diffs.push(`${base.id}@${vendor}/${taskKind}: 主方式 ${mode?.id} ${JSON.stringify(owned)} ≠ 桥接表 ${JSON.stringify(legacy)}`)
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100)
    expect(diffs).toEqual([])
  })
})
