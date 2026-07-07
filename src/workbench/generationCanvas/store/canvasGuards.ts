// 画布持久化/分类的纯守卫与小工具。从 generationCanvasStore.ts 抽出。
import type { CategoryId } from '../model/generationCanvasTypes'

export type CanvasMutationOptions = {
  persist?: boolean
  emit?: boolean
}

export function shouldPersistCanvasMutation(options?: CanvasMutationOptions): boolean {
  return options?.persist !== false
}

export function shouldEmitCanvasMutation(options?: CanvasMutationOptions): boolean {
  return options?.emit !== false
}

// 注意：这是 store 本地语义的 isCategoryId（自定义分类启用后不再限内置 5 个），
// 与 project/projectCategoryMigration.ts 的白名单版本不同，不可互换。
export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && value.trim().length > 0
}

export function bumpPersistRevision(state: { persistRevision: number }): void {
  state.persistRevision += 1
}
