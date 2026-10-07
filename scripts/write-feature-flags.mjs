import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const FEATURE_FLAGS_RELATIVE = 'dist-electron/feature-flags.json'

export function writeFeatureFlags(repoRoot, env = process.env) {
  const enabled = env.NOMI_DIRECTOR_3DBOX === 'true' || env.NOMI_DIRECTOR_3DBOX === '1'
  const file = path.join(repoRoot, FEATURE_FLAGS_RELATIVE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const value = { version: 1, director3dbox: enabled, expiresOn: '2026-11-15' }
  fs.writeFileSync(file, JSON.stringify(value) + '\n')
  return value
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const value = writeFeatureFlags(process.cwd())
  console.log(`feature flags baked: director3dbox=${value.director3dbox ? 'true' : 'false'}`)
}
