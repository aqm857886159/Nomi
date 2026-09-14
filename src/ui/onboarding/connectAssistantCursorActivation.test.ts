import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { zhOnboardingProviders, enOnboardingProviders } from '../../i18n/locales/onboardingProviders'
import { MCP_CLIENT_REGISTRY } from '../../../electron/shared/mcpClientRegistry'
import { assistantRequiresHostApproval, resolveAssistantActivationState } from './assistantActivationState'

const dir = path.dirname(fileURLToPath(import.meta.url))
const read = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8')

// Cursor 还有宿主自己的审批门：Nomi 握手成功只证明命令可用，不能替 Cursor 批准自己。
// 这个事实住在注册表（requiresHostApproval），不许在渲染层写死 target === 'cursor'。
describe('Cursor MCP activation remains truthful', () => {
  it('reads the host-approval fact from the registry instead of a hard-coded key', () => {
    expect(MCP_CLIENT_REGISTRY.cursor.requiresHostApproval).toBe(true)
    expect(assistantRequiresHostApproval('cursor')).toBe(true)
    expect(assistantRequiresHostApproval('claude')).toBe(false)
    expect(read('assistantActivationState.ts')).not.toContain("=== 'cursor'")
  })

  it.each([null, 'checking', 'ok'] as const)(
    'keeps installed Cursor neutral and approval-aware when verification is %s',
    (verifyPhase) => {
      const state = resolveAssistantActivationState({
        target: 'cursor', installed: true, verifyPhase, trustedHosts: ['nomi', 'claude', 'codex'],
      })
      expect(state).toEqual({ broken: false, hostApprovalPending: true, trusted: false, headerStatus: 'todo' })
    },
  )

  it('reacts to Nomi trust without claiming Cursor host approval', () => {
    const trusted = resolveAssistantActivationState({
      target: 'cursor', installed: true, verifyPhase: 'ok', trustedHosts: ['nomi', 'cursor'],
    })
    expect(trusted.headerStatus).toBe('todo')
    expect(trusted.trusted).toBe(true)
    expect(trusted.hostApprovalPending).toBe(true)
    expect(zhOnboardingProviders.assistant.hostApprovalHint).toContain('可能')
    expect(enOnboardingProviders.assistant.hostApprovalHint).toContain('may')
  })

  it('keeps verified Claude Code green while a broken Cursor stays broken', () => {
    expect(resolveAssistantActivationState({
      target: 'claude', installed: true, verifyPhase: 'ok', trustedHosts: ['nomi', 'claude'],
    }).headerStatus).toBe('ok')
    const broken = resolveAssistantActivationState({
      target: 'cursor', installed: true, verifyPhase: 'broken', trustedHosts: ['nomi', 'cursor'],
    })
    expect(broken.broken).toBe(true)
    expect(broken.hostApprovalPending).toBe(false)
    expect(broken.headerStatus).toBe('todo')
  })

  it.each([null, 'checking'] as const)(
    'does not turn an unverified Claude Code configuration green when verification is %s',
    (verifyPhase) => {
      expect(resolveAssistantActivationState({
        target: 'claude', installed: true, verifyPhase, trustedHosts: ['nomi', 'claude'],
      }).headerStatus).toBe('todo')
    },
  )

  // 「连上后允许做什么」是每张客户端卡里的第二个开关，不再是设置页里独立的一栏；
  // Cursor 也不再有一条「跳去别处开权限」的旁路。
  it('keeps the trust switch inside the client card and removes the separate hosts section', () => {
    const card = read('ConnectAssistantCard.tsx')
    expect(card).toContain('data-assistant-trust-row')
    expect(card).toContain('onTrustChange(target, event.currentTarget.checked)')
    expect(card).not.toContain('cursor-host')
    expect(card).not.toContain("=== 'cursor'")
    const permissions = read('../../workbench/settings/AutomationPermissionsSection.tsx')
    expect(permissions).toContain('onTrustChange={toggleHost}')
    expect(permissions).not.toContain('settings-hosts-title')
    expect(permissions).not.toContain('cursor-host')
  })
})
