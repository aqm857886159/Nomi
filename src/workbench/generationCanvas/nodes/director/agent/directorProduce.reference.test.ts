/**
 * I-3d-ref：「出成片」之后，付费请求里到底带不带预演参考、编号对不对。
 * 走真画布 store、真 stage_shot 执行体、真预演写回（applyPreviewCaptured，与常驻 Host 同一个函数）、真「出成片」准备、
 * 真请求构建（resolveGenerationReferences → buildCatalogTaskRequest，runner 在提交前走的同一条路）。
 * 不起 Electron、不花钱：请求只构建、不发送。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES, specializeArchetypeForVariant } from '../../../../../../electron/shared/modelArchetypes'
import { generationCanvasTools } from '../../../agent/generationCanvasTools'
import { applyProposalBatch } from '../../../agent/proposalTxn'
import { buildCatalogTaskRequest } from '../../../runner/catalogTaskActions'
import { resolveGenerationReferences } from '../../../runner/generationReferenceResolver'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { directorPreviewSpendBlock } from '../model/directorPreviewState'
import { normalizeDirectorProject } from '../model/directorProject'
import type { DirectorProject } from '../model/directorTypes'
import { archetypeForNode } from '../../../agent/referenceEdgeCapability'
import { applyArchetypeModeSwitch, currentArchetypeMode } from '../../controls/archetypeMeta'
import { removeFromArray, type ReferenceWriteContext } from '../../controls/referenceWrites'
import type { DirectorWriteDomainResult } from './applyDirectorWrite'
import { applyPreviewCaptured, previewCapturePlan, requestDirectorPreviewRender } from './directorPreviewCapture'
import { prepareProduceFromPreview } from './directorProduce'
import { previewAttachReconcileKey, startPreviewAttachReconciler } from './previewAttachReconciler'
import { directorWriteSemanticInputSchema } from '../../../../../../electron/shared/agentCapabilities/directorWrite'

const PLAN = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [
    { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
    { id: 'close', window: [3, 6], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in' } },
  ],
}
const URL_V1 = 'nomi-local://asset/p/preview-1.mp4'
const USER_CLIP = 'nomi-local://asset/p/user-clip.mp4'
const output = { id: 'out-1', name: 'preview-output', width: 1280, height: 720, duration: 6, createdAt: 1 }
// kie 的 seedance-2：omni 模式有参考视频槽（上限 3）；veo-3.1 没有任何参考视频槽。
const SLOT_MODEL = { modelKey: 'bytedance/seedance-2', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'seedance-2', modeId: 't2v' } }
const NO_SLOT_MODEL = { modelKey: 'google/veo-3.1', modelVendor: 'kie', vendor: 'kie', archetype: { id: 'veo-3.1', modeId: 't2v' } }

const store = () => useGenerationCanvasStore.getState()
const node = (id: string) => store().nodes.find((candidate) => candidate.id === id)
const projectOf = (id: string): DirectorProject => normalizeDirectorProject(node(id)?.meta?.[DIRECTOR_PROJECT_META_KEY])

async function stagedWith(meta: Record<string, unknown>) {
  const shot = generationCanvasTools.create_nodes([{ kind: 'video', title: '镜头 1', prompt: '书房对话', position: { x: 0, y: 0 }, meta }])[0]
  const outcome = await applyProposalBatch([{ toolCallId: 'c1', toolName: 'create_director_plan', effectiveArgs: directorWriteSemanticInputSchema.parse({ operation: 'create_director_plan', shotNodeId: shot.id, plan: PLAN }) as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error('stage failed')
  const result = outcome.results[0] as Extract<DirectorWriteDomainResult, { applied: true }>
  return { shotId: shot.id, directorNodeId: result.directorNodeId }
}

function renderPreview(directorNodeId: string, url = URL_V1): void {
  const plan = previewCapturePlan(node(directorNodeId)!)
  if (!plan) throw new Error('no capture plan')
  applyPreviewCaptured(directorNodeId, plan.revision, url, 'asset-preview', output, plan.sourceFingerprint)
}

/** runner 在提交前走的同一条路：节点 + 画布边 → 解析参考 → 构建请求。 */
function requestOf(shotId: string): { videos: unknown; prompt: string } {
  const current = node(shotId)!
  const references = resolveGenerationReferences(current, { nodes: store().nodes, edges: store().edges })
  const { request } = buildCatalogTaskRequest(current, { references })
  const archetypeInput = (request.extras?.archetypeInput ?? {}) as Record<string, unknown>
  return { videos: archetypeInput.reference_video_urls, prompt: String(request.prompt ?? '') }
}

