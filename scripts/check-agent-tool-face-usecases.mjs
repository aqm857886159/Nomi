import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/system/agent-tool-face-usecases.json'), 'utf8'))
const sourceFiles = [
  'electron/shared/agentCapabilities/verbs/readVerbs.ts',
  'electron/shared/agentCapabilities/verbs/writeVerbs.ts',
]
const declared = new Set()
for (const relative of sourceFiles) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  for (const match of source.matchAll(/name:\s*"([a-z0-9_]+)"/g)) {
    // `nomi_canvas_edit` is the MCP transport projection of the canonical
    // canvas.write capability, not a 21st user-facing verb. Keep the manifest
    // cardinality about the Agent lane contract rather than transport aliases.
    const declarationTail = source.slice(match.index, match.index + 180)
    if (/profiles:\s*\["mcp"\]/.test(declarationTail)) continue
    declared.add(match[1])
  }
}
const expected = new Set(manifest.canonicalVerbs)
const caseIds = new Set()
const covered = new Set(manifest.cases.flatMap((entry) => entry.tools ?? [entry.firstTool]))
const errors = []
if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1')
if (expected.size !== 20) errors.push(`expected 20 canonical verbs, got ${expected.size}`)
for (const verb of expected) if (!declared.has(verb)) errors.push(`manifest verb is not declared: ${verb}`)
for (const verb of declared) if (!expected.has(verb)) errors.push(`declared verb missing from manifest: ${verb}`)
for (const entry of manifest.cases) {
  if (caseIds.has(entry.id)) errors.push(`duplicate case id: ${entry.id}`)
  caseIds.add(entry.id)
  if (!expected.has(entry.firstTool)) errors.push(`${entry.id}: firstTool is not canonical: ${entry.firstTool}`)
  if (!Array.isArray(entry.tools) || entry.tools.length === 0) errors.push(`${entry.id}: tools must list the full semantic trajectory`)
  if (!Array.isArray(entry.proof) || entry.proof.length < 2) errors.push(`${entry.id}: proof must contain trajectory and one result dimension`)
}
for (const verb of expected) if (!covered.has(verb)) errors.push(`canonical verb has no user case: ${verb}`)
if (manifest.cases.length < 20) errors.push(`at least 20 user cases required, got ${manifest.cases.length}`)
if (errors.length) {
  console.error(['Agent tool-face usecase manifest: FAIL', ...errors.map((error) => `- ${error}`)].join('\n'))
  process.exit(1)
}
console.log(`Agent tool-face usecase manifest: PASS · verbs=${expected.size} · cases=${manifest.cases.length} · metrics=${manifest.metrics.length}`)
