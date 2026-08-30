// 系统提示词「用户覆盖层」：默认值仍住 creationAiModes.ts（唯一真相源，P1 无并行副本），
// 这里只负责把用户改过的那几条盖上去。
//
// 为什么需要一个模块级缓存（而不是 React state / async getter）：
// `getCreationAiMode()` 是**同步**函数，渲染期被调用，它的结果又直接
// 喂给 `buildCreationAiPrompt()`（同文件 :313，发消息那一刻同步取值）。而覆盖值只能走异步 IPC 拿。
// 三个约束凑在一起 → 必须有个「进程内已经装好答案」的同步读取口：
//   1. 模块加载时**发一次**异步 IPC，回来后写进模块级 `overrides`（load-once，同 modelCatalogCache 的范式）；
//   2. 对外只暴露**同步** `effectiveModePrompt()`：读当前快照，没有覆盖就返回默认值；
//   3. React 侧用 `subscribeSystemPromptOverrides()` + useSyncExternalStore 订阅，快照变了就重渲。
// 首帧（IPC 还没回来）取到的是默认值——这是正确的降级：默认值本来就是「没覆盖」的答案，
// 不会出现空提示词，也不会阻塞渲染。IPC 回来后触发订阅者重渲，UI 自动换成覆盖值。

import { getDesktopBridge } from '../../desktop/bridge'
import {
  CUSTOM_PROMPT_ID_PREFIX,
  type CustomSystemPrompt,
  type SystemPromptModeId,
  type SystemPromptOverrides,
} from '../../../electron/settings/systemPromptsContract'

export type SystemPromptOverrideMap = Partial<Record<SystemPromptModeId, string>>

/**
 * 按**运行时字符串** id 读/删覆盖值的收口。
 *
 * 模式 id 在类型上是 string（自定义 id 是运行时数据，不进类型联合），而这张 map 的键是内置
 * 7 个字面量——直接下标索引 TS 会报 implicit any。收成两个口子，别在每个调用点各写一次断言，
 * 更别写 `as never` 那种「能过编译但读不出意图」的糊法。
 * 自定义 id 天然查不到（它们的正文存在 custom 条目上），返回 undefined 即是正确答案。
 */
export function readOverride(overrides: SystemPromptOverrideMap, modeId: string): string | undefined {
  return overrides[modeId as SystemPromptModeId]
}

/** 删掉一条覆盖，返回新 map（「恢复默认」= 删这一条，而不是把默认文本写回去）。 */
export function withoutOverride(
  overrides: SystemPromptOverrideMap,
  modeId: string,
): SystemPromptOverrideMap {
  const next = { ...overrides }
  delete next[modeId as SystemPromptModeId]
  return next
}

/**
 * 纯合并规则（单一判定源，被 UI / 发送路径 / 单测共用）：
 * 有覆盖且非空白 → 用覆盖；否则 → 用默认值（byte-for-byte 原样返回，不做 trim/规整，
 * 因为「恢复默认」必须精确回到默认文本）。
 */
export function resolveEffectivePrompt(
  defaultPrompt: string,
  override: string | undefined | null,
): string {
  if (typeof override !== 'string') return defaultPrompt
  if (!override.trim()) return defaultPrompt
  return override
}

/** 某个模式当前是不是「被用户自定义过」——徽标和「恢复默认」是否可点都查它。 */
export function hasPromptOverride(
  overrides: SystemPromptOverrideMap,
  modeId: string,
  defaultPrompt: string,
): boolean {
  const override = overrides[modeId as SystemPromptModeId]
  if (typeof override !== 'string' || !override.trim()) return false
  // 和默认值一模一样就不算覆盖：用户手动把文本改回默认的场景，不该继续显示「已自定义」。
  return override !== defaultPrompt
}

/**
 * 写盘前的收口：把「等于默认值」的条目剔掉。
 * 默认值住渲染进程，主进程判不了这条，所以由这里负责——否则默认提示词以后一改，
 * 老用户会被自己那份「和当时默认值相同」的副本永久钉住（并行版）。
 */
export function pruneRedundantOverrides(
  overrides: SystemPromptOverrideMap,
  defaultPromptOf: (modeId: SystemPromptModeId) => string | undefined,
): SystemPromptOverrideMap {
  const next: SystemPromptOverrideMap = {}
  for (const [modeId, prompt] of Object.entries(overrides)) {
    if (typeof prompt !== 'string' || !prompt.trim()) continue
    const fallback = defaultPromptOf(modeId as SystemPromptModeId)
    if (fallback !== undefined && prompt === fallback) continue
    next[modeId as SystemPromptModeId] = prompt
  }
  return next
}

