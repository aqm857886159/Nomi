// 设计实验室 · Agent 面板 v4 · **付费卡（参数条版）+ 「全自动」档**（2026-09-10 用户拍板）
//
// 基线是这两件已经存在的东西，本组只画**增量**：
//   ① `v4-intervention-spend` 那张付费卡的骨架（槽头 + 摘要 + 按钮，`V4Intervention` 的 spend kind）；
//   ② 图片/视频节点底下那条参数条（`InlineParameterBar`，2026-07-17 用户拍板的「模型芯片 + 摘要 pill」形态）。
//
// 增量只有一句话：**把 ① 里那排不能点的只读 chip，换成 ② 本人**。
// 用户原话：「得类似于图片节点、视频节点，它得点之后，下拉之后，它得选」「只能选改模型就不对，
// 而且改模型就应该是下拉框选」。所以这里 `import` 的就是节点那一个组件——不是照着它再画一份
// 长得像的（那是并行版，P1），也不是把它抄进 v4 词表（那是同一个控件两份定义）。
//
// 夹具**镜像真实调用点**（`NodeParameterControls.tsx:686` 那次调用）：
//   · 控件不是手写的，是 `resolveRenderedControls(option, meta, false, true)` 从**真档案**
//     （`electron/shared/videoCapabilities/kling.ts` 的 KLING_3_ARCHETYPE）算出来的——
//     画质 std/pro/4K、时长 3/5/10、比例 16:9/9:16/1:1、声效开关，一个都不是编的；
//   · `onParameterControlChange` 真回写 meta，所以这一格在实验室里**是真能点、真能改**的：
//     换个时长，下面那行价格当场跟着变。截图钉住的是形态，能点的那部分是给拍板人自己试的。
//
// 价格那半行是**实验室自己的报价桩**（`quotePrice`）：这一版只出样张不接线，真实报价来自
// 供应商目录。桩的口径写在函数上方，谁来接线照那个口径接。
import React from 'react'
import { V4Intervention } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { V4AutoModeBanner } from '../../../../workbench/ai/v4/AgentPanelV4AutoMode'
import { AgentPanelV4Composer } from '../../../../workbench/ai/v4/AgentPanelV4Composer'
import { useV4Labels } from '../../../../workbench/ai/v4/agentPanelV4Labels'
import type { InterventionData } from '../../../../workbench/ai/v4/agentPanelV4Types'
import InlineParameterBar from '../../../../workbench/generationCanvas/nodes/InlineParameterBar'
import { resolveRenderedControls, resolveArchetypeForOption } from '../../../../workbench/generationCanvas/nodes/nodeModelArchetype'
import type { ModelOption } from '../../../../config/models'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import type { DynamicCatalogControl } from '../../../../workbench/generationCanvas/nodes/controls/parameterControlModel'
import { Piece, useV4Fixtures } from '../agentPanelV4LabKit'
import type { LabState } from '../../labScreen'

const SOURCE = '2026-09-10-spend-card-node-params-and-full-auto.md'

/**
 * 目录里的三个视频模型。`modelKey` 是**真身份串**——`resolveRenderedControls` 靠它认档案，
 * 写错一个字这一格就退回「认不出的模型」那条路，参数全没了。
 * label 用拉丁名：模型名不翻译，也不该占用 i18n 词条（R15 管的是**我们写的**可见文字）。
 */
const KLING: ModelOption = {
  value: 'kling-3.0/video',
  modelKey: 'kling-3.0/video',
  vendor: 'kie',
  label: 'Kling 3.0',
  kind: 'video',
}
const MODEL_OPTIONS: readonly ModelOption[] = [
  KLING,
  { value: 'seedance-2.5', modelKey: 'seedance-2.5', vendor: 'apimart', label: 'Seedance 2.5', kind: 'video' },
  { value: 'minimax-hailuo-3', modelKey: 'minimax-hailuo-3', vendor: 'apimart', label: 'Hailuo 3', kind: 'video' },
]

