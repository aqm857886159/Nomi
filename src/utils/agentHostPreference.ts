/**
 * 项目级常驻 Agent（Agent Dock / 常驻助手壳）的发布闸。
 *
 * **为什么要这个开关**：常驻 Agent 宿主（`ProjectAgentResidentShell`）已经在工作区里挂了 portal +
 * 折叠药丸 + 入口，但它的交互对齐 epic（#194）还没完成——在对齐前把整套 UI 摆到每个用户面前，会让
 * 大多数人看到一个半成品的常驻面板。故这是一个**产品级发布闸**：默认关闭，UI 一概不渲染；等 #194
 * 完成后开闸。
 *
 * **这是发布闸，不是逃生口（P1）**：开闸那天要**删掉这个默认关闭的歧义**——把 DEFAULT 改成 `true`
 * 或直接移除本模块、让常驻壳无条件渲染，绝不能留成一个「有时开有时关」的并行世界。
 *
 * 存储与响应式沿用本仓既有的轻量偏好模式（见 [[canvasGesturePreference]]）：模块级 pub/sub +
 * localStorage + `useSyncExternalStore`，不进 `workbenchStore`（它已贴近 R9 上限）。测试/走查在
 * 隔离 profile 里显式 `localStorage.setItem(AGENT_HOST_ENABLED_KEY, 'true')` 开启。
 */
import React from 'react'

export const AGENT_HOST_ENABLED_KEY = 'nomi.agentHost.enabled'

/**
 * 默认关闭：直到 #194 交互对齐 epic 完成后开闸。开闸即删此默认值歧义（把它改为 true 或移除本闸），
 * 不留「发布闸兼逃生口」的并行态（P1）。
 */
export const DEFAULT_AGENT_HOST_ENABLED = false

function readStoredEnabled(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(AGENT_HOST_ENABLED_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return DEFAULT_AGENT_HOST_ENABLED
  } catch {
    return DEFAULT_AGENT_HOST_ENABLED
  }
}

let currentEnabled: boolean = readStoredEnabled()
const listeners = new Set<() => void>()

export function getAgentHostEnabled(): boolean {
  return currentEnabled
}

export function setAgentHostEnabled(enabled: boolean): void {
  if (enabled === currentEnabled) return
  currentEnabled = enabled
  try {
    globalThis.localStorage?.setItem(AGENT_HOST_ENABLED_KEY, enabled ? 'true' : 'false')
  } catch {
    /* 私有模式等存不了 → 只作用本次会话 */
  }
  for (const listener of listeners) listener()
}

export function subscribeAgentHostEnabled(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 订阅式读取：设置页开关一改，常驻壳当场挂载/卸载，不用重开项目。 */
export function useAgentHostEnabled(): boolean {
  return React.useSyncExternalStore(subscribeAgentHostEnabled, getAgentHostEnabled, getAgentHostEnabled)
}

/** 仅测试用：把模块级缓存拉回落盘值，避免用例之间串状态。 */
export function __resetAgentHostEnabledForTest(): void {
  currentEnabled = readStoredEnabled()
  listeners.clear()
}
