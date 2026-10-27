// 生成框参考行「+」→「上传本地文件」的类测试夹具（tests/ux/composer-upload-connect.test.mjs），零额度、不发任何生成请求。
// 真的：生成框参考区（NodeParameterControls → NodeInputReferenceEntry → AssetPicker）、画布 store（导入建卡默认选中新卡）、
//       本地文件导入链（importLocalFilesToGenerationCanvas → importLocalMediaFilesToGenerationCanvas → 落盘回执写回卡上）、
//       项目签发（withProjectAction）。
// 桩：桌面桥的模型目录、磁盘余量、落盘。余量与落盘各挂一道闸，由测试放行——好把「建卡前」「建卡后、完成前」两段钉住，
//     不靠赌时序。
// 宿主（查询参数 host）：
//   canvas = 画布节点的挂载规矩（BaseGenerationNode：这张卡单选才挂生成框，React.useDeferredValue 低优先级挂卸）；
//   inline = 列表视图内嵌生成框（GenerationListDetail：详情开着就挂，不随画布选中卸载）。
import React, { type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { NomiPreviewHost } from '../../../src/design/previewHost'
import NodeParameterControls from '../../../src/workbench/generationCanvas/nodes/NodeParameterControls'
import { useGenerationCanvasStore } from '../../../src/workbench/generationCanvas/store/generationCanvasStore'
import { createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurfaceCoordinator } from '../../../src/workbench/project/projectCanvasReadSurface'
import { useComposerControlProps } from './composerControlProps'
import type { CanvasReadSurfaceBridge } from '../../../electron/shared/surfacePortBinding'
import type { GenerationCanvasNode } from '../../../src/workbench/generationCanvas/model/generationCanvasTypes'
import type { ModelCatalogHealthDto, ModelCatalogModelDto, ModelCatalogVendorDto } from '../../../src/workbench/api/modelCatalogApi'

const query = new URLSearchParams(location.search)
const host = query.get('host') === 'inline' ? 'inline' : 'canvas'
const TARGET = 'target'
const OTHER = 'other'
const MODEL_KEY = 'gpt-image-2-image-to-image'
const ARCHETYPE = 'gpt-image-2'
const catalogModels: ModelCatalogModelDto[] = [
  { modelKey: MODEL_KEY, vendorKey: 'apimart', labelZh: ARCHETYPE, kind: 'image', meta: { archetypeId: ARCHETYPE }, enabled: true, published: true,
    publishedModes: ['text_to_image', 'image_edit'], availability: { usable: true }, createdAt: 'now', updatedAt: 'now' },
]
const catalogVendors: ModelCatalogVendorDto[] = [{ key: 'apimart', name: 'APIMart', enabled: true, authType: 'none', createdAt: 'now', updatedAt: 'now' }]
const catalogHealth: ModelCatalogHealthDto = { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 1, enabledModels: 1, mappings: 1, enabledMappings: 1, enabledApiKeys: 0 }, byKind: [], issues: [] }

