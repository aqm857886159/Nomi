#!/usr/bin/env node
/**
 * Generate the storyboard-table retirement fixture with a release's own writer.
 *
 * `git archive <tag>` extracts the tagged `src/` + `electron/` (and the vitest setup it needs) into
 * `.tmp/fixture-<tag>/`, copies `scripts/fixtures/storyboardTableReleaseWriter.probe.ts` into that tree,
 * and runs it with the tagged tree's vitest config. Every node in the output is created by that
 * release's store code; the payload is read back through the release's `readCurrentWorkbenchProjectPayload`.
 *
 * Usage: node scripts/generate-storyboard-table-fixture.mjs v0.23.1
 * Output: src/workbench/generationCanvas/store/__fixtures__/storyboard-table-<tag>.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tag = process.argv[2]
if (!tag) throw new Error('usage: node scripts/generate-storyboard-table-fixture.mjs <tag>')

const tree = path.join(repoRoot, '.tmp', `fixture-${tag}`)
fs.rmSync(tree, { recursive: true, force: true })
fs.mkdirSync(tree, { recursive: true })
const archive = execFileSync('git', ['archive', '--format=tar', tag, 'src', 'electron', 'tests/setup', 'tests/stubs', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json', 'package.json', 'agent-skills', 'skills', 'model-catalog.json'], { cwd: repoRoot, maxBuffer: 512 * 1024 * 1024 })
execFileSync('tar', ['-x'], { cwd: tree, input: archive })
fs.copyFileSync(path.join(repoRoot, 'scripts/fixtures/storyboardTableReleaseWriter.probe.ts'), path.join(tree, 'src/storyboardTableReleaseWriter.test.ts'))

const outputDir = path.join(repoRoot, 'src/workbench/generationCanvas/store/__fixtures__')
fs.mkdirSync(outputDir, { recursive: true })
const raw = path.join(tree, 'payload.json')
execFileSync(process.execPath, [path.join(repoRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--root', tree, 'src/storyboardTableReleaseWriter.test.ts'], {
  cwd: tree, stdio: 'inherit', env: { ...process.env, NOMI_FIXTURE_OUTPUT: raw },
})
const { payload } = JSON.parse(fs.readFileSync(raw, 'utf8'))
const commit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { cwd: repoRoot, encoding: 'utf8' }).trim()
const fixture = { writtenBy: { tag, commit, writer: 'scripts/fixtures/storyboardTableReleaseWriter.probe.ts' }, payload }
fs.writeFileSync(path.join(outputDir, `storyboard-table-${tag}.json`), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
fs.rmSync(tree, { recursive: true, force: true })
console.log(`wrote src/workbench/generationCanvas/store/__fixtures__/storyboard-table-${tag}.json`)
