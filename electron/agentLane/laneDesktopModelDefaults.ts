import { readGenerationDefaultModelResolver } from '../capabilityCore/generationDefaultModelResolver'
import { GENERATION_DEFAULT_TASK_KINDS } from '../shared/contracts/generationModelDefaultsContract'
import type { LaneDeclaredDefaults } from './laneModelContext'

/**
 * 交给 Agent 看的「用户声明的默认模型」。
 *
 * 不在这里解释设置：「用户选的 (vendor, model) 此刻是不是真能用」由 `createGenerationDefaultModelResolver` 一处回答——
 * 宿主替 Agent 补默认（`semanticGenerationCandidate`）问的是同一个函数，所以模型被告知的默认，
 * 与宿主没点名时实际补上的默认，永远是同一个模型。
 */
export function readLaneDeclaredDefaults(): LaneDeclaredDefaults {
  const resolve = readGenerationDefaultModelResolver()
  return Object.fromEntries(GENERATION_DEFAULT_TASK_KINDS.flatMap((taskKind) => {
    const declared = resolve(taskKind)
    return declared ? [[taskKind, { vendor: declared.providerId, modelId: declared.modelId }]] : []
  }))
}