type Gate = { promise: Promise<void>; release: () => void }
function gate(): Gate {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
const capacityGate = gate()
const uploadGate = gate()
const calls = { capacity: 0, importFile: 0 }
Object.assign(window, { nomiDesktop: {
  modelCatalog: {
    listModels: () => structuredClone(catalogModels),
    listVendors: () => structuredClone(catalogVendors),
    health: () => structuredClone(catalogHealth),
  },
  assets: {
    // 导入在建卡**之前**先量磁盘余量：这道闸不放，选择器还开着、卡还没建（「建卡前」那一段）。null = 量不到，不拦。
    storageCapacity: async () => { calls.capacity += 1; await capacityGate.promise; return null },
    // 落盘：卡已建好、正在拷文件（「建卡后、完成前」那一段）。放行后回一张能显示的落盘回执。
    importFile: async (request: { fileName: string; bytes: ArrayBuffer }) => {
      calls.importFile += 1
      await uploadGate.promise
      const url = URL.createObjectURL(new Blob([request.bytes], { type: 'image/png' }))
      return { ok: true, asset: { id: `asset-${calls.importFile}`, name: request.fileName, userId: 'local', createdAt: 'now', updatedAt: 'now',
        data: { url, previewState: 'source', width: 64, height: 48 } } }
    },
  },
} })

const nodes: GenerationCanvasNode[] = [
  { id: TARGET, kind: 'image', title: 'fixture-target', categoryId: 'shots', position: { x: 600, y: 0 }, status: 'idle', prompt: '',
    meta: { modelKey: MODEL_KEY, modelVendor: 'apimart', archetype: { id: ARCHETYPE, modeId: 't2i' } } } as GenerationCanvasNode,
  { id: OTHER, kind: 'image', title: 'fixture-other', categoryId: 'shots', position: { x: 1200, y: 0 }, status: 'idle', prompt: '' } as GenerationCanvasNode,
]

function snapshot() {
  const state = useGenerationCanvasStore.getState()
  const target = state.nodes.find((node) => node.id === TARGET)
  return {
    nodes: state.nodes.map((node) => ({ id: node.id, kind: node.kind, uploadStatus: (node.meta as { uploadStatus?: string } | undefined)?.uploadStatus ?? null })),
    edges: state.edges.map((edge) => ({ source: edge.source, target: edge.target })),
    selected: [...state.selectedNodeIds],
    targetMode: (target?.meta as { archetype?: { modeId?: string } } | undefined)?.archetype?.modeId ?? null,
  }
}
Object.assign(window, { composerUpload: {
  releaseCapacity: () => capacityGate.release(),
  releaseUpload: () => uploadGate.release(),
  calls: () => ({ ...calls }),
  /** 用户在画布上点了另一张卡（画布点卡走的同一个 store 动作）。 */
  select: (nodeId: string) => useGenerationCanvasStore.getState().selectNode(nodeId),
  /** 画布 Ctrl+Z 走的同一个 store 动作。 */
  undo: () => useGenerationCanvasStore.getState().undo(),
  snapshot,
} })

function Composer(): JSX.Element | null {
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === TARGET))
  const controlProps = useComposerControlProps(node, TARGET)
  return node ? <div data-harness-composer={host}><NodeParameterControls node={node} section="references" {...controlProps} /></div> : null
}

function CanvasHost(): JSX.Element | null {
  // 与 BaseGenerationNode 同一条挂载规矩：这张卡被单选才要生成框；挂 / 卸走低优先级渲染。
  const wanted = useGenerationCanvasStore((state) => state.selectedNodeIds.length === 1 && state.selectedNodeIds[0] === TARGET)
  const mounted = React.useDeferredValue(wanted)
  return mounted ? <Composer /> : null
}

async function boot(): Promise<void> {
  // 打开一个项目（真签发点）：导入只认动作起点签发的项目，没有打开的项目就什么都不做。
  const coordinator = createProjectCanvasReadSurfaceCoordinator({
    createSurfaceInstanceId: () => 'window',
    getSurfaceBridge: () => ({
      suspend: async () => ({ suspension: {} }),
      release: async () => ({ released: true }),
      commitCanvasRead: async ({ projectId }: { projectId: string }) => ({ binding: { binding: {
        projectId, immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1,
      } } }),
    } as unknown as CanvasReadSurfaceBridge),
  })
  registerProjectCanvasReadSurfaceCoordinator(coordinator)
  await coordinator.beginHydration().commitCanvasRead('project-a')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [] })
  // 起点：用户刚选中这张图片节点（文字生图），画布里它的生成框挂着。
  useGenerationCanvasStore.getState().selectNodes([TARGET])
  createRoot(document.getElementById('root')!).render(
    <NomiPreviewHost locale={query.get('locale') || 'zh-CN'}>
      <main data-harness-host={host}>{host === 'canvas' ? <CanvasHost /> : <Composer />}</main>
    </NomiPreviewHost>,
  )
}
void boot()
