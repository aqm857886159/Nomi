import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { zhOnboardingProviders, enOnboardingProviders } from '../../i18n/locales/onboardingProviders'
import { resolveAssistantActivationState } from './assistantActivationState'

const dir = path.dirname(fileURLToPath(import.meta.url))
const read = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8')

describe('Cursor MCP activation remains truthful', () => {
  it.each([null, 'checking', 'ok'] as const)(
    'keeps installed Cursor neutral and approval-aware when verification is %s',
    (verifyPhase) => {
      const state = resolveAssistantActivationState({
        target: 'cursor', installed: true, verifyPhase, trustedHosts: ['nomi', 'claude', 'codex'],
      })
      expect(state).toEqual({
        broken: false,
        cursorConfiguration: true,
        cursorTrusted: false,
        headerStatus: 'todo',
        showCursorPermissionAction: true,
      })
    },
  )

  it('reacts to Nomi trust without claiming Cursor host approval', () => {
    const trusted = resolveAssistantActivationState({
      target: 'cursor', installed: true, verifyPhase: 'ok', trustedHosts: ['nomi', 'cursor'],
    })
    expect(trusted.headerStatus).toBe('todo')
    expect(trusted.cursorTrusted).toBe(true)
    expect(trusted.showCursorPermissionAction).toBe(false)
    expect(zhOnboardingProviders.assistant.cursorHostPermissionUnknown).toContain('可能')
    expect(enOnboardingProviders.assistant.cursorHostPermissionUnknown).toContain('May')
  })

  it('keeps verified Claude Code green while a broken Cursor stays broken', () => {
    expect(resolveAssistantActivationState({
      target: 'claude', installed: true, verifyPhase: 'ok', trustedHosts: ['nomi', 'claude'],
    }).headerStatus).toBe('ok')
    const broken = resolveAssistantActivationState({
      target: 'cursor', installed: true, verifyPhase: 'broken', trustedHosts: ['nomi', 'cursor'],
    })
    expect(broken.broken).toBe(true)
    expect(broken.cursorConfiguration).toBe(false)
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

  it('targets the Cursor permission row instead of silently self-approving', () => {
    const card = read('ConnectAssistantCard.tsx')
    const permissions = fs.readFileSync(
      path.resolve(dir, '../../workbench/settings/AutomationPermissionsSection.tsx'),
      'utf8',
    )
    expect(card).toContain("tab: 'automation', section: 'cursor-host'")
    expect(card).toContain("remove(CURSOR_CONNECTED_TOAST_ID)")
    expect(permissions).toContain("section={host.key === 'cursor' ? 'cursor-host' : undefined}")
    expect(card).not.toContain('mcp-approvals.json')
  })

  it('keeps the compact bilingual card title short enough to remain primary information', () => {
    expect(zhOnboardingProviders.assistant.name).toBe('AI 助手')
    expect(enOnboardingProviders.assistant.name).toBe('AI agents')
  })
})
