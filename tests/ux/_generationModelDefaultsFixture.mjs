import fs from 'node:fs'
import path from 'node:path'

export function seedGenerationModelDefaults(settingsDir, models) {
  const byTaskKind = {}
  for (const { kind, vendorKey, modelKey } of models) {
    const identity = { vendorKey, modelKey }
    if (kind === 'image') Object.assign(byTaskKind, { text_to_image: identity, image_edit: identity })
    if (kind === 'video') Object.assign(byTaskKind, { text_to_video: identity, image_to_video: identity })
  }
  if (Object.keys(byTaskKind).length) {
    fs.writeFileSync(path.join(settingsDir, 'generation-model-defaults.json'), `${JSON.stringify({ schemaVersion: 1, byTaskKind }, null, 2)}\n`)
  }
}
