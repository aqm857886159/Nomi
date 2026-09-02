// 最小复现：旧走查边界会把 future seed 交给 Electron，修复后的共享边界先 quarantine。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareIsolatedCatalog } from './_launchApp.mjs'

const roots = []
const makeCase = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-catalog-repro-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'model-catalog.json'), JSON.stringify({
    version: 12,
    futureOnlyField: 'must-survive-quarantine',
    vendors: [], models: [], mappings: [], apiKeysByVendor: {},
  }))
  return root
}

try {
  const beforeRoot = makeCase()
  const beforePath = path.join(beforeRoot, 'model-catalog.json')
  const beforeRed = fs.existsSync(beforePath)
  console.log(`BEFORE_FIX: ${beforeRed ? 'RED' : 'GREEN'} - old boundary would pass v12 seed to tested app v11`)

  const afterRoot = makeCase()
  const after = prepareIsolatedCatalog(afterRoot, { testedCatalogVersion: 11 })
  const afterGreen = after.status === 'quarantined' && !fs.existsSync(path.join(afterRoot, 'model-catalog.json')) &&
    fs.existsSync(after.quarantinePath)
  console.log(`AFTER_FIX: ${afterGreen ? 'GREEN' : 'RED'} - ${after.status}, app receives no future seed, quarantine=${path.basename(after.quarantinePath || '')}`)
  if (!beforeRed || !afterGreen) process.exitCode = 1
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
}
