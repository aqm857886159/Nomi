import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { userVendorBaseUrl } from '../catalog/userVendorBase'
import {
  productionFixtureBaseOriginFromEnv,
  setProductionRunE2eFixturePackagedState,
  type ProductionRunE2eFixtureEnvironment,
} from '../shared/productionRunE2eFixtureGate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('production E2E fixture owner matrix', () => {
  const values = ['0', '1'] as const
  const bases = [
    ['http://127.0.0.1:5555', true],
    ['https://fixture.example', false],
  ] as const
  const cases = values.flatMap((e2e) => values.flatMap((production) =>
    [undefined, false, true].flatMap((packagedState) => values.flatMap((packagedFixture) =>
      bases.map(([base, loopback]) => ({
        e2e, production, packagedState, packagedFixture, base,
        expected: e2e === '1' && production === '1'
          && (packagedState === false || packagedFixture === '1') && loopback,
      }))
    ))
  ))

  it.each(cases)('allows only the complete gate (%o)', ({ e2e, production, packagedState, packagedFixture, base, expected }) => {
    setProductionRunE2eFixturePackagedState(packagedState)
    const env: ProductionRunE2eFixtureEnvironment = {
      NOMI_E2E: e2e,
      NOMI_E2E_PRODUCTION_FIXTURE: production,
      NOMI_E2E_PACKAGED_FIXTURE: packagedFixture,
      NOMI_E2E_FIXTURE_BASE_URL: base,
    }
    expect(productionFixtureBaseOriginFromEnv(env))
      .toBe(expected ? 'http://127.0.0.1:5555' : undefined)
  })

  it('applies the same owner gate to the user base entry point', () => {
    setProductionRunE2eFixturePackagedState(true)
    vi.stubEnv('NOMI_E2E_FIXTURE_BASE_URL', 'http://127.0.0.1:5555')
    vi.stubEnv('NOMI_E2E_PRODUCTION_FIXTURE', '1')
    vi.stubEnv('NOMI_E2E', '0')
    expect(userVendorBaseUrl({ key: 'apimart', baseUrlHint: 'https://api.apimart.ai' }))
      .toBe('https://api.apimart.ai')
    vi.stubEnv('NOMI_E2E', '1')
    expect(userVendorBaseUrl({ key: 'apimart', baseUrlHint: 'https://api.apimart.ai' }))
      .toBe('https://api.apimart.ai')
    setProductionRunE2eFixturePackagedState(false)
    expect(userVendorBaseUrl({ key: 'apimart', baseUrlHint: 'https://api.apimart.ai' }))
      .toBe('http://127.0.0.1:5555')
    vi.unstubAllEnvs()
  })

  it('keeps the fixture switch in one production owner', () => {
    const callPoints = [
      'electron/capabilityCore/apimartGenerationProvider.ts',
      'electron/capabilityCore/generationProviderBootstrap.ts',
      'electron/catalog/userVendorBase.ts',
      'electron/capabilityCore/appIntegration.ts',
      'electron/capabilityCore/mcpStdioServer.ts',
    ]
    for (const relative of callPoints) {
      const source = fs.readFileSync(path.join(root, relative), 'utf8')
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code).not.toContain('NOMI_E2E_PRODUCTION_FIXTURE')
      expect(code).toMatch(/productionFixtureBaseOrigin/)
      expect(code).not.toMatch(/productionFixtureBaseOrigin(?:FromEnv)?[\s\S]{0,160}\b(?:false|isPackaged)\b/)
    }
    const owner = fs.readFileSync(path.join(root, 'electron/shared/productionRunE2eFixtureGate.ts'), 'utf8')
    expect(owner).toContain('NOMI_E2E_PRODUCTION_FIXTURE')
  })
})
