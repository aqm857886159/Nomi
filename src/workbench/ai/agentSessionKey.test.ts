import { afterEach, describe, expect, it, vi } from 'vitest'

// readWindowUrlParam 是键工厂内部读 projectId 的唯一来源（与现状 4 处一致）。
// 用 vi.mock 控制它，锁死「有 pid」「无 pid 落 local」两条分支的字面输出。
vi.mock('../windowUrlParam', () => ({
  readWindowUrlParam: vi.fn(() => ''),
}))

import { readWindowUrlParam } from '../windowUrlParam'
import {
  sessionKeyFor,
  directionSessionKey,
  shotVerifySessionKey,
  productionScriptSessionKey,
} from './agentSessionKey'

const mockPid = (pid: string) => {
  ;(readWindowUrlParam as unknown as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
    name === 'projectId' ? pid : '',
  )
}

afterEach(() => {
  vi.clearAllMocks()
  ;(readWindowUrlParam as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => '')
})

describe('sessionKeyFor —— 收口 4 种硬编码约定，字面值逐字节锁死', () => {
  it('显式 local 不会被后来 UI URL 中的项目替换', () => {
    mockPid('later-project')
    expect(sessionKeyFor({ feature: 'workbench', area: 'creation', projectId: '' })).toBe('nomi:workbench:local:creation')
  })
  it('单次任务键：nomi:<feature>:<pid>（方向 / 校验 / 脚本三种）', () => {
    mockPid('proj-42')
    expect(directionSessionKey('proj-42')).toBe('nomi:production-directions:proj-42')
    expect(shotVerifySessionKey('proj-42')).toBe('nomi:shot-verify:proj-42')
    expect(productionScriptSessionKey('proj-42')).toBe('nomi:production-script:proj-42')
  })

  it('projectId 缺省一律落 local（打包版曾因只读 search 段全落 local，这里锁死兜底值）', () => {
    mockPid('')
    expect(directionSessionKey()).toBe('nomi:production-directions:local')
    expect(shotVerifySessionKey()).toBe('nomi:shot-verify:local')
    expect(productionScriptSessionKey()).toBe('nomi:production-script:local')
  })

  it('显式传入 projectId 覆盖 URL 读取（capabilityApplyHandler 会传入 input.projectId）', () => {
    mockPid('from-url')
    // 传入优先：脚本入口允许 caller 显式给 projectId（否则回退 URL）
    expect(productionScriptSessionKey('explicit-pid')).toBe('nomi:production-script:explicit-pid')
    expect(productionScriptSessionKey('')).toBe('nomi:production-script:local')
    expect(productionScriptSessionKey(undefined)).toBe('nomi:production-script:local')
    expect(readWindowUrlParam).not.toHaveBeenCalled()
  })

  it('底层 sessionKeyFor：area 形态与 feature 形态都按固定模板产出', () => {
    mockPid('p1')
    // feature 形态（无 area 段）
    expect(sessionKeyFor({ feature: 'shot-verify', projectId: 'p1' })).toBe('nomi:shot-verify:p1')
    // area 形态（feature=workbench，area 作末段）
    expect(sessionKeyFor({ feature: 'workbench', area: 'creation', projectId: 'p1' })).toBe('nomi:workbench:p1:creation')
    // 显式 projectId 覆盖
    expect(sessionKeyFor({ feature: 'shot-verify', projectId: 'zz' })).toBe('nomi:shot-verify:zz')
  })
})
