import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { enSettings, zhSettings } from '../../i18n/locales/settings'

const read = (relativePath: string): string => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('MCP connection settings ownership', () => {
  it('removes AI assistants from the model catalog and its data lifecycle', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const catalog = read('src/ui/onboarding/useOnboardingDrawerCatalog.ts')
    const constants = read('src/ui/onboarding/onboardingDrawerConstants.ts')

    expect(drawer).not.toContain('ConnectAssistantCard')
    expect(drawer).not.toContain('ASSISTANT_CONNECTION_KEY')
    expect(drawer).not.toContain("kind: 'assistant'")
    expect(drawer).not.toContain('mcpInfo')
    expect(catalog).not.toContain('McpInfo')
    expect(catalog).not.toContain('mcpInfo')
    expect(constants).not.toContain('assistant-mcp')
  })

  // 2026-09-14 用户拍板（审计 §⑥ 第 6 条）：「可信发起方」不再单独成栏，并进每张客户端卡当第二个开关。
  it('keeps one MCP entry in Automation and folds trusted initiators into each client card', () => {
    const automation = read('src/workbench/settings/AutomationPermissionsSection.tsx')
    const view = read('src/workbench/settings/settingsAutomationView.ts')
    const card = read('src/ui/onboarding/ConnectAssistantCard.tsx')

    expect(automation).toContain('data-settings-action="manage-mcp-connections"')
    expect(automation).toContain('data-settings-section="mcp-assistant-connections"')
    expect(automation).toContain('<ConnectAssistantCard')
    expect(automation).toContain('onTrustChange={toggleHost}')
    expect(automation).not.toContain('settings-hosts-title')
    expect(automation).not.toContain('settings.automation.hosts')
    expect(view).not.toContain("'workbuddy'")
    expect(card).toContain('data-assistant-trust-row')
  })

  it('provides the approved bilingual information architecture', () => {
    expect(zhSettings.automation.mcp).toMatchObject({
      title: 'AI 助手连接（MCP）',
      clients: 'Claude Code、Claude Desktop、Codex、Cursor 与 WorkBuddy',
      manage: '管理连接',
    })
    expect(enSettings.automation.mcp).toMatchObject({
      title: 'AI agent connections (MCP)',
      clients: 'Claude Code, Claude Desktop, Codex, Cursor, and WorkBuddy',
      manage: 'Manage connections',
    })
    expect((zhSettings.automation as Record<string, unknown>).hosts).toBeUndefined()
    expect((enSettings.automation as Record<string, unknown>).hosts).toBeUndefined()
  })
})
