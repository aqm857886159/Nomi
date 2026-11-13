// 铁律 ⑩「说的 = 摆的」宿主那一半：Agent 用语义字段说的意图，经宿主落到草稿、画布节点、付费卡上，必须逐项一致。
//
// 走的是真宿主链（零额度）：模型面 `draft_shots` 参数 → `verbToTransportCall`（全链唯一的有损投影）→ 宿主计划处理器
// （真内置目录种子建的模块目录 `createCatalogModuleRegistry`）→ durable Run 草稿 → 画布落地线缆 →
// 渲染层落节点那几步（`plannedInputFromCandidate` → `buildPlannedNodeMeta`，节点 meta 的唯一构造器；起草钉住的参考经
// `planReferenceProjection` 摆进节点）→ 付费卡：`listPendingSpend` 出的那一次出价，加卡读节点的那几个读口
// （`nodePointerSummaryFacts` 读比例 / 时长，`nodeSelectedModelAddress` 读模型身份）。
// D2 之后卡上没有第二份数据：卡上的每个字都从节点现读，所以「卡」这一站核的是卡的读口在它指着的那个节点上读出来的值——
// 节点上有、卡读不出来，就是卡上漏印了。
// 供应商一笔都不发：整条链停在「等用户点头」。
//
// 每一格只回答一件事：Agent 说了 X，这一站摆的是不是 X。宿主当场拒绝（把不合法的意图说回给模型）也算一致——
// 那是诚实；悄悄改值、悄悄丢掉才是违反。
import { applyBuiltinSeeds } from '../../electron/catalog/seedBuiltins'
import { agentModelEntriesFromCatalog } from '../../electron/catalog/agentModelEntriesFromCatalog'
import { createCatalogModuleRegistry } from '../../electron/capabilityCore/moduleCatalogBootstrap'
import { verbToTransportCall } from '../../electron/agentLane/laneVerbTransport'
import { PROJECT_ID, callTool, resetSpendFixture, spendWorld } from '../../electron/capabilityCore/agentPanelSpendConfirmTestUtils'
import { toCatalogModelOptions } from '../../src/config/modelOptionMappers'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../../src/workbench/generationCanvas/agent/plannedNodeMeta'
import { plannedInputFromCandidate } from '../../src/workbench/generationCanvas/agent/candidateNodeMeta'
import { nodeOwnReferenceInputs, planReferenceProjection } from '../../src/workbench/generationCanvas/model/referenceInputSlots'
import { nodeSelectedModelAddress } from '../../src/workbench/generationCanvas/nodes/controls/parameterControlModel'
import { nodePointerSummaryFacts } from '../../src/workbench/ai/pointer/nodePointerFace'
import { readAspectRatioGeometry } from '../../electron/shared/aspectRatioValue'

const SEED_NOW = '2026-10-05T00:00:00.000Z'

/** 矩阵的列：Agent 能用语义字段表达的意图（比例随 #1023 上了 draft_shots）。 */
export const INTENT_FIELDS = Object.freeze(['model', 'count', 'durationSec', 'references', 'aspectRatio'])

/**
 * 一站上的几何：比例与像素尺寸共用owner读取宽高；不把界面控件分类当作几何判据。
 * 不含宽高的清晰度/自动档（720P、auto）跳过。
 */
const ASPECT_CARRIERS = ['aspect_ratio', 'aspectRatio', 'ratio', 'size', 'image_size', 'imageSize', 'video_size', 'videoSize']
function aspectOf(parameters) {
  for (const key of ASPECT_CARRIERS) {
    const geometry = readAspectRatioGeometry(parameters?.[key])
    if (geometry !== null) return { key, value: parameters[key], ratio: geometry.width / geometry.height }
  }
  return undefined
}
const ratioLabel = (ratio) => (ratio === undefined ? undefined : `≈${ratio.toFixed(2)}`)
const sameRatio = (a, b) => Math.abs(a - b) / Math.max(a, b) <= 0.03

/** 一份种子目录、一份模块目录、一份 Agent 可见的模型清单——和生产同一组派生。 */
export function seededWorld() {
  const state = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, SEED_NOW).state
  const registry = createCatalogModuleRegistry(state)
  const entries = agentModelEntriesFromCatalog(state).map((row) => row.entry)
  const optionOf = (vendorKey, modelKey) => {
    const model = state.models.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey)
    if (!model) throw new Error(`内置目录里没有 ${vendorKey}/${modelKey}——代表模型被下线了，换一个同类的`)
    return toCatalogModelOptions([model])[0]
  }
  return { state, registry, entries, entryIndex: buildModelEntryIndex(entries), optionOf }
}

