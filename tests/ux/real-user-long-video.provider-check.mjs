// Redacted provider/config preflight. It reports presence and public catalog metadata only;
// never prints API-key plaintext, ciphertext, token, or environment values.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { liveCanaryReadiness } from './real-user-long-video.runner.mjs'

const catalogPath = path.join(os.homedir(), 'Library', 'Application Support', 'Nomi', 'model-catalog.json')
const result = {
  providerProfile: { provider: 'apimart', model: 'gemini-3.5-flash', credentialEnv: 'APIMART_API_KEY' },
  environment: liveCanaryReadiness(),
  catalog: { path: catalogPath, present: false, apimartVendor: null, targetModel: null, encryptedCredentialRecordPresent: false },
}
if (fs.existsSync(catalogPath)) {
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    const vendor = catalog.vendors?.find((row) => row.key === 'apimart')
    const model = catalog.models?.find((row) => row.vendorKey === 'apimart' && row.modelKey === 'gemini-3.5-flash')
    const keyRecord = catalog.apiKeysByVendor?.apimart
    result.catalog.present = true
    result.catalog.apimartVendor = vendor ? { enabled: vendor.enabled, providerKind: vendor.providerKind, authType: vendor.authType, baseUrlHint: vendor.baseUrlHint } : null
    result.catalog.targetModel = model ? { kind: model.kind, enabled: model.enabled, supportsImageInput: model.meta?.supportsImageInput === true } : null
    result.catalog.encryptedCredentialRecordPresent = Boolean(keyRecord && typeof keyRecord === 'object' && (keyRecord.enc || keyRecord.ciphertext || keyRecord.encryptedValue))
  } catch (error) {
    result.catalog.parseError = error instanceof Error ? error.message : String(error)
  }
}
console.log(JSON.stringify(result, null, 2))
