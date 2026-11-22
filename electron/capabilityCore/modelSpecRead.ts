// 对外/对内模型面的**分级披露**读侧：薄名单一档、单模型详情一档。
//
// 住在自己的文件里而不是 core.ts：core 贴着 800 行门岗（R9），而这两支本身是一个完整单元
// ——它们是「模型说明书」这份知识的唯一出口，两个模型面都从这里取。
import { readCatalog } from '../catalog/catalogStore'
import type { CatalogState } from '../catalog/types'
import { setCatalogRowLookup } from './modelAdmissionSchema'
import { currentCatalogFingerprint } from './modelOnboarding/dispatch'
import { agentModelEntriesFromCatalog } from '../catalog/agentModelEntriesFromCatalog'
import { resolveModelHandle, resolveModelIdentity } from "../shared/agentCapabilities/modelHandle"
import {
  modelSpecDetail,
  modelSpecRow,
  type ModelAvailabilityFacts,
  type ModelSpecDetail,
  type ModelSpecRow,
} from '../shared/agentCapabilities/modelSpecProjection'

/**
 * 对外模型面的**薄名单**：每行只留选型需要的最少字段。与应用内 Agent 的薄名单
 * 是同一个 `modelSpecRow` 投影，不是第二份（用户拍板：MCP 不能重造一套，而是复用）。
 */
export function listModelSpecRows(): ModelSpecRow[] {
  return agentModelEntriesFromCatalog(readCatalog()).map((row) => modelSpecRow(row.entry, "mcp", row.availability))
}

/**
 * 取详情，取不到就**带出路地拒**——与准入层那族同一条纪律：
 * 事实进 `details`（语言中立，两个面给的出路一致），人话由码表按 locale 出。
 *
 * 两种拒绝，不许合成一种：`ambiguous_model_vendor`（没点名哪一家、而它有好几家）
 * 与 `unknown_model_identity`（点名的那家没有它 / 压根没这个模型）。
 * 第一种以前会**悄悄返回第一家**。
 *
 * 认名字问名字主人（`resolveModelIdentity`，与起草同一个阶梯：大小写 / 别名 / 近似写法；说了 vendor 就只在那一家认）。
 * 读详情没有「这一种任务」，所以多家同名一律当歧义，不看默认。两种拒绝的码与 `details` 键逐字不变；
 * `vendorsForModelId` 是「只按 id 认」时对得上的那几家（主人给的行），不是这里另比一次 id。
 *
 * @param state 缺省读真实目录；测试喂同一份种子状态，接线逐字相同。
 */
export function requireModelSpecDetail(modelId: string, vendor: unknown, state: CatalogState = readCatalog()): ModelSpecDetail {
  const rows = agentModelEntriesFromCatalog(state)
  const named = typeof vendor === 'string' ? vendor : undefined
  const entries = rows.map((row) => row.entry)
  const found = resolveModelIdentity(entries, { modelId, vendor: named ?? null })
  if (found.ok) {
    return modelSpecDetail(found.row, "mcp", rows.find((row) => row.entry === found.row)!.availability)
  }
  const byId = found.reason === 'ambiguous' ? found : resolveModelHandle(entries, modelId)
  const vendors = [...new Set((byId.ok ? [byId.row] : byId.reason === 'ambiguous' ? byId.rows : [])
    .map((entry) => entry.vendor).filter((v): v is string => Boolean(v)))]
  const vendorsForModelId = vendors.join(',') || '(none)'
  if (found.reason === 'ambiguous') {
    throw Object.assign(new Error(`Ambiguous model: ${modelId} is carried by ${vendors.length} providers`), {
      code: 'ambiguous_model_vendor',
      details: { modelKey: modelId, vendorsForModelId },
    })
  }
  throw Object.assign(new Error(`Unknown model: ${modelId}`), {
    code: 'unknown_model_identity',
    details: { modelKey: modelId, vendorsForModelId, ...(named ? { vendor: named } : {}) },
  })
}

/**
 * 把「按 (providerId, modelId) 取目录行」接给准入层的档案解析。
 * 在**装配期**调一次；`modelAdmissionSchema` 自己是纯函数、不读盘。
 */
export function installCatalogRowLookup(): void {
  setCatalogRowLookup((providerId, modelId) => {
    const model = readCatalog().models.find((row) => row.vendorKey === providerId && row.modelKey === modelId)
    return model ? { modelAlias: model.modelAlias ?? null, meta: model.meta } : undefined
  })
}

/**
 * 一个模型此刻的可用性三件。给应用内那一面用——它的清单由渲染层推上来、不带这三样。
 * 由 `laneDesktopRuntime`（已持有目录的装配层）注入给 lane，**lane 自己不 import 目录**。
 * 读的就是对外面同一份目录，故两面这三样同源。
 */
export function catalogAvailabilityFor(vendor: string | null, modelId: string, state: CatalogState = readCatalog()): ModelAvailabilityFacts | undefined {
  const match = agentModelEntriesFromCatalog(state)
    .find((row) => row.entry.modelId === modelId && (vendor === null || row.entry.vendor === vendor))
  return match?.availability
}

/**
 * `models.list` / `models.read` 的路由那一半。放这里而不是 dispatcher：
 * 两档分级是同一份知识的两个出口，出口逻辑跟着知识走（dispatcher 也贴着 800 行门岗）。
 */
export function dispatchModelSpec(method: string, params: Record<string, unknown>): unknown {
  if (method === 'models.read') {
    const modelId = typeof params.modelId === 'string' ? params.modelId.trim() : ''
    if (!modelId) {
      throw Object.assign(new Error('target=model requires modelId'), {
        code: 'unknown_model_identity',
        details: { at: 'modelId' },
      })
    }
    return requireModelSpecDetail(modelId, params.vendor)
  }
  // `fingerprint` 与 `nomi_remove_provider` 的 `ifUnchanged` 同一个函数算，不许两份。
  return { models: listModelSpecRows(), fingerprint: currentCatalogFingerprint() }
}
