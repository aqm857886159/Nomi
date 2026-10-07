// 「这一次生成带哪些参考图」只有一个主人：卡上看到的 = 发出去的 = 画布节点上摆着的。
//
// 矩阵（入口清单 ENTRIES）：入口（画布连线 / 画布节点「首帧」那一格 / 卡上 @ 本项目画布上的图 / 卡上 @ 别的项目的图）
//      × 结果（卡上摆出来、点生成时发给宿主并被宿主钉住、回写画布节点的规划把它摆进占位节点）。
// 每一格走的都是生产代码那一份：卡体 = `projectSpendNode` ⊕ 账本（`useAgentPanelSpendConfirm.shownNodeFor` 的同一个算法），
// 卡上 @ = `createMentionSelect`（卡的写入面没有连线权能），点生成 = `candidatePatchFromNode` → `revisionsForConfirm`
// → 宿主 `resolveSpendReferenceInputs`，回写规划 = `planReferenceProjection`（纯函数；接进落地链等画布写边界重构「方案 A」，
// 在那之前卡上生成后画布节点的参考槽仍是空的——这一列证的是规划本身对，不是落地已接线）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { DesktopAssetDto } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import type { NodeWriteAccess } from '../../generationCanvas/nodes/nodeWriteAccess'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { MentionSuggestionItem } from '../../assets/AssetMentionSuggestionList'
import type { GenerationReference } from '../../../../electron/shared/agentCapabilities/generationPlanSchemas'
import {
  applyPatchToNode, candidatePatchFromNode, draftAfterNodeEdit, effectivePatchForShot, EMPTY_SPEND_DRAFT, keptReferenceUrls,
  projectSpendNode, revisionsForConfirm, type SpendDraft,
} from './spendCardDraft'
import { referenceInputsFromNode } from './spendCardReferences'
import { createMentionSearch, createMentionSelect, type MentionLibraryAsset } from '../../generationCanvas/nodes/useNodeMentionSource'
import { materializeAssetLibraryItems } from '../../assets/assetLibraryMaterialize'
import { referenceSlotStorage } from '../../generationCanvas/nodes/controls/archetypeMeta'
import { resolveReferenceSlots } from '../../generationCanvas/runner/referenceSlots'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { materializeShots } from '../../capability/multiShotCanvasLanding'
import { resetClientIdRegistry } from '../../generationCanvas/agent/applyCanvasToolCall'
import { planReferenceProjection } from '../../generationCanvas/model/referenceInputSlots'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { resolveSpendReferenceInputs, type SpendReferenceAssets } from '../../../../electron/capabilityCore/pendingSpendReferences'

const PROJECT = 'project-a'
const OTHER = 'project-b'
const CANVAS_IMAGE = `nomi-local://asset/${PROJECT}/assets/canvas-cat.png`
const PROJECT_IMAGE = `nomi-local://asset/${PROJECT}/assets/library-dog.png`
const OTHER_IMAGE = `nomi-local://asset/${OTHER}/assets/other-fox.png`
const COPIED_IMAGE = `nomi-local://asset/${PROJECT}/assets/other-fox-copy.png`
const OPERATION = 'canvas-landing:run-refs'
const binding = { projectId: PROJECT, immutableProjectUuid: 'uuid-a', projectGeneration: 1 }

/** 本项目素材库（宿主钉参考图的唯一身份来源）：别的项目的那张不在里面——它要先被复制进来。 */
const indexed = [CANVAS_IMAGE, PROJECT_IMAGE, COPIED_IMAGE].map((url, index) => ({ id: `asset-${index}`, data: { url, contentType: 'image/png' } }))
const projectAssets: SpendReferenceAssets = {
  list: () => indexed,
  identity: (_projectId, assetId) => ({ contentHash: `hash-${assetId}`, version: 1 }),
  import: async () => undefined,
}
const urlOfReference = (_projectId: string, reference: GenerationReference): string | undefined =>
  indexed.find((asset) => asset.id === reference.assetId)?.data.url

type Entry = Readonly<{
  name: string
  url: string
  shot: Omit<PendingSpendShot, 'shotId' | 'nodeId' | 'index'>
  /** 在画布上摆好这一格（占位节点已经落在画布上，id = placedId）。 */
  arrange?: (placedId: string, sourceId: string) => void
  /** 在卡上做的那一下（卡上 @ 一张图）。 */
  onCard?: (card: CardSession, sourceId: string) => Promise<void>
}>

