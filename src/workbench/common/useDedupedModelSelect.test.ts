// 病模型沉底/灰化的判定（2026-07-30 拍板）。核心是**别误伤**：下拉一条 = 去重后的模型，
// 底下可能挂 2-4 家供应商；只要还有一家健康就该走那家、整条不算病。
// 判据以 AilingProbe 注入 → 纯函数直测，不引 React 测试库、不碰 localStorage。
import { describe, expect, it } from 'vitest'
import {
  buildModelSelectOptions,
  buildProviderSelectOptions,
  buildVendorExplicitModelOptions,
  pickHealthiestProvider,
  providerAddress,
  resolveProviderByAddress,
  resolveProviderSelectValue,
} from './useDedupedModelSelect'
import { dedupeModelOptions } from '../../config/modelIdentity'
import type { ModelOption } from '../../config/models'

function option(modelKey: string, vendor: string, label: string): ModelOption {
  return { value: `${vendor}:${modelKey}`, label, modelKey, vendor, kind: 'image' } as ModelOption
}
const ailing = (...keys: string[]) => (modelKey: string) => keys.includes(modelKey)
const healthy = () => false

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

  it('多家里只病一家 → 整条**不算病**（否则「N 家」里一家挂就误伤整个模型）', () => {
    const deduped = dedupeModelOptions([
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
    ])
    const view = buildModelSelectOptions(deduped, ailing('nano-banana-apimart'))

    expect(view).toHaveLength(1)
    expect(view[0].dimmed).toBeUndefined()
    expect(view[0].trailing).toBe('2 家')
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
    expect(buildVendorExplicitModelOptions(deduped, healthy)).toEqual([
      { value: providerAddress(deduped[0].providers[0]), label: 'Z-Image Turbo', trailing: 'APIMart' },
    ])
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
