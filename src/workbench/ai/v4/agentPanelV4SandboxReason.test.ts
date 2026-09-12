import { describe, expect, it } from 'vitest'
import { enAgentPanelV4, zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'
import { V4_SANDBOX_INACTIVE_REASON_KEY, v4SandboxNoticeText } from './agentPanelV4SandboxReason'
import type { LaneSandboxInactiveCode } from '../../../../electron/shared/agentLane/laneContracts'

/**
 * 真词条当字典：写一个假 `t` 只能证明「代码调了 t」，证不了那两个 key 真的存在
 * （少一条词条时，i18next 会原样回显 key——界面上是一串 `agentPanelV4.xxx`，不是报错）。
 */
function translator(dictionary: Record<string, string>) {
  return (key: string, options?: Record<string, unknown>): string => {
    const leaf = key.replace(/^agentPanelV4\./, '')
    const value = dictionary[leaf]
    if (value === undefined) throw new Error(`缺词条：${key}`)
    return value.replace(/\{\{(\w+)\}\}/g, (_all, name: string) => String(options?.[name] ?? ''))
  }
}

const CODES: readonly LaneSandboxInactiveCode[] = ['unsupported-platform', 'init-failed']

describe('命令沙箱没起来时那一行微字', () => {
  it('两种原因各自有一句人话，且都不是同一句', () => {
    const t = translator(zhAgentPanelV4 as unknown as Record<string, string>)
    const rendered = CODES.map((code) => v4SandboxNoticeText(code, t))
    expect(rendered).toEqual(['命令需逐条确认：这台设备没有系统级命令沙箱', '命令需逐条确认：命令沙箱这次没能启动'])
    expect(new Set(rendered).size).toBe(CODES.length)
  })

  it('英文同样两句齐活——缺一条时 i18next 会把 key 原样印上屏，不会报错', () => {
    const t = translator(enAgentPanelV4 as unknown as Record<string, string>)
    for (const code of CODES) {
      const text = v4SandboxNoticeText(code, t)
      expect(text).not.toContain('agentPanelV4.')
      expect(text).not.toContain('{{')
    }
  })

  it('原因码表覆盖契约里的每一个码——上游加第三种时这里先红，界面不会印空串', () => {
    expect(Object.keys(V4_SANDBOX_INACTIVE_REASON_KEY).sort()).toEqual([...CODES].sort())
  })

  it('用户看到的是原因码选出的那句话，永远不是上游那串英文诊断正文', () => {
    const t = translator(zhAgentPanelV4 as unknown as Record<string, string>)
    expect(v4SandboxNoticeText('init-failed', t)).not.toMatch(/[A-Za-z]{4,}/)
  })
})