const imageShot = { prompt: '同一只猫，黄昏', providerId: 'apimart', modelId: 'gpt-image-2', kind: 'image', parameters: {}, price: { known: false } } as const
const videoShot = { prompt: '猫转过头', providerId: 'apimart', modelId: 'kling-3.0-turbo', kind: 'video', parameters: {}, price: { known: false } } as const

/** 卡上那一镜的一次编辑（`useAgentPanelSpendConfirm` 的写入面：改动只进账本，不写画布）。 */
type CardSession = Readonly<{ access: NodeWriteAccess; shown: () => GenerationCanvasNode; search: () => MentionSuggestionItem[]; select: (item: MentionSuggestionItem, library?: readonly MentionLibraryAsset[]) => ReturnType<ReturnType<typeof createMentionSelect>> }>

function openCard(shot: PendingSpendShot): CardSession {
  let draft: SpendDraft = EMPTY_SPEND_DRAFT
  const graph = () => ({ nodes: useGenerationCanvasStore.getState().nodes, edges: useGenerationCanvasStore.getState().edges })
  const placed = () => graph().nodes.find((node) => node.id === shot.nodeId)
  const baseline = () => projectSpendNode(shot, placed(), undefined, graph())!
  const shown = () => {
    const patch = effectivePatchForShot(draft, shot.shotId)
    return applyPatchToNode(projectSpendNode(shot, placed(), undefined, graph(), keptReferenceUrls(patch))!, patch)
  }
  let editing = shown()
  const access: NodeWriteAccess = Object.freeze({
    canWrite: () => true,
    updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>) => {
      if (nodeId !== editing.id) return
      editing = { ...editing, ...patch }
      draft = draftAfterNodeEdit(draft, shot, editing, undefined, baseline())
    },
    latestNode: (nodeId: string) => (nodeId === editing.id ? editing : undefined),
  })
  const project = { binding } as unknown as ProjectExecutionContext
  const copy = async (input: { sourceProjectId: string; targetProjectId: string; relativePath: string }): Promise<DesktopAssetDto> => {
    expect(input).toEqual({ sourceProjectId: OTHER, targetProjectId: PROJECT, relativePath: 'assets/other-fox.png' })
    return { id: 'copied', name: 'other-fox-copy.png', projectId: PROJECT, data: { url: COPIED_IMAGE, relativePath: 'assets/other-fox-copy.png', contentType: 'image/png' } } as unknown as DesktopAssetDto
  }
  return {
    access,
    shown,
    search: () => createMentionSearch({ node: editing, access, libraryAssets: [], t: ((key: string) => key) as never })(''),
    select: (item, library = []) => createMentionSelect({
      nodeId: editing.id, access, libraryAssets: library, reportFeedback: () => undefined, t: ((key: string) => key) as never,
      issueProject: () => project,
      materialize: (items, issued) => materializeAssetLibraryItems(items, issued, copy),
    })(item),
  }
}

const ENTRIES: readonly Entry[] = [
  {
    name: '画布连线（参考图连到占位节点）',
    url: CANVAS_IMAGE,
    shot: imageShot,
    arrange: (placedId, sourceId) => useGenerationCanvasStore.getState().connectNodes(sourceId, placedId, 'reference'),
  },
  {
    name: '画布连线进「首帧」那一格',
    url: CANVAS_IMAGE,
    shot: videoShot,
    arrange: (placedId, sourceId) => useGenerationCanvasStore.getState().connectNodes(sourceId, placedId, 'first_frame'),
  },
  {
    name: '画布节点「首帧」那一格选了一张本项目素材（没有连线）',
    url: PROJECT_IMAGE,
    shot: videoShot,
    arrange: (placedId) => {
      const store = useGenerationCanvasStore.getState()
      const placed = store.nodes.find((node) => node.id === placedId)!
      const metaKey = referenceSlotStorage({ kind: 'first_frame' })!.metaKey
      const archetype = (placed.meta as { archetype: Record<string, unknown> }).archetype
      store.updateNode(placedId, { meta: { ...placed.meta, archetype: { ...archetype, modeId: 'i2v' }, [metaKey]: PROJECT_IMAGE } })
    },
  },
  {
    name: '卡上 @ 本项目画布上已有的图',
    url: CANVAS_IMAGE,
    shot: imageShot,
    onCard: async (card, sourceId) => {
      const listed = card.search()
      expect(listed.map((item) => item.key), '卡上 @ 列得出画布上的图（不再弹「没有可引用的素材」）').toContain(`canvas:${sourceId}`)
      expect(await card.select(listed.find((item) => item.key === `canvas:${sourceId}`)!)).toBe(1)
    },
  },
  {
    name: '卡上 @ 别的项目的图（先复制进本项目）',
    url: COPIED_IMAGE,
    shot: imageShot,
    onCard: async (card) => {
      const library: MentionLibraryAsset[] = [{ id: `${OTHER}:assets/other-fox.png`, name: 'other-fox.png', url: OTHER_IMAGE, kind: 'image', origin: { source: 'project', projectId: OTHER, relativePath: 'assets/other-fox.png' } }]
      const placed = await card.select({ key: `library:${OTHER}:assets/other-fox.png`, url: OTHER_IMAGE, label: 'other-fox.png', group: 'library' }, library)
      expect(placed, '插的 chip 指向复制品，不是别的项目的原文件').toEqual({ url: COPIED_IMAGE, index: 1 })
    },
  },
]

