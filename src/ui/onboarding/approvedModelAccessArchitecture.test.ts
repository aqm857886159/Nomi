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
    // 2026-09-29 用户拍板「一开始配置就该能改地址」（主域被墙的人得先换线路，key 才验得出去）：
    // 地址行用已接入卡片同一个组件、同一个保存入口，不在这页另写一份地址编辑。
    expect(page).toContain('<VendorBaseUrlField')
    expect(page).not.toContain('upsertVendor(')
    expect(page).not.toContain('文档')

    // 「已有预置地址、模型和请求适配」必须真的有清单：页面拿到的是模型数组本身，
    // 不是一个数字，并且用的是全站同一个 chip 列表组件（不另写第二份列表）。
    expect(page).toContain('models: readonly ChipModel[]')
    expect(page).toContain('<ModelChipGroups')
    expect(drawer).toContain('models={card.vendorModels}')
    expect(drawer).not.toContain('modelCount={')
    // 未接入的供应商也要带着真实清单进投影——曾经在这里被硬写成空数组。
    expect(connections).not.toMatch(/kind: 'api',\s*\n\s*models: \[\],/)

    // Routing must be derived from the vendor archive field, not a hardcoded allowlist.
    expect(connections).not.toMatch(/\['apimart',\s*'kie'\]\.includes/)
    expect(connections).not.toMatch(/'apimart'\s*\|\|\s*'kie'/)
    expect(connections).toContain('usesPlatformConnect !== false')

    // The vendor type must declare the capability field.
    expect(vendors).toContain('usesPlatformConnect')

    // The page must accept hasApiKey and show the saved state without requiring key re-entry.
    // D-1117-delete-verification：存下即可用，没有「待验证」那一档、也没有「继续验证」那一步。
    expect(page).toContain('hasApiKey')
    expect(page).toContain('savedTitle')
    expect(page).not.toContain('pendingTitle')
    expect(page).not.toContain('continueVerification')
  })

  it('keeps the Dreamina membership entry available while its local status is loading', () => {
    const catalog = read('src/ui/onboarding/useOnboardingDrawerCatalog.ts')
    const connections = read('src/ui/onboarding/onboardingDrawerConnections.ts')

    expect(catalog).toContain('DREAMINA_UNCHECKED_STATUS')
    expect(catalog).toContain('setDreaminaStatus((current) => current ?? DREAMINA_UNCHECKED_STATUS)')
    const available = connections.slice(connections.indexOf('const availableHomeConnections'))
    expect(available.indexOf('vendorKey: DREAMINA_CONNECTION_KEY')).toBeLessThan(available.indexOf('vendorKey: CODEX_LOCAL_VENDOR_KEY'))
  })

  // 2026-09-14：「可信发起方」并进每张客户端卡（用户拍板），设置页不再有独立一栏。
  it('keeps MCP out of Models and folds trusted hosts into the client cards', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const catalog = read('src/ui/onboarding/useOnboardingDrawerCatalog.ts')
    const automation = read('src/workbench/settings/AutomationPermissionsSection.tsx')

    expect(drawer).not.toContain('ASSISTANT_CONNECTION_KEY')
    expect(drawer).not.toContain('<ConnectAssistantCard')
    expect(catalog).not.toContain('mcpInfo')
    expect(automation).toContain('data-settings-action="manage-mcp-connections"')
    expect(automation).not.toContain('settings-hosts-title')
    expect(automation).toContain('onTrustChange={toggleHost}')
  })
})
