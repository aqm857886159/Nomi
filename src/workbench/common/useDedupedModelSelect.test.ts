// 病模型沉底/灰化的判定（2026-07-30 拍板）。核心是**别误伤**：下拉一条 = 去重后的模型，
// 底下可能挂 2-4 家供应商；只要还有一家健康就该走那家、整条不算病。
// 判据以 AilingProbe 注入 → 纯函数直测，不引 React 测试库、不碰 localStorage。
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CONNECT_VENDOR_OPTION_VALUE,
  buildModelSelectOptions,
  buildProviderSelectOptions,
  buildVendorExplicitModelOptions,
  pickHealthiestProvider,
  providerAddress,
  resolveProviderByAddress,
  resolveProviderSelectValue,
  useDedupedModelSelect,
  type DedupedModelSelectView,
} from './useDedupedModelSelect'
import { dedupeModelOptions } from '../../config/modelIdentity'
import type { ModelOption } from '../../config/models'
import { toCatalogModelOptions } from '../../config/modelOptionMappers'

function option(modelKey: string, vendor: string, label: string): ModelOption {
  return { value: `${vendor}:${modelKey}`, label, modelKey, vendor, kind: 'image' } as ModelOption
}
const ailing = (...keys: string[]) => ({ modelKey }: { modelKey: unknown; vendor: unknown }) => keys.includes(String(modelKey))
const healthy = () => false

function variantOptions(tiers = ['low', 'medium', 'high']): ModelOption[] {
  return toCatalogModelOptions(tiers.map(tier => ({
    modelKey: `gemini-3.7-flash-${tier}`, vendorKey: 'antigravity-cli', labelZh: `Gemini 3.7 Flash ${tier}`,
    kind: 'text', enabled: true, published: true, publishedModes: ['chat' as const], createdAt: '', updatedAt: '',
  }))).map(option => ({ ...option, vendorName: 'Antigravity CLI' }))
}