let landing: ProjectSessionTestHarness
beforeEach(async () => {
  resetClientIdRegistry()
  landing = createProjectSessionTestHarness()
  await landing.open(PROJECT)
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
})
afterEach(() => landing.dispose())

describe('付费卡参考图一个主人：入口 × （卡上 / 发出去 / 回写规划）', () => {
  it.each(ENTRIES)('$name', async (entry) => {
    // ── 画布：一张已出图的节点 + 这一镜的占位节点（落地链建的那一个）──
    const store = useGenerationCanvasStore.getState()
    const source = store.addNode({ kind: 'image', title: '猫', prompt: '', position: { x: 0, y: 0 } })
    store.updateNode(source.id, { status: 'success', result: { id: 'r-cat', type: 'image', url: CANVAS_IMAGE, createdAt: 1 } })
    const shotId = 'shot-1'
    const first = await materializeShots({ projectId: PROJECT, materializationOperationId: OPERATION, runId: 'run-refs', shots: [{ shotId, kind: entry.shot.kind, prompt: entry.shot.prompt, candidate: { candidateId: shotId, revision: 1 } }] })
    const placedId = first.bindings[0]!.nodeId
    const shot: PendingSpendShot = { ...entry.shot, shotId, nodeId: placedId, index: 1 }
    // 占位节点的模型身份 = 这一镜的候选（落地链按候选写进去的那一份）。
    const asCard = projectSpendNode(shot)!
    store.updateNode(placedId, { meta: { ...useGenerationCanvasStore.getState().nodes.find((node) => node.id === placedId)!.meta, ...asCard.meta } })
    entry.arrange?.(placedId, source.id)

    // ── 卡：默认那张框 + 卡上的动作 ──
    const card = openCard(shot)
    await entry.onCard?.(card, source.id)
    const shown = card.shown()
    expect(referenceInputsFromNode(shown, shot).map((input) => input.url), '① 卡上摆着它').toContain(entry.url)

    // ── 点生成：卡上那一份发给宿主，宿主在本项目素材库里把它钉住 ──
    const patch = candidatePatchFromNode(shown, shot)
    const revision = revisionsForConfirm([shot], { perShot: patch ? { [shotId]: patch } : {} })[0]
    expect(revision?.patch.referenceInputs?.map((input) => input.url), '② 发给宿主的那一份里有它').toContain(entry.url)
    const pinned = await resolveSpendReferenceInputs({ projectId: PROJECT, binding, values: revision!.patch.referenceInputs, existing: [], assets: projectAssets, assertCurrent: () => undefined })
    expect(pinned.map((reference) => urlOfReference(PROJECT, reference)), '② 宿主钉住的就是它（供应商收到的那一份）').toContain(entry.url)

    // ── 回写规划：宿主钉住的那几条 → 占位节点要补什么（画布上的图补真边，其余补进槽）；照规划在画布 store 上真做一遍 ──
    const store2 = useGenerationCanvasStore.getState()
    const before = store2.nodes.find((node) => node.id === placedId)!
    const references = pinned.map((reference) => ({ url: urlOfReference(PROJECT, reference)!, kind: reference.kind ?? 'image' as const, ...(reference.role ? { role: reference.role } : {}) }))
    const plan = planReferenceProjection(before, references, store2.nodes, store2.edges)
    if (plan.meta) store2.updateNode(placedId, { meta: plan.meta })
    for (const edge of plan.connect) useGenerationCanvasStore.getState().connectNodes(edge.sourceNodeId, placedId, edge.mode)
    const after = useGenerationCanvasStore.getState()
    const placed = after.nodes.find((node) => node.id === placedId)!
    const onCanvas = resolveReferenceSlots(placed, after.nodes, after.edges).flatMap((slot) => slot.fills.map((fill) => fill.url))
    expect(onCanvas, '③ 照回写规划补完，画布节点的参考槽里有它（接线待方案 A）').toContain(entry.url)
  })
})
