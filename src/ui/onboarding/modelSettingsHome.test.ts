import { describe, expect, it } from 'vitest'
import type { ChipModel } from './ModelChipGroups'
import { connectionHomeStatus, countModelHomeStates, modelHomeStatus } from './modelSettingsHomeState'

// D-1117-delete-verification：设置页上一行 / 一条连接显示成什么，只转交展示投影。
// 这里钉「转交」本身：同一份 availability，行、连接、页头计数说同一句话；没有验证档位可挑。
const model = (patch: Partial<ChipModel> = {}): ChipModel => ({
  vendorKey: 'future-api',
  modelKey: 'future-video-v1',
  labelZh: 'Future Video',
  kind: 'video',
  enabled: true,
  ...patch,
})

describe('model settings home status', () => {
  it('a saved media model without a request format is 待设置, never 可使用', () => {
    expect(modelHomeStatus(model({ availability: { usable: false, reason: 'model_unpublished' } })).state).toBe('needsSetup')
    expect(modelHomeStatus(model({ customCallDraft: true })).state).toBe('needsSetup')
  })

  it('usable is 可使用 with a green dot, whatever the old verification records said', () => {
    const ready = model({ availability: { usable: true }, meta: { adapter: { state: 'failed' } } })
    expect(modelHomeStatus(ready)).toEqual({ state: 'ready', tone: 'success', labelKey: 'onboardingProviders.modelStatus.ready' })
    expect(connectionHomeStatus({ models: [ready] })).toMatchObject({ state: 'ready', count: 1 })
  })

  it('a running format task shows 配置中 only while the model cannot be used yet', () => {
    const configuring = model({ availability: { usable: false, reason: 'model_unpublished' }, formatInProgress: true })
    expect(modelHomeStatus(configuring).state).toBe('configuring')
    expect(modelHomeStatus({ ...configuring, availability: { usable: true } }).state).toBe('ready')
    expect(connectionHomeStatus({ models: [configuring] })).toMatchObject({ state: 'configuring', count: 1 })
  })

  it('a connection without a key is 待接入 without a count', () => {
    expect(connectionHomeStatus({ keyMissing: true, models: [model({ availability: { usable: true } })] }))
      .toEqual({ state: 'notConnected', tone: 'neutral', labelKey: 'onboardingProviders.modelStatus.notConnected' })
  })

  it('header counts use the same projection as each row', () => {
    const models = [
      model({ modelKey: 'a', availability: { usable: true } }),
      model({ modelKey: 'b', availability: { usable: true } }),
      model({ modelKey: 'c', availability: { usable: false, reason: 'model_unpublished' } }),
      model({ modelKey: 'd', availability: { usable: false, reason: 'model_disabled' } }),
      model({ modelKey: 'e', availability: { usable: false, reason: 'model_unpublished' }, formatInProgress: true }),
    ]
    const counts = countModelHomeStates(models)
    expect(counts).toEqual({ ready: 2, configuring: 1, needsSetup: 1, disabled: 1, notConnected: 0 })
    for (const row of models) expect(counts[modelHomeStatus(row).state]).toBeGreaterThan(0)
  })
})
