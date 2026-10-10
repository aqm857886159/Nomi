// 旧项目迁移：0.23.1 写的分镜表节点（storyboard / production 来源）在打开时移除并出一条可见提示；
// 镜头节点、方案、拆参考片的事实表一个不少；镜头都出现在生成页列表里。
// 夹具由 0.23.1 自己的写入代码生成（scripts/generate-storyboard-table-fixture.mjs v0.23.1），不是手写的形状。
import { describe, expect, it } from 'vitest'
import fixture from '../generationCanvas/store/__fixtures__/storyboard-table-v0.23.1.json'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
import { retireStoryboardTableViews } from './storyboardTableRetirement'
import { normalizeStoreSnapshot } from '../generationCanvas/store/canvasSnapshotNormalizer'
import { normalizeGenerationCanvasSnapshot } from '../workbenchPersistence'
import { deriveGenerationList } from '../generation/list/generationListModel'
import { readShotTable } from '../../../electron/shared/canvas/shotTable'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

const record = (): WorkbenchProjectRecordV1 => ({
  id: 'p-0231', name: 'Released project', version: 1, createdAt: 1, updatedAt: 1,
  payload: structuredClone(fixture.payload),
} as unknown as WorkbenchProjectRecordV1)

const tableSources = (nodes: readonly { kind: string; meta?: unknown }[]) => nodes
  .filter((node) => node.kind === 'shot_table')
  .map((node) => (node.meta as { shotTable?: { source?: { kind?: string } } })?.shotTable?.source?.kind)

describe('storyboard-table retirement (old projects written by v0.23.1)', () => {
  it('the fixture really comes from the release writer and holds all three table sources', () => {
    expect(fixture.writtenBy.tag).toBe('v0.23.1')
    expect(tableSources(fixture.payload.generationCanvas.nodes).sort()).toEqual(['deconstruction', 'production', 'storyboard'])
  })

  it('removes storyboard and production table views on open, reports them, and keeps every shot', () => {
    const before = record()
    const { record: after, retired } = retireStoryboardTableViews(before)
    expect(retired).toEqual(2)
    const nodes = after.payload.generationCanvas.nodes as GenerationCanvasNode[]
    expect(tableSources(nodes)).toEqual(['deconstruction'])
    // 除了两张表节点，别的节点原样都在（不靠「东西不见了」丢数据）。
    expect(nodes.map((node) => node.id).sort()).toEqual(
      before.payload.generationCanvas.nodes.filter((node) => !['storyboard', 'production'].includes(tableSources([node as never])[0] ?? '')).map((node) => (node as GenerationCanvasNode).id).sort(),
    )
    expect(after.payload.storyboardDesignsByDocumentId).toEqual(before.payload.storyboardDesignsByDocumentId)
    // 幂等：再迁一次不再动。
    expect(retireStoryboardTableViews(after).retired).toBe(0)
  })

  it('the shots of the old table show up in the generation list', () => {
    const { record: after } = retireStoryboardTableViews(record())
    const canvas = normalizeStoreSnapshot(after.payload.generationCanvas)
    const model = deriveGenerationList({
      nodes: canvas.nodes, edges: canvas.edges, groups: canvas.groups,
      designsByDocumentId: after.payload.storyboardDesignsByDocumentId as never,
      imageModelOptions: [], videoModelOptions: [],
    })
    const storyboard = model.sections.find((section) => section.kind === 'storyboard')!
    // 列表只显示画布上有的镜头：方案第 3 镜还没落画布，它在创作页的分镜方案里（方案一个不动，上面已断言）。
    expect(storyboard.cards.map((card) => card.storyboardShotNumber)).toEqual([1, 2])
    const group = model.sections.find((section) => section.kind === 'group')!
    expect(group.cards).toHaveLength(2)
  })

  it('every snapshot read path drops a retired view instead of failing to open (load, persistence normalizer)', () => {
    const canvas = fixture.payload.generationCanvas
    expect(tableSources(normalizeStoreSnapshot(canvas).nodes)).toEqual(['deconstruction'])
    // 写盘载荷不带 selectedNodeIds（会话态）；serializeWorkbenchState 吃的是内存快照，所以这条路补上它再喂。
    expect(tableSources(normalizeGenerationCanvasSnapshot({ ...canvas, selectedNodeIds: [] }).nodes)).toEqual(['deconstruction'])
    // 现行写入 schema 不再认这两种来源：读不出来 = 没有任何地方能再把它当一张表用。
    const storyboardTable = canvas.nodes.find((node) => tableSources([node])[0] === 'storyboard')!
    expect(readShotTable(storyboardTable.meta)).toBeUndefined()
  })
})