/** 进程内快照：内置覆盖 + 自定义提示词。两者同源同步，别拆成两份缓存（会不同步）。 */
export type SystemPromptSnapshot = {
  overrides: SystemPromptOverrideMap
  custom: CustomSystemPrompt[]
}

const EMPTY_SNAPSHOT: SystemPromptSnapshot = { overrides: {}, custom: [] }

let snapshot: SystemPromptSnapshot = EMPTY_SNAPSHOT
let loadPromise: Promise<SystemPromptSnapshot> | null = null
let loaded = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** 同步读当前快照。IPC 还没回来时是空的 = 全部走内置默认值、没有自定义条目。 */
export function getSystemPromptSnapshot(): SystemPromptSnapshot {
  return snapshot
}

/** 同步读内置覆盖。IPC 还没回来时是空 map = 全部走默认值。 */
export function getSystemPromptOverrides(): SystemPromptOverrideMap {
  return snapshot.overrides
}

/** 同步读用户自建的提示词清单（顺序即用户在设置里看到的顺序）。 */
export function getCustomSystemPrompts(): CustomSystemPrompt[] {
  return snapshot.custom
}

/** 新建一条自定义提示词的稳定 id。改名不动它——用户的选择记的是 id。 */
export function newCustomPromptId(): string {
  return `${CUSTOM_PROMPT_ID_PREFIX}${globalThis.crypto.randomUUID()}`
}

export function systemPromptOverridesLoaded(): boolean {
  return loaded
}

export function subscribeSystemPromptOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function applySnapshot(next: SystemPromptSnapshot): SystemPromptSnapshot {
  snapshot = next
  loaded = true
  emit()
  return snapshot
}

/**
 * load-once：多次调用共用同一个 in-flight promise，不会打多次 IPC。
 * 非 Electron 环境（浏览器测试/预览）没有 bridge → 直接落到空 map，全部用默认值。
 */
function toSnapshot(value: SystemPromptOverrides | undefined): SystemPromptSnapshot {
  return { overrides: { ...(value?.prompts ?? {}) }, custom: [...(value?.custom ?? [])] }
}

export function loadSystemPromptOverrides(): Promise<SystemPromptSnapshot> {
  if (loaded) return Promise.resolve(snapshot)
  if (loadPromise) return loadPromise
  const bridge = getDesktopBridge()?.settings?.systemPrompts
  if (!bridge?.get) {
    return Promise.resolve(applySnapshot(EMPTY_SNAPSHOT))
  }
  loadPromise = bridge
    .get()
    .then((value: SystemPromptOverrides | undefined) => applySnapshot(toSnapshot(value)))
    .catch(() => applySnapshot(EMPTY_SNAPSHOT))
    .finally(() => {
      loadPromise = null
    })
  return loadPromise
}

/** 写盘 + 立即更新本地快照（乐观），让同步 getter 马上看到新值、不用等 IPC 回来。 */
export async function saveSystemPromptSnapshot(
  next: SystemPromptSnapshot,
): Promise<SystemPromptSnapshot> {
  applySnapshot({ overrides: { ...next.overrides }, custom: [...next.custom] })
  const bridge = getDesktopBridge()?.settings?.systemPrompts
  if (!bridge?.set) return snapshot
  try {
    const stored = await bridge.set({ schemaVersion: 2, prompts: next.overrides, custom: next.custom })
    return applySnapshot(toSnapshot(stored))
  } catch {
    return snapshot
  }
}

/**
 * 仅供单测复位模块级状态。
 *
 * 签名刻意**不用** `Partial<SystemPromptSnapshot>`：那样写的话，形状扩成
 * `{ overrides, custom }` 之前的旧调用（`reset({ story: '…' })`）仍能通过类型检查，
 * 却因为没有 `overrides` 键而静默变成「复位成空」——测试照跑，断言全绿，实际什么都没设进去。
 * 这里要求显式给出两个键中的至少一个字段名，写错的旧形状会当场编译报错而不是无声失效。
 */
export function resetSystemPromptOverridesForTest(
  next: { overrides?: SystemPromptOverrideMap; custom?: CustomSystemPrompt[] } = {},
): void {
  snapshot = { overrides: next.overrides ?? {}, custom: next.custom ?? [] }
  loaded = false
  loadPromise = null
  listeners.clear()
}
