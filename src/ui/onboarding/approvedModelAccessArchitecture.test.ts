import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

describe('approved model access architecture', () => {
  it('routes all known vendors with usesPlatformConnect to the dedicated key-only page', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const navigation = read('src/ui/onboarding/modelSettingsNavigation.ts')
    const page = read('src/ui/onboarding/KnownVendorKeyConnectPage.tsx')
    const connections = read('src/ui/onboarding/onboardingDrawerConnections.ts')
    const vendors = read('src/config/knownVendors.ts')

    // Navigation type and drawer handler must exist.
    expect(navigation).toContain("type: 'platformConnect'")
    expect(drawer).toContain("page.type === 'platformConnect'")
    expect(drawer).toContain('<KnownVendorKeyConnectPage')

    // Page structure: key input section before saved-success section.
    expect(page).toContain('data-key-only-vendor')
    expect(page.match(/type="password"/g)).toHaveLength(1)
    expect(page).toContain("value={saved ? 'saved-key' : apiKey}")
    expect(page).toContain('disabled={busy || saved}')
    expect(page.indexOf('data-platform-key-only')).toBeLessThan(page.indexOf('data-key-only-success'))
    expect(page).not.toContain('baseUrl')
    expect(page).not.toContain('ModelChipGroups')
    expect(page).not.toContain('文档')

    // Routing must be derived from the vendor archive field, not a hardcoded allowlist.
    expect(connections).not.toMatch(/\['apimart',\s*'kie'\]\.includes/)
    expect(connections).not.toMatch(/'apimart'\s*\|\|\s*'kie'/)
    expect(connections).toContain('usesPlatformConnect !== false')

    // The vendor type must declare the capability field.
    expect(vendors).toContain('usesPlatformConnect')

    // The page must accept hasApiKey and show pending state without requiring key re-entry.
    expect(page).toContain('hasApiKey')
    expect(page).toContain('pendingTitle')
    expect(page).toContain('continueVerification')
  })

  it('keeps the Dreamina membership entry available while its local status is loading', () => {
    const catalog = read('src/ui/onboarding/useOnboardingDrawerCatalog.ts')
    const connections = read('src/ui/onboarding/onboardingDrawerConnections.ts')

    expect(catalog).toContain('DREAMINA_UNCHECKED_STATUS')
    expect(catalog).toContain('setDreaminaStatus((current) => current ?? DREAMINA_UNCHECKED_STATUS)')
    const available = connections.slice(connections.indexOf('const availableHomeConnections'))
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
