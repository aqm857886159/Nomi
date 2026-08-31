import { afterEach, describe, expect, it, vi } from 'vitest'

// readWindowUrlParam 是键工厂内部读 projectId 的唯一来源（与现状 4 处一致）。
// 用 vi.mock 控制它，锁死「有 pid」「无 pid 落 local」两条分支的字面输出。
vi.mock('../windowUrlParam', () => ({
  readWindowUrlParam: vi.fn(() => ''),
}))

import { readWindowUrlParam } from '../windowUrlParam'
import {
  sessionKeyFor,
  workbenchSessionKey,
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
  it('workbench area 键：nomi:workbench:<pid>:<area>（历史起按 area 隔离）', () => {
    mockPid('proj-42')
    expect(workbenchSessionKey('creation')).toBe('nomi:workbench:proj-42:creation')
    expect(workbenchSessionKey('generation')).toBe('nomi:workbench:proj-42:generation')
  })

  it('单次任务键：nomi:<feature>:<pid>（方向 / 校验 / 脚本三种）', () => {
    mockPid('proj-42')
    expect(directionSessionKey()).toBe('nomi:production-directions:proj-42')
    expect(shotVerifySessionKey()).toBe('nomi:shot-verify:proj-42')
    expect(productionScriptSessionKey()).toBe('nomi:production-script:proj-42')
  })

  it('projectId 缺省一律落 local（打包版曾因只读 search 段全落 local，这里锁死兜底值）', () => {
    mockPid('')
    expect(workbenchSessionKey('creation')).toBe('nomi:workbench:local:creation')
    expect(workbenchSessionKey('generation')).toBe('nomi:workbench:local:generation')
    expect(directionSessionKey()).toBe('nomi:production-directions:local')
    expect(shotVerifySessionKey()).toBe('nomi:shot-verify:local')
    expect(productionScriptSessionKey()).toBe('nomi:production-script:local')
  })

  it('显式传入 projectId 覆盖 URL 读取（capabilityApplyHandler 会传入 input.projectId）', () => {
    mockPid('from-url')
    // 传入优先：脚本入口允许 caller 显式给 projectId（否则回退 URL）
    expect(productionScriptSessionKey('explicit-pid')).toBe('nomi:production-script:explicit-pid')
    // 传入空串/undefined → 回退 URL
    expect(productionScriptSessionKey('')).toBe('nomi:production-script:from-url')
    expect(productionScriptSessionKey(undefined)).toBe('nomi:production-script:from-url')
  })

  it('底层 sessionKeyFor：area 形态与 feature 形态都按固定模板产出', () => {
    mockPid('p1')
    // feature 形态（无 area 段）
    expect(sessionKeyFor({ feature: 'shot-verify' })).toBe('nomi:shot-verify:p1')
    // area 形态（feature=workbench，area 作末段）
    expect(sessionKeyFor({ feature: 'workbench', area: 'creation' })).toBe('nomi:workbench:p1:creation')
    // 显式 projectId 覆盖
    expect(sessionKeyFor({ feature: 'shot-verify', projectId: 'zz' })).toBe('nomi:shot-verify:zz')
  })
})
