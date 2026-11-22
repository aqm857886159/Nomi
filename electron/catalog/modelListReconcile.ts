import type { Model } from './types'
import type { ModelListResult } from '../ai/onboarding/modelListResponse'
import { isJsonRecord } from '../jsonUtils'

/**
 * 供应商的模型清单是**旁注**，不是用户的决定。
 *
 * 这条边界只写 `unlisted` 一个字段。它曾经同时写 `enabled`（`enabled: unlisted ? false : model.enabled`），
 * 于是一个每天跑一次的后台任务（当时 vendorHealth 的 24h setInterval，现为 catalogReconciliation）可以在没有任何通知的情况下，
 * 把用户昨天还能选的文本模型改成停用——对中转站/自建网关来说「/models 里暂时没有这个 id」是常态。
 * 用户镜头：模型过一夜从下拉里消失，他没做过任何事，也没人告诉他发生了什么。
 *
 * 2026-09-21 用户拍板：**缺口是我们的，不能让用户扛、不能静默**。查不到 → 只标 `unlisted`，
 * 界面在模型旁如实显示「供应商清单里暂时没有它」，停不停用由用户自己决定。
 *
 * 原设计（docs/fixes/2026-09-08-catalog-liveness.root-cause.json，「自动禁用，保留配置」）想防的是
 * 「用户选了一个供应商已经不提供的模型，按下去必然失败」。那件事由 `unlisted` 旁注继续防着——
 * 它是**告诉**用户，而不是**替**用户做决定；两者的区别正是这次要修的东西。
 */
export function modelListReconciliation(
  models: readonly Model[],
  vendorKey: string,
  result: ModelListResult,
): Array<Pick<Model, 'vendorKey' | 'modelKey' | 'unlisted'>> {
  // 失败 / 不完整 / 304 都不是「它不在了」的证据。
  if (!result.ok || result.partial || result.notModified) return []
  // 一份成功但**空**的清单同样不是证据：鉴权降级、网关抖动、上游改了分页形状，
  // 都会让 /models 回一个 200 + 空数组。拿它去标全家不在了，是把一次抖动写成状态。
  if (result.models.length === 0) return []
  const listed = new Set(result.models)
  return models.flatMap((model) => {
    if (model.vendorKey !== vendorKey || model.kind !== 'text') return []
    if (!isJsonRecord(model.meta) || typeof model.meta.catalogLifecycle !== 'string') return []
    const unlisted = !listed.has(model.modelAlias || model.modelKey)
    if (Boolean(model.unlisted) === unlisted) return []
    return [{ vendorKey, modelKey: model.modelKey, unlisted }]
  })
}