/** 4 段 = 这一单要生成几条片子。它不是模型参数（模型不认识"几段"），所以不在参数条里，只进价格行。 */
const CLIP_COUNT = 4

/**
 * 实验室报价桩。口径：**每秒单价 × 时长 × 段数**，单价随画质档走。
 * 真接线时这三个数全部来自供应商目录/报价接口；这里写死只是为了让「改参数 → 价格原地刷新」
 * 这件事在样张上真的发生。`null` = 这个组合报不出价（接线后是常态：中转/自建端点多半没有价目）。
 */
const UNIT_PRICE_PER_SECOND: Record<string, number> = { std: 0.1, pro: 0.2, '4K': 0.4 }

function quotePrice(meta: Record<string, unknown>): { unit: number; seconds: number; total: number } | null {
  const unit = UNIT_PRICE_PER_SECOND[String(meta.mode ?? '')]
  const seconds = Number(meta.duration)
  if (!unit || !Number.isFinite(seconds)) return null
  return { unit, seconds, total: unit * seconds * CLIP_COUNT }
}

function money(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

const BASE_META: Record<string, unknown> = {
  archetype: { id: 'kling-3.0', modeId: 'i2v' },
  mode: 'std',
  duration: '3',
  aspect_ratio: '16:9',
  sound: false,
}

/**
 * 付费卡（参数条版）。**一张卡、不跳转、不出第二张卡**（用户拍板的那句话就是本组件的验收标准）。
 *
 * `priceUnknown` 那一档不是另一张卡：它就是这张卡上「合计算不出」的样子——
 * 价格行右端换成一句话、确认钮从「生成 ¥X」退成「仍要生成」、范围那行换成一句诚实交代。
 * 现役 `ResidentSpendCard` 就是这么兜的（红框 + 「仍要生成」），这一版只是让它别再是**唯一**的那一态。
 */
function SpendParamsCard({
  initialMeta = BASE_META,
  priceUnknown = false,
  perShot = false,
  openTrigger,
}: {
  initialMeta?: Record<string, unknown>
  priceUnknown?: boolean
  perShot?: boolean
  /** 挂载后自动点开的那一件（展开态那几格用；不给 = 收起态）。截图截不出「点一下会怎样」，
   *  所以展开态一律**真的点一下**，不是另画一份展开的样子。 */
  openTrigger?: 'model' | 'panel' | 'per-item'
}): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const [meta, setMeta] = React.useState<Record<string, unknown>>(initialMeta)
  const [modelValue, setModelValue] = React.useState<string>(KLING.value)
  const cardRef = React.useRef<HTMLDivElement>(null)

  // 展开态由取景台**真的点一下触发钮**得到，不是另画一份下拉（同 `pf-08` 的纪律）。
  // 触发钮按 aria-label 找：那两个 label 本来就走 i18n，跟着语言走，不写死中文选择器。
  const modelLabel = fx.t('generationCommon.parameters.model')
  const panelLabel = fx.t('generationCommon.parameters.generationParameters')
  React.useLayoutEffect(() => {
    if (!openTrigger) return
    if (openTrigger === 'per-item') {
      cardRef.current?.querySelector<HTMLDetailsElement>('[data-v4-block="price-per-item"]')?.setAttribute('open', '')
      return
    }
    const selector = `button[aria-label="${openTrigger === 'model' ? modelLabel : panelLabel}"]`
    cardRef.current?.querySelector<HTMLButtonElement>(selector)?.click()
  }, [openTrigger, modelLabel, panelLabel])

  const selected = MODEL_OPTIONS.find((option) => option.value === modelValue) ?? KLING
  const controls = resolveRenderedControls(selected, meta, false, true)
  const quote = priceUnknown ? null : quotePrice(meta)
  const quality = meta.mode === 'std' ? fx.t('agentPanelV4.qualityStandard') : fx.t('agentPanelV4.qualityPro')

  const price: InterventionData['price'] = {
    // 报不出价的那一档连**单价**都不印：那个数同样是报价给的，编一个出来和印 ¥0 是同一种错。
    breakdown: quote
      ? fx.t('agentPanelV4.spendParamsBreakdown', {
        count: CLIP_COUNT,
        seconds: quote.seconds,
        quality,
        unit: money(quote.unit),
      })
      : fx.t('agentPanelV4.spendParamsBreakdownNoUnit', {
        count: CLIP_COUNT,
        seconds: Number(meta.duration),
        quality,
      }),
    ...(quote
      ? { totalLabel: fx.t('agentPanelV4.spendParamsTotalLabel'), total: money(quote.total) }
      : { unavailable: fx.t('agentPanelV4.spendParamsUnavailable') }),
    ...(perShot && quote
      ? {
          perItemLabel: fx.t('agentPanelV4.spendParamsPerItem', { count: CLIP_COUNT }),
          perItem: Array.from({ length: CLIP_COUNT }, (_, index) => ({
            label: fx.t('agentPanelV4.spendParamsShot', { number: index + 1 }),
            amount: money(quote.total / CLIP_COUNT),
          })),
        }
      : {}),
  }

  const data: InterventionData = {
    kind: 'spend',
    // 标题里**不再印金额**：金额会随参数变，两个地方印同一个数就一定有一个先漂。
    // 它只说「要做什么」，钱归价格行与确认钮（后者是用户按下去时的那句承诺）。
    title: perShot ? fx.t('agentPanelV4.spendParamsBatchTitle') : fx.t('agentPanelV4.spendParamsTitle'),
    badge: fx.t('agentPanelV4.slotSpendBadge'),
    summary: fx.t('agentPanelV4.spendParamsSummary'),
    price,
    scope: quote
      ? fx.t('agentPanelV4.spendParamsScope')
      : fx.t('agentPanelV4.spendParamsScopeUnknown'),
    confirmLabel: quote
      ? fx.t('agentPanelV4.spendParamsConfirm', { amount: money(quote.total) })
      : fx.t('agentPanelV4.spendParamsConfirmUnknown'),
  }

  return (
    <Piece>
      <div ref={cardRef}>
        <V4Intervention
          data={data}
          labels={{ ...labels.intervention, reject: fx.t('agentPanelV4.spendParamsDecline') }}
          parameterBar={
            <InlineParameterBar
              modelOptions={MODEL_OPTIONS}
              modelCatalogStatus={{ message: '' }}
              renderedControls={controls}
              selectedModelOption={selected}
              archetype={resolveArchetypeForOption(selected)}
              meta={meta}
              onModelChange={(value) => setModelValue(value)}
              onCatalogControlChange={(control: DynamicCatalogControl, value: string) =>
                setMeta((current) => ({ ...current, [control.key]: value }))
              }
              onParameterControlChange={(control: ModelParameterControl, value: string) =>
                setMeta((current) => ({ ...current, [control.key]: control.type === 'boolean' ? value === 'true' : value }))
              }
              // 窄面板里参数条竖排、浮层就地展开：卡随转录滚动，portal 到 body 的浮层会脱离卡。
              layout="stacked"
              panelMode="inline"
              portalTarget={cardRef}
              // 模型是 Nomi 替用户挑的——标记必须长在**那颗芯片上**：用户一改模型，
              // 这句话就该跟着那颗芯片一起被覆盖，而不是留在卡上变成一句假话。
              modelBadge={{ text: fx.t('agentPanelV4.spendParamsModelPicked'), tone: 'accent' }}
            />
          }
        />
      </div>
    </Piece>
  )
}

