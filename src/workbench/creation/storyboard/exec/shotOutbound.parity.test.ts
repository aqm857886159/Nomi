import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'
import type { ArchetypeMode } from '../../../../../electron/shared/modelArchetypes/types'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { applyCanvasToolCall } from '../../../generationCanvas/agent/applyCanvasToolCall'
import { storyboardPlanToCreateNodesArgs, renderShotNodePrompt, type PlanShot, type StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { compileShotOutbound } from '../../../generationCanvas/agent/storyboardPromptCompiler'
import { referenceSlotStorage } from '../../../generationCanvas/nodes/controls/archetypeMeta'
import { useWorkbenchStore } from '../../../workbenchStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { shotReferenceMetaPatch } from '../shotRow/shotReferenceSlots'
import { projectPlanShotsOntoCreatedNodes, projectStoryboardDesign } from './storyboardProjection'
import { generateShotRow, materializeShotRow, runStoryboardBatch } from './storyboardRowActions'
import type { StoryboardRowRuntime } from './storyboardRowStatus'

// 对等测试（2026-09-30，「巨龙」变人物的根因合同）：同一行，不管从哪个入口发出去，
// 提示词和参考图逐字节相同，并且就是行上写的那句 + 行上摆着的那张。
// 「入口」= 用户的哪个动作：行内生成 / 生成剩余（批量） / Agent 确认框（storyboard.present，与批量同一个函数） /
// 放到画布 / production.materialize-storyboard / 方案编辑后的投影。它们汇到的函数在下面各调一次。

vi.mock('../../../generationCanvas/agent/availableModels', () => ({
  buildAgentModelEntries: () => [],
  listAvailableModelsForAgent: async () => [],
  resolveStoryboardImageDefault: async () => ({}),
  resolveStoryboardVideoDefault: async () => ({}),
}))
vi.mock('../../../generationCanvas/runner/generationRunController', () => ({
  confirmAndRunNode: async (_nodeId: string, options: { deferredMaterialization?: { materialize: () => Promise<string> } }) => {
    await options.deferredMaterialization?.materialize()
    return 'started'
  },

  regenerateNodeInPlace: vi.fn(),
}))
vi.mock('../../../generationCanvas/components/batchPlanPreview', () => ({
  confirmAndRunPlan: async (_plan: unknown, options: { deferredMaterialization?: { materialize: () => Promise<unknown> } }) => {
    await options.deferredMaterialization?.materialize()
    return 'started'
  },
}))

const archetype = resolveArchetypeForModel({ modelKey: 'MiniMax-H3', vendorKey: 'apimart' })!
const mode: ArchetypeMode = archetype.modes.find((candidate) => candidate.slots.some((slot) => slot.kind === 'image_ref'))
  ?? archetype.modes.find((candidate) => candidate.slots.length > 0)!
const slot = mode.slots.find((candidate) => candidate.kind === 'image_ref') ?? mode.slots[0]
const metaKey = referenceSlotStorage(slot)!.metaKey
const ROW_REF = 'nomi-local://asset/p/assets/row-ref.png'
const DRAGON = '一条巨龙盘在山顶'

const shot: PlanShot = {
  index: 1, shotId: 'dragon', shotKind: 'video', durationSec: 5,
  prompt: DRAGON, modelKey: 'MiniMax-H3', modelVendor: 'apimart', modeId: mode.id,
  // 引用着一张带身份特征的角色定妆卡 + 一个文本风格锚——过去这两样会被追加进提示词、并把定妆卡连成参考图。
  anchorIds: ['hero', 'mood'],
  referenceBindings: { [slot.kind]: [{ url: ROW_REF, name: '行上的参考' }] },
}
const plan: StoryboardPlan = {
  title: '巨龙',
  anchors: [
    { id: 'hero', kind: 'character', carrier: 'visual', name: '林薇', description: '短发，风衣', staticFeatures: '黑色齐肩短发、瓜子脸的年轻女子', referenceUrl: 'nomi-local://asset/p/assets/hero.png', referenceKind: 'image' },
    { id: 'mood', kind: 'style', carrier: 'text', name: '全片风格', description: '赛博霓虹，冷蓝洋红' },
  ],
  shots: [shot],
}
const ctx = { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan }
const row: StoryboardRowRuntime = { shot, mode, exec: {} as never }

/** 这一镜在画布上此刻的样子：提示词、参考槽 meta、进来的边。 */
function shotNodeState() {
  const { nodes, edges } = useGenerationCanvasStore.getState()
  const node = nodes.find((candidate) => candidate.meta?.shotId === 'dragon' || candidate.meta?.productionShotId === undefined && candidate.title?.includes('1'))
    ?? nodes.find((candidate) => candidate.kind === 'video')
  if (!node) throw new Error('这一镜没有落成节点')
  return {
    prompt: node.prompt,
    reference: (node.meta as Record<string, unknown>)[metaKey],
    incomingEdges: edges.filter((edge) => edge.target === node.id).length,
    anchorCards: nodes.filter((candidate) => candidate.meta?.anchorId).length,
  }
}

beforeEach(() => {
  useWorkbenchStore.getState().hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: '故事', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], 'doc')
  useWorkbenchStore.getState().hydrateStoryboardDesigns({ doc: [{ id: 'design', documentId: 'doc', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})

const expectedReference = (): unknown => shotReferenceMetaPatch(mode, compileShotOutbound(shot, 'shot').referenceBindings)[metaKey]
const confirmSpend = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm')

beforeEach(() => {
  confirmSpend.mockReset().mockImplementation(async (request) => {
    const anchor = request.planRows?.find((item) => item.id === 'anchor:hero')
    if (anchor) request.onPlanToggle?.(anchor, false)
    return true
  })
})

describe('一镜发出去的只有行上的提示词和行上看得见的参考图（唯一出口 compileShotOutbound）', () => {
  it('出口本身：提示词逐字等于行上写的，参考图只有行上摆着的；anchorIds 不参与', () => {
    const outbound = compileShotOutbound(shot, 'shot')
    expect(outbound.prompt).toBe(DRAGON)
    expect(outbound.referenceBindings).toEqual({ [slot.kind]: [{ url: ROW_REF, name: '行上的参考' }] })
    expect(compileShotOutbound({ ...shot, referenceBindings: undefined }, 'shot').referenceBindings).toEqual({})
    expect(compileShotOutbound({ ...shot, anchorIds: [] }, 'shot')).toEqual(outbound)
  })

  const entrances: ReadonlyArray<readonly [string, () => Promise<void> | void]> = [
    ['行内生成（generateShotRow）', async () => { await generateShotRow(ctx, shot, mode) }],
    ['生成剩余 / 批量（runStoryboardBatch）', async () => { await runStoryboardBatch(ctx, [row]) }],
    ['Agent 确认框（storyboard.present 走的也是 runStoryboardBatch，带落地事务）', async () => { await runStoryboardBatch(ctx, [row], { groupTitle: '巨龙' }) }],
    ['放到画布（runStoryboardBatch 只摆位）', async () => { await runStoryboardBatch(ctx, [row], { groupTitle: '巨龙', placementOnly: true }) }],
    ['production.materialize-storyboard（整方案落画布 + 按当前模式投影）', async () => {
      const args = storyboardPlanToCreateNodesArgs(plan)
      const applied = await applyCanvasToolCall('create_canvas_nodes', args) as { clientIdToNodeId?: Record<string, string> }
      projectPlanShotsOntoCreatedNodes(plan, (clientId) => applied.clientIdToNodeId?.[clientId] ?? clientId, useGenerationCanvasStore.getState())
    }],
    ['方案编辑后的投影（projectStoryboardDesign）', async () => {
      await materializeShotRow(ctx, { ...shot, prompt: '旧的一句' }, mode)
      projectStoryboardDesign({ id: 'design', plan }, useGenerationCanvasStore.getState())
    }],
  ]

  for (const [name, run] of entrances) {
    it(`${name}：提示词逐字 = 行上写的，参考图 = 行上摆着的，不连任何边、不建锚卡`, async () => {
      await run()
      const state = shotNodeState()
      expect(state.prompt).toBe(DRAGON)
      expect(state.reference).toEqual(expectedReference())
      expect(JSON.stringify(state.reference)).toContain(ROW_REF)
      expect(JSON.stringify(state.reference)).not.toContain('hero.png')
      expect(state.incomingEdges).toBe(0)
      // 放到画布会把方案里的定妆卡作为参考卡摆出来（它们是项目素材，用户自己去连）；行的生成入口则一张都不建。
      if (!name.startsWith('放到画布') && !name.startsWith('production') && !name.startsWith('Agent')) expect(state.anchorCards).toBe(0)
    })
  }

  it('所有入口逐字节相同：同一行从六个入口出去的 {提示词, 参考图} 序列化后完全一致', async () => {
    const seen: string[] = []
    for (const [, run] of entrances) {
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
      await run()
      const { prompt, reference } = shotNodeState()
      seen.push(JSON.stringify({ prompt, reference }))
    }
    expect(new Set(seen).size).toBe(1)
    expect(seen[0]).toBe(JSON.stringify({ prompt: DRAGON, reference: expectedReference() }))
  })

  it('renderShotNodePrompt（节点覆写对账用）读的也是同一个出口', () => {
    expect(renderShotNodePrompt(plan, shot)).toBe(compileShotOutbound(shot, 'shot').prompt)
  })

  it('取消新的确认等待不会派发，确认入口仍使用同一份行级出站内容', async () => {
    confirmSpend.mockResolvedValue(false)
    await expect(runStoryboardBatch(ctx, [row])).resolves.toBe('declined')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  })
})
