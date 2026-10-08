export type ProductionRunE2eFixtureEnvironment = Partial<Record<
  'NOMI_E2E' | 'NOMI_E2E_PRODUCTION_FIXTURE' | 'NOMI_E2E_PACKAGED_FIXTURE' | 'NOMI_E2E_FIXTURE_BASE_URL',
  string | undefined
>>

// The main process injects this once during boot. Until then, fail closed as
// packaged so a renderer or an early worker can never enable a private fixture
// by assuming it is running unpackaged.
let packagedState: boolean | undefined

export function setProductionRunE2eFixturePackagedState(
  isPackaged: boolean | undefined,
): void {
  packagedState = isPackaged
}

function isPackagedBuild(): boolean {
  return packagedState ?? true
}

export function isProductionRunE2eFixtureEnabled(
  env: ProductionRunE2eFixtureEnvironment,
): boolean {
  if (isPackagedBuild() && env.NOMI_E2E_PACKAGED_FIXTURE !== '1') return false
  return env.NOMI_E2E === '1' && env.NOMI_E2E_PRODUCTION_FIXTURE === '1'
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** The sole owner of the production E2E fixture switch and private base. */
export function productionFixtureBaseOrigin(
  value: unknown,
  env: ProductionRunE2eFixtureEnvironment,
): string | undefined {
  if (!isProductionRunE2eFixtureEnabled(env)) return undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!LOOPBACK_HOSTS.has(url.hostname)) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export function productionFixtureBaseOriginFromEnv(
  env: ProductionRunE2eFixtureEnvironment = process.env,
): string | undefined {
  return productionFixtureBaseOrigin(env.NOMI_E2E_FIXTURE_BASE_URL, env)
}
