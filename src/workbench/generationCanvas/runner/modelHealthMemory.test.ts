// 健康记忆 + 默认选择避让（2026-07-29 批量体检根治）。
// 保证整类不复发：上游挂掉的模型连败两次后必让出「自动默认」位；成功/过期自动回流；绝不空选。
import { beforeEach, describe, expect, it } from 'vitest'
import {
  isModelRecentlyAiling,
  recordModelFailure,
  recordModelSuccess,
  resetModelHealthMemory,
} from './modelHealthMemory'
import { chooseDefaultModelOption, resolveArchetypeForOption } from '../nodes/nodeModelArchetype'
import type { ModelOption } from '../../../config/models'

const HOUR = 60 * 60 * 1000

describe('modelHealthMemory', () => {
  beforeEach(() => resetModelHealthMemory())

  it('连败 1 次不避让，2 次进入避让期', () => {
    recordModelFailure('m-a')
    expect(isModelRecentlyAiling('m-a')).toBe(false)
    recordModelFailure('m-a')
    expect(isModelRecentlyAiling('m-a')).toBe(true)
  })

  it('成功清零：恢复默认资格', () => {
    recordModelFailure('m-a')
    recordModelFailure('m-a')
    recordModelSuccess('m-a')
    expect(isModelRecentlyAiling('m-a')).toBe(false)
  })

  it('24h 过期自动回流（上游修好无需手动洗白）', () => {
    const now = 1_700_000_000_000
    recordModelFailure('m-a', now)
    recordModelFailure('m-a', now)
    expect(isModelRecentlyAiling('m-a', now + HOUR)).toBe(true)
    expect(isModelRecentlyAiling('m-a', now + 25 * HOUR)).toBe(false)
  })

  it('空/非法 modelKey 全程静默跳过', () => {
    recordModelFailure('')
    recordModelFailure(undefined)
    recordModelSuccess(null)
    expect(isModelRecentlyAiling('')).toBe(false)
    expect(isModelRecentlyAiling(undefined)).toBe(false)
  })
})

describe('chooseDefaultModelOption 健康避让', () => {
  beforeEach(() => resetModelHealthMemory())

  // 真实 curated 键（apimart 文生图族）——先守卫 fixture 确实被档案系统认得，
  // 免得注册表变动后测试静默退化成「测了个寂寞」。
  const imagen: ModelOption = { value: 'imagen-4.0-apimart', label: 'Imagen 4', vendor: 'apimart', modelKey: 'imagen-4.0-apimart', meta: { archetypeId: 'imagen-4' } }
  const seedream: ModelOption = { value: 'doubao-seedream-4.5', label: 'Seedream 4.5', vendor: 'apimart', modelKey: 'doubao-seedream-4.5', meta: { archetypeId: 'seedream' } }

  it('fixture 守卫：两个候选都是「带档案」模型', () => {
    expect(resolveArchetypeForOption(imagen)).toBeTruthy()
    expect(resolveArchetypeForOption(seedream)).toBeTruthy()
  })

  it('默认位第一名连败 ≥2 → 自动让位给下一个健康模型', () => {
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('imagen-4.0-apimart')
    recordModelFailure('apimart\u0000imagen-4.0-apimart')
    recordModelFailure('apimart\u0000imagen-4.0-apimart')
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('doubao-seedream-4.5')
  })

  it('全部候选都在避让期 → 回退原序，绝不空选', () => {
    for (const key of ['imagen-4.0-apimart', 'doubao-seedream-4.5']) {
      recordModelFailure(`apimart\u0000${key}`)
      recordModelFailure(`apimart\u0000${key}`)
    }
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('imagen-4.0-apimart')
  })

  it('成功清零后重新回到默认位', () => {
    recordModelFailure('apimart\u0000imagen-4.0-apimart')
    recordModelFailure('apimart\u0000imagen-4.0-apimart')
    recordModelSuccess('apimart\u0000imagen-4.0-apimart')
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('imagen-4.0-apimart')
  })

  it('同名模型只避让失败的供应商，不污染另一家', () => {
    const relayA = { ...imagen, vendor: 'relay-a' }
    const relayB = { ...imagen, vendor: 'relay-b' }
    recordModelFailure('relay-a\u0000imagen-4.0-apimart')
    recordModelFailure('relay-a\u0000imagen-4.0-apimart')
    expect(chooseDefaultModelOption([relayA, relayB], true, false)?.vendor).toBe('relay-b')
  })
})
