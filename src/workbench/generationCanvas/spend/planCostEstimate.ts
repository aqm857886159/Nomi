// 执行计划的「本波预估额度」（F15 确认条 F11：确认前先让用户看到大概花多少）。
//
// 语义铁律：**未知 ≠ 0**。目录里有价目 → 按**唯一那条算式**算（基价 + 命中的规格加价，
// `electron/shared/contracts/shotPricingRule.ts`）；只要**任一节点的模型解不出价目** →
// 整批标「价格未知」，绝不把解不出的当 0 悄悄少报（少报比不报更坏——用户以为便宜）。
//
// 2026-09-11：这里此前只累加基价，规格加价（如 720p / 10s 的加钱档）一分都不进这个数，
// 于是同一批镜头，确认条上印的数比主进程真正要扣的少。算式收进契约层后两边共用一份——
// 付费确认卡的本地重算走的也是它（`workbench/ai/v4/spendCardEstimate.ts`）。
//
// 纯函数：喂节点 + 该 kind 的模型选项，不碰 store，可裸测。

import { deriveShotPrice } from '../../../../electron/shared/contracts/shotPricingRule'
import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../adapters/modelOptionsAdapter'
import { nodeSelectedModelAddress } from '../nodes/controls/parameterControlModel'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export type PlanCostEstimate =
  | { known: true; credits: number }
  | { known: false; credits: number; unresolved: number }

/**
 * 累加一批节点的模型额度。
 * @param nodes 计划内节点（waves 拍平后取到的节点对象；缺失节点计入 unresolved）
 * @param optionsByKind 取模型选项的函数（按节点 kind 拿对应模型列表；渲染层传 useGenerationModelOptionsState 的结果）
 */
export function estimatePlanCost(
  nodes: readonly (GenerationCanvasNode | undefined)[],
  resolveOption: (node: GenerationCanvasNode) => ModelOption | undefined,
): PlanCostEstimate {
  let credits = 0
  let unresolved = 0
  for (const node of nodes) {
    if (!node) {
      unresolved += 1
      continue
    }
    const option = resolveOption(node)
    if (!option) {
      unresolved += 1
      continue
    }
    // 参数喂节点 meta：档案把选中的参数值就写在 meta 顶层，而规格加价的 specKey 认的正是
    // 「某个参数选了某个值」（裸值或 `paramKey:value`）。算式忽略非标量，不会被 meta 里
    // 那些结构化字段（参考槽 / 档案快照）误伤。
    const price = deriveShotPrice({
      candidate: {
        providerId: option.vendor ?? '',
        modelId: option.modelKey ?? option.value,
        parameters: (node.meta ?? {}) as Record<string, unknown>,
      },
      resolvePricing: () => option.pricing,
    })
    if (!price.known) {
      unresolved += 1
      continue
    }
    credits += price.amount
  }
  return unresolved > 0 ? { known: false, credits, unresolved } : { known: true, credits }
}

/** 便利入口：从模型选项表按节点 meta 解析模型选项（供渲染层直接喂 estimatePlanCost 的 resolveOption）。 */
export function optionForNode(
  node: GenerationCanvasNode,
  optionsForKind: readonly ModelOption[],
): ModelOption | undefined {
  const address = nodeSelectedModelAddress(node.meta || {})
  return findModelOptionByIdentifier(optionsForKind, address.modelKey, address.vendorKey) ?? undefined
}