/**
 * 本项目素材库（矩阵只用得到一张：`asset-` 开头的 id 认得，其余认不得——「参考给了素材库里没有的 id」那一格靠它拒）。
 * 起草时钉身份、落地时换地址，走夹具里生产同一组解析口。
 */
const LAW_ASSETS = Object.freeze({
  list: () => [{ id: 'asset-hero', data: { url: 'nomi-local://asset/project-1/asset-hero.png', contentType: 'image/png' } }],
  identity: (_projectId, assetId) => (assetId.startsWith('asset-') ? { contentHash: `hash-${assetId}`, version: 1, kind: 'image' } : undefined),
})

/**
 * 落地线缆上的一镜 → 渲染层落下的那个节点（只走纯的那几步，不起画布仓库）：kind 照 `materializeShots` 的规则，
 * meta 由 `plannedInputFromCandidate` → `buildPlannedNodeMeta`（create_canvas_nodes 写边界里同一个构造器），
 * 参考由 `planReferenceProjection` 摆进节点（这里画布上没有别的图，参考全进节点那一份参考列表）。
 */
function landedNode(shot, entryIndex) {
  const input = plannedInputFromCandidate(shot.candidate)
  const node = {
    id: `law10-${shot.shotId}`,
    kind: shot.kind || (shot.role === 'anchor' ? 'image' : 'video'),
    title: shot.title ?? '',
    position: { x: 0, y: 0 },
    meta: (input ? buildPlannedNodeMeta(input, entryIndex) : undefined) ?? {},
  }
  const references = shot.candidate?.references ?? []
  if (references.length === 0) return node
  const placed = planReferenceProjection(node, references, [node], [])
  return placed.meta ? { ...node, meta: placed.meta } : node
}

/**
 * 跑一个用例：Agent 发一次 `draft_shots`，再 `generate` 把草稿摆上卡，逐站读下摆出来的东西。
 * 返回 { refused, said, draft, node, card } —— 每站都是同一形状：{ model, count, durationSec, references, aspectRatio }。
 */
export async function observeIntent(world, intent) {
  const spend = spendWorld({ registry: world.registry, assets: LAW_ASSETS })
  try {
    const transport = spend.transport('request')
    const shots = Array.from({ length: intent.count }, (_, index) => ({
      title: `镜 ${index + 1}`,
      prompt: `${intent.prompt} · ${index + 1}`,
      modelId: intent.modelId,
      candidate: { providerId: intent.providerId, modelId: intent.modelId },
      ...(intent.durationSec !== undefined ? { durationSec: intent.durationSec } : {}),
      ...(intent.references ? { references: intent.references } : {}),
      ...(intent.aspectRatio !== undefined ? { aspectRatio: intent.aspectRatio } : {}),
    }))
    const draftCall = verbToTransportCall({ toolCallId: 'law10-draft', toolName: 'draft_shots', args: { shots } })
    const created = await callTool(transport, draftCall.call.toolName, draftCall.call.args)
    const saidRatio = aspectOf({ aspectRatio: intent.aspectRatio })?.ratio
    const said = { model: `${intent.providerId}/${intent.modelId}`, count: intent.count, durationSec: intent.durationSec, references: intent.references?.length ?? 0, aspectRatio: saidRatio }
    if (!created?.ok) return { refused: true, refusal: JSON.stringify(created), said }
    await spend.canvasLanding.settleCanvasLanding(PROJECT_ID)
    const operation = created.result.operation
    const generateCall = verbToTransportCall({ toolCallId: 'law10-present', toolName: 'generate', args: { operationId: operation.operationId } })
    await callTool(transport, generateCall.call.toolName, generateCall.call.args)
    await spend.canvasLanding.settleCanvasLanding(PROJECT_ID)

    const draftShots = operation.shots ?? [{ candidate: operation.candidate }]
    const durationOf = (parameters) => (parameters && parameters.duration !== undefined ? Number(parameters.duration) : undefined)
    const draft = {
      model: `${draftShots[0].candidate.providerId}/${draftShots[0].candidate.modelId}`,
      count: draftShots.length,
      durationSec: durationOf(draftShots[0].candidate.parameters),
      references: draftShots[0].candidate.references?.length ?? 0,
      aspectRatio: aspectOf(draftShots[0].candidate.parameters)?.ratio,
    }

    const wire = spend.renderer.payloads.at(-1)?.shots ?? []
    const nodeByShot = new Map(wire.map((shot) => [shot.shotId, landedNode(shot, world.entryIndex)]))
    const firstNode = wire[0] ? nodeByShot.get(wire[0].shotId) : undefined
    const node = {
      model: firstNode?.meta.modelKey ? `${firstNode.meta.modelVendor}/${firstNode.meta.modelKey}` : undefined,
      count: wire.length,
      durationSec: firstNode?.meta.duration === undefined ? undefined : Number(firstNode.meta.duration),
      references: firstNode ? nodeOwnReferenceInputs(firstNode).length : undefined,
      aspectRatio: aspectOf(firstNode?.meta)?.ratio,
    }

    // 卡上那一次出价：每一镜指着哪个节点（绑定由落地回报写回），卡上的字从那个节点现读。指不到节点的那一镜卡上是中性占位，不算摆出来了。
    const card = spend.pending()
    const pointed = (card?.shots ?? []).map((shot) => {
      const bound = spend.renderer.nodeOf(shot.shotId, operation.operationId)
      return shot.nodeId && bound && shot.nodeId === bound.nodeId ? nodeByShot.get(shot.shotId) : undefined
    })
    const shownNode = pointed[0]
    const facts = shownNode ? nodePointerSummaryFacts(shownNode, '') : undefined
    const selected = shownNode ? nodeSelectedModelAddress(shownNode.meta) : undefined
    const cardView = {
      model: selected?.modelKey ? `${selected.vendorKey}/${selected.modelKey}` : undefined,
      count: pointed.filter(Boolean).length,
      durationSec: facts?.durationSec ?? undefined,
      // 卡上不摆参考（见 NOT_CARRIED_BY_DESIGN）。
      references: undefined,
      aspectRatio: aspectOf({ aspectRatio: facts?.aspect })?.ratio,
    }
    return { refused: false, said, draft, node, card: cardView,
      raw: { draft: draftShots[0].candidate, node: firstNode, card: facts } }
  } finally {
    resetSpendFixture()
  }
}

