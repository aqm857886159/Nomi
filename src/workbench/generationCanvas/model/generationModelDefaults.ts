// 「新建节点默认用哪个模型」的渲染侧快照（load-once + 模块级缓存 + 订阅）。
//
// 2026-11-27 AutoModel 板（SG-1 / SG-2 / SG-3）：
// - 收成 `image` / `video` 两项偏好（`schemaVersion: 2`）；缺席 = 「自动 · 实际模型名」。
// - 同提交删除旧「跟上次一样」本地记忆（`lastGenerationChoice` / `rememberGenerationChoice`）：
//   新卡默认写「自动 · 实际模型名」，不再跟随上一张卡的手选模型变化。
// - **`loaded` 仍是关键守卫**：首帧 IPC 尚未返回前不抢挑模型，避免把已设固定默认的用户新卡错写成自动模型。

import { getDesktopBridge } from '../../../desktop/bridge'
import {
  mediaKindForTaskKind,
  type GenerationDefaultMediaKind,
  type GenerationDefaultTaskKind,
  type GenerationModelDefault,
  type GenerationModelDefaults,
} from '../../../../electron/shared/contracts/generationModelDefaultsContract'

export type GenerationModelDefaultMap = Partial<Record<GenerationDefaultMediaKind, GenerationModelDefault>>

// 渲染层统一从本模块取类型与映射函数，避免直连主进程 settings 目录触发边界门岗。
export { mediaKindForTaskKind }
export type { GenerationDefaultMediaKind, GenerationDefaultTaskKind, GenerationModelDefault }

const EMPTY: GenerationModelDefaultMap = {}

let snapshot: GenerationModelDefaultMap = EMPTY
let loadPromise: Promise<GenerationModelDefaultMap> | null = null
let loaded = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** 同步读当前快照。**用它之前先问 generationModelDefaultsLoaded()**。 */
export function getGenerationModelDefaults(): GenerationModelDefaultMap {
  return snapshot
}

/** 偏好是否已经从磁盘装好。没装好时调用方必须等待订阅通知再落默认模型。 */
export function generationModelDefaultsLoaded(): boolean {
  return loaded
}

export function subscribeGenerationModelDefaults(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function applySnapshot(next: GenerationModelDefaultMap): GenerationModelDefaultMap {
  snapshot = next
  loaded = true
  emit()
  return snapshot
}

function toMap(value: GenerationModelDefaults | undefined): GenerationModelDefaultMap {
  return { ...(value?.byKind ?? {}) }
}

/**
 * load-once：多次调用共用同一个 in-flight promise，不会打多次 IPC。
 * 非 Electron 环境（浏览器测试/预览）没有 bridge → 落到空 map 并标记已装好。
 */
export function loadGenerationModelDefaults(): Promise<GenerationModelDefaultMap> {
  if (loaded) return Promise.resolve(snapshot)
  if (loadPromise) return loadPromise
  const bridge = getDesktopBridge()?.settings?.generationModelDefaults
  if (!bridge?.get) return Promise.resolve(applySnapshot(EMPTY))
  loadPromise = bridge
    .get()
    .then((value: GenerationModelDefaults | undefined) => applySnapshot(toMap(value)))
    .catch(() => applySnapshot(EMPTY))
    .finally(() => {
      loadPromise = null
    })
  return loadPromise
}

/** 写盘 + 立即更新本地快照（乐观），让同步 getter 马上看到新值、不用等 IPC 回来。 */
export async function saveGenerationModelDefaults(
  next: GenerationModelDefaultMap,
): Promise<GenerationModelDefaultMap> {
  applySnapshot({ ...next })
  const bridge = getDesktopBridge()?.settings?.generationModelDefaults
  if (!bridge?.set) return snapshot
  try {
    const stored = await bridge.set({ schemaVersion: 2, byKind: next })
    return applySnapshot(toMap(stored))
  } catch {
    return snapshot
  }
}

/** 仅供单测复位模块级状态。 */
export function resetGenerationModelDefaultsForTest(
  next: { defaults?: GenerationModelDefaultMap; loaded?: boolean } = {},
): void {
  snapshot = next.defaults ?? {}
  loaded = next.loaded ?? false
  loadPromise = null
  listeners.clear()
}
