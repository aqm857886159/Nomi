/**
 * 按画布节点记模型健康 —— `generationRunController` 结算时用的薄封装。
 *
 * 从 controller 里搬出来：那个文件是**运行编排**，不该顺带承载「模型身份怎么从 node.meta 里读」
 * 这条取数规则（R9；它已顶到 800 行硬上限）。记账主体的定义与 [[modelHealthMemory]] 同住一处。
 */
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { recordModelFailure, recordModelSuccess, type ModelHealthIdentity } from './modelHealthMemory'

/**
 * 读节点当前绑定的**模型身份**（meta 无 modelKey 的异常路径返回空身份 = 记账时静默跳过）。
 *
 * 身份是 (vendor, modelKey) 而不是 modelKey：同名模型来自不同供应商，各家死活互不相干，
 * 记成一笔就等于「Kie 连败 → APIMart 也被判病」，换家机制随之失效（2026-09-03 复验实测）。
 * `modelVendor` 优先于 `vendor`：前者是模型身份里那一半，后者在部分旧节点上是别的语义。
 */
export function nodeModelIdentity(nodeId: string): ModelHealthIdentity {
  const meta = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)?.meta as
    | Record<string, unknown>
    | undefined
  return { modelKey: meta?.modelKey, vendor: meta?.modelVendor ?? meta?.vendor }
}

/** 这一跑成了：清零该 (vendor, model) 的连败计数。 */
export function recordNodeModelSuccess(nodeId: string): void {
  recordModelSuccess(nodeModelIdentity(nodeId))
}

/** 这一跑败了：给该 (vendor, model) 记一笔连败（可找回超时不算，调用方已过滤）。 */
export function recordNodeModelFailure(nodeId: string): void {
  recordModelFailure(nodeModelIdentity(nodeId))
}
