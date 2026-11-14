// 病模型沉底/灰化的判定（2026-07-30 拍板）。核心是**别误伤**：下拉一条 = 去重后的模型，
// 底下可能挂 2-4 家供应商；只要还有一家健康就该走那家、整条不算病。
// 判据以 AilingProbe 注入 → 纯函数直测，不引 React 测试库、不碰 localStorage。
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CONNECT_VENDOR_OPTION_VALUE,
  buildModelSelectOptions,
  buildProviderSelectOptions,
  modelVisibilityFooterAction,
  pickHealthiestProvider,
  resolveProviderSelectValue,
  useDedupedModelSelect,
  type DedupedModelSelectView,
  type ModelVariantMenu,
} from './useDedupedModelSelect'
import { dedupeModelOptions } from '../../config/modelIdentity'
import type { ModelOption } from '../../config/models'
import type { ModelBoxPreferenceSettings } from '../../../electron/shared/contracts/modelBoxPreference'
import { toCatalogModelOptions } from '../../config/modelOptionMappers'

function option(modelKey: string, vendor: string, label: string): ModelOption {
  return { value: `${vendor}:${modelKey}`, label, modelKey, vendor, kind: 'image' } as ModelOption
}
const ailing = (...keys: string[]) => ({ modelKey }: { modelKey: unknown; vendor: unknown }) => keys.includes(String(modelKey))
const healthy = () => false

