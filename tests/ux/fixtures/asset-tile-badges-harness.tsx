// 画布节点参考区的真组件（NodeParameterControls section="references" → AssetReference → AssetTile），
// 零额度：只读目录桥是桩，节点与连线灌进真 store，不发任何生成请求。
// 用途：参考缩略图的序号角标与 × 要整枚落在可见区域内（tests/ux/asset-tile-badges-visible.test.mjs）。
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/styles/index.css'
import { NomiPreviewHost } from '../../../src/design/previewHost'
import NodeParameterControls from '../../../src/workbench/generationCanvas/nodes/NodeParameterControls'
import { useGenerationCanvasStore } from '../../../src/workbench/generationCanvas/store/generationCanvasStore'
import { STILL_NEON, STILL_PORTRAIT, STILL_PROP } from '../../../src/devlab/designLab/storyboard/storyboardFixtures'
import type { GenerationCanvasNode } from '../../../src/workbench/generationCanvas/model/generationCanvasTypes'
import type { ModelCatalogHealthDto, ModelCatalogModelDto, ModelCatalogVendorDto } from '../../../src/workbench/api/modelCatalogApi'

const query = new URLSearchParams(location.search)
const catalogModels: ModelCatalogModelDto[] = [
  { modelKey: 'MiniMax-H3', vendorKey: 'apimart', labelZh: 'MiniMax H3', kind: 'video', meta: { archetypeId: 'minimax-h3-apimart' }, enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: { usable: true }, createdAt: 'now', updatedAt: 'now' },
]
const catalogVendors: ModelCatalogVendorDto[] = [{ key: 'apimart', name: 'APIMart', enabled: true, authType: 'none', createdAt: 'now', updatedAt: 'now' }]
const catalogHealth: ModelCatalogHealthDto = { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 1, enabledModels: 1, mappings: 1, enabledMappings: 1, enabledApiKeys: 0 }, byKind: [], issues: [] }
Object.assign(window, { nomiDesktop: { modelCatalog: {
  listModels: () => structuredClone(catalogModels),
  listVendors: () => structuredClone(catalogVendors),
  health: () => structuredClone(catalogHealth),
} } })

const sources: GenerationCanvasNode[] = [STILL_PORTRAIT, STILL_NEON, STILL_PROP].map((url, index) => ({
  id: `ref-${index + 1}`, kind: 'image', title: `参考 ${index + 1}`, categoryId: 'shots', position: { x: 0, y: index * 200 }, status: 'success',
  result: { id: `r-${index + 1}`, type: 'image', url, createdAt: 1 },
}) as GenerationCanvasNode)
const target = {
  id: 'target', kind: 'video', title: '镜头', categoryId: 'shots', position: { x: 600, y: 0 }, status: 'idle', prompt: '',
  meta: { modelKey: 'MiniMax-H3', modelVendor: 'apimart', archetype: { id: 'minimax-h3-apimart', modeId: 'ref' } },
} as GenerationCanvasNode
const store = useGenerationCanvasStore.getState()
store.restoreSnapshot({ nodes: [...sources, target], edges: [], groups: [] })
for (const source of sources) useGenerationCanvasStore.getState().connectNodes(source.id, target.id, 'character_ref')

function Stage(): JSX.Element {
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === 'target'))
  return (
    <main className="min-h-screen bg-nomi-bg p-8 text-nomi-ink">
      <div className="w-fit rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4" data-asset-tile-stage="canvas">
        {node ? <NodeParameterControls node={node} section="references" /> : null}
      </div>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<NomiPreviewHost locale={query.get('locale') || 'zh-CN'}><Stage /></NomiPreviewHost>)
