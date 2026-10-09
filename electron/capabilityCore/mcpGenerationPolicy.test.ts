import { describe, expect, it, vi } from 'vitest'

import { MCP_GENERATION_CAPABILITIES, classifyMcpGenerationRoute } from './mcpGenerationPolicy'
import { deriveProjectSessionScopes } from './projectSessionAuthority'

/**
 * 2026-09-21：这份测试此前钉的是「默认关、三段式 rollout、feature_disabled」。那三样东西连同
 * 两个 env flag 一起删了——用户拍板「这版要开」，而一个没有界面能关的 flag 不是开关，是一道
 * 只会把自家在 tools/list 上广告着的工具打回去的墙。现在钉的是删完之后必须仍然成立的两件事。
 */
describe('MCP generation route classification', () => {
  it('六条 legacy 生成路仍然是墓碑，语义路不被误判', () => {
    for (const route of ['generate', 'nomi_generate', 'production.start', 'production.control', 'production.decide-gate', 'nomi_start_playbook']) {
      expect(classifyMcpGenerationRoute(route)).toEqual({ kind: 'legacy', route })
    }
    expect(classifyMcpGenerationRoute('nomi_operation_create')).toEqual({ kind: 'semantic' })
    expect(classifyMcpGenerationRoute('nomi_read')).toEqual({ kind: 'semantic' })
  })

  it('没有任何环境变量能把这个面关掉（阳性对照：曾经的两个 flag）', async () => {
    const before = process.env.NOMI_MCP_GENERATION_SINGLE_SHOT_V1
    vi.stubEnv("NOMI_MCP_GENERATION_SINGLE_SHOT_V1", '0')
    try {
      // 租约照发：scope 的多少不再由任何 env 决定。
      const scopes = deriveProjectSessionScopes()
      expect(scopes).toContain('generation:read')
      expect(scopes).toContain('generation:gate')
    } finally {
      if (before === undefined) vi.stubEnv("NOMI_MCP_GENERATION_SINGLE_SHOT_V1", undefined)
      else vi.stubEnv("NOMI_MCP_GENERATION_SINGLE_SHOT_V1", before)
    }
  })

  it('提交（start）仍然不在租约发的 scope 里——那是花钱边界，要的是人证不是租约', () => {
    const scopes = deriveProjectSessionScopes()
    expect(scopes).not.toContain('generation:submit')
    expect(MCP_GENERATION_CAPABILITIES).toContain('start')
  })
})
