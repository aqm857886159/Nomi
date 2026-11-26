import React from 'react'
import { builtinVendorKeyOfKey } from '../../../../electron/shared/builtinVendorIdentity'
import type { VendorPricePreview, VendorPriceRequest } from '../../../../electron/shared/contracts/vendorPricePreview'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ComposerGraph } from '../nodes/composerGraphSnapshot'
import { buildCatalogTaskRequest } from '../runner/catalogTaskActions'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { resolveModelArchetype, variantRecordedInMeta } from '../../../../electron/shared/modelArchetypes'
import { sampleBillingRequest } from '../../../../electron/shared/videoCapabilities/sampleMode'
import type { SampleFacts } from '../model/sampleFacts'

/** 改参数后等这么久再问价（连着改只问最后一次）。 */
export const PRICE_DEBOUNCE_MS = 100
/** 改参数后旧数最多再留这么久：新价在这之内回来就直接换，不闪成箭头；过了还没回来就收成只剩箭头。 */
export const PRICE_HOLD_MS = 300

/**
 * 约价只读发送那一刻的最终请求（交接处 `archetype-panel-request` 的产出，`buildCatalogTaskRequest`），
 * 不另拼一份；提示词清掉再交主进程（价目和提示词无关，也不让正文过 IPC）。只读、不上传、不发。
 */
export function priceRequest(node: GenerationCanvasNode, graph: ComposerGraph): VendorPriceRequest | null {
  if (!['image', 'video'].includes(node.kind)) return null
  try {
    const references = resolveGenerationReferences(node, { nodes: graph.nodes, edges: graph.edges })
    const draft = node.prompt?.trim() ? node : { ...node, prompt: '…' }
    const { vendor, request } = buildCatalogTaskRequest(draft, { references })
    if (builtinVendorKeyOfKey(vendor) !== 'apimart') return null
    // 样片行按它声明的那一行约价（sampleBillingRequest 是唯一的家）；别的行原样。
    // 档案只从唯一入口拿（发送那一刻的 extras 带着 archetype.id 与 modelKey）。
    const extras = request.extras ?? {}
    const modelKey = typeof extras.modelKey === 'string' ? extras.modelKey : null
    const archetype = resolveModelArchetype({ modelKey, vendorKey: vendor, meta: extras }, { variant: variantRecordedInMeta(extras, modelKey) })
    const priced = sampleBillingRequest(request, archetype) ?? request
    return { vendorKey: vendor, request: { ...priced, prompt: '', negativePrompt: undefined } }
  } catch {
    return null
  }
}

/**
 * 出高清要约的价：样片当时冻结的请求，按样片档案声明的那一行、给定清晰度约价。
 * 约哪一行、哪一档只有 `sampleBillingRequest` 一个家；出高清按钮和第二次出高清的确认框都从这里取。
 * 不走公开价的那家 → null（钮上不印数）。
 */
export function sampleFinalPriceRequest(sample: SampleFacts, resolution: string): VendorPriceRequest | null {
  const frozen = { kind: sample.taskKind as VendorPriceRequest['request']['kind'], prompt: '', extras: sample.extras }
  const billed = sampleBillingRequest(frozen, sample.archetype, resolution)
  if (!billed || builtinVendorKeyOfKey(sample.vendorKey) !== 'apimart') return null
  return { vendorKey: sample.vendorKey, request: { ...billed, prompt: '' } }
}

/** 一次性读一份约价（确认框按钮上那个数）：读不到 / 不约价 → null。和下面的钩子走同一条 IPC。 */
export async function readPricePreviewOnce(input: VendorPriceRequest | null): Promise<VendorPricePreview | null> {
  const read = getDesktopBridge()?.onboarding?.vendorPricePreview
  if (!input || !read) return null
  return read(input).catch(() => null)
}

export type NodePricePreview = {
  /** 这次请求走的是有公开价目的那家（APIMart）时才有。 */
  vendorKey?: string
  /** 和**当前**参数对得上的公开估价；改参数后 300 毫秒内仍是上一次的数（`pending` 为真）。null = 没有可印的数。 */
  quote: VendorPricePreview | null
  /** 新价还没回来：`quote` 是上一次的数（暂留），或已收成 null。 */
  pending: boolean
}

/**
 * 节点当前参数的公开估价。只采用和当前参数对得上的那一次响应（旧响应后到不倒灌）；
 * 改参数后旧数暂留 `PRICE_HOLD_MS`，新数回来直接替换，中间不闪箭头、不闪 0。
 */
export function useNodePricePreview(node: GenerationCanvasNode, graph: ComposerGraph): NodePricePreview {
  return usePricePreview(React.useMemo(() => priceRequest(node, graph), [node, graph]))
}

/** 一份约价请求的公开估价（节点发送键、出高清按钮共用这一套暂留 / 防抖 / 防倒灌）。null = 不约价。 */
export function usePricePreview(input: VendorPriceRequest | null): NodePricePreview {
  const identity = input && JSON.stringify(input)
  const [result, setResult] = React.useState<{ identity: string; quote: VendorPricePreview | null }>()
  const [expiredFor, setExpiredFor] = React.useState<string | null>(null)
  const current = result && result.identity === identity ? result : undefined
  // 上一次键上印着的数，和参数变了的那一刻要暂留的数——都在渲染里同步定，不等 effect（否则会闪一帧箭头）。
  const shown = React.useRef<VendorPricePreview | null>(null)
  const change = React.useRef<{ identity: string | null; prior: VendorPricePreview | null }>({ identity: null, prior: null })
  if (change.current.identity !== identity) change.current = { identity, prior: shown.current }
  const held = identity && expiredFor !== identity ? change.current.prior : null
  shown.current = current ? current.quote : held

  React.useEffect(() => {
    if (!identity) return
    const hold = window.setTimeout(() => setExpiredFor(identity), PRICE_HOLD_MS)
    const read = getDesktopBridge()?.onboarding?.vendorPricePreview
    if (!read) return () => window.clearTimeout(hold)
    let active = true
    const timer = window.setTimeout(() => {
      void read(JSON.parse(identity) as VendorPriceRequest).then(
        quote => { if (active) setResult({ identity, quote }) },
        () => { if (active) setResult({ identity, quote: null }) },
      )
    }, PRICE_DEBOUNCE_MS)
    return () => { active = false; window.clearTimeout(timer); window.clearTimeout(hold) }
  }, [identity])

  if (!input) return { quote: null, pending: false }
  if (current) return { vendorKey: input.vendorKey, quote: current.quote, pending: false }
  return { vendorKey: input.vendorKey, quote: held, pending: true }
}
