// 渠道行（fal / Runway）并进模型身份——走 App 模型下拉的**同一条路**断言（2026-09-28 用户拍板「合并」）：
//   applyBuiltinSeeds → toCatalogModelOptions（带供应商显示名，同 modelCatalogCache）→ dedupeModelOptions。
//
// 这份测试守四件事，缺一件合并就不算做对：
//   ① 同一个模型只列一次，旁边的供应商里有 fal / Runway（身份的唯一 owner 是 seedModelIdentity.CANONICAL_MODEL_IDS）；
//   ② 钱走哪家不悄悄变：合并前用户会点的那一条（中转站那条）默认走哪家，合并后仍走哪家；
//   ③ 选的变体 = 真正发出去的 modelKey：同一组里同一家的多行必须可互换，变体轴只在线缆认它的那家出现；
//   ④ 合并不让那一条在下拉里换档（分档跟着模型走，不跟着渠道走）。
// 待定名单（PENDING）里的每一行都写了**为什么这次不并**——改之前先读理由，别为了让测试变绿删名单。
import { describe, expect, it } from 'vitest'
import { applyBuiltinSeeds } from '../../electron/catalog/seedBuiltins'
import { selectTaskMapping, type CatalogState, type Mapping } from '../../electron/catalog/types'
import { wireReferencedParamKeys } from '../../electron/catalog/paramTranslate'
import { getArchetypeById } from '../../electron/shared/modelArchetypes'
import { archetypeVariantAxisIsLive } from '../workbench/generationCanvas/nodes/controls/channelModeReach'
import { operationSelectsArchetypeWireModel, resolveWireModel } from '../../electron/shared/modelArchetypes/wireModelIdentity'

/** 与 useChannelCreateBody.readModeChannelBody 同形：变体栏看的那三样。 */
function channelOf(mapping: Mapping) {
  return { body: mapping.create.body, wireParamKeys: wireReferencedParamKeys(mapping.create), selectsArchetypeWireModel: operationSelectsArchetypeWireModel(mapping.create) }
}
import { dedupeModelOptions, modelCatalogLifecycle, sortModelProviders, type DedupedModel, type ModelProviderRef } from './modelIdentity'
import { toCatalogModelOptions } from './modelOptionMappers'

type Kind = 'video' | 'image' | 'audio' | 'model3d'
const KINDS: readonly Kind[] = ['video', 'image', 'audio', 'model3d']
const CHANNEL_VENDORS = new Set(['fal', 'runway'])

function seeded(): CatalogState {
  return applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, '2026-09-28T00:00:00.000Z').state
}

/** App 模型下拉的同一条路。`override` 只用来**模拟**把待定行并进来会发生什么（`vendor:modelKey` → canonical id）。 */
function dropdown(state: CatalogState, kind: Kind, override: Readonly<Record<string, string>> = {}): DedupedModel[] {
  const names = new Map(state.vendors.map((vendor) => [vendor.key, vendor.name]))
  const rows = state.models.filter((model) => model.kind === kind).map((model) => {
    const canonicalModelId = override[`${model.vendorKey}:${model.modelKey}`]
    return canonicalModelId ? { ...model, meta: { ...(model.meta as Record<string, unknown>), canonicalModelId } } : model
  })
  return dedupeModelOptions(toCatalogModelOptions(rows as never).map((option) => ({ ...option, vendorName: names.get(option.vendor ?? '') })))
}

const address = (provider: ModelProviderRef): string => `${provider.vendor}:${provider.modelKey}`
const isChannel = (provider: ModelProviderRef): boolean => CHANNEL_VENDORS.has(provider.vendor ?? '')
const channelGroups = (groups: readonly DedupedModel[]) => groups.filter((group) => group.providers.some(isChannel))