const setShotMeta = (shotId: string, patch: Record<string, unknown>): void => {
  store().updateNode(shotId, { meta: { ...(node(shotId)?.meta ?? {}), ...patch } })
}

const removePreviewReference = (shotId: string): void => {
  const current = node(shotId)!
  const archetype = archetypeForNode(current)!
  const archMode = currentArchetypeMode(archetype, current.meta ?? {})
  const canvas = store()
  const ctx: ReferenceWriteContext = {
    node: current,
    archMode,
    getImageUrlSlots: () => [],
    latestNode: (id) => store().nodes.find((candidate) => candidate.id === id),
    updateNode: canvas.updateNode,
    getLatestMeta: () => store().nodes.find((candidate) => candidate.id === shotId)?.meta ?? {},
    updateMeta: () => {},
    storeConnectNodes: canvas.connectNodes,
    storeDisconnectEdge: canvas.disconnectEdge,
    closeSlot: () => {},
    feedback: () => {},
  }
  removeFromArray(ctx, 'referenceVideoUrls', 0)
}

beforeEach(() => {
  for (const item of [...store().nodes]) store().deleteNode(item.id)
})

describe('3D-BOX produce: 预演参考真的进付费请求，编号指向它', () => {
  it('无槽模型准备 → 换成有槽模型 → 出成片：请求里带上预演参考，提示词引用 @video1', async () => {
    const { shotId, directorNodeId } = await stagedWith(NO_SLOT_MODEL)
    renderPreview(directorNodeId)
    expect(node(shotId)?.meta?.referenceVideoUrls).toBeUndefined()
    setShotMeta(shotId, SLOT_MODEL)
    const outcome = prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    expect(outcome).toMatchObject({ kind: 'prepared', videoNodeId: shotId, attach: 'video_ref' })
    const request = requestOf(shotId)
    expect(request.videos).toEqual([URL_V1])
    expect(request.prompt).toMatch(/@video1 跟随这段参考视频的运镜/)
  })

  it('已挂好的预演参考被手动删掉 → 出成片：重新挂上，请求里有它', async () => {
    const { shotId, directorNodeId } = await stagedWith(SLOT_MODEL)
    renderPreview(directorNodeId)
    expect(requestOf(shotId).videos).toEqual([URL_V1])
    setShotMeta(shotId, { referenceVideoUrls: [] })
    expect(requestOf(shotId).videos).toBeUndefined()
    expect(prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))).toMatchObject({ kind: 'prepared', attach: 'video_ref' })
    expect(requestOf(shotId).videos).toEqual([URL_V1])
  })

  it('用户已有一个视频参考：预演排在它后面，请求里两条都在，提示词引用 @video2（不是第一个用户片）', async () => {
    const { shotId, directorNodeId } = await stagedWith({ ...SLOT_MODEL, archetype: { id: 'seedance-2', modeId: 'omni' }, referenceVideoUrls: [USER_CLIP] })
    renderPreview(directorNodeId)
    prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    const request = requestOf(shotId)
    expect(request.videos).toEqual([USER_CLIP, URL_V1])
    expect(request.prompt).toMatch(/@video2 跟随这段参考视频的运镜/)
    expect(request.prompt).not.toMatch(/@[Vv]ideo1 跟随/)
  })

  it('换成不接参考视频的模型 → 出成片：给出现有提示、预演退成文字描述，不悄悄丢掉', async () => {
    const { shotId, directorNodeId } = await stagedWith(SLOT_MODEL)
    renderPreview(directorNodeId)
    setShotMeta(shotId, NO_SLOT_MODEL)
    const outcome = prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    expect(outcome).toMatchObject({ kind: 'prepared', attach: 'prompt_only' })
    expect(outcome.kind === 'prepared' ? outcome.toast?.level : undefined).toBe('warning')
    expect(node(shotId)?.prompt).toContain('3D-BOX 预演运镜：')
  })

  it('同样的输入连点出成片：节点不变，不重复追加参考与提示词', async () => {
    const { shotId, directorNodeId } = await stagedWith({ ...SLOT_MODEL, archetype: { id: 'seedance-2', modeId: 'omni' }, referenceVideoUrls: [USER_CLIP] })
    renderPreview(directorNodeId)
    prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    const settled = JSON.stringify(node(shotId))
    for (let i = 0; i < 3; i += 1) expect(prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))).toMatchObject({ kind: 'prepared', attach: 'kept' })
    expect(JSON.stringify(node(shotId))).toBe(settled)
    expect(requestOf(shotId).videos).toEqual([USER_CLIP, URL_V1])
  })
})

