import React from 'react'
import { builtinVendorKeyOfKey } from '../../../../electron/shared/builtinVendorIdentity'
import type { VendorPricePreview, VendorPriceRequest } from '../../../../electron/shared/contracts/vendorPricePreview'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ComposerGraph } from '../nodes/composerGraphSnapshot'
import { buildCatalogTaskRequest } from '../runner/catalogTaskActions'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'

function priceRequest(node: GenerationCanvasNode, graph: ComposerGraph): VendorPriceRequest | null {
  if (!['image', 'video'].includes(node.kind)) return null
  try {
    const references = resolveGenerationReferences(node, { nodes: graph.nodes, edges: graph.edges })
    const draft = node.prompt?.trim() ? node : { ...node, prompt: '…' }
    const { vendor, request } = buildCatalogTaskRequest(draft, { references })
    if (builtinVendorKeyOfKey(vendor) !== 'apimart') return null
    return { vendorKey: vendor, request: { ...request, prompt: '', negativePrompt: undefined } }
  } catch {
    return null
  }
}

export function useNodePricePreview(node: GenerationCanvasNode, graph: ComposerGraph) {
  const input = React.useMemo(() => priceRequest(node, graph), [node, graph])
  const identity = input && JSON.stringify(input)
  const [result, setResult] = React.useState<{ identity: string; quote: VendorPricePreview | null }>()
  React.useEffect(() => {
    const read = getDesktopBridge()?.onboarding?.vendorPricePreview
    if (!identity || !read) return
    let active = true
    const timer = window.setTimeout(() => {
      void read(JSON.parse(identity) as VendorPriceRequest).then(
        quote => { if (active) setResult({ identity, quote }) },
        () => { if (active) setResult({ identity, quote: null }) },
      )
    }, 150)
    return () => { active = false; window.clearTimeout(timer) }
  }, [identity])
  return { vendorKey: input?.vendorKey, quote: result?.identity === identity ? result?.quote ?? null : null }
}
