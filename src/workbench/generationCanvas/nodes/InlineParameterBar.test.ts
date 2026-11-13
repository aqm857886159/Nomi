import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NomiSelectProps } from '../../../design/NomiSelect'
import type { WorkbenchIconButtonProps } from '../../../design/actions'
import { toCatalogModelOptions } from '../../../config/modelOptionMappers'
import InlineParameterBar from './InlineParameterBar'
import { summaryFitCandidates } from './composerHeadlineSummary'
import type { DynamicModelControl } from './controls/parameterControlModel'

const captured = vi.hoisted(() => ({ selects: [] as NomiSelectProps[], iconButtons: [] as WorkbenchIconButtonProps[] }))
vi.mock('../../../design', async () => ({
  // 摘要 pill 的 ▾ 是按钮外的裸图标，尺寸取四档真相源；用真值，不在测试里抄第二份数字。
  ICON_TIERS: (await vi.importActual<typeof import('../../../design/iconTiers')>('../../../design/iconTiers')).ICON_TIERS,
  NomiSelect: (props: NomiSelectProps) => {
    captured.selects.push(props)
    return React.createElement('span', null, props.options.find(option => option.value === props.value)?.label)
  },
  WorkbenchIconButton: (props: WorkbenchIconButtonProps) => {
    captured.iconButtons.push(props)
    return React.createElement('button', { type: 'button' }, props.label)
  },
  NomiSegmented: () => null,
  DesignSwitch: () => null,
  DesignSearchInput: () => null,
}))

