import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/styles/index.css'
import { NomiAppProviders } from '../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../src/theme/NomiColorSchemeProvider'
import NodeParameterControls from '../../../src/workbench/generationCanvas/nodes/NodeParameterControls'
import { useComposerControlProps } from './composerControlProps'
import { useGenerationCanvasStore } from '../../../src/workbench/generationCanvas/store/generationCanvasStore'
import { workspaceInputAttributes } from '../../../src/workbench/shortcutSurface'

// The real catalog, real store and real controls; no network generation calls.
// The placeholder APIMart key is saved by the walk before launch (seedSavedFixtureCredentials): saving it here
// goes through the live credential check, which either sends it to the real vendor (401) or, offline, stores it
// unverified and disabled; both leave the model out of the picker.
window.nomiDesktop!.modelCatalog.upsertVendor({ key: 'apimart', enabled: true })
useGenerationCanvasStore.getState().restoreSnapshot({
  nodes: [{ id: 'contract-video', kind: 'video', title: 'Hailuo 2.3', categoryId: 'shots', position: { x: 0, y: 0 }, size: { width: 320, height: 180 },
    meta: { modelKey: 'MiniMax-Hailuo-2.3', vendor: 'apimart', resolution: '768p', duration: 10,
      archetype: { id: 'hailuo-2.3', modeId: 't2v', variantId: 'standard' } } }],
  edges: [], selectedNodeIds: ['contract-video'], groups: [],
})
function Stage() {
  const node = useGenerationCanvasStore(state => state.nodes[0])
  const controlProps = useComposerControlProps(node, 'contract-video')
  // 宿主声明（同 GenerationWorkspace / WorkbenchShell 的工作区宿主，e57081ef0 起键盘 / 点外面只认声明了「输入在这」的宿主）：
  // 不声明，参数面板的 Esc 和点外面关闭在这页一律不响应——那是夹具缺宿主，不是产品行为。
  return <main className="min-h-screen bg-nomi-bg p-8 text-nomi-ink" {...workspaceInputAttributes(true)}>
    <div className="w-fit rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4" data-contract-stage>
      <NodeParameterControls node={node} section="references" {...controlProps} />
      <NodeParameterControls node={node} section="parameters" {...controlProps} />
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<NomiColorSchemeProvider><NomiAppProviders><Stage /></NomiAppProviders></NomiColorSchemeProvider>)