/** 切到「全自动」的二次确认。**不是新组件**：它就是介入槽的可撤销档（换档本身可撤销）。 */
function AutoModeConfirmCard(): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  return (
    <Piece>
      <V4Intervention
        data={{
          kind: 'approval-reversible',
          title: fx.t('agentPanelV4.autoModeConfirmTitle'),
          summary: fx.t('agentPanelV4.autoModeConfirmBody'),
          confirmLabel: fx.t('agentPanelV4.autoModeConfirmOk'),
        }}
        labels={{ ...labels.intervention, reject: fx.t('agentPanelV4.autoModeConfirmCancel') }}
      />
    </Piece>
  )
}

/** 开启后的常驻提醒：一条 h-6 微字横条，压在 composer 上沿——它在的地方就是你打字的地方。 */
function AutoModeReminderCell(): JSX.Element {
  const fx = useV4Fixtures()
  const [tier, setTier] = React.useState<'project' | 'safe-auto'>('project')
  return (
    <Piece>
      {tier === 'project' ? (
        <V4AutoModeBanner
          label={fx.t('agentPanelV4.permission.project')}
          note={fx.t('agentPanelV4.autoModeBannerNote')}
          revertLabel={fx.t('agentPanelV4.autoModeBannerRevert')}
          onRevert={() => setTier('safe-auto')}
        />
      ) : null}
      <AgentPanelV4Composer panelHeight={620} mode="idle" permission={tier} value="" />
    </Piece>
  )
}