it('档案变体只收窄参数，不改变参考槽形状，因此不算换模型', () => {
  for (const archetype of MODEL_ARCHETYPES) {
    const baseShape = archetype.modes.map((mode) => mode.slots)
    for (const variant of archetype.variants ?? []) {
      const specialized = specializeArchetypeForVariant(archetype, variant.id)
      expect(specialized.modes.map((mode) => mode.slots), `${archetype.id}:${variant.id}`).toEqual(baseShape)
    }
  }
})

// ── 直接点节点 ↑（不经「出成片」）：换模型 / 换方式之后预演要跟着重挂，花钱闸再核一次「挂接是当前的」 ──
describe('节点上直接点 ↑：挂接始终是当前的', () => {
  const blockOf = (shotId: string) => directorPreviewSpendBlock(shotId, store().nodes)

  it('换成有槽模型 → 挂接对账器自动重挂，请求里带预演（不用再点出成片）', async () => {
    const { shotId, directorNodeId } = await stagedWith(NO_SLOT_MODEL)
    renderPreview(directorNodeId)
    const stop = startPreviewAttachReconciler()
    try {
      setShotMeta(shotId, SLOT_MODEL)
      expect(requestOf(shotId).videos).toEqual([URL_V1])
      expect(requestOf(shotId).prompt).toMatch(/@video1 跟随这段参考视频的运镜/)
      expect(blockOf(shotId)).toBeNull()
    } finally { stop() }
  })

  it('删掉唯一预演参考 → B3 回文生，方式变化不触发对账重挂', async () => {
    const { shotId, directorNodeId } = await stagedWith({ ...SLOT_MODEL, archetype: { id: 'seedance-2', modeId: 'omni' } })
    renderPreview(directorNodeId)
    const stop = startPreviewAttachReconciler()
    try {
      removePreviewReference(shotId)
      const current = node(shotId)!
      const archetype = archetypeForNode(current)!
      const target = archetype.modes.find((mode) => mode.intent === 'text')!
      store().updateNode(shotId, { meta: applyArchetypeModeSwitch(current.meta ?? {}, archetype, target.id) })
      expect(node(shotId)?.meta?.referenceVideoUrls ?? []).toEqual([])
      expect((node(shotId)?.meta?.archetype as { modeId: string }).modeId).toBe('t2v')
      expect(node(shotId)?.meta?.cameraMoveAttachedUrl).toBe(URL_V1)
      expect(node(shotId)?.meta?.directorPreviewDismissedUrl).toBe(URL_V1)
      expect(node(shotId)?.prompt).not.toContain(`@[asset:${encodeURIComponent(URL_V1)}]`)
    } finally { stop() }
  })

  it('删掉后重渲出新 URL：退出只绑定旧 URL，花钱闸要求显式出成片', async () => {
    const { shotId, directorNodeId } = await stagedWith({ ...SLOT_MODEL, archetype: { id: 'seedance-2', modeId: 'omni' } })
    renderPreview(directorNodeId, URL_V1)
    removePreviewReference(shotId)
    requestDirectorPreviewRender(directorNodeId)
    renderPreview(directorNodeId, 'nomi-local://asset/p/preview-2.mp4')
    expect(node(shotId)?.meta?.referenceVideoUrls ?? []).toEqual([])
    expect(directorPreviewSpendBlock(shotId, store().nodes)?.reason).toBe('not_attached')
    expect(prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))).toMatchObject({ kind: 'prepared', attach: 'video_ref' })
    expect(node(shotId)?.meta?.directorPreviewDismissedUrl).toBeUndefined()
  })

  it('只换生成方式（参考 → 首尾帧 → 参考）不重挂，单份参考列表始终保留', async () => {
    const { shotId, directorNodeId } = await stagedWith({ ...SLOT_MODEL, archetype: { id: 'seedance-2', modeId: 'omni' } })
    renderPreview(directorNodeId)
    const stop = startPreviewAttachReconciler()
    try {
      const original = node(shotId)?.meta?.referenceVideoUrls
      setShotMeta(shotId, { archetype: { id: 'seedance-2', modeId: 'firstlast' } })
      expect(node(shotId)?.meta?.referenceVideoUrls).toEqual(original)
      setShotMeta(shotId, { archetype: { id: 'seedance-2', modeId: 'omni' } })
      expect(node(shotId)?.meta?.referenceVideoUrls).toEqual(original)
    } finally { stop() }
  })

  it('只换变体不算换模型：档案变体不改变参考槽形状，预演不重挂', async () => {
    const { shotId, directorNodeId } = await stagedWith({ ...SLOT_MODEL, archetype: { id: 'seedance-2', modeId: 'omni', variantId: 'standard' } })
    renderPreview(directorNodeId)
    const stop = startPreviewAttachReconciler()
    try {
      const before = node(shotId)!
      setShotMeta(shotId, { archetype: { id: 'seedance-2', modeId: 'omni', variantId: 'fast' } })
      expect(node(shotId)?.prompt).toBe(before.prompt)
      expect(node(shotId)?.meta?.referenceVideoUrls).toEqual(before.meta?.referenceVideoUrls)
      expect(node(shotId)?.meta?.cameraMoveAttachedUrl).toBe(before.meta?.cameraMoveAttachedUrl)
      expect(previewAttachReconcileKey(node(shotId)?.meta ?? {})).toBe(previewAttachReconcileKey(before.meta ?? {}))
    } finally { stop() }
  })

  it('换成不接参考视频的模型 → 自动退成文字描述，提示词里不留指向空气的引用句', async () => {
    const { shotId, directorNodeId } = await stagedWith(SLOT_MODEL)
    renderPreview(directorNodeId)
    const stop = startPreviewAttachReconciler()
    try {
      setShotMeta(shotId, NO_SLOT_MODEL)
      expect(node(shotId)?.prompt).toContain('3D-BOX 预演运镜：')
      expect(node(shotId)?.prompt).not.toContain('跟随这段参考视频的运镜')
    } finally { stop() }
  })

  it('没有对账器时（比如换模型发生在窗口关着的时候）：花钱闸发现预演没挂上 → 用新原因挡；出成片重挂后放行', async () => {
    const { shotId, directorNodeId } = await stagedWith(NO_SLOT_MODEL)
    renderPreview(directorNodeId)
    expect(blockOf(shotId)).toBeNull()
    setShotMeta(shotId, SLOT_MODEL)
    expect(blockOf(shotId)?.reason).toBe('not_attached')
    prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    expect(blockOf(shotId)).toBeNull()
  })

  it('用户手动改了提示词（参考没变）不被闸挡', async () => {
    const { shotId, directorNodeId } = await stagedWith(SLOT_MODEL)
    renderPreview(directorNodeId)
    store().updateNode(shotId, { prompt: '我自己重写的提示词' })
    expect(blockOf(shotId)).toBeNull()
  })
})