/** 本次并进来的组（组名取中转站那一行的名字，不带渠道名）。 */
const MERGED: ReadonlyArray<{ kind: Kind; canonicalId: string; label: string; providers: readonly string[] }> = [
  { kind: 'video', canonicalId: 'seedance 2.5', label: 'Seedance 2.5', providers: ['kie:bytedance/seedance-2-5', 'apimart:doubao-seedance-2.5', 'volcengine:doubao-seedance-2-5-260628', 'fal:bytedance/seedance-2.5', 'runway:seedance2_5'] },
  { kind: 'video', canonicalId: 'minimax h3', label: 'MiniMax H3', providers: ['kie:minimax-h3', 'apimart:MiniMax-H3', 'minimax:MiniMax-H3', 'runway:hailuo3'] },
  { kind: 'video', canonicalId: 'wan 3.0', label: 'Wan 3.0', providers: ['kie:wan/3-0-video', 'apimart:wan3.0-video', 'runway:wan3'] },
  { kind: 'video', canonicalId: 'grok imagine 1.5', label: 'Grok Imagine 1.5', providers: ['apimart:grok-imagine-1.5-video-apimart', 'runway:grok_imagine_1_5'] },
  { kind: 'video', canonicalId: 'gemini omni 1.1 flash', label: 'Gemini Omni 1.1 Flash', providers: ['kie:google/gemini-omni-flash-1-1', 'fal:google/gemini-omni-flash/v1.1', 'runway:gemini_omni_flash'] },
  { kind: 'video', canonicalId: 'happyhorse 1.0', label: 'HappyHorse 1.0', providers: ['kie:happyhorse', 'runway:happyhorse_1_0'] },
  { kind: 'image', canonicalId: 'gpt image 2', label: 'GPT Image 2', providers: ['kie:gpt-image-2-text-to-image', 'kie:gpt-image-2-image-to-image', 'apimart:gpt-image-2', 'runninghub:rhart-image-g-2-official', 'runway:gpt_image_2'] },
  { kind: 'image', canonicalId: 'nano banana 2', label: 'Nano Banana 2', providers: ['kie:nano-banana-2', 'apimart:gemini-3.1-flash-image-preview', 'fal:fal-ai/nano-banana-2', 'runway:gemini_image3.1_flash'] },
  { kind: 'image', canonicalId: 'nano banana', label: 'Nano Banana', providers: ['kie:nano-banana', 'apimart:gemini-2.5-flash-image-preview', 'runninghub:rhart-image-v1', 'runway:gemini_2.5_flash'] },
  { kind: 'image', canonicalId: 'seedream 5.0 pro', label: 'Seedream 5.0 Pro', providers: ['kie:seedream/5-pro-text-to-image', 'apimart:doubao-seedream-5-0-pro', 'volcengine:doubao-seedream-5-0-pro-260628', 'fal:bytedance/seedream/v5/pro', 'runway:seedream5_pro'] },
  { kind: 'image', canonicalId: 'seedream 5.0 lite', label: 'Seedream 5.0 Lite', providers: ['kie:seedream/5-lite-text-to-image', 'volcengine:doubao-seedream-5-0-260128', 'runway:seedream5_lite'] },
  { kind: 'audio', canonicalId: 'eleven v3', label: 'Eleven v3', providers: ['elevenlabs:eleven_v3', 'runway:eleven_v3'] },
  { kind: 'audio', canonicalId: 'eleven sound effects v2', label: 'Eleven Sound Effects v2', providers: ['elevenlabs:eleven_text_to_sound_v2', 'fal:fal-ai/elevenlabs/sound-effects/v2', 'runway:eleven_text_to_sound_v2'] },
]

/** Runway 自家出品：「Runway」就是模型名的一部分，身份不去掉它。 */
const RUNWAY_NATIVE = new Set(['gen4.5', 'gen4_turbo', 'gen4_image', 'gen4_image_turbo'])

/** 这次**不并**的渠道行 → 理由。并它们之前先把理由里的事解决掉（拍板默认渠道 / 变体桥接 / 查清出品方）。 */
const PENDING: ReadonlyMap<string, string> = new Map([
  ['fal:openai/gpt-image-2', '2026-09-29 裁决 B：不并，单独一行。并进来默认渠道会换家（同档 vendorTier 2 里「fal.ai」字母序排在 RunningHub 前，只接了 RunningHub + fal 的用户默认家会从 RunningHub 变成 fal）；要保住默认家就得给 fal / Runway 单开第 3 档，而那会改掉 Agent 读的 list_models 顺序——Agent 在没人看见的情况下换家花钱，比下拉里多两行糟得多'],
  ['fal:fal-ai/kling-video/v3/pro', '同上（可灵 3.0 组里有 RunningHub 的 kling-v3.0-pro）'],
  ['runway:seedance2', '变体行：中转站是「一行 + 标准/快速/Mini 变体轴」，Runway 是每个变体一行；选择器按供应商折叠，并进来后 Runway 只剩一行可选'],
  ['runway:seedance2_fast', '变体行（同上）'],
  ['runway:seedance2_mini', '变体行（同上）'],
  ['runway:veo3.1', '变体行（veo3.1 / veo3.1_fast 两行对 APIMart 的 fast / quality / lite 变体轴，对应关系未定）'],
  ['runway:veo3.1_fast', '变体行（同上）'],
  ['runway:seed_audio', '出品方查不清：仓里档案写「Runway 自家的一手音频产品」'],
])