describe('InlineParameterBar catalog variant control', () => {
  beforeEach(() => { captured.selects = []; captured.iconButtons = [] })

  function render(tiers: string[], selected: string) {
    const modelOptions = toCatalogModelOptions(tiers.map(tier => ({
      modelKey: `gemini-3.7-flash-${tier}`, vendorKey: 'antigravity-cli', labelZh: `Gemini 3.7 Flash ${tier}`,
      kind: 'text', enabled: true, published: true, availability: { usable: true } as const, publishedModes: ['chat' as const], createdAt: '', updatedAt: '',
    })))
    const onModelChange = vi.fn()
    const html = renderToStaticMarkup(React.createElement(InlineParameterBar, {
      modelOptions, selectedModelOption: modelOptions.find(option => option.value.endsWith(selected))!,
      modelCatalogStatus: { message: '' }, renderedControls: [], archetype: null, meta: {},
      onModelChange, onCatalogControlChange: vi.fn(), onParameterControlChange: vi.fn(),
    }))
    return { html, onModelChange }
  }

  it('uses the existing model + variant controls and writes the exact selected ID', () => {
    const { html, onModelChange } = render(['low', 'medium', 'high'], 'high')
    expect(captured.selects).toHaveLength(2)
    expect(html).toContain('Gemini 3.7 Flash')
    expect(html).toContain('High')
    const variant = captured.selects[1]
    variant.onChange(variant.options.find(option => option.label === 'Low')!.value)
    expect(onModelChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
  })

  // 2026-09-21 走查：1100×720 英文下画布节点（summary 摆法）的变体芯片被压到值区只剩 5px，
  // 「Variant 5.0」读成「Variant E」。行窄时让位的只许是模型那枚（有意省略号 + title 全名）；
  // 变体是短枚举，从不缩——与分镜旧底栏让位表的「短枚举不缩」同一条规则（分镜 2026-10-06 起直接用本组件）。
  it('summary: only the model chip yields width; the short variant enum never shrinks', () => {
    render(['low', 'medium', 'high'], 'high')
    const [model, variant] = captured.selects
    expect(variant.leadingLabel).toBeTruthy()
    expect(variant.className ?? '').toContain('shrink-0')
    expect(model.className ?? '').not.toContain('shrink-0')
  })

  it('shows a single enabled tier as a fixed value without offering disabled tiers', () => {
    const { html } = render(['high'], 'high')
    expect(captured.selects).toHaveLength(2)
    expect(captured.selects[1].disabled).toBe(true)
    expect(captured.selects[1].options.map(option => option.label)).toEqual(['High'])
    expect(html).toContain('High')
  })
})

// 参数区的摆法只有一种：摘要 pill + 全部参数进面板（画布节点，用户 2026-09-11 04:30 拍板保持原样）。
// 付费确认卡那种「逐参数 chip」随 D2 旧卡一起删了（用户 2026-10-23 拍板：付费卡上不挂参数控件）。
describe('InlineParameterBar 摘要 pill', () => {
  const ratio: DynamicModelControl = {
    key: 'aspect_ratio', label: '比例', type: 'select', binding: 'parameter',
    options: [{ value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
    defaultValue: '16:9',
  }
  const duration: DynamicModelControl = {
    key: 'duration', label: '时长', type: 'number', binding: 'parameter', options: [], min: 4, max: 8, defaultValue: 5,
  }
  const generateAudio: DynamicModelControl = {
    key: 'generate_audio', label: '生成音频', type: 'boolean', binding: 'parameter', options: [], defaultValue: true,
  }

  const modelOptions = toCatalogModelOptions([{
    modelKey: 'seedance-2', vendorKey: 'apimart', labelZh: 'Seedance 2',
    kind: 'video', enabled: true, published: true, availability: { usable: true } as const, publishedModes: ['text_to_video' as const], createdAt: '', updatedAt: '',
  }])

  function render(
    renderedControls: DynamicModelControl[],
    meta: Record<string, unknown> = {},
    extra: Partial<React.ComponentProps<typeof InlineParameterBar>> = {},
  ) {
    const onParameterControlChange = vi.fn()
    const html = renderToStaticMarkup(React.createElement(InlineParameterBar, {
      modelOptions, selectedModelOption: modelOptions[0], modelCatalogStatus: { message: '' },
      renderedControls, archetype: null, meta,
      onModelChange: vi.fn(), onCatalogControlChange: vi.fn(), onParameterControlChange,
      ...extra,
    }))
    return { html, onParameterControlChange }
  }
  beforeEach(() => { captured.selects = []; captured.iconButtons = [] })

  it('一颗摘要 pill，一颗参数 chip 都不摆', () => {
    const { html } = render([ratio, duration, generateAudio], { aspect_ratio: '9:16', duration: 5 })
    expect(html).toContain('data-parameter-summary="9:16 · 5 · 生成音频"')
    expect(html).not.toContain('data-parameter-chip')
    expect(html).not.toContain('data-parameter-more')
    expect(captured.iconButtons).toHaveLength(0)
    // 模型芯片之外一颗 NomiSelect 都不该多出来（参数全在点开的面板里）。
    expect(captured.selects.map(select => select.ariaLabel)).toEqual(['模型'])
  })

  it('summary 的 pill 文案可被 summaryOverride 顶掉（导入工作流那条窄例外还在）', () => {
    const { html } = render([ratio], { aspect_ratio: '9:16' }, { summaryOverride: '工作流参数 · 7 项' })
    expect(html).toContain('data-parameter-summary="工作流参数 · 7 项"')
  })

  it('summary 里没有任何参数时不留一颗点开是空白的 pill', () => {
    const { html } = render([], {})
    expect(html).not.toContain('data-parameter-summary')
  })

  const barClass = (html: string): string => /class="([^"]*generation-canvas-v2-node__params--parameters[^"]*)"/.exec(html)?.[1] ?? ''

  it('一行、不换行，身份行是自己的 flex 盒', () => {
    const { html } = render([ratio, duration], {})
    expect(barClass(html).split(' ')).not.toContain('flex-wrap')
    // 身份行能缩（min-w-0）：参数退到只剩时长还放不下时，模型名末尾省略（2026-11-12 让法顺序）；量得到空间时变 shrink-0。
    expect(html).toContain('class="flex items-center gap-1.5 min-w-0"')
  })

  // 逐参数 chip / 就地展开面板 / 竖排那几种摆法只给过聊天里的卡，随旧卡一起删了：不许长回来。
  it('只剩一种摆法：逐参数 chip、就地展开面板、竖排这几个开关都不在了', () => {
    const source = readFileSync(fileURLToPath(new URL('./InlineParameterBar.tsx', import.meta.url)), 'utf8')
    for (const removed of ['parameterLayout', 'chipsMode', 'panelMode', 'inlinePanelSlot', 'portalTarget', 'stacked', 'data-parameter-chip']) {
      expect(source, removed).not.toContain(removed)
    }
  })
})

describe('InlineParameterBar semantic option presentation wiring', () => {
  // 编排（谁打开这块面、面里还摆不摆供应商/生成方式）住在壳里；
  // 控件长什么样住在 `controls/ParameterControlBody.tsx`（R9 拆巨壳时整体搬过去的，不是复制）。
  // 下面每条不变量都断在**它真正归属的那层**——断错层就是假绿。
  const source = readFileSync(fileURLToPath(new URL('./InlineParameterBar.tsx', import.meta.url)), 'utf8')
  const body = readFileSync(
    fileURLToPath(new URL('./controls/ParameterControlBody.tsx', import.meta.url)),
    'utf8',
  )

  it('passes supplier semantics through the shared option renderer', () => {
    expect(source).toMatch(
      /<ParameterOptionGroup[\s\S]*?modelSelect\.providerOptions\.map\([\s\S]*?modelSelect\.onProviderPick[\s\S]*?requestedPurpose="provider"[\s\S]*?\/>/,
    )
  })

  it('resolves semantic purpose before choosing shapes or a searchable list', () => {
    expect(body).toContain('resolveParameterOptionPurpose(rawOptions, requestedPurpose)')
  })

  // 面板与它那批控件渲染只能有一处。
  it('面板只有一块（renderParameterPanel 只有一个定义、只被声明一次）', () => {
    expect(source.match(/const renderParameterPanel = /g) ?? []).toHaveLength(1)
    expect(body.match(/export function ParameterPanelGroup\(/g) ?? []).toHaveLength(1)
  })

  // 拆巨壳是**搬**不是抄：控件那批渲染只许住在 ParameterControlBody 里，
  // 壳里再长回一份就是并行版（P1）。
  it('控件渲染只有一处：壳里不留任何一份副本', () => {
    for (const moved of ['ParameterOptionList', 'NomiSegmented', 'DesignSwitch', '@mantine/core']) {
      expect(source).not.toContain(moved)
      expect(body).toContain(moved)
    }
  })

  // 2026-09-11 13:00 用户拍板：**面板里不再套下拉**。这条守的是那条路真的被删了，
  // 不是又长回来一份「短候选摊开、长候选下拉」的并行版（P1）。
  // 判据取 `portalTarget={panelRef}`：面板里的下拉必须把浮层 portal 进面板自己
  // （否则点外面会把面板关掉），所以它是「面板内下拉」独有的签名。
  it('面板里没有下拉：选项一律摊开（chip 一排/一列，或默认展开的搜索列表）', () => {
    expect(source).not.toContain('portalTarget={panelRef}')
    expect(body).not.toContain('NomiSelect')
    expect(body).toContain('<ParameterOptionList')
    expect(body).toContain("optionLayout === 'chips-column' ? 'column' : 'fill'")
  })

  // 2026-09-14 用户两次拍板之后的最终形态：**一列、每项一行的摆法不动**（横排换行被退回：
  // 「两个一行、三个一行反而更难受」），只把浮层右边那截空白收掉——宽度 = 最宽项文字宽 + 内边距。
  it('单参数直出：摆法仍是一列，浮层宽度由最宽项的文字派生而不是固定 320', () => {
    expect(source).toContain('hugsContent')
    expect(source).toContain('hugWidth')
    // 量的是文字（Range 量内容盒），不是被 1fr 拉伸的按钮框——量错对象就会量回容器自己。
    expect(source).toContain('range.selectNodeContents(item)')
    // 左缘与触发它的 chip 对齐，不按那个不存在的 320 槽居中。
    expect(source).toContain('hugsContent ? panelInit?.anchorLeft : panelInit?.left')
    // 横排换行那一版已整段撤掉：一种摆法、一份控件体（P1）。
    expect(source).not.toContain("'chips-wrap'")
  })

  // 单参数直出与面板走的是**同一个** ParameterControlBody：给单参数另写一套渲染就是并行版。
  it('单参数直出与面板共用同一处控件渲染（ParameterControlBody 只有一个定义）', () => {
    expect(body.match(/export function ParameterControlBody\(/g) ?? []).toHaveLength(1)
    expect(source).toContain('<ParameterControlBody control={soloControl} {...controlWiring} onPicked={closePanel} />')
    expect(body).toContain('<ParameterControlBody')
  })
})

// 2026-10-11 走查 §4：清单「加载中」不许被画成「没有模型」——那是点节点先闪空态的根因。
// 特征钉子（方向检查 docs/engineering/direction-check-2026-10-11-model-catalog-lifecycle.md §4）。
describe('InlineParameterBar 清单空态（走查 §4）', () => {
  function renderEmpty(status: 'loading' | 'ready') {
    return renderToStaticMarkup(React.createElement(InlineParameterBar, {
      modelOptions: [], selectedModelOption: null,
      modelCatalogStatus: { status, message: '加载模型清单' },
      renderedControls: [], archetype: null, meta: {},
      onModelChange: vi.fn(), onCatalogControlChange: vi.fn(), onParameterControlChange: vi.fn(),
    }))
  }

  it('加载中画骨架，不画配置入口', () => {
    const html = renderEmpty('loading')
    expect(html).toContain('data-model-chip-loading')
  })

  it('确认没有清单（非加载）时不画骨架', () => {
    expect(renderEmpty('ready')).not.toContain('data-model-chip-loading')
  })
})

// 底栏挤时摘要整值地退（边界样张 K4）：比例 → 有声 → 清晰度 → 时长留到最后；永远至少留一个值，不出现半个值。
describe('summaryFitCandidates', () => {
  const part = (text: string, dropRank: number) => ({ text, dropRank })
  it('从全写开始，按 dropRank 从小到大一档一档整值地退，最后只剩时长', () => {
    expect(summaryFitCandidates([part('21:9', 0), part('有声', 1), part('1080p', 2), part('15s', 3)])).toEqual([
      '21:9 · 有声 · 1080p · 15s',
      '有声 · 1080p · 15s',
      '1080p · 15s',
      '15s',
    ])
  })
  it('同一档的几个值一起退；只有一档时不退', () => {
    expect(summaryFitCandidates([part('16:9', 0), part('720p', 2), part('5s', 3)])).toEqual(['16:9 · 720p · 5s', '720p · 5s', '5s'])
    expect(summaryFitCandidates([part('5s', 3)])).toEqual(['5s'])
    expect(summaryFitCandidates([])).toEqual([])
  })
})
