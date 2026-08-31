import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

describe('key-only connection UI contract', () => {
  it('threads the backend credential mode into the page and keeps direct-key out of certification', () => {
    const drawer = read('src/ui/onboarding/OnboardingDrawer.tsx')
    const catalog = read('src/ui/onboarding/useOnboardingDrawerCatalog.ts')
    const page = read('src/ui/onboarding/KnownVendorKeyConnectPage.tsx')
    const card = read('src/ui/onboarding/VendorOnboardCard.tsx')

    expect(catalog).toContain('credentialMode')
    expect(drawer).toContain('credentialMode={card.meta.credentialMode}')
    expect(drawer).toContain('enabled={card.meta.enabled}')
    expect(drawer).toContain("card.meta.credentialMode === 'direct-key'")
    expect(page).toContain('resolveKeyOnlySaveOutcome')
    expect(page).toContain('const directKey = credentialMode === \'direct-key\'')
    expect(page).toContain('enabled: directKey')
    expect(page).toContain("saveOutcome === 'connected' ? onBack")
    expect(page).toContain('directKeyUnavailable')
    expect(page).not.toContain('onClick={onContinueVerification}')
    expect(card).toContain('credentialMode?: KeyOnlyCredentialMode')
    expect(card).toContain('usableKey = hasApiKey && (credentialMode !== \'direct-key\' || enabled)')
    expect(card).toContain('resolveKeyOnlySaveOutcome')
    expect(card).toContain('enabled: credentialMode === \'direct-key\'')
  })

  it('exposes credential mode only through the public catalog projection and DTOs', () => {
    const projection = read('electron/catalog/customConfigStore.ts')
    const desktopDto = read('src/api/desktopClient.ts')
    const workbenchDto = read('src/workbench/api/modelCatalogApi.ts')

    expect(projection).toContain('credentialModeForVendor')
    expect(projection).toContain('export type PublicVendor')
    expect(desktopDto).toContain('credentialMode?: ModelCatalogVendorCredentialMode')
    expect(workbenchDto).toContain('credentialMode?: ModelCatalogVendorCredentialMode')
  })
})