describe('渠道行并进模型身份 · ① 同一个模型只列一次', () => {
  const state = seeded()
  it.each(MERGED)('$canonicalId：只剩一条，fal / Runway 在它的供应商里', ({ kind, canonicalId, label, providers }) => {
    const groups = dropdown(state, kind)
    const hits = groups.filter((group) => group.providers.some((provider) => providers.includes(address(provider))))
    expect(hits.map((group) => group.canonicalId)).toEqual([canonicalId])
    expect(hits[0].providers.map(address).sort()).toEqual([...providers].sort())
    expect(hits[0].providers.some(isChannel)).toBe(true)
    // 组名取中转站那一行（目录里中转站的行在渠道行前面），不是「· fal」「Runway …」。
    expect(hits[0].label).toBe(label)
  })

  it('每一条 fal / Runway 行：要么有不带渠道名的模型身份，要么是 Runway 自家出品，要么在待定名单里（写了理由）', () => {
    const seen = new Set<string>()
    for (const model of state.models.filter((row) => CHANNEL_VENDORS.has(row.vendorKey))) {
      const key = `${model.vendorKey}:${model.modelKey}`
      seen.add(key)
      const canonical = (model.meta as Record<string, unknown> | undefined)?.canonicalModelId
      if (model.vendorKey === 'runway' && RUNWAY_NATIVE.has(model.modelKey)) {
        expect(canonical, key).toBeUndefined()
      } else if (PENDING.has(key)) {
        // 待定的不许悄悄并进来：要并，先把 PENDING 里写的那件事解决，再从名单里删掉它。
        expect(canonical, `${key}：${PENDING.get(key)}`).toBeUndefined()
      } else {
        expect(canonical, `${key} 缺模型身份——走 label 回退会把渠道名算进身份，下拉里又多一条`).toEqual(expect.any(String))
        expect(String(canonical), key).not.toMatch(/(^|\s)(fal|runway)(\s|$)|·/i)
      }
    }
    // 名单里的行必须真实存在，否则名单会悄悄变成一份没人核对的豁免清单。
    for (const key of PENDING.keys()) expect(seen.has(key), `待定名单里的 ${key} 在目录里不存在`).toBe(true)
  })

  it('一个组只要含渠道行，组里每一行都显式带身份（labelZh 用户可改，靠 label 回退的那一行一改名就会掉出组）', () => {
    for (const kind of KINDS) {
      for (const group of channelGroups(dropdown(state, kind))) {
        for (const provider of group.providers) {
          const explicit = (provider.option.meta as Record<string, unknown> | undefined)?.canonicalModelId
          if (provider.vendor === 'runway' && RUNWAY_NATIVE.has(provider.modelKey ?? '')) continue
          if (PENDING.has(address(provider))) continue
          expect(explicit, `${group.canonicalId} ← ${address(provider)}`).toBe(group.canonicalId)
        }
      }
    }
  })
})

/** 合并前用户点的那一条（中转站那条）默认走哪家 vs 合并后那一条默认走哪家；只比较接了至少一家中转站的组合。 */
function defaultVendorChanges(group: DedupedModel, orderedVendorKeys: readonly string[] = []): string[] {
  const vendors = [...new Set(group.providers.map((provider) => provider.vendor ?? ''))]
  const changes: string[] = []
  for (let mask = 1; mask < 1 << vendors.length; mask += 1) {
    const connected = new Set(vendors.filter((_, index) => mask & (1 << index)))
    const relay = group.providers.filter((provider) => !isChannel(provider) && connected.has(provider.vendor ?? ''))
    if (relay.length === 0) continue
    const before = sortModelProviders(relay, orderedVendorKeys)[0].vendor
    const after = sortModelProviders(group.providers.filter((provider) => connected.has(provider.vendor ?? '')), orderedVendorKeys)[0].vendor
    if (before !== after) changes.push(`{${[...connected].join(',')}}: ${before} -> ${after}`)
  }
  return changes
}

