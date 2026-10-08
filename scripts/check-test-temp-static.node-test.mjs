import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['scripts', 'tests']
const sourcePattern = /\.(?:node-test|test|walk|e2e|probe|paid)\.m?js$/
const forbidden = [
  /(?:mkdtempSync|mkdtemp)\s*\(\s*path\.join\(\s*os\.tmpdir\(\)/,
  /(?:mkdtempSync|mkdtemp)\s*\(\s*path\.join\(\s*tmpdir\(\)/,
  /mkdtempSync\s*\(\s*join\(\s*tmpdir\(\)/,
  /mkdtempSync\s*\(\s*path\.join\(\s*fs\.realpathSync\(os\.tmpdir\(\)/,
]
const helperCall = /\b(?:makeTempDir|makeTempDirAsync|registerTempRoot|cleanupTempRoot)\s*\(/g
const forbiddenQualifiedHelperCall = /\b[A-Za-z_$][\w$]*\.(?:makeTempDir|makeTempDirAsync|registerTempRoot|cleanupTempRoot)\s*\(/g

// These are deliberately non-system fixtures: their parent is a repository or
// caller-provided scratch root, so redirecting them would change the fixture contract.
const NON_SYSTEM_TEMP_ALLOWLIST = {
  'tests/network/run-proxy-cold.mjs': 'fixture is created below the caller-provided network repair root',
  'tests/ux/anchor-real-planner.mjs': 'explicit --output-dir fallback is below the planner repository scratch root',
  'tests/ux/g1/c0-short-film.walk.mjs': 'attempt directory is below the selected sweep output directory',
}

function filesUnder(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if ((root === 'scripts' ? entry.name.endsWith('.node-test.mjs') : sourcePattern.test(entry.name))) out.push(full)
    }
  }
  walk(path.join(repoRoot, root))
  return out
}

test('node:test and standalone walkthroughs use the shared temp helper for system temp roots', () => {
  const violations = []
  for (const file of roots.flatMap(filesUnder)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/')
    const source = fs.readFileSync(file, 'utf8')
    if (forbidden.some((pattern) => pattern.test(source)) && !Object.hasOwn(NON_SYSTEM_TEMP_ALLOWLIST, rel)) violations.push(rel)
  }
  assert.deepEqual(violations, [], `direct system-temp mkdtemp calls remain: ${violations.join(', ')}`)
})

test('every non-system mkdtemp exception has a documented reason', () => {
  for (const [file, reason] of Object.entries(NON_SYSTEM_TEMP_ALLOWLIST)) {
    assert.ok(reason.length > 0)
    assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} disappeared from its allowlist`)
  }
})

test('every shared temp helper call has an import and no qualified helper call', () => {
  const missingImports = []
  const qualifiedCalls = []
  for (const file of roots.flatMap(filesUnder)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/')
    if (rel === 'scripts/_test-temp.mjs') continue
    const source = fs.readFileSync(file, 'utf8')
    if (source.match(helperCall) && !/from ['"][^'\"]*_test-temp\.mjs['"]/.test(source)) missingImports.push(rel)
    if (forbiddenQualifiedHelperCall.test(source)) qualifiedCalls.push(rel)
    forbiddenQualifiedHelperCall.lastIndex = 0
  }
  assert.deepEqual(missingImports, [], `helper calls without shared helper imports: ${missingImports.join(', ')}`)
  assert.deepEqual(qualifiedCalls, [], `qualified shared helper calls remain: ${qualifiedCalls.join(', ')}`)
})
