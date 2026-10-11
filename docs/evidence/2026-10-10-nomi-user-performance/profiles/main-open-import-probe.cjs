// Diagnostic-only source hook around the SAME two native import awaits.
// It does not skip migration, move imports, replace operations, or enter builds.
'use strict'
const module_ = require('node:module')
const { performance } = require('node:perf_hooks')
let entries = []
globalThis.__nomiDiagnosticImport = async (name, load) => {
  const startTime = performance.now()
  try { return await load() }
  finally { entries.push({ name, startTime, duration: performance.now() - startTime }) }
}
globalThis.__nomiOpenImportProbe = {
  arm() { entries = [] },
  take() { const result = entries; entries = []; return result },
}
module_.registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context)
  if (!url.endsWith('/agentLane/laneNativeLoader.cjs')) return loaded
  if (loaded.format !== 'commonjs' || loaded.source == null) throw new Error('native loader source hook unavailable')
  let count = 0
  const source = String(loaded.source).replace(/await import\(['"](\.\/lane(?:LegacyMigration|Workspace)\.mjs)['"]\)/g, (_, file) => {
    count += 1
    return `await globalThis.__nomiDiagnosticImport(${JSON.stringify(file)}, () => import(${JSON.stringify(file)}))`
  })
  if (count !== 2) throw new Error(`native import boundary drift: expected2, saw${count}`)
  return { ...loaded, source }
} })
