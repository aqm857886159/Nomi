import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

describe('approved model access architecture', () => {
  it('has a dedicated key-only route for APIMart and Kie.ai', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const navigation = read('src/ui/onboarding/modelSettingsNavigation.ts')
    const page = read('src/ui/onboarding/KnownVendorKeyConnectPage.tsx')

    expect(navigation).toContain("type: 'platformConnect'")
    expect(drawer).toContain("page.type === 'platformConnect'")
    expect(drawer).toContain('<KnownVendorKeyConnectPage')
    expect(page).toContain('data-key-only-vendor')
    expect(page.match(/type="password"/g)).toHaveLength(1)
    expect(page).toContain("value={saved ? 'saved-key' : apiKey}")
    expect(page).toContain('disabled={busy || saved}')
    expect(page.indexOf('data-platform-key-only')).toBeLessThan(page.indexOf('data-key-only-success'))
    expect(page).not.toContain('baseUrl')
    expect(page).not.toContain('ModelChipGroups')
    expect(page).not.toContain('文档')
  })

  it('keeps the Dreamina membership entry available while its local status is loading', () => {
    const catalog = read('src/ui/onboarding/useOnboardingDrawerCatalog.ts')
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')

    expect(catalog).toContain('DREAMINA_UNCHECKED_STATUS')
    expect(catalog).toContain('setDreaminaStatus((current) => current ?? DREAMINA_UNCHECKED_STATUS)')
    const available = drawer.slice(drawer.indexOf('const availableHomeConnections'))
    expect(available.indexOf('vendorKey: DREAMINA_CONNECTION_KEY')).toBeLessThan(available.indexOf('vendorKey: CODEX_LOCAL_VENDOR_KEY'))
  })

  it('keeps MCP out of Models and places its management before trusted hosts', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const catalog = read('src/ui/onboarding/useOnboardingDrawerCatalog.ts')
    const automation = read('src/workbench/settings/AutomationPermissionsSection.tsx')

    expect(drawer).not.toContain('ASSISTANT_CONNECTION_KEY')
    expect(drawer).not.toContain('<ConnectAssistantCard')
    expect(catalog).not.toContain('mcpInfo')
    expect(automation).toContain('data-settings-action="manage-mcp-connections"')
    expect(automation.indexOf('settings-mcp-title')).toBeLessThan(automation.indexOf('settings-hosts-title'))
  })
})