function variantOptions(tiers = ['low', 'medium', 'high']): ModelOption[] {
  return toCatalogModelOptions(tiers.map(tier => ({
    modelKey: `gemini-3.7-flash-${tier}`, vendorKey: 'antigravity-cli', labelZh: `Gemini 3.7 Flash ${tier}`,
    kind: 'text', enabled: true, published: true, availability: { usable: true } as const, publishedModes: ['chat' as const], createdAt: '', updatedAt: '',
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

describe('目录里的精确变体（Antigravity 档位）在模型菜单里是各自的一行', () => {
  it('一个模型 = 三行（Low / Medium / High），选中的是存着的那一档；点哪一行就写哪一个精确模型', () => {
    const { view, onChange } = renderSelect(variantOptions(), 'gemini-3.7-flash-high')
    expect(view.modelOptions.map(option => option.label)).toEqual(['Gemini 3.7 Flash Low', 'Gemini 3.7 Flash Medium', 'Gemini 3.7 Flash High'])
    expect(view.modelOptions.find(option => option.value === view.modelValue)?.label).toBe('Gemini 3.7 Flash High')
    view.onModelPick(view.modelOptions[0].value)
    expect(onChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
  })

  it('只有一档时不展开：仍是一行，点它写那唯一的一档（不编造没有的档）', () => {
    const fresh = renderSelect(variantOptions(['low']), '')
    expect(fresh.view.modelOptions).toHaveLength(1)
    fresh.view.onModelPick(fresh.view.modelOptions[0].value)
    expect(fresh.onChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
  })

  it('没开的档不出现，也点不到：未知的行键什么都不写', () => {
    const { view, onChange } = renderSelect(variantOptions(['low', 'high']), 'gemini-3.7-flash-low')
    expect(view.modelOptions.map(option => option.label)).toEqual(['Gemini 3.7 Flash Low', 'Gemini 3.7 Flash High'])
    for (const unavailable of ['gemini 3.7 flash#Medium', 'gemini 3.7 flash#future']) view.onModelPick(unavailable)
    view.onProviderPick('antigravity-cli\u0000gemini-3.7-flash-future')
    expect(onChange).not.toHaveBeenCalled()
  })
})

// 2026-09-29 走查：英文界面模型框里是「Gemini 3 Pro 图像」「可灵 3.0」——供应商名在这一层翻了、模型名漏了。
// 显示名在这一层翻；身份（canonicalId = 下拉的 value，也是模型框偏好的存键）一个字不动，切语言不会拆组。
describe('模型名跟着界面语言走，身份不动', () => {
  afterEach(async () => { await i18n.changeLanguage('zh-CN') })
  const gemini = [
    { ...option('gemini-3-pro-image-preview', 'apimart', 'Gemini 3 Pro 图像'), meta: { canonicalModelId: 'gemini image 3 pro' } },
    { ...option('gemini_image3_pro', 'runway', 'Runway Gemini 3 Pro Image'), meta: { canonicalModelId: 'gemini image 3 pro' } },
  ]
  // 没显式声明身份的行按 label 归组：label 是身份的输入，所以更不能在归组之前翻。
  const kling = [option('kling-3.0', 'apimart', '可灵 3.0'), option('kling-v3', 'kie', '可灵 3.0')]

  it('折叠版：英文界面显示英文名，value（canonicalId）两种语言相同', async () => {
    await i18n.changeLanguage('zh-CN')
    const zh = buildModelSelectOptions(dedupeModelOptions([...gemini, ...kling]), healthy)
    await i18n.changeLanguage('en')
    const en = buildModelSelectOptions(dedupeModelOptions([...gemini, ...kling]), healthy)
    // 可灵 3.0 在默认顺序表里、Gemini 不在 → 默认顺序下可灵靠前（这条测的是名字跟语言走，不是顺序）。
    expect(zh.map((row) => row.label)).toEqual(['可灵 3.0', 'Gemini 3 Pro 图像'])
    expect(en.map((row) => row.label)).toEqual(['Kling 3.0', 'Gemini 3 Pro Image'])
    expect(en.map((row) => row.value)).toEqual(zh.map((row) => row.value))
  })

  // 「最近多次失败」那一支是另一段代码（灰化 + 沉底），名字同样要翻——两个版本各查一遍。
  it('最近连败、被灰化沉底的行：名字照样跟着语言走', async () => {
    await i18n.changeLanguage('en')
    const sick = ailing('gemini-3-pro-image-preview', 'gemini_image3_pro')
    const folded = buildModelSelectOptions(dedupeModelOptions(gemini), sick)
    expect(folded.map((row) => [row.label, row.dimmed])).toEqual([['Gemini 3 Pro Image', true]])
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
    // 健康的保持原序、不被打标；菜单里只有一家供应商，不写厂商名（写了也没有区别）。
    expect(view[0].label).toBe('Z-Image Turbo')
    expect(view[0].dimmed).toBeUndefined()
    expect(view[0].trailing).toBeUndefined()
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
    // 菜单里只有这一家：厂商名不写（见下面「厂商名只在看得出区别时才出现」）。
    expect(entry.trailing).toBeUndefined()
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

// ── 模型框偏好：显示哪些 / 排在哪 / 记住哪家（2026-09-11 用户拍板） ──
//
// 这四条是用户当场就能看出来对不对的行为，所以逐条钉死在这里：藏起来的不出现、
// 排过的排在前面、chip 顺序仍由全局供应商顺序决定、高亮与自动选家都听手点过的那家。
describe('模型框偏好', () => {
  // 偏好按 canonicalId 存，所以夹具显式给出 canonicalModelId（不靠 label 归一化推导，
  // 否则测试里的 id 和被测代码里的 id 只是**碰巧**一样）。
  const boxOption = (canonicalId: string, vendor: string, label: string): ModelOption => ({
    ...option(`${canonicalId}-${vendor}`, vendor, label), meta: { canonicalModelId: canonicalId },
  })
  const modelBoxDeduped = dedupeModelOptions([
    boxOption('gpt-image-2', 'apimart', 'GPT Image 2'),
    boxOption('gpt-image-2', 'kie', 'GPT Image 2'),
    boxOption('nano-banana-2', 'apimart', 'Nano Banana 2'),
    boxOption('nano-banana-2', 'kie', 'Nano Banana 2'),
    boxOption('z-image-turbo', 'apimart', 'Z-Image Turbo'),
  ])
  const preference = (patch: Partial<ModelBoxPreferenceSettings>): ModelBoxPreferenceSettings => ({
    schemaVersion: 1, modelOrder: [], hiddenModelIds: [], preferredVendorByModel: {}, ...patch,
  })

  it('隐藏的模型一行都不进模型框', () => {
    const hidden = preference({ hiddenModelIds: ['z-image-turbo'] })
    expect(buildModelSelectOptions(modelBoxDeduped, healthy, [], hidden).map(o => o.label))
      .toEqual(['GPT Image 2', 'Nano Banana 2'])
  })

  it('手排过的模型排在前面，没排过的仍按原顺序跟在后面', () => {
    expect(buildModelSelectOptions(modelBoxDeduped, healthy, [], preference({ modelOrder: ['z-image-turbo'] })).map(o => o.label))
      .toEqual(['Z-Image Turbo', 'GPT Image 2', 'Nano Banana 2'])
  })

  it('chip 顺序永远是全局供应商顺序，只有高亮跟着手点过的那家走', () => {
    const options = buildModelSelectOptions(
      modelBoxDeduped, healthy, ['apimart', 'kie'],
      preference({ preferredVendorByModel: { 'nano-banana-2': 'kie' } }),
    )
    const nanoBanana = options.find(o => o.label === 'Nano Banana 2')!
    expect(nanoBanana.chips?.map(chip => chip.label)).toEqual(['APIMart', 'Kie'])
    expect(nanoBanana.chips?.find(chip => chip.active)?.label).toBe('Kie')
    // 阴性对照：没手点过的那行仍是顺序里的第一家（证明记忆只作用在被点过的模型上）。
    expect(options.find(o => o.label === 'GPT Image 2')!.chips?.find(chip => chip.active)?.label).toBe('APIMart')
  })

  it('自动选家：手点过的那家压过全局顺序，记忆没了就干净回落', () => {
    const nanoBanana = modelBoxDeduped.find(model => model.canonicalId === 'nano-banana-2')!
    expect(pickHealthiestProvider(nanoBanana, healthy, ['apimart', 'kie'], 'kie')?.vendor).toBe('kie')
    expect(pickHealthiestProvider(nanoBanana, healthy, ['apimart', 'kie'], null)?.vendor).toBe('apimart')
    expect(pickHealthiestProvider(nanoBanana, healthy, ['apimart', 'kie'], 'runninghub')?.vendor).toBe('apimart')
  })

  it('底部「隐藏模型 N」：藏过才带数，没藏过就只是「隐藏模型」', () => {
    expect(modelVisibilityFooterAction(0).label).toBe('隐藏模型')
    expect(modelVisibilityFooterAction(2).label).toBe('隐藏模型 2')
  })

  it('「两家并存时变体行按哪家展开」今天复现不出：带变体的组只会有反重力一家（2026-11-14 界面问题，写明而不改）', () => {
    // 目录映射给反重力的条目钉了带供应商前缀的身份（antigravity-cli:family:…），别家同名模型进不了这一组；
    // 所以 expandModelRows 用「第一家」算变体和用「这一行实际会用的那家」算，结果永远一样。
    // 哪天有第二家也给变体、并进同一组，这条先红——那时再按「实际会用的那家」展开。
    const apimartGemini = toCatalogModelOptions([{
      modelKey: 'gemini-3.7-flash', vendorKey: 'apimart', labelZh: 'Gemini 3.7 Flash',
      kind: 'text', enabled: true, published: true, availability: { usable: true } as const, publishedModes: ['chat' as const], createdAt: '', updatedAt: '',
    }])
    const deduped = dedupeModelOptions([...variantOptions(), ...apimartGemini])
    for (const model of deduped.filter((candidate) => candidate.providers.some((provider) => provider.option.variant))) {
      expect(new Set(model.providers.map((provider) => provider.vendor))).toEqual(new Set(['antigravity-cli']))
    }
    expect(deduped.length).toBe(2)
  })
})

// 「供应商清单里暂时没有它」（2026-09-21）。
//
// 这条旁注取代的是旧行为：后台对账查不到就替用户把模型停用。它现在**只是一句话**——
// 所以这几条钉的全是「它不许改变别的东西」：不影响可选性、不排到后面、不覆盖厂商短名、
// 一家没列出不代表整行没列出。
describe('清单里暂时没有它 —— 只是一句实话，不是停用', () => {
  const unlisted = (modelKey: string, vendor: string, label: string): ModelOption =>
    ({ ...option(modelKey, vendor, label), unlisted: true })

  it('目录行带 unlisted 就原样进 ModelOption——渲染层不自己推断', () => {
    const [mapped] = toCatalogModelOptions([{
      modelKey: 'kling-o1', vendorKey: 'kie', labelZh: 'Kling O1', kind: 'video',
      enabled: true, unlisted: true, published: true, availability: { usable: true } as const,
      publishedModes: ['text_to_video' as const], createdAt: '', updatedAt: '',
    }])
    expect(mapped.unlisted).toBe(true)
    const [listed] = toCatalogModelOptions([{
      modelKey: 'kling-o1', vendorKey: 'kie', labelZh: 'Kling O1', kind: 'video',
      enabled: true, published: true, availability: { usable: true } as const,
      publishedModes: ['text_to_video' as const], createdAt: '', updatedAt: '',
    }])
    expect(listed.unlisted).toBeUndefined()
  })

  it('折叠下拉：只有一家且那一家没列出时，短名后面加一句限定语', () => {
    const [row] = buildModelSelectOptions(dedupeModelOptions([unlisted('kling-o1', 'kie', 'Kling O1')]), healthy)
    expect(row.trailing).toContain('暂未列出')
    // 仍可点：它不是 disabled、也不 dimmed（手动选择永不拦）。
    expect(row.disabled).toBeUndefined()
    expect(row.dimmed).toBeUndefined()
  })

  it('折叠下拉：还有一家列着它就不标——标了等于说「这个模型没了」，而他点下去能用', () => {
    const deduped = dedupeModelOptions([unlisted('kling-o1', 'kie', 'Kling O1'), option('kling-o1', 'apimart', 'Kling O1')])
    const [row] = buildModelSelectOptions(deduped, healthy)
    expect(JSON.stringify(row)).not.toContain('暂未列出')
  })
})

// ── 自定义供应商与 APIMart 同名 modelKey：选 APIMart 必须真的选中 APIMart（群反馈，0.20.1 报障）──
//
// 用户自定义了一个 modelKey 也叫 gpt-image-2 的模型后，在节点模型框里点 APIMart 那条「选不上」：
// 0.20.1 的 selectedModel 只按 value 找去重组，同名的自定义组排在前面（store newest-first）就先命中它，
// 回显、供应商列表、再次选择全落回自定义那家。修在 d5cf70b63（v0.21.0 起）：身份按 (value, vendor) 找。
// 这里把「选中 → 回显 → 再选」整条往返钉死，防止任何一处又退回只比 value。
describe('同名 modelKey 跨供应商：选中的是哪家，回显与回写就是哪家', () => {
  const CUSTOM = 'my-relay-example-com'
  const custom = (label: string): ModelOption =>
    ({ value: 'gpt-image-2', label, modelKey: 'gpt-image-2', vendor: CUSTOM, vendorName: 'My Relay', kind: 'image' }) as ModelOption
  const apimart: ModelOption = {
    value: 'gpt-image-2', label: 'GPT Image 2', modelKey: 'gpt-image-2', vendor: 'apimart', kind: 'image',
    meta: { canonicalModelId: 'gpt image 2' },
  } as ModelOption

  function renderNodeSelect(options: ModelOption[], value: string, vendor?: string) {
    const onChange = vi.fn()
    let view!: DedupedModelSelectView
    function Probe() {
      view = useDedupedModelSelect(options, value, onChange, vendor)
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    return { view, onChange }
  }

  it('自定义与 APIMart 各成一组：节点存 (gpt-image-2, apimart) → 回显 APIMart 那组、供应商也是 APIMart', () => {
    // 自定义排在前面 = catalog newest-first 的真实顺序，也是 0.20.1 先命中错组的前提。
    const options = [custom('image2'), apimart]
    const groups = dedupeModelOptions([...options])
    expect(groups).toHaveLength(2)
    const apimartGroup = groups.find((group) => group.providers.some((provider) => provider.vendor === 'apimart'))!
    const { view } = renderNodeSelect(options, 'gpt-image-2', 'apimart')
    expect(view.modelValue).toBe(apimartGroup.canonicalId)
    expect(view.selectedModel?.providers.map((provider) => provider.vendor)).toEqual(['apimart'])
  })

  it('从自定义那家切到 APIMart：点 APIMart 那组回写 (gpt-image-2, apimart)，再渲染仍停在 APIMart', () => {
    const options = [custom('image2'), apimart]
    const onCustom = renderNodeSelect(options, 'gpt-image-2', CUSTOM)
    const apimartRow = onCustom.view.modelOptions.find((row) => row.label === 'GPT Image 2')!
    onCustom.view.onModelPick(apimartRow.value)
    expect(onCustom.onChange).toHaveBeenCalledWith('gpt-image-2', 'apimart')
    // 回写后的下一帧：重选同一组必须保留 APIMart，不许被同名自定义那组抢走。
    const onApimart = renderNodeSelect(options, 'gpt-image-2', 'apimart')
    expect(onApimart.view.modelValue).toBe(apimartRow.value)
    onApimart.view.onModelPick(apimartRow.value)
    expect(onApimart.onChange).toHaveBeenCalledWith('gpt-image-2', 'apimart')
  })

  it('两家合成一组（自定义也叫 GPT Image 2）：锁 APIMart 的供应商值与回写都是 APIMart', () => {
    const options = [custom('GPT Image 2'), apimart]
    const { view, onChange } = renderNodeSelect(options, 'gpt-image-2', 'apimart')
    expect(view.selectedModel?.providers.map((provider) => provider.vendor).sort()).toEqual(['apimart', CUSTOM].sort())
    const apimartAddress = view.providerOptions.find((provider) => provider.label === 'APIMart')!.value
    expect(view.providerValue).toBe(apimartAddress)
    view.onModelPick(view.modelValue)
    expect(onChange).toHaveBeenLastCalledWith('gpt-image-2', 'apimart')
    view.onProviderPick(apimartAddress)
    expect(onChange).toHaveBeenLastCalledWith('gpt-image-2', 'apimart')
  })
})

// 厂商名规则（用户 2026-11-14）：不是每行都写——菜单里有 ≥2 家供应商、且这一行不在默认那家，才写。
// 规则是通用的：测里用的是任意名字的供应商，组件里没有任何一家的名字。
describe('厂商名只在看得出区别时才出现', () => {
  const rows = (...pairs: Array<[string, string, string]>) => dedupeModelOptions(pairs.map(([key, vendor, label]) => option(key, vendor, label)))
  const trailingOf = (options: ReturnType<typeof buildModelSelectOptions>, label: string) => options.find(o => o.label === label)?.trailing

  it('菜单里只有一家供应商 → 一行都不写厂商名', () => {
    const options = buildModelSelectOptions(rows(['a-1', 'alpha', 'Model A'], ['b-1', 'alpha', 'Model B']), healthy)
    expect(options.map(o => o.trailing)).toEqual([undefined, undefined])
  })

  it('有两家供应商 → 只给不在默认那家（行数最多的那家）的行写厂商名', () => {
    const options = buildModelSelectOptions(rows(['a-1', 'alpha', 'Model A'], ['b-1', 'alpha', 'Model B'], ['c-1', 'beta', 'Model C']), healthy, [])
    expect(trailingOf(options, 'Model A')).toBeUndefined()
    expect(trailingOf(options, 'Model B')).toBeUndefined()
    expect(trailingOf(options, 'Model C')).toBe('beta')
  })

  it('两家行数并列 → 全局供应商顺序里靠前的当默认家', () => {
    const options = buildModelSelectOptions(rows(['a-1', 'alpha', 'Model A'], ['c-1', 'beta', 'Model C']), healthy, ['beta', 'alpha'])
    expect(trailingOf(options, 'Model C')).toBeUndefined()
    expect(trailingOf(options, 'Model A')).toBe('alpha')
  })

  it('多家的行仍是 chip，不重复写厂商名；「暂未列出」这类实话不受影响', () => {
    const multi = dedupeModelOptions([option('m-1', 'alpha', 'Model M'), option('m-2', 'beta', 'Model M'), { ...option('c-1', 'beta', 'Model C'), unlisted: true }])
    const options = buildModelSelectOptions(multi, healthy, [])
    expect(options.find(o => o.label === 'Model M')?.trailing).toBeUndefined()
    expect(options.find(o => o.label === 'Model M')?.chips).toHaveLength(2)
    expect(trailingOf(options, 'Model C')).toContain('暂未列出')
  })

  it('同一份输入、不管调用方是哪一页：规则只看菜单里的行（参数里没有页面名）', () => {
    const input = rows(['a-1', 'alpha', 'Model A'], ['c-1', 'beta', 'Model C'])
    expect(buildModelSelectOptions(input, healthy, [])).toEqual(buildModelSelectOptions(input, healthy, [], null, undefined))
  })
})

// 变体行只在调用方声明「我存得了变体」时出现（画布节点 / 画布列表声明；分镜行没有存变体的字段，不声明）。
describe('变体行由调用方的一处声明决定', () => {
  const seedance = [{ ...option('doubao-seedance-2.0', 'apimart', 'Seedance 2.0'), kind: 'video' as const, meta: { archetypeId: 'seedance-2-apimart' } }]
  const menu = (overrides: Partial<ModelVariantMenu> = {}): ModelVariantMenu => ({ activeVariantId: 'fast', onPick: vi.fn(), ...overrides })

  it('声明了 → 每个变体一行（标准 / Fast / Mini），选中的是存着的那一个', () => {
    const declared = menu()
    let view!: DedupedModelSelectView
    renderToStaticMarkup(createElement(function Probe() { view = useDedupedModelSelect(seedance, 'apimart:doubao-seedance-2.0', vi.fn(), 'apimart', undefined, declared); return null }))
    expect(view.modelOptions.map(o => o.label)).toEqual(['Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini'])
    expect(view.modelValue).toBe('seedance 2.0#fast')
    view.onModelPick('seedance 2.0#mini')
    expect(declared.onPick).toHaveBeenCalledWith({ value: 'apimart:doubao-seedance-2.0', vendor: 'apimart' }, 'mini')
  })

  it('没声明（分镜行）→ 每个模型只一行，点它走原来的 onChange，变体一个字都不碰', () => {
    const onChange = vi.fn()
    let view!: DedupedModelSelectView
    renderToStaticMarkup(createElement(function Probe() { view = useDedupedModelSelect(seedance, '', onChange, 'apimart'); return null }))
    expect(view.modelOptions.map(o => o.value)).toEqual(['seedance 2.0'])
    view.onModelPick('seedance 2.0')
    expect(onChange).toHaveBeenCalledWith('apimart:doubao-seedance-2.0', 'apimart')
  })

  it('变体轴不起作用（惰性通道）的行不展开，免得骗人——选中的那一行也一样', () => {
    let view!: DedupedModelSelectView
    renderToStaticMarkup(createElement(function Probe() { view = useDedupedModelSelect(seedance, 'apimart:doubao-seedance-2.0', vi.fn(), 'apimart', undefined, menu({ axisLiveOf: () => false })); return null }))
    expect(view.modelOptions).toHaveLength(1)
  })

  it('只有那一行（渠道把型号名写死，如 Runway）不展开；起作用的行照常展开', () => {
    const mixed = [
      ...seedance,
      { ...option('veo3.1', 'runway', 'Runway Veo 3.1'), kind: 'video' as const, meta: { archetypeId: 'veo-3.1' } },
    ]
    const deadVendor = menu({ axisLiveOf: (model) => !model.providers.every((provider) => provider.vendor === 'runway') })
    const labels = buildModelSelectOptions(dedupeModelOptions(mixed), healthy, [], null, deadVendor).map(o => o.label)
    expect(labels).toEqual(['Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini', 'Runway Veo 3.1'])
    expect(buildModelSelectOptions(dedupeModelOptions(mixed), healthy, [], null, menu()).length).toBeGreaterThan(labels.length)
  })

  // 自己接的中转：目录行没写档案 id，只靠型号名被认出档案。底栏的方式 / 参数各格按型号名认它，菜单必须说同一件事——
  // 以前菜单只认显式写的档案 id，这类模型在菜单里既没有变体行也没有描述，创作者丢了「选 Fast / Mini」。
  it('只靠型号名认出档案的模型（自己接的中转、没写档案 id）：变体行、描述、图标一样不少', () => {
    const relayed = [{ ...option('doubao-seedance-2.0', 'my-custom-relay', 'Seedance 2.0'), kind: 'video' as const }]
    const declared = menu()
    const rows = buildModelSelectOptions(dedupeModelOptions(relayed), healthy, [], null, declared)
    expect(rows.map(o => o.label)).toEqual(['Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini'])
    for (const row of rows) expect(row.description).toMatch(/文生/)
    const explicit = buildModelSelectOptions(dedupeModelOptions(seedance), healthy, [], null, declared)
    expect(rows.map(o => o.description)).toEqual(explicit.map(o => o.description))
    expect(rows.map(o => o.icon)).toEqual(explicit.map(o => o.icon))
    expect(rows[0].icon).toBeTruthy()
  })

  it('每行带一句由档案算出的能力描述；没档案的模型不编', () => {
    const custom = [option('my-model', 'apimart', 'My Model')]
    expect(buildModelSelectOptions(dedupeModelOptions(custom), healthy)[0].description).toBeUndefined()
    const described = buildModelSelectOptions(dedupeModelOptions(seedance), healthy)[0]
    expect(described.description).toMatch(/文生/)
  })
})