describe('渠道行并进模型身份 · ② 钱走哪家不悄悄变', () => {
  const state = seeded()
  it('没排过供应商顺序（按 vendorTier）：每个合并组、每种「接了哪几家」的组合，默认家都和合并前一样', () => {
    let compared = 0
    for (const kind of KINDS) {
      for (const group of channelGroups(dropdown(state, kind))) {
        if (!group.providers.some((provider) => !isChannel(provider))) continue
        compared += 1
        expect(defaultVendorChanges(group), group.canonicalId).toEqual([])
      }
    }
    expect(compared).toBeGreaterThanOrEqual(MERGED.length)
  })

  it('fal 的 GPT Image 2 / Kling V3 Pro 为什么不并（2026-09-29 裁决 B）：并进来会让「只接了 RunningHub + fal」的用户默认家从 RunningHub 变成 fal', () => {
    const simulate = { 'fal:openai/gpt-image-2': 'gpt image 2', 'fal:fal-ai/kling-video/v3/pro': '可灵 3.0' }
    const gpt = dropdown(state, 'image', simulate).find((group) => group.canonicalId === 'gpt image 2')!
    const kling = dropdown(state, 'video', simulate).find((group) => group.canonicalId === '可灵 3.0')!
    expect(defaultVendorChanges(gpt)).toEqual(['{runninghub,fal}: runninghub -> fal', '{runninghub,fal,runway}: runninghub -> fal'])
    expect(defaultVendorChanges(kling)).toEqual(['{runninghub,fal}: runninghub -> fal'])
  })

  it('用户在设置里把 fal / Runway 排在最前：合并后那一条按他的排序走（排序设置的本义，显式列出，不是悄悄变）', () => {
    const seedance = dropdown(state, 'video').find((group) => group.canonicalId === 'seedance 2.5')!
    expect(sortModelProviders(seedance.providers)[0].vendor).toBe('volcengine')
    expect(sortModelProviders(seedance.providers, ['fal'])[0].vendor).toBe('fal')
    expect(sortModelProviders(seedance.providers, ['runway'])[0].vendor).toBe('runway')
  })
})

/** 这一行在某个 (taskKind, modeId) 上真正会走的那条 mapping——与执行侧同一个选择闸。 */
function mappingIds(mappings: Mapping[], vendor: string, modelKey: string): Map<string, string | null> {
  const slots = new Set(mappings.filter((mapping) => mapping.vendorKey === vendor).map((mapping) => `${mapping.taskKind}|${mapping.modeId ?? ''}`))
  return new Map([...slots].map((slot) => {
    const [taskKind, modeId] = slot.split('|')
    return [slot, selectTaskMapping(mappings, vendor, taskKind as Mapping['taskKind'], modelKey, modeId || undefined)?.id ?? null]
  }))
}

/** 同一组里同一家的多行必须**可互换**（每个任务都落到同一条 mapping）；否则就是变体行，选择器按供应商折叠会把它藏掉。 */
function variantRowViolations(state: CatalogState, groups: readonly DedupedModel[]): string[] {
  const violations: string[] = []
  for (const group of groups) {
    const byVendor = new Map<string, ModelProviderRef[]>()
    for (const provider of group.providers) byVendor.set(provider.vendor ?? '', [...(byVendor.get(provider.vendor ?? '') ?? []), provider])
    for (const [vendor, rows] of byVendor) {
      const [first, ...rest] = rows.map((row) => mappingIds(state.mappings, vendor, row.modelKey ?? ''))
      for (const [index, other] of rest.entries()) {
        for (const [slot, id] of first) {
          if (other.get(slot) !== id) violations.push(`${group.canonicalId} · ${vendor}: ${rows[0].modelKey} 与 ${rows[index + 1].modelKey} 在 ${slot} 上发的不是同一条（${id} / ${other.get(slot)}）`)
        }
      }
    }
  }
  return violations
}

