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
  // 底栏图标排（提示词工具 + 高级设置）用到的气泡：静态渲染里只要把孩子画出来。
  Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipContent: () => null,
}))

describe('InlineParameterBar 模型格（变体是菜单里的行）', () => {
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

  // 2026-11-14：底栏没有单独的「变体」格了——变体是模型菜单里的行（用户拍板）。
  it('底栏只有一个模型格；变体档位是它菜单里的行，点哪行就写哪个精确模型', () => {
    const { html, onModelChange } = render(['low', 'medium', 'high'], 'high')
    expect(captured.selects).toHaveLength(1)
    expect(captured.selects[0].ariaLabel).toBe('模型')
    expect(html).toContain('Gemini 3.7 Flash High')
    expect(captured.selects[0].options.map(option => option.label)).toEqual(['Gemini 3.7 Flash Low', 'Gemini 3.7 Flash Medium', 'Gemini 3.7 Flash High'])
    captured.selects[0].onChange(captured.selects[0].options.find(option => option.label.endsWith('Low'))!.value)
    expect(onModelChange).toHaveBeenCalledWith('gemini-3.7-flash-low', 'antigravity-cli')
  })

  // 2026-09-21 走查：1100×720 英文下参数条里相邻控件互相压；让位的只许是模型名那一枚（省略号 + title 全名），图标从不让。
  it('summary: 模型格是唯一会让位的那枚，旁边不再有「变体」格', () => {
    render(['low', 'medium', 'high'], 'high')
    expect(captured.selects.map(select => select.leadingLabel)).toEqual([undefined])
    expect(captured.selects[0].className ?? '').not.toContain('shrink-0')
  })

  it('只剩一档时就是一行，菜单里不编造没开的档', () => {
    const { html } = render(['high'], 'high')
    expect(captured.selects).toHaveLength(1)
    expect(captured.selects[0].options.map(option => option.label)).toEqual(['Gemini 3.7 Flash'])
    expect(html).toContain('Gemini 3.7 Flash')
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

  // 2026-11-14 用户定稿（画板 T / U）：参数面板全摊开——不再有 420 封顶，只受窗口高度限制，
  // 窗口放不下才在面板里滚；只有一项的面板也是同一只 320 面板（旧「单参数直出」那条 68 宽细条整段删了）。
  it('面板全摊开：高度只由窗口剩余空间决定，没有固定封顶；单参数也走同一只面板', () => {
    expect(source).not.toMatch(/Math\.min\(\s*420/)
    expect(source).not.toMatch(/\b420\b/)
    expect(source).toContain("const maxHeight = side === 'above' ? spaceAbove : Math.max(160, vh - rect.bottom - 18)")
    for (const removed of ['soloControl', 'soloOptionControl', 'hugsContent', 'hugWidth', 'data-parameter-solo']) {
      expect(source, removed).not.toContain(removed)
    }
    expect(body.match(/export function ParameterControlBody\(/g) ?? []).toHaveLength(1)
  })

  // 便签：56 个选项那一格最多显示三排，多的在这一格里自己滚，不把整块面板撑高。
  it('一格选项最多三排，多出来的在格里自己滚', () => {
    expect(body).toContain('OPTION_GROUP_VISIBLE_ROWS = 3')
    expect(body).toContain('data-option-group-capped')
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

// 2026-11-14 用户定稿（画板 T / T2 / T4）：高级设置是底栏右边那排图标里的一颗；
// 去处只由 parameterPlacement 一处决定，这里只验「宿主给了底栏 → 拆开；有改过的值 → 小点；没有高级项 → 不出图标」。
describe('InlineParameterBar 底栏的高级设置', () => {
  const ratio: DynamicModelControl = {
    key: 'aspect_ratio', label: '比例', type: 'select', binding: 'parameter',
    options: [{ value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }], defaultValue: '16:9',
  }
  const seed: DynamicModelControl = { key: 'seed', label: '种子', type: 'number', binding: 'parameter', options: [] }
  const watermark: DynamicModelControl = { key: 'watermark', label: '添加水印', type: 'boolean', binding: 'parameter', options: [], defaultValue: false }
  const modelOptions = toCatalogModelOptions([{
    modelKey: 'seedance-2', vendorKey: 'apimart', labelZh: 'Seedance 2',
    kind: 'video', enabled: true, published: true, availability: { usable: true } as const, publishedModes: ['text_to_video' as const], createdAt: '', updatedAt: '',
  }])
  function render(renderedControls: DynamicModelControl[], meta: Record<string, unknown>, withFooter = true) {
    return renderToStaticMarkup(React.createElement(InlineParameterBar, {
      modelOptions, selectedModelOption: modelOptions[0], modelCatalogStatus: { message: '' },
      renderedControls, archetype: null, meta,
      onModelChange: vi.fn(), onCatalogControlChange: vi.fn(), onParameterControlChange: vi.fn(),
      ...(withFooter ? { footer: { action: React.createElement('button', { 'data-test-send': 'true' }) } } : {}),
    }))
  }
  beforeEach(() => { captured.selects = []; captured.iconButtons = [] })
  // 图标按钮被替身接走了，属性从替身收到的 props 里读。
  const advancedToggles = () => captured.iconButtons.filter((props) => (props as Record<string, unknown>)['data-advanced-settings-toggle'] === 'true')

  it('有高级项：底栏出图标，摘要里只剩面板那几项', () => {
    const html = render([ratio, seed, watermark], { aspect_ratio: '1:1' })
    expect(advancedToggles()).toHaveLength(1)
    expect(html).toContain('data-parameter-summary="1:1"')
    expect(html).toContain('data-test-send="true"')
    // 收着：开合不记，挂载时一律收起。
    expect(html).not.toContain('data-advanced-settings="true"')
  })

  it('高级里有值不是默认 → 图标带小点；全是默认 → 不带', () => {
    const dot = (meta: Record<string, unknown>) => {
      captured.iconButtons = []
      const html = render([ratio, seed, watermark], meta)
      const [toggle] = advancedToggles()
      return { attr: toggle?.['data-advanced-settings-changed' as keyof WorkbenchIconButtonProps], drawn: html.includes('data-prompt-tool-active="true"') }
    }
    expect(dot({ watermark: false })).toEqual({ attr: undefined, drawn: false })
    expect(dot({ seed: 20261114 })).toEqual({ attr: 'true', drawn: true })
    expect(dot({ watermark: true })).toEqual({ attr: 'true', drawn: true })
  })

  it('这种方式没有高级项 → 图标整颗不出', () => {
    render([ratio], {})
    expect(advancedToggles()).toHaveLength(0)
  })

  it('宿主不给底栏（批量弹窗、实验室小样）→ 不拆，图标不出', () => {
    render([ratio, seed], { aspect_ratio: '1:1' }, false)
    expect(advancedToggles()).toHaveLength(0)
  })
})