/**
 * 一格对不对：Agent 没说的字段不核（那是默认值的事，不是意图）；说了的，这一站要么摆出同一个值，
 * 要么这一站本来就不承载这个字段（`undefined` 且该站的说明里写了为什么）。
 */
export function compareStation(said, station, field) {
  if (said[field] === undefined) return { field, verdict: 'not-said' }
  if (station[field] === undefined) return { field, verdict: 'not-carried' }
  if (field === 'aspectRatio') {
    return { field, verdict: sameRatio(station[field], said[field]) ? 'equal' : 'differs', said: ratioLabel(said[field]), shown: ratioLabel(station[field]) }
  }
  return { field, verdict: station[field] === said[field] ? 'equal' : 'differs', said: said[field], shown: station[field] }
}

/** 这一站本来就不承载这个字段（不是丢，是住在别处）。只有写在这里的才不算「悄悄丢掉」。 */
export const NOT_CARRIED_BY_DESIGN = Object.freeze({
  'card.references': '付费卡不摆参考：卡只指向节点，摘要一行只读模型 · 比例 · 时长 · 清晰度（设计系统 §1.0、SpendCardQ1 板）；参考住在节点上，由节点那一站核',
})

/**
 * 一个用例的全部违反：
 *   · `differs`：某一站摆的值和 Agent 说的不一样（例如节点写 6 秒、Agent 说的是 8 秒）；
 *   · `dropped`：Agent 说了，宿主没拒绝，可某一站（除了上面登记的「本来不承载」）什么都没摆——悄悄丢了。
 * 宿主当场拒绝 = 诚实，不算违反。
 *
 * 卡上看到的 = 发出去的（铁律 ③）不在这里核：卡没有自己的那一份，读的就是节点；节点上看到的 = 节点上发出去的，
 * 由 `electron/parity/draftNodeSendParity.test.ts` 用真请求构造器逐模型、逐方式守着。
 */
export function violationsOf(observation) {
  if (observation.refused) return []
  const out = []
  for (const stationName of ['draft', 'node', 'card']) {
    for (const field of INTENT_FIELDS) {
      const cell = compareStation(observation.said, observation[stationName], field)
      if (cell.verdict === 'differs') out.push(`${stationName}.${field}:differs(${cell.said}→${cell.shown})`)
      if (cell.verdict === 'not-carried' && !NOT_CARRIED_BY_DESIGN[`${stationName}.${field}`]) out.push(`${stationName}.${field}:dropped`)
    }
  }
  return out.sort()
}
