// 老项目画布夹具（0.24.1 真实存盘写出来的 13 个生成节点）的读取与「怎么读」的共用入口。
// 夹具与来历：tests/fixtures/old-user-data/canvas/v0.24.1-mode-nodes/（canvas.json = payload.generationCanvas 存盘片段；
// manifest.json = 每个节点在 0.24.1 里怎么得到的 + 0.24.1 自己读它读出什么）；重生成：generators/zzCanvasModeGen.ts.txt（README 有命令）。
// 三份测试（现状 / 目标 / 退回旧版本）共用这里，读方式的口只有一处：改造后换了函数名，只改这一个文件。
import fs from 'node:fs'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes'
import { currentArchetypeMode, orderedSentMediaReferenceUrls } from '../../../../src/workbench/generationCanvas/nodes/controls/archetypeMeta'
import { canRunGenerationNode } from '../../../../src/workbench/generationCanvas/runner/generationRunController'
import { resolveTaskKind } from '../../../../src/workbench/generationCanvas/runner/catalogTaskResolve'
import { resolveGenerationReferences } from '../../../../src/workbench/generationCanvas/runner/generationReferenceResolver'
import { normalizeStoreSnapshot } from '../../../../src/workbench/generationCanvas/store/canvasSnapshotNormalizer'
import { useGenerationCanvasStore } from '../../../../src/workbench/generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../../../src/workbench/generationCanvas/model/generationCanvasTypes'

const DIR = new URL('./v0.24.1-mode-nodes/', import.meta.url)

export type FixtureScenario = { key: string; nodeId: string; how: string; group: 'design-card' | 'control' }
export type V0241Read = {
  storedModeId: string | null
  readModeId: string | null
  taskKind: string
  canRun: boolean
  incomingEdges: Array<{ id: string; source: string; mode: string | null }>
}
export type Canvas = { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[]; groups: unknown[] }

export function loadFixture(): { canvas: Canvas; scenarios: FixtureScenario[]; v0241Reads: Record<string, V0241Read> } {
  const canvas = JSON.parse(fs.readFileSync(new URL('canvas.json', DIR), 'utf8')) as Canvas
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', DIR), 'utf8')) as {
    scenarios: FixtureScenario[]
    v0241Reads: Record<string, V0241Read>
  }
  return { canvas, scenarios: manifest.scenarios, v0241Reads: manifest.v0241Reads }
}

export type ModeRead = {
  /** 节点盘上存着的 modeId（meta.archetype.modeId 原样）。 */
  storedModeId: string | null
  /** 这个节点此刻会按哪个方式发（生成钮、请求构造读的那个）。 */
  effectiveModeId: string | null
  /** 发出去的任务种类（传输桶）。 */
  taskKind: string
  /** 生成钮可不可点（不含「归制作流程」那一条）。 */
  canRun: boolean
  /** 数组类参考（参考图 / 参考视频 / 参考音频）真正会被发出去的个数；首帧 / 尾帧槽不算在内。 */
  sentArrayReferences: number
}

function archetypeOfNode(node: GenerationCanvasNode) {
  const id = (node.meta?.archetype as { id?: string } | undefined)?.id
  return MODEL_ARCHETYPES.find((candidate) => candidate.id === id) ?? null
}

/** 读一个节点：这是三份测试唯一的「读方式」口。 */
export function readNode(nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[], nodeId: string): ModeRead {
  const node = nodes.find((candidate) => candidate.id === nodeId)!
  const meta = (node.meta || {}) as Record<string, unknown>
  const archetype = archetypeOfNode(node)
  const references = resolveGenerationReferences(node, { nodes, edges })
  const sent = archetype
    ? orderedSentMediaReferenceUrls(meta, archetype, { image: references.referenceImages, video: references.referenceVideos, audio: references.referenceAudios })
    : []
  return {
    storedModeId: (meta.archetype as { modeId?: string } | undefined)?.modeId ?? null,
    effectiveModeId: archetype ? currentArchetypeMode(archetype, meta).id : null,
    taskKind: resolveTaskKind(node, references),
    canRun: canRunGenerationNode(node, { nodes, edges }),
    sentArrayReferences: sent.length,
  }
}

/** 路径 A：只过读取归一（normalizeStoreSnapshot），节点原样。 */
export function readAfterNormalize(canvas: Canvas): { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] } {
  const normalized = normalizeStoreSnapshot(structuredClone(canvas))
  return { nodes: normalized.nodes as GenerationCanvasNode[], edges: normalized.edges as GenerationCanvasEdge[] }
}

/** 路径 B：真实打开项目（restoreSnapshot，含加载收敛）后，store 里的节点——创作者真正看到、真正发出去的那份。 */
export function openProject(canvas: Canvas): { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[]; saved: ReturnType<ReturnType<typeof useGenerationCanvasStore.getState>['readDocumentSnapshot']> } {
  const store = useGenerationCanvasStore.getState()
  store.restoreSnapshot(structuredClone(canvas), 'old-user-mode-fixture')
  const state = useGenerationCanvasStore.getState()
  return { nodes: state.nodes, edges: state.edges, saved: state.readDocumentSnapshot() }
}
