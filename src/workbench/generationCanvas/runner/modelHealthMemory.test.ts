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
    recordModelFailure({ modelKey: 'm-a', vendor: null })
    expect(isModelRecentlyAiling({ modelKey: 'm-a', vendor: null })).toBe(false)
    recordModelFailure({ modelKey: 'm-a', vendor: null })
    expect(isModelRecentlyAiling({ modelKey: 'm-a', vendor: null })).toBe(true)
  })

  it('成功清零：恢复默认资格', () => {
    recordModelFailure({ modelKey: 'm-a', vendor: null })
    recordModelFailure({ modelKey: 'm-a', vendor: null })
    recordModelSuccess({ modelKey: 'm-a', vendor: null })
    expect(isModelRecentlyAiling({ modelKey: 'm-a', vendor: null })).toBe(false)
  })

  it('24h 过期自动回流（上游修好无需手动洗白）', () => {
    const now = 1_700_000_000_000
    recordModelFailure({ modelKey: 'm-a', vendor: null }, now)
    recordModelFailure({ modelKey: 'm-a', vendor: null }, now)
    expect(isModelRecentlyAiling({ modelKey: 'm-a', vendor: null }, now + HOUR)).toBe(true)
    expect(isModelRecentlyAiling({ modelKey: 'm-a', vendor: null }, now + 25 * HOUR)).toBe(false)
  })

  it('空/非法 modelKey 全程静默跳过', () => {
    recordModelFailure({ modelKey: '', vendor: null })
    recordModelFailure(undefined)
    recordModelSuccess(null)
    expect(isModelRecentlyAiling({ modelKey: '', vendor: null })).toBe(false)
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
    // 记账主体是 (vendor, modelKey)：必须用这个候选自己那家记，否则记的是另一个桶。
    const failing = { modelKey: imagen.modelKey, vendor: imagen.vendor }
    recordModelFailure(failing)
    recordModelFailure(failing)
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('doubao-seedream-4.5')
  })

  it('别家同名模型的连败不该殃及这一家（身份键含 vendor 的直接回归）', () => {
    // 2026-09-03 走查实测的那个摩擦：Kie 的 gpt-image-2 连连失败，APIMart 的同名模型跟着背锅，
    // 于是默认永远选不到能用的那家。这里用同一个 modelKey、不同 vendor 钉住「互不牵连」。
    const otherVendor = { modelKey: imagen.modelKey, vendor: 'some-other-relay' }
    recordModelFailure(otherVendor)
    recordModelFailure(otherVendor)
    expect(isModelRecentlyAiling(otherVendor)).toBe(true)
    expect(isModelRecentlyAiling({ modelKey: imagen.modelKey, vendor: imagen.vendor })).toBe(false)
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('imagen-4.0-apimart')
  })

  it('全部候选都在避让期 → 回退原序，绝不空选', () => {
    for (const key of ['imagen-4.0-apimart', 'doubao-seedream-4.5']) {
      recordModelFailure(key)
      recordModelFailure(key)
    }
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('imagen-4.0-apimart')
  })

  it('成功清零后重新回到默认位', () => {
    recordModelFailure({ modelKey: 'imagen-4.0-apimart', vendor: null })
    recordModelFailure({ modelKey: 'imagen-4.0-apimart', vendor: null })
    recordModelSuccess({ modelKey: 'imagen-4.0-apimart', vendor: null })
    expect(chooseDefaultModelOption([imagen, seedream], true, false)?.value).toBe('imagen-4.0-apimart')
  })
})
