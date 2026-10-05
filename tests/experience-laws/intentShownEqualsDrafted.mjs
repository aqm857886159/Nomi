// 铁律 ⑩「说的 = 摆的」宿主那一半：Agent 用语义字段说的意图，经宿主落到草稿、画布节点、付费卡上，必须逐项一致。
//
// 走的是真宿主链（零额度）：模型面 `draft_shots` 参数 → `verbToTransportCall`（全链唯一的有损投影）→ 宿主计划处理器
// （真内置目录种子建的模块目录 `createCatalogModuleRegistry`）→ durable Run 草稿 → 画布落地线缆 →
// 渲染层 `buildPlannedNodeMeta`（节点 meta 的唯一构造器）→ 付费卡投影 `listPendingSpend` →
// 卡体那张生成框（`projectSpendNode` + `resolveRenderedControls`）上用户读到的值。
// 供应商只有本机 loopback，且整条链停在「等用户点头」，一笔都不发。
//
// 每一格只回答一件事：Agent 说了 X，这一站摆的是不是 X。宿主当场拒绝（把不合法的意图说回给模型）也算一致——
// 那是诚实；悄悄改值、悄悄丢掉才是违反。
import { applyBuiltinSeeds } from '../../electron/catalog/seedBuiltins'
import { agentModelEntriesFromCatalog } from '../../electron/catalog/agentModelEntriesFromCatalog'
import { createCatalogModuleRegistry } from '../../electron/capabilityCore/moduleCatalogBootstrap'
import { verbToTransportCall } from '../../electron/agentLane/laneVerbTransport'
import {
  PROJECT_ID, buildActions, callTool, harness, resetSpendFixture, startLoopbackVendor,
} from '../../electron/capabilityCore/agentPanelSpendConfirmTestUtils'
import { toCatalogModelOptions } from '../../src/config/modelOptionMappers'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../../src/workbench/generationCanvas/agent/plannedNodeMeta'
import { projectSpendNode } from '../../src/workbench/ai/v4/spendCardDraft'
import { resolveRenderedControls } from '../../src/workbench/generationCanvas/nodes/nodeModelArchetype'

const SEED_NOW = '2026-10-05T00:00:00.000Z'

/** 矩阵的列：Agent 能用语义字段表达的意图。`aspectRatio` 等 #1023（比例上 draft_shots）合入后接上。 */
export const INTENT_FIELDS = Object.freeze(['model', 'count', 'durationSec', 'references', 'aspectRatio'])
export const PENDING_FIELDS = Object.freeze({ aspectRatio: 'draft_shots 还没有比例字段（#1023 未合入）；接口留在 INTENT_FIELDS，合入后补列' })

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

/** 卡体那张生成框上「时长」这一格用户读到的值（控件当前值 = meta 上的值，没有就是档案默认）。 */
function displayedValue(controls, meta, key) {
  const control = controls.find((candidate) => candidate.key === key)
  if (!control) return { shown: false }
  const value = meta[key] ?? control.defaultValue
  return { shown: true, value: value === undefined ? undefined : Number.isFinite(Number(value)) ? Number(value) : value }
}

/**
 * 跑一个用例：Agent 发一次 `draft_shots`，再 `generate` 把草稿摆上卡，逐站读下摆出来的东西。
 * 返回 { refused, said, draft, node, card } —— 每站都是同一形状：{ model, count, durationSec, references }。
 */
