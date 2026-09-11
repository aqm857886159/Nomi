import type { GenerationNodeExecutionKind } from './registry'

export const GENERATION_VARIANT_COUNTS = [1, 2, 3, 4] as const

export type GenerationVariantCount = (typeof GENERATION_VARIANT_COUNTS)[number]

export function parseGenerationVariantCount(value: string): GenerationVariantCount {
  const parsed = Number(value)
  return GENERATION_VARIANT_COUNTS.find((count) => count === parsed) ?? 1
}

/**
 * 这个节点支不支持「一次生成几个」。
 *
 * 判据从**执行类**派生，不点名 kind：连发的执行侧 `confirmAndRunNodeVariants`
 * 本来就没有任何媒体分支（只是循环调 `runGenerationNode`），能不能连发只取决于
 * 「产物会不会堆进节点的版本历史」——媒体产物会，文本不会（文本节点是原地覆写，
 * 连发四次只剩最后一次，×4 会是个骗人的按钮）。
 *
 * 所以图对图、视频对视频、音频对音频、3D 对 3D 用的是同一个通用件（P4 通用第一）；
 * 以后新增执行类默认拿到 ×N，不需要回来改调用点（2026-09-10 反馈 #11）。
 */
export function supportsGenerationVariants(executionKind: GenerationNodeExecutionKind | undefined): boolean {
  return executionKind !== undefined && executionKind !== 'text'
}
