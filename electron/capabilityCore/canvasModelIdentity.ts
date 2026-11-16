// 「外部调用方给的模型身份合不合法」——画布写路径的那一道判据。
//
// 为什么单独一个文件：`canvasNodeFactory` 是零 import 的纯工厂、`canvasGraph` 是零副作用的纯图层，
// 两者都读不到目录；而 `core.ts` 贴着 800 行门岗（R9）。本文件是**纯函数**（目录清单由调用方传入），
// 既不新增一条 core ↔ 本文件的静态环，也可零依赖单测。
import { CanvasGraphError } from './canvasGraph'
import { modelHandleOf, nearestModelHandles, resolveModelIdentity } from '../shared/agentCapabilities/modelHandle'

/** 媒体节点 kind → 这个节点该挂什么 kind 的模型。其余 kind（text/shot/output…）不绑模型，不校验。 */
const MODEL_KIND_FOR_NODE_KIND: Record<string, string> = {
  image: 'image', keyframe: 'image', character: 'image', scene: 'image', panorama: 'image',
  video: 'video', clip: 'video', audio: 'audio', model3d: 'model3d',
}

/** 判据要的那几列（= `ModelListingEntry` 的子集，故调用方直接把 `listAvailableModels()` 递进来）。 */
export type ModelIdentityRow = { vendor: string; modelKey: string; kind: string }

/**
 * 外部调用方给的 `(vendor, modelKey)` 必须真的在目录里，且 kind 对得上节点。
 *
 * 判据读的就是调用方递进来的那一份清单——生产里是 `listAvailableModels()`，
 * 也就是全 App 唯一的「有哪些模型 / 能不能用」；本文件不另写一套查找，也不自己去读目录。
 * 拒绝时**不**把 100 多个模型抄进错误里（那会把回合上下文撑爆，也正是分级披露要治的事），
 * 只给最接近的那个 + 指向薄名单的那一句。
 */
export function assertCatalogModelIdentity(
  listing: readonly ModelIdentityRow[],
  identity: { vendor?: string; modelKey?: string; kind: string },
): void {
  const expectedModelKind = MODEL_KIND_FOR_NODE_KIND[identity.kind]
  if (!expectedModelKind || !identity.modelKey) return
  const modelKey = identity.modelKey
  const sameKey = listing.filter((entry) => entry.modelKey === modelKey)
  const matched = identity.vendor ? sameKey.filter((entry) => entry.vendor === identity.vendor) : sameKey
  if (matched.length === 0) {
    // 「最接近的那个」由名字主人给（大小写 / 别名 / 近似 / 最像的，与其余入口同一个阶梯），这里不另写一套折法。
    // 收下仍只认一字不差：这条路只校验、不改写调用方写下的身份。
    const closest = closestCatalogRow(listing, identity.vendor, modelKey)
    throw new CanvasGraphError(
      'unknown_model_identity',
      `目录里没有${identity.vendor ? ` ${identity.vendor} 的` : ''}模型 ${modelKey}。`
      + (closest ? `最接近的是 ${closest.vendor}/${closest.modelKey}。` : '')
      + '用 nomi_read{target:"models"} 取薄名单，再查那一个的详情。',
      {
        modelKey,
        nodeKind: identity.kind,
        expectedModelKind,
        ...(identity.vendor ? { vendor: identity.vendor } : {}),
        ...(closest ? { closest: `${closest.vendor}/${closest.modelKey}` } : {}),
      },
    )
  }
  if (!matched.some((entry) => entry.kind === expectedModelKind)) {
    throw new CanvasGraphError(
      'unknown_model_identity',
      `模型 ${modelKey} 是 ${matched[0]!.kind} 模型，挂不到 ${identity.kind} 节点上（这里要 ${expectedModelKind} 模型）。`,
      { modelKey, modelKind: matched[0]!.kind, nodeKind: identity.kind, expectedModelKind },
    )
  }
}

/** 名字主人认出的那一行；认不出就取它给的最像的第一个；同名多家拿不准时不给（错误里已指向薄名单）。 */
function closestCatalogRow(listing: readonly ModelIdentityRow[], vendor: string | undefined, modelKey: string): ModelIdentityRow | undefined {
  const rows = listing.map((entry) => ({ vendor: entry.vendor, modelId: entry.modelKey, entry }))
  const hit = resolveModelIdentity(rows, { modelId: modelKey, vendor })
  if (hit.ok) return hit.row.entry
  if (hit.reason === 'ambiguous') return undefined
  // 家写对了、只是 id 写错：先在这一家的行里问名字主人要最像的（指到别家的同名近亲，用户照抄也对不上这一家）。
  const sameVendor = vendor === undefined ? [] : rows.filter((row) => row.vendor === vendor)
  const pool = sameVendor.length > 0 ? sameVendor : rows
  const nearest = pool === rows ? hit.nearest : nearestModelHandles(pool, modelKey)
  const first = nearest[0]
  return first === undefined ? undefined : pool.find((row) => modelHandleOf(row) === first)?.entry
}