export const V4_SPEND_PARAMS_STATES: readonly LabState[] = [
  {
    id: 'v4-spend-params-collapsed',
    name: '付费卡 · 参数条收起（模型芯片带「Nomi 选的」+ 摘要 pill + 价格行）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:686',
    coverage: 'component-only',
    render: () => <SpendParamsCard />,
  },
  {
    id: 'v4-spend-params-collapsed-dark',
    name: '付费卡 · 参数条收起（暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:686',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <SpendParamsCard />,
  },
  {
    id: 'v4-spend-params-model-open',
    name: '付费卡 · 模型下拉展开（和节点上同一个下拉：同行供应商 chip、同一份目录）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:542',
    coverage: 'component-only',
    render: () => <SpendParamsCard openTrigger="model" />,
  },
  {
    id: 'v4-spend-params-panel-open',
    name: '付费卡 · 参数面板就地展开（画质 / 时长 / 比例 / 声效 全都能改，不只是模型）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:340',
    coverage: 'component-only',
    render: () => <SpendParamsCard openTrigger="panel" />,
  },
  {
    id: 'v4-spend-params-repriced',
    name: '付费卡 · 改完参数价格行原地刷新（3s→5s：¥1.20→¥2.00，同一张卡）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:686',
    coverage: 'component-only',
    render: () => <SpendParamsCard initialMeta={{ ...BASE_META, duration: '5' }} />,
  },
  {
    id: 'v4-spend-params-batch',
    name: '付费卡 · 多镜批量（参数条 = 整批默认值，价格展开逐镜）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:686',
    coverage: 'component-only',
    render: () => <SpendParamsCard perShot openTrigger="per-item" />,
  },
  {
    id: 'v4-spend-params-price-unknown',
    name: '付费卡 · 价格算不出（沿现役：不印 ¥0，钮退成「仍要生成」）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:180',
    coverage: 'component-only',
    render: () => <SpendParamsCard priceUnknown />,
  },
  {
    id: 'v4-auto-mode-confirm',
    name: '全自动 · 切档二次确认（一句话说清仍会问什么）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:213',
    coverage: 'component-only',
    render: () => <AutoModeConfirmCard />,
  },
  {
    id: 'v4-auto-mode-confirm-dark',
    name: '全自动 · 切档二次确认（暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:213',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AutoModeConfirmCard />,
  },
  {
    id: 'v4-auto-mode-reminder',
    name: '全自动 · 常驻提醒（压在 composer 上沿，一点回「自动改」）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Composer.tsx:250',
    coverage: 'component-only',
    render: () => <AutoModeReminderCell />,
  },
  {
    id: 'v4-auto-mode-reminder-dark',
    name: '全自动 · 常驻提醒（暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/ai/v4/AgentPanelV4Composer.tsx:250',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AutoModeReminderCell />,
  },
]