function renderSelect(options: ModelOption[], value: string, vendor = 'antigravity-cli') {
  const onChange = vi.fn()
  let view!: DedupedModelSelectView
  function Probe() {
    view = useDedupedModelSelect(options, value, onChange, vendor)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return { view, onChange }
}

describe('exact catalog variants in the generic model selector', () => {
  it('shows one family and one supplier while retaining all enabled exact tiers', () => {
    const { view, onChange } = renderSelect(variantOptions(), 'gemini-3.7-flash-high')
    expect(view.modelOptions).toHaveLength(1)
    expect(view.modelOptions[0]).toMatchObject({ label: 'Gemini 3.7 Flash', trailing: 'Antigravity CLI' })
    expect(view.providerOptions).toEqual([])
    expect(view.variantOptions.map(option => option.label)).toEqual(['Low', 'Medium', 'High'])
    expect(view.variantOptions.find(option => option.value === view.variantValue)?.label).toBe('High')
    view.onVariantPick(view.variantOptions[0].value)
    expect(onChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
  })

  it('preserves the selected tier when reselecting its family and chooses the documented default only for a new selection', () => {
    const existing = renderSelect(variantOptions(), 'gemini-3.7-flash-low')
    existing.view.onModelPick(existing.view.modelOptions[0].value)
    expect(existing.onChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
    const fresh = renderSelect(variantOptions(), '')
    fresh.view.onModelPick(fresh.view.modelOptions[0].value)
    expect(fresh.onChange).toHaveBeenCalledWith('gemini-3.7-flash-medium', 'antigravity-cli')
  })

  it('never invents an unavailable default or accepts disabled and unknown tier addresses', () => {
    const { view, onChange } = renderSelect(variantOptions(['low', 'high']), 'gemini-3.7-flash-low')
    expect(view.variantOptions.map(option => option.label)).toEqual(['Low', 'High'])
    for (const unavailable of ['gemini-3.7-flash-medium', 'gemini-3.7-flash-future']) {
      view.onVariantPick(`antigravity-cli\u0000${unavailable}`)
      view.onProviderPick(`antigravity-cli\u0000${unavailable}`)
    }
    expect(onChange).not.toHaveBeenCalled()
    const fresh = renderSelect(variantOptions(['low']), '')
    fresh.view.onModelPick(fresh.view.modelOptions[0].value)
    expect(fresh.onChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
  })
})

describe('buildModelSelectOptions — 病模型沉底 + 灰化', () => {
  it('全家都病 → 沉到最后 + 灰化 + 右侧标注换成「最近多次失败」', () => {
    const deduped = dedupeModelOptions([
      option('imagen-4.0-apimart', 'apimart', 'Imagen 4'),
      option('z-image-turbo', 'apimart', 'Z-Image Turbo'),
    ])
    const view = buildModelSelectOptions(deduped, ailing('imagen-4.0-apimart'))

    const last = view[view.length - 1]
    expect(last.label).toBe('Imagen 4')
    expect(last.dimmed).toBe(true)
    expect(last.trailing).toBe('最近多次失败')
    expect(last.trailingTone).toBe('danger')
    // 健康的保持原序、不被打标、仍显示厂商名。
    expect(view[0].label).toBe('Z-Image Turbo')
    expect(view[0].dimmed).toBeUndefined()
    expect(view[0].trailing).toBe('APIMart')
  })

  it('多家里只病一家 → 整条**不算病**（否则多家里一家挂就误伤整个模型）', () => {
    const deduped = dedupeModelOptions([
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
    ])
    const view = buildModelSelectOptions(deduped, ailing('nano-banana-apimart'))

    expect(view).toHaveLength(1)
    expect(view[0].dimmed).toBeUndefined()
    // 多家 → 行尾 chip 说明走哪几家；**不再**同时挂一条「N 家」附注。
    // 两种表达一起上会把模型名挤没（2026-09-06 真机实测），这条钉住只留一种。
    expect(view[0].trailing).toBeUndefined()
    expect(view[0].chips?.map((chip) => chip.label)).toEqual(['APIMart', 'Kie'])
  })

  it('全healthy 时顺序与打标一律不动（避让机制不该影响常态）', () => {
    const deduped = dedupeModelOptions([option('a', 'apimart', 'A'), option('b', 'kie', 'B')])
    const view = buildModelSelectOptions(deduped, healthy)
    expect(view.map((o) => o.label)).toEqual(['A', 'B'])
    expect(view.some((o) => o.dimmed)).toBe(false)
  })
})

describe('pickHealthiestProvider — 换家优先于换模型', () => {
  it('跳过病供应商，落到健康那家', () => {
    const [model] = dedupeModelOptions([
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
    ])
    expect(pickHealthiestProvider(model, ailing('nano-banana-apimart'))?.vendor).toBe('kie')
  })

  it('全病也绝不空选：用户明知故选时仍回退到某一家', () => {
    const [model] = dedupeModelOptions([option('only', 'apimart', '独苗')])
    expect(pickHealthiestProvider(model, ailing('only'))?.option.value).toBe('apimart:only')
  })
})

describe('buildVendorExplicitModelOptions — 批量下拉里把供应商摊开（2026-08-18 用户报「框选没法选不同供应商」）', () => {
  it('多家的模型一家一行、trailing 是那一家的短名（不再折叠成「N 家」）', () => {
    const deduped = dedupeModelOptions([
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
      option('nano-banana-vol', 'volcengine', 'Nano Banana'),
      option('gpt-image-2-apimart', 'apimart', 'GPT Image 2'),
    ])
    const view = buildVendorExplicitModelOptions(deduped, healthy)

    expect(view.map((o) => [o.label, o.trailing])).toEqual([
      ['Nano Banana', 'APIMart'],
      ['Nano Banana', 'Kie'],
      ['Nano Banana', '火山方舟'],
      ['GPT Image 2', 'APIMart'],
    ])
    // 每行 value 都是复合寻址串 → 同名模型跨厂商绝不撞值（撞了就又选不动家）。
    expect(new Set(view.map((o) => o.value)).size).toBe(4)
  })

  it('病态按**这一家**判（不是折叠版的「每家都病」）：病的那家沉底 + 灰化，同模型其他家不受牵连', () => {
    const deduped = dedupeModelOptions([
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
    ])
    const view = buildVendorExplicitModelOptions(deduped, ailing('nano-banana-apimart'))

    expect(view).toHaveLength(2)
    // 健康那家在前、保留厂商短名。
    expect(view[0].trailing).toBe('Kie')
    expect(view[0].dimmed).toBeUndefined()
    // 病的那家沉底、灰化、标注换成「最近多次失败」——但仍可点（手动选择永不拦）。
    expect(view[1].dimmed).toBe(true)
    expect(view[1].trailing).toBe('最近多次失败')
    expect(view[1].trailingTone).toBe('danger')
    expect(view[1].disabled).toBeUndefined()
  })

  it('单家的模型仍是一行，trailing = 那家短名（与今天的折叠版行为一致）', () => {
    const deduped = dedupeModelOptions([option('z-image-turbo', 'apimart', 'Z-Image Turbo')])
    expect(buildVendorExplicitModelOptions(deduped, healthy)).toEqual([expect.objectContaining({
      value: providerAddress(deduped[0].providers[0]),
      label: 'Z-Image Turbo',
      trailing: 'APIMart',
      icon: { kind: 'model' },
    })])
  })

  // 回归锁：2026-08-18 真机走查抓到的。第一版按 (vendor, option.value) 折叠，
  // 而真实目录里**同一家**会把多个 modelKey 挂到同一个显示名（kie 的 nano-banana /
  // nano-banana-kie），于是渲出两行「Nano Banana · Kie」——长得一模一样、用户只能瞎猜。
  // 单测和七道门岗全没抓到，是走查截图看出来的。
  it('同一家给同名模型挂多个 modelKey → 仍只出一行（不许出现两行完全相同的选项）', () => {
    const deduped = dedupeModelOptions([
      option('nano-banana', 'kie', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
      option('gpt-image-2-text-to-image', 'kie', 'GPT Image 2'),
      option('gpt-image-2-image-to-image', 'kie', 'GPT Image 2'),
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
    ])
    const view = buildVendorExplicitModelOptions(deduped, healthy)

    expect(view.map((o) => [o.label, o.trailing])).toEqual([
      ['Nano Banana', 'Kie'],
      ['Nano Banana', 'APIMart'],
      ['GPT Image 2', 'Kie'],
    ])
    // 不变量：任意两行的「显示名 + 厂商」组合不得重复——重复即用户不可区分。
    const shown = view.map((o) => `${o.label}␟${o.trailing}`)
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('一家有多个变体、其中一个病 → 走这家健康的那个变体，整行不标病', () => {
    const deduped = dedupeModelOptions([
      option('nano-banana', 'kie', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
    ])
    const view = buildVendorExplicitModelOptions(deduped, ailing('nano-banana'))

    expect(view).toHaveLength(1)
    expect(view[0].dimmed).toBeUndefined()
    expect(view[0].trailing).toBe('Kie')
    // 选中的应是这家健康的那个变体，不是病的那个。
    expect(view[0].value).toContain('nano-banana-kie')
  })
})

describe('resolveProviderByAddress — 摊平项反查回具体那一家', () => {
  const deduped = dedupeModelOptions([
    option('gpt-image-2', 'relay-a', 'GPT Image 2'),
    option('gpt-image-2', 'relay-b', 'GPT Image 2'),
  ])

  it('每一行都能反查回它自己那一家（这就是 vendor 真正被写进节点的那一步）', () => {
    for (const row of buildVendorExplicitModelOptions(deduped, healthy)) {
      const picked = resolveProviderByAddress(deduped, row.value)
      expect(picked).not.toBeNull()
      expect(providerAddress(picked!)).toBe(row.value)
    }
    const vendors = buildVendorExplicitModelOptions(deduped, healthy)
      .map((row) => resolveProviderByAddress(deduped, row.value)?.vendor)
    expect(new Set(vendors)).toEqual(new Set(['relay-a', 'relay-b']))
  })

  it('认不出的串 → null（调用方据此不写模型，绝不瞎猜一家）', () => {
    expect(resolveProviderByAddress(deduped, 'nope nope')).toBeNull()
    expect(resolveProviderByAddress(deduped, '')).toBeNull()
  })
})

describe('供应商锁定寻址 — 同名 modelKey 跨厂商不撞值（2026-07-31 群反馈）', () => {
  // 两个中转站提供**同名** modelKey（option.value 相同）——裸 value 当下拉值会撞。
  const sameKey = (vendor: string): ModelOption =>
    ({ value: 'gpt-image-2', label: 'GPT Image 2', modelKey: 'gpt-image-2', vendor, kind: 'image' }) as ModelOption

  it('buildProviderSelectOptions：两家各一项且 value 互不相同', () => {
    const [model] = dedupeModelOptions([sameKey('relay-b'), sameKey('relay-a')])
    const opts = buildProviderSelectOptions(model)
    expect(opts).toHaveLength(2)
    expect(new Set(opts.map((o) => o.value)).size).toBe(2)
    expect(opts.map((o) => o.icon)).toEqual([
      { kind: 'provider', fallback: 'R' },
      { kind: 'provider', fallback: 'R' },
    ])
  })

  it('resolveProviderSelectValue：按节点存的 vendor 显示锁定那家，不再永远显示首家', () => {
    const [model] = dedupeModelOptions([sameKey('relay-b'), sameKey('relay-a')])
    const opts = buildProviderSelectOptions(model)
    const valueA = resolveProviderSelectValue(model, 'gpt-image-2', 'relay-a')
    const valueB = resolveProviderSelectValue(model, 'gpt-image-2', 'relay-b')
    expect(valueA).not.toBe(valueB)
    expect(opts.some((o) => o.value === valueA)).toBe(true)
    expect(opts.some((o) => o.value === valueB)).toBe(true)
    // vendor 缺省（旧数据）→ 回退首家，不落空。
    expect(resolveProviderSelectValue(model, 'gpt-image-2')).toBe(valueB)
  })
})

describe('健康记忆按 (vendor, modelKey) 判定 —— 「换家优先于换模型」才真的能换家', () => {
  // 2026-09-03 真实付费复验实测：点「Gpt Image 2」反复落到 Kie（余额为负、连连失败），
  // 要手动切回 APIMart。根因不在 picker，在健康记忆的身份键少了 vendor：
  // Kie 那家连败被记成「gpt-image-2 这个模型病了」，APIMart 的同名模型跟着背锅，
  // healthyVendors 于是只能全好或全病 —— 整个换家机制对它本来要解决的多供应商场景完全失效。
  const twoVendors = () => dedupeModelOptions([
    option('gpt-image-2', 'kie', 'GPT Image 2'),
    option('gpt-image-2', 'apimart', 'GPT Image 2'),
  ])
  /** 只有 Kie 那家病了；APIMart 的同名模型健康。 */
  const kieAiling = ({ modelKey, vendor }: { modelKey: unknown; vendor: unknown }) => modelKey === 'gpt-image-2' && vendor === 'kie'

  it('一家病了就换另一家，不是整条模型判病', () => {
    const model = twoVendors()[0]
    expect(pickHealthiestProvider(model, kieAiling)?.vendor).toBe('apimart')
  })

  it('还有健康的家时，模型不该被标成「最近多次失败」', () => {
    const [entry] = buildModelSelectOptions(twoVendors(), kieAiling)
    expect(entry.dimmed).toBeFalsy()
    expect(entry.trailing).toBeUndefined()
    expect(entry.chips).toHaveLength(2)
  })

  it('只有一家时给厂商短名附注，不给只能点自己的单个 chip', () => {
    const deduped = dedupeModelOptions([option('solo', 'apimart', 'Solo')])
    const [entry] = buildModelSelectOptions(deduped, healthy)
    expect(entry.chips).toBeUndefined()
    expect(entry.trailing).toBe('APIMart')
  })

  it('批量下拉一家一行：只有病的那一行标红并沉底', () => {
    const rows = buildVendorExplicitModelOptions(twoVendors(), kieAiling)
    expect(rows).toHaveLength(2)
    expect(rows[0].dimmed).toBeFalsy()
    expect(rows[1].dimmed).toBe(true)
  })

  it('两家都病了才回退全集（绝不空选）', () => {
    const model = twoVendors()[0]
    expect(pickHealthiestProvider(model, () => true)).not.toBeNull()
  })
})

// 2026-09-06 用户拍板：没接入的供应商，它的模型不再沉底灰显，而是根本不出现。
// 于是新装机上这个下拉会一条都不剩——空白下拉读起来像「坏了」，必须换成说得清、点得动的一行。
describe('一家供应商都没接入 → 诚实空态，而不是空白下拉', () => {
  it('折叠版下拉给出「还没接入供应商 · 去接入」一行', () => {
    const view = buildModelSelectOptions([], healthy)
    expect(view).toHaveLength(1)
    expect(view[0]).toMatchObject({
      value: CONNECT_VENDOR_OPTION_VALUE,
      label: '还没接入供应商',
      trailing: '去接入',
      trailingTone: 'accent',
    })
  })

  it('批量下拉给出同一行（同一件事只有一种说法）', () => {
    expect(buildVendorExplicitModelOptions([], healthy)).toEqual(buildModelSelectOptions([], healthy))
  })

  it('点那一行 = 打开模型接入页，绝不当成选了个模型', () => {
    const onChange = vi.fn()
    const events: string[] = []
    // 这个测试文件跑在无 DOM 环境（纯函数直测），所以只桩出这一行代码真正用到的那个口子。
    vi.stubGlobal('window', { dispatchEvent: (event: Event) => { events.push(event.type); return true } })
    try {
      let view!: DedupedModelSelectView
      function Probe() {
        view = useDedupedModelSelect([], '', onChange)
        return null
      }
      renderToStaticMarkup(createElement(Probe))
      view.onModelPick(CONNECT_VENDOR_OPTION_VALUE)
      expect(events).toEqual(['nomi-open-model-catalog'])
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