export async function observeIntent(world, intent) {
  const vendor = await startLoopbackVendor()
  const base = harness()
  const submits = []
  try {
    const built = buildActions(base, vendor.origin, submits, {
      registry: world.registry,
      providerIds: [...new Set(world.state.models.map((model) => model.vendorKey))],
      unpriced: true,
      resolveAssetReferenceIdentity: (_projectId, assetId) => (assetId.startsWith('asset-') ? { contentHash: `hash-${assetId}`, version: 1, kind: 'image' } : undefined),
    })
    const transport = built.transport('step')
    const shots = Array.from({ length: intent.count }, (_, index) => ({
      title: `镜 ${index + 1}`,
      prompt: `${intent.prompt} · ${index + 1}`,
      modelId: intent.modelId,
      candidate: { providerId: intent.providerId, modelId: intent.modelId },
      ...(intent.durationSec !== undefined ? { durationSec: intent.durationSec } : {}),
      ...(intent.references ? { references: intent.references } : {}),
    }))
    const draftCall = verbToTransportCall({ toolCallId: 'law10-draft', toolName: 'draft_shots', args: { shots } })
    const created = await callTool(transport, draftCall.call.toolName, draftCall.call.args)
    const said = { model: `${intent.providerId}/${intent.modelId}`, count: intent.count, durationSec: intent.durationSec, references: intent.references?.length ?? 0 }
    if (!created?.ok) return { refused: true, refusal: JSON.stringify(created?.error ?? created).slice(0, 300), said }
    await base.canvasLanding.settleCanvasLanding(PROJECT_ID)
    const operation = created.result.operation
    const generateCall = verbToTransportCall({ toolCallId: 'law10-present', toolName: 'generate', args: { operationId: operation.operationId } })
    await callTool(transport, generateCall.call.toolName, generateCall.call.args)
    await base.canvasLanding.settleCanvasLanding(PROJECT_ID)

    const draftShots = operation.shots ?? [{ candidate: operation.candidate }]
    const durationOf = (parameters) => (parameters && parameters.duration !== undefined ? Number(parameters.duration) : undefined)
    const draft = {
      model: `${draftShots[0].candidate.providerId}/${draftShots[0].candidate.modelId}`,
      count: draftShots.length,
      durationSec: durationOf(draftShots[0].candidate.parameters),
      references: draftShots[0].candidate.references?.length ?? 0,
    }

    const wire = base.renderer.payloads.at(-1)?.shots ?? []
    const nodeMetas = wire.map((shot) => buildPlannedNodeMeta({
      modelKey: shot.candidate?.modelKey, vendor: shot.candidate?.vendor, modeId: shot.candidate?.modeId, params: shot.candidate?.parameters,
    }, world.entryIndex) ?? {})
    const node = {
      model: nodeMetas[0] ? `${nodeMetas[0].modelVendor}/${nodeMetas[0].modelKey}` : undefined,
      count: wire.length,
      durationSec: nodeMetas[0]?.duration === undefined ? undefined : Number(nodeMetas[0].duration),
      // 参考在画布上是节点的边，不在线缆的 meta 里——这一站只核数量能不能对上（线缆不带就记 undefined）。
      references: undefined,
    }

    const card = built.withWindow.listPendingSpend(PROJECT_ID)[0]
    const cardShot = card?.shots[0]
    const option = cardShot ? world.optionOf(cardShot.providerId, cardShot.modelId) : undefined
    const cardNode = cardShot ? projectSpendNode(cardShot, undefined, option) : undefined
    const controls = cardNode ? resolveRenderedControls(option, cardNode.meta ?? {}, cardNode.kind === 'image', cardNode.kind === 'video') : []
    const shownDuration = cardNode ? displayedValue(controls, cardNode.meta ?? {}, 'duration') : { shown: false }
    const cardView = {
      model: cardShot ? `${cardShot.providerId}/${cardShot.modelId}` : undefined,
      count: card?.shots.length ?? 0,
      durationSec: shownDuration.shown ? shownDuration.value : undefined,
      references: cardShot?.references?.length ?? 0,
      sentDurationSec: durationOf(cardShot?.parameters),
    }
    return { refused: false, said, draft, node, card: cardView }
  } finally {
    await vendor.close()
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
  return { field, verdict: station[field] === said[field] ? 'equal' : 'differs', said: said[field], shown: station[field] }
}

/** 这一站本来就不承载这个字段（不是丢，是住在别处）。只有写在这里的才不算「悄悄丢掉」。 */
export const NOT_CARRIED_BY_DESIGN = Object.freeze({
  'node.references': '画布上参考是连到节点的边，不在落地线缆的 meta 里；参考数量由草稿与付费卡两站核',
})

/**
 * 一个用例的全部违反：
 *   · `differs`：某一站摆的值和 Agent 说的不一样（例如节点写 6 秒、卡和请求写 8 秒）；
 *   · `dropped`：Agent 说了，宿主没拒绝，可某一站（除了上面登记的「本来不承载」）什么都没摆——悄悄丢了。
 * 宿主当场拒绝 = 诚实，不算违反。
 */
export function violationsOf(observation) {
  if (observation.refused) return []
  const out = []
  for (const stationName of ['draft', 'node', 'card']) {
    for (const field of ['model', 'count', 'durationSec', 'references']) {
      const cell = compareStation(observation.said, observation[stationName], field)
      if (cell.verdict === 'differs') out.push(`${stationName}.${field}:differs(${cell.said}→${cell.shown})`)
      if (cell.verdict === 'not-carried' && !NOT_CARRIED_BY_DESIGN[`${stationName}.${field}`]) out.push(`${stationName}.${field}:dropped`)
    }
  }
  // 卡上「看到的」和「发出去的」也得一致（铁律 ③ 在这一站的投影，⑩ 顺手核一遍，不改 ③ 的判据）。
  if (observation.card.sentDurationSec !== observation.card.durationSec) out.push(`card.durationSec:shown≠sent(${observation.card.durationSec}/${observation.card.sentDurationSec})`)
  return out.sort()
}
