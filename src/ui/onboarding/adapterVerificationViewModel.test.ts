import { describe, expect, it } from 'vitest'
import type { DesktopProviderAdapterRun } from '../../desktop/bridge'
import {
  adapterModelProgressState,
  adapterRunElapsedSeconds,
  adapterRunProgress,
  adapterRunTerminalReasonKey,
  isAdapterModelLocked,
  isAdapterRunTerminal,
  shouldShowAdapterModelRecovery,
} from './adapterVerificationViewModel'

const run = (stage: DesktopProviderAdapterRun['stage']): DesktopProviderAdapterRun => ({
  id: 'run-1',
  vendorKey: 'example-com',
  vendorName: 'Example',
  selectedModelKeys: ['text-v1', 'paint-v2'],
  stage,
  repairAttempt: 0,
  sourceUrls: [],
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  models: [
    {
      modelKey: 'text-v1',
      labelZh: 'Text V1',
      kind: 'text',
      modes: [{ taskKind: 'chat', state: 'verified', attempts: 1 }],
    },
    {
      modelKey: 'paint-v2',
      labelZh: 'Paint V2',
      kind: 'image',
      modes: [
        { taskKind: 'text_to_image', state: 'verified', attempts: 1 },
        { taskKind: 'image_edit', state: 'testing', attempts: 1 },
      ],
    },
  ],
})

describe('adapterRunProgress', () => {
  it('reports real completed models rather than a fabricated percentage', () => {
    expect(adapterRunProgress(run('testing'))).toEqual({ completed: 1, total: 2, verified: 1, failed: 0 })
  })

  it('treats a model with at least one pass and one failure as partially usable', () => {
    const value = run('partial')
    value.models[1].modes[1] = { taskKind: 'image_edit', state: 'failed', attempts: 3, error: 'HTTP 400' }

    expect(adapterRunProgress(value)).toEqual({ completed: 2, total: 2, verified: 2, failed: 0 })
  })
})

describe('adapterModelProgressState', () => {
  it('keeps an empty model working only while its run is active', () => {
    const emptyModel = { ...run('testing').models[1], modes: [] }

    expect(adapterModelProgressState(emptyModel, false)).toBe('working')
    expect(adapterModelProgressState(emptyModel, true)).toBe('needs_attention')
  })

  it('never leaves queued or testing modes spinning after the run is terminal', () => {
    const unfinishedModel = run('timed_out').models[1]

    expect(adapterModelProgressState(unfinishedModel, true)).toBe('partial')
    unfinishedModel.modes[0] = { taskKind: 'text_to_image', state: 'queued', attempts: 0 }
    expect(adapterModelProgressState(unfinishedModel, true)).toBe('needs_attention')
  })

  it('reports partial models without hiding their verified modes', () => {
    const partialModel = run('partial').models[1]
    partialModel.modes[1] = { taskKind: 'image_edit', state: 'failed', attempts: 2 }

    expect(adapterModelProgressState(partialModel, true)).toBe('partial')
  })
})

describe('adapterRunElapsedSeconds', () => {
  it('resumes elapsed time from the persisted stage timestamp', () => {
    const value = { ...run('compiling'), stageStartedAt: '2026-08-07T00:00:10.000Z' }

    expect(adapterRunElapsedSeconds(value, Date.parse('2026-08-07T00:00:52.800Z'))).toBe(42)
  })

  it('freezes elapsed time at the persisted terminal update', () => {
    const value = {
      ...run('timed_out'),
      stageStartedAt: '2026-08-07T00:00:10.000Z',
      updatedAt: '2026-08-07T00:00:25.900Z',
    }

    expect(adapterRunElapsedSeconds(value, Date.parse('2026-08-07T01:00:00.000Z'))).toBe(15)
  })
})

describe('isAdapterRunTerminal', () => {
  it('recognizes every terminal state', () => {
    expect(['completed', 'partial', 'failed', 'needs_ai', 'cancelled', 'timed_out', 'stale'].every(stage =>
      isAdapterRunTerminal(stage as DesktopProviderAdapterRun['stage']),
    )).toBe(true)
    expect(isAdapterRunTerminal('repairing')).toBe(false)
  })
})

describe('adapterRunTerminalReasonKey', () => {
  it('localizes operational terminal reasons instead of exposing backend English', () => {
    expect(adapterRunTerminalReasonKey('cancelled')).toBe('onboardingProviders.adapterVerification.stage.cancelled')
    expect(adapterRunTerminalReasonKey('timed_out')).toBe('onboardingProviders.adapterVerification.stage.timed_out')
    expect(adapterRunTerminalReasonKey('stale')).toBe('onboardingProviders.adapterVerification.stage.stale')
    expect(adapterRunTerminalReasonKey('failed')).toBeNull()
  })
})

describe('shouldShowAdapterModelRecovery', () => {
  it('keeps operational stop reasons at run level instead of presenting them as model failures', () => {
    expect(shouldShowAdapterModelRecovery('cancelled')).toBe(false)
    expect(shouldShowAdapterModelRecovery('timed_out')).toBe(false)
    expect(shouldShowAdapterModelRecovery('stale')).toBe(false)
  })

  it('keeps model-level recovery available for actual verification outcomes', () => {
    expect(shouldShowAdapterModelRecovery('failed')).toBe(true)
    expect(shouldShowAdapterModelRecovery('partial')).toBe(true)
    expect(shouldShowAdapterModelRecovery('needs_ai')).toBe(true)
    expect(shouldShowAdapterModelRecovery('testing')).toBe(false)
  })
})

describe('isAdapterModelLocked', () => {
  // 「在跑」只读主进程算好的 formatInProgress——渲染层拿不到任务状态原料（D-1117-delete-verification）。
  it('locks while a format task is running or a direct-call draft has no saved script', () => {
    expect(isAdapterModelLocked({ formatInProgress: true })).toBe(true)
    expect(isAdapterModelLocked({ meta: { customCallDraft: { createdAt: '2026-08-15T00:00:00.000Z' } } })).toBe(true)
    expect(isAdapterModelLocked({ formatInProgress: false, meta: {} })).toBe(false)
    expect(isAdapterModelLocked({})).toBe(false)
  })

  // 「接不进来」的最后一道墙（2026-08-11 用户接 DeepSeek 踩到）：任务没过就锁住勾选框，
  // 用户改了地址也没法自己启用，只能删掉整个供应商重来。失败不锁：开关归创作者。
  it('never locks a model because of an old task record — the renderer cannot even see one', () => {
    expect(isAdapterModelLocked({ meta: { adapter: { state: 'failed' } } })).toBe(false)
    expect(isAdapterModelLocked({ meta: { adapter: { state: 'testing' } } })).toBe(false)
  })
})
