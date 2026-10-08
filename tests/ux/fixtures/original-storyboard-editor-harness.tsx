// Controlled catalog boundary; the real editor, the real project-record plan store and the real projection.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmDialogHost } from '../../../src/design'
import { NomiPreviewHost } from '../../../src/design/previewHost'
import StoryboardPlanEditor from '../../../src/workbench/creation/storyboard/StoryboardPlanEditor'
import { useGenerationCanvasStore } from '../../../src/workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../src/workbench/workbenchStore'
import '@mantine/core/styles.css'
import type { ModelCatalogModelDto, ModelCatalogVendorDto, ModelCatalogHealthDto } from '../../../src/workbench/api/modelCatalogApi'
const query = new URLSearchParams(location.search)
const mediaKind = query.get('media') === 'video' ? 'video' : 'image'
const catalogModels: ModelCatalogModelDto[] = [
  { modelKey: 'agent-runtime-image', vendorKey: 'agent-runtime-loopback', labelZh: 'Fixture 图片', kind: 'image', meta: { archetypeId: 'agnes-image' }, enabled: true, published: true, publishedModes: ['text_to_image', 'image_edit'], availability: { usable: true }, createdAt: 'now', updatedAt: 'now' },
  { modelKey: 'pf-video', vendorKey: 'agent-runtime-loopback', labelZh: 'Fixture 视频', kind: 'video', meta: { archetypeId: query.has('switch') ? 'rh-kling-3.0' : 'wan-2.7' }, enabled: true, published: true, publishedModes: query.has('switch') ? ['text_to_video', 'image_to_video'] : ['image_to_video'], availability: { usable: true }, createdAt: 'now', updatedAt: 'now' },
]
const catalogVendors: ModelCatalogVendorDto[] = [{ key: 'agent-runtime-loopback', name: 'Fixture', enabled: true, authType: 'none', createdAt: 'now', updatedAt: 'now' }]
const catalogHealth: ModelCatalogHealthDto = { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 2, enabledModels: 2, mappings: 3, enabledMappings: 3, enabledApiKeys: 0 }, byKind: [], issues: [] }
Object.assign(window, { nomiDesktop: { modelCatalog: {
  listModels: (params?: { kind?: string; enabled?: boolean }) => structuredClone(catalogModels.filter(row => (!params?.kind || row.kind === params.kind) && (params?.enabled === undefined || row.enabled === params.enabled))),
  listVendors: () => structuredClone(catalogVendors),
  health: () => structuredClone(catalogHealth),
} } })
const store = useWorkbenchStore.getState()
store.hydrateWorkbenchDocuments([{ id: 'doc', title: 'Script', version: 1, updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
const REF_IMAGES = ['#7a5c48', '#2b2f4a', '#3d4a3a', '#4a3a2a', '#24323f', '#5a3a4a'].map((color) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${color}"/></svg>`)}`)
// 两份**普通方案**——Agent 产出与手建产出在这里没有区别，本来就是同一种东西。
const planFor = (id: string) => ({ title: `Plan ${id}`, anchors: [], ...(query.has('refs') ? { aspectRatio: '16:9' } : {}), ...(query.has('segments') ? { profileKey: 'genre.short-drama' } : {}), shots: [{ index: 1, shotId: `shot-${id}`, shotKind: mediaKind as 'image' | 'video',
  prompt: query.has('segments') ? '远景，Prompt' : `Prompt ${id}`, ...(query.has('segments') ? { promptSegments: [{ key: 'shotSize', start: 0, end: 2 }] } : {}), anchorIds: [], durationSec: mediaKind === 'video' ? 5 : 0, modelVendor: 'agent-runtime-loopback',
  modelKey: mediaKind === 'video' ? 'pf-video' : 'agent-runtime-image',
  params: mediaKind === 'video' ? { duration: 5, resolution: '720p' } : { size: '1024x1024' },
  // `refs`：整片 16:9（参考条在预览框下面），镜 1 挂 6 张参考（改图模式收参考图）——窄档参考条一行放不下，
  // 确定性地折出「+N」浮层（不靠字体 / 宽度碰运气）。
  ...(query.has('refs') && mediaKind === 'image' ? { modeId: 'edit', referenceBindings: { image_ref: REF_IMAGES.map((url, index) => ({ url, name: `Ref ${index + 1}` })) } } : {}) }] })
const designs = Object.fromEntries(['a', 'b'].map(id => [id, store.addStoryboardDesign({ initiator: 'user', documentId: 'doc', source: planFor(id), identity: { id: `design-${id}`, title: `Plan ${id}` } })!]))
store.setActiveStoryboardId(designs.a.id, 'doc')
if (query.has('confirm')) {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ id: 'result-node', kind: 'image', title: 'Result', position: { x: 0, y: 0 }, categoryId: 'shots', status: 'success', result: { id: 'result', type: 'image', url: '/favicon.ico', createdAt: 1 }, meta: { storyboardDesignId: designs.a.id, shotId: 'shot-a' } }], edges: [], groups: [] })
}
Object.assign(window, { originalStoryboard: { plans: () => useWorkbenchStore.getState().storyboardDesignsByDocumentId, agentRefs: () => useWorkbenchStore.getState().projectAgentReferences.map((item) => item.value) } })
useWorkbenchStore.getState().setWorkspaceMode('storyboard')
function Fixture() {
  const [hidden, setHidden] = React.useState(false)
  const select = (id: string) => useWorkbenchStore.getState().setActiveStoryboardId(designs[id].id, 'doc')
  return <><button onClick={() => select('a')}>Plan A</button><button onClick={() => select('b')}>Plan B</button>
    {query.has('undo') ? <><button>Outside editor</button><input aria-label="Sibling text" /><button onClick={() => { setHidden(true); useWorkbenchStore.getState().setWorkspaceMode('generation') }}>Canvas sibling</button></> : null}
    <div style={{ height: 800 }} hidden={hidden}><StoryboardPlanEditor projectId="project" /></div></>
}
createRoot(document.getElementById('root')!).render(<NomiPreviewHost locale={query.get('locale') || 'zh-CN'}><Fixture /><ConfirmDialogHost /></NomiPreviewHost>)
