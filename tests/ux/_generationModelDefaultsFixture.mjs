import fs from 'node:fs'
import path from 'node:path'

export function seedGenerationModelDefaults(settingsDir, models) {
  const byKind = {}
  for (const { kind, vendorKey, modelKey } of models) {
    const identity = { vendorKey, modelKey }
    if (kind === 'image') byKind.image = identity
    if (kind === 'video') byKind.video = identity
  }
  if (Object.keys(byKind).length) {
    fs.writeFileSync(path.join(settingsDir, 'generation-model-defaults.json'), `${JSON.stringify({ schemaVersion: 2, byKind }, null, 2)}\n`)
  }
}
