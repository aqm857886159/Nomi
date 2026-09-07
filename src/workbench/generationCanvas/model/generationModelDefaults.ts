// 「新建卡片默认模型」的渲染侧快照（范式同 systemPromptOverrides.ts：load-once + 模块级缓存 + 订阅）。
//
// 为什么要模块级缓存而不是纯 React state：挑模型发生在节点刚建出来的那一刻，
// 是个**同步**判断；而偏好只能走异步 IPC 拿。所以必须有个「进程内已装好答案」的同步读取口。
//
// **`loaded` 不是可有可无的字段，它是这套东西正确性的关键。**
// 首帧 IPC 还没回来时，快照是空的——若此刻就去挑模型，会挑成「自动选择」并把结果写进节点，
// 然后偏好才姗姗来迟：用户看到的是「我明明设了默认模型，新建的卡还是别的」。
// 所以调用方必须先问 `generationModelDefaultsLoaded()`，没装好就**什么都别做**，
// 等订阅通知再挑。这与系统提示词那边「首帧降级到默认值」不同：那边降级是无害的（默认值本来就是答案），
// 这边降级会**写坏用户数据**（把错模型钉进节点 meta）。

import { getDesktopBridge } from '../../../desktop/bridge'
import {
  type GenerationDefaultTaskKind,
  type GenerationModelDefault,
  type GenerationModelDefaults,
} from '../../../../electron/settings/generationModelDefaultsContract'

export type GenerationModelDefaultMap = Partial<Record<GenerationDefaultTaskKind, GenerationModelDefault>>

// 渲染层要用这两个类型时**从这里取**，别各自去 import `electron/settings/…`：
// 那是主进程的家，渲染层直连它是 `check:boundaries` 的 `src-no-import-electron`。
// 本模块已经是渲染侧读写这份偏好的唯一入口，类型跟着它走是同一条边界。
export type { GenerationDefaultTaskKind, GenerationModelDefault }

const EMPTY: GenerationModelDefaultMap = {}

let snapshot: GenerationModelDefaultMap = EMPTY
let loadPromise: Promise<GenerationModelDefaultMap> | null = null
let loaded = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** 同步读当前快照。**用它之前先问 generationModelDefaultsLoaded()**，理由见文件头。 */
export function getGenerationModelDefaults(): GenerationModelDefaultMap {
  return snapshot
}

/**
 * 偏好是否已经从磁盘装好。
 * 没装好时挑模型 = 拿空偏好当「用户没设」，会把错模型钉进新节点。调用方必须等。
 */
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
  return { ...(value?.byTaskKind ?? {}) }
}

/**
 * load-once：多次调用共用同一个 in-flight promise，不会打多次 IPC。
 * 非 Electron 环境（浏览器测试/预览）没有 bridge → 落到空 map 并标记已装好：
 * 那里本来就没有偏好可言，一直等下去反而会让节点永远挑不出模型。
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
    const stored = await bridge.set({ schemaVersion: 1, byTaskKind: next })
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