describe('渠道行并进模型身份 · ③ 选的变体 = 真正发出去的 modelKey', () => {
  const state = seeded()
  it('每个组里同一家的多行都可互换（kie 的 GPT Image 2 文生图 / 图生图两行共用同一组 mapping，不算变体行）', () => {
    for (const kind of KINDS) expect(variantRowViolations(state, dropdown(state, kind)), kind).toEqual([])
  })

  it('Runway 的 Seedance 2 / Veo 3.1 变体行为什么暂不并：并进来就是「同一家多行、各发各的 modelKey」', () => {
    const simulate = {
      'runway:seedance2': 'seedance 2.0', 'runway:seedance2_fast': 'seedance 2.0', 'runway:seedance2_mini': 'seedance 2.0',
      'runway:veo3.1': 'veo 3.1', 'runway:veo3.1_fast': 'veo 3.1',
    }
    const violations = variantRowViolations(state, dropdown(state, 'video', simulate))
    expect(violations.some((line) => line.startsWith('seedance 2.0 · runway: seedance2 与 seedance2_fast'))).toBe(true)
    expect(violations.some((line) => line.startsWith('seedance 2.0 · runway: seedance2 与 seedance2_mini'))).toBe(true)
    expect(violations.some((line) => line.startsWith('veo 3.1 · runway: veo3.1 与 veo3.1_fast'))).toBe(true)
  })

  it('没并的 Runway 变体行各自一条，选哪条就发哪条的 modelKey', () => {
    const groups = dropdown(state, 'video')
    for (const modelKey of ['seedance2', 'seedance2_fast', 'seedance2_mini', 'veo3.1', 'veo3.1_fast']) {
      const group = groups.find((candidate) => candidate.providers.some((provider) => provider.vendor === 'runway' && provider.modelKey === modelKey))!
      expect(group.providers.map(address)).toEqual([`runway:${modelKey}`])
      const mapping = selectTaskMapping(state.mappings, 'runway', 'text_to_video', modelKey, 't2v')!
      expect((mapping.create.body as { model?: unknown }).model).toBe(modelKey)
    }
  })

  it('Wan 3.0（kie 有「标准 / 高速」变体轴，Runway 只有一行 wan3）：变体轴只在线缆认它的那家出现，Runway 发的就是 wan3', () => {
    const archetype = getArchetypeById('wan-3.0')!
    const kie = selectTaskMapping(state.mappings, 'kie', 'text_to_video', 'wan/3-0-video', 't2v')!
    const runway = selectTaskMapping(state.mappings, 'runway', 'text_to_video', 'wan3', 't2v')!
    // kie：body 读 {{request.params.model}} → 变体轴活着，选「高速」真的发 wan/3-0-video-prime。
    expect(archetypeVariantAxisIsLive(channelOf(kie))).toBe(true)
    const prime = { modelKey: 'wan/3-0-video', archetype: { id: archetype.id, modeId: 't2v', variantId: 'prime' } }
    expect(resolveWireModel({ operation: kie.create, connection: { vendorKey: 'kie', modelKey: 'wan/3-0-video' }, extras: prime, taskKind: 'text_to_video' }))
      .toBe('wan/3-0-video-prime')
    // Runway：model 写死 → 变体轴是惰性的，界面不出变体段（NodeParameterControls 按它收掉），线缆上就是 wan3。
    expect(archetypeVariantAxisIsLive(channelOf(runway))).toBe(false)
    expect((runway.create.body as { model?: unknown }).model).toBe('wan3')
  })
})

describe('渠道行并进模型身份 · ④ 合并不让那一条换档', () => {
  const state = seeded()
  it('合并后的分档 = 中转站那几行原来的分档（Nano Banana 第一代不会被 Runway 行顶进旗舰区）', () => {
    for (const kind of KINDS) {
      for (const group of channelGroups(dropdown(state, kind))) {
        const relay = group.providers.filter((provider) => !isChannel(provider))
        if (relay.length === 0) continue
        expect(modelCatalogLifecycle(group), group.canonicalId).toBe(modelCatalogLifecycle({ ...group, providers: relay }))
      }
    }
    const nanoBanana = dropdown(state, 'image').find((group) => group.canonicalId === 'nano banana')!
    expect(modelCatalogLifecycle(nanoBanana)).toBe('legacy')
  })
})
