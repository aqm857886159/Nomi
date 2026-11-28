import type { DesktopProviderAdapterRun } from '../../desktop/bridge'

import { isTerminalAdapterRunStage } from '../../../electron/shared/contracts/providerAdapterContract'

export function isAdapterRunTerminal(stage: DesktopProviderAdapterRun['stage']): boolean {
  return isTerminalAdapterRunStage(stage)
}

export type AdapterRunTerminalReasonKey =
  | 'onboardingProviders.adapterVerification.stage.cancelled'
  | 'onboardingProviders.adapterVerification.stage.timed_out'
  | 'onboardingProviders.adapterVerification.stage.stale'

export function adapterRunTerminalReasonKey(
  stage: DesktopProviderAdapterRun['stage'],
): AdapterRunTerminalReasonKey | null {
  if (stage === 'cancelled' || stage === 'timed_out' || stage === 'stale') {
    return `onboardingProviders.adapterVerification.stage.${stage}`
  }
  return null
}

export function shouldShowAdapterModelRecovery(stage: DesktopProviderAdapterRun['stage']): boolean {
  return stage === 'failed' || stage === 'partial' || stage === 'needs_ai'
}

export type AdapterModelProgressState = 'working' | 'verified' | 'partial' | 'failed' | 'needs_attention'

export function adapterModelProgressState(
  model: DesktopProviderAdapterRun['models'][number],
  runTerminal: boolean,
): AdapterModelProgressState {
  const hasUnfinishedMode = model.modes.some(mode =>
    mode.state === 'testing' || mode.state === 'repairing' || mode.state === 'queued')
  if (hasUnfinishedMode && !runTerminal) {
    return 'working'
  }
  const passed = model.modes.filter(mode => mode.state === 'verified').length
  if (passed === model.modes.length && passed > 0) return 'verified'
  if (passed > 0) return 'partial'
  if (hasUnfinishedMode && runTerminal) return 'needs_attention'
  if (model.modes.length > 0) return 'failed'
  return runTerminal ? 'needs_attention' : 'working'
}

export function adapterRunElapsedSeconds(run: DesktopProviderAdapterRun, now = Date.now()): number {
  const startedAt = Date.parse(run.stageStartedAt || run.createdAt)
  if (!Number.isFinite(startedAt)) return 0
  const endAt = isAdapterRunTerminal(run.stage) ? Date.parse(run.updatedAt) : now
  if (!Number.isFinite(endAt)) return 0
  return Math.max(0, Math.floor((endAt - startedAt) / 1_000))
}

export function adapterRunProgress(run: DesktopProviderAdapterRun): {
  completed: number
  total: number
  verified: number
  failed: number
} {
  let completed = 0
  let verified = 0
  let failed = 0
  for (const model of run.models) {
    const terminal = model.modes.length > 0 && model.modes.every(mode => mode.state === 'verified' || mode.state === 'failed')
    if (!terminal) continue
    completed += 1
    if (model.modes.some(mode => mode.state === 'verified')) verified += 1
    else failed += 1
  }
  return {
    completed: Math.max(completed, run.completedCount ?? 0),
    total: run.totalCount ?? run.selectedModelKeys.length,
    verified,
    failed,
  }
}

/**
 * 格式任务正在跑时锁住，避免完成结果覆盖用户操作；直达脚本草稿也锁住，
 * 因为它在脚本保存前不能进入生成下拉。
 *
 * 曾经把任务失败也锁上，那是「接不进来」的最后一道墙（2026-08-11 用户接 DeepSeek 踩到）：
 * 任务没过 → 模型停用 → 勾选框还点不动 → 改了地址也不会重跑 → 只能删掉整个供应商重来。
 * 失败不锁：开关归创作者。
 *
 * 「在跑」只读主进程算好的 `formatInProgress`——渲染层拿不到任务状态原料（IPC 已剥掉 meta.adapter.state）。
 */
export function isAdapterModelLocked(model: { formatInProgress?: boolean; meta?: unknown }): boolean {
  const root = model.meta && typeof model.meta === 'object' ? model.meta as Record<string, unknown> : {}
  return model.formatInProgress === true || (root.customCallDraft !== null && typeof root.customCallDraft === 'object')
}
