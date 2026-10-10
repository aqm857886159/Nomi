import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { repoWriteViolations } from './lib/repoWriteScan.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['scripts', 'tests']
const sourcePattern = /\.(?:node-test|test|walk|e2e|probe|paid)\.m?js$/
const forbidden = [
  /(?:mkdtempSync|mkdtemp)\s*\(\s*path\.join\(\s*os\.tmpdir\(\)/,
  /(?:mkdtempSync|mkdtemp)\s*\(\s*path\.join\(\s*tmpdir\(\)/,
  /mkdtempSync\s*\(\s*join\(\s*tmpdir\(\)/,
  /mkdtempSync\s*\(\s*path\.join\(\s*fs\.realpathSync\(os\.tmpdir\(\)/,
  /mkdtempSync\s*\(\s*['\"]\/(?:tmp|var\/tmp)\//,
]
const helperCall = /\b(?:makeTempDir|makeTempDirAsync|registerTempRoot|cleanupTempRoot)\s*\(/g
const forbiddenQualifiedHelperCall = /\b[A-Za-z_$][\w$]*\.(?:makeTempDir|makeTempDirAsync|registerTempRoot|cleanupTempRoot)\s*\(/g

// These are deliberately non-system fixtures: their parent is a repository or
// caller-provided scratch root, so redirecting them would change the fixture contract.
const NON_SYSTEM_TEMP_ALLOWLIST = {
  'tests/network/run-proxy-cold.mjs': 'fixture is created below the caller-provided network repair root',
  'tests/ux/anchor-real-planner.mjs': 'explicit --output-dir fallback is below the planner repository scratch root',
  'tests/ux/g1/c0-short-film.walk.mjs': 'attempt directory is below the selected sweep output directory',
  'scripts/_test-temp.mjs': 'the shared helper is the single system-temp allocation boundary',
  'tests/setup/tempWorkspace.ts': 'Vitest global setup owns the run TMPDIR and its direct allocation is the workspace contract',
}

function filesUnder(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if ((root === 'scripts' ? /\.(?:mjs|ts)$/.test(entry.name) : sourcePattern.test(entry.name))) out.push(full)
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
    if (rel === 'scripts/check-test-temp-static.node-test.mjs') continue
    if (forbidden.some((pattern) => pattern.test(source)) && !Object.hasOwn(NON_SYSTEM_TEMP_ALLOWLIST, rel)) violations.push(rel)
  }
  assert.deepEqual(violations, [], `direct system-temp mkdtemp calls remain: ${violations.join(', ')}`)
})

test('fixed absolute system-temp mkdtemp calls are rejected', () => {
  const source = ['const root = fs.mkdtempSync(', "'/tmp/", "nomi-regression-')"].join('')
  assert.ok(forbidden.some((pattern) => pattern.test(source)))
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
    if (rel === 'scripts/_test-temp.mjs' || rel === 'scripts/check-test-temp-static.node-test.mjs') continue
    const source = fs.readFileSync(file, 'utf8')
    if (source.match(helperCall) && !/from ['"][^'\"]*_test-temp\.mjs['"]/.test(source)) missingImports.push(rel)
    if (forbiddenQualifiedHelperCall.test(source)) qualifiedCalls.push(rel)
    forbiddenQualifiedHelperCall.lastIndex = 0
  }
  assert.deepEqual(missingImports, [], `helper calls without shared helper imports: ${missingImports.join(', ')}`)
  assert.deepEqual(qualifiedCalls, [], `qualified shared helper calls remain: ${qualifiedCalls.join(', ')}`)
})

test('walkthrough scripts are included in the static scan', () => {
  const files = filesUnder('scripts').map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
  assert.ok(files.includes('scripts/settings-autosave-walkthrough.mjs'))
  assert.ok(files.includes('scripts/asset-preview-walkthrough.mjs'))
})

// ---- 测试不许往真实仓库路径写（2026-10-10：gate-mutation-harness 原地改生产文件，被杀后留下变异代码）----
// 判据与限制见 scripts/lib/repoWriteScan.mjs。范围：scripts/ 与 tests/ 下的 *.node-test.* / *.test.*（走查的 .walk/.e2e 写的是证据截图目录，不在此列），
// 加上共用装置 gate-mutation-harness.mjs 本身。要写文件就写 makeTempDir 给的临时目录。
const repoWriteScopePattern = /\.(?:node-test|test)\.(?:m?js|cjs|ts)$/
const repoWriteExtraFiles = ['scripts/gate-mutation-harness.mjs']

function repoWriteScopeFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (repoWriteScopePattern.test(entry.name)) out.push(full)
    }
  }
  for (const root of roots) walk(path.join(repoRoot, root))
  for (const rel of repoWriteExtraFiles) out.push(path.join(repoRoot, rel))
  return out
}

test('测试与门岗自检装置不往真实仓库路径写文件（写 repoRoot 下非 .tmp 的路径就红）', () => {
  const violations = []
  for (const file of repoWriteScopeFiles()) {
    for (const hit of repoWriteViolations(file, fs.readFileSync(file, 'utf8'))) {
      violations.push(`${path.relative(repoRoot, file).split(path.sep).join('/')}:${hit.line} ${hit.call}`)
    }
  }
  assert.deepEqual(violations, [], `这些调用往真实仓库路径写：\n${violations.join('\n')}\n改成写 makeTempDir 的临时目录（门岗自检用 scripts/gate-mutation-harness.mjs 的副本）`)
})

test('必红：往 repoRoot / process.cwd() 下写 / 删 / 建目录 / 拷贝目标 / 改名', () => {
  const red = [
    "fs.writeFileSync(path.join(repoRoot, 'electron/a.ts'), 'x')",
    "writeFileSync(path.join(REPO_ROOT, rel), content)",
    "fs.rmSync(path.join(repoRoot, 'scripts/recovery.json'), { force: true })",
    "fs.mkdirSync(path.join(repoRoot, 'out'), { recursive: true })",
    "fs.copyFileSync(source, path.join(repoRoot, 'electron/a.ts'))",
    "fs.cpSync(tempDir, path.join(repoRoot, 'electron'), { recursive: true })",
    "fs.renameSync(path.join(tempDir, 'a'), path.join(repoRoot, 'a'))",
    "fs.writeFileSync(path.resolve(process.cwd(), 'package.json'), '{}')",
    // 事故原型：gate-mutation-harness 改造前的 withMutation / 还原
    "for (const [relative, content] of originals) fs.writeFileSync(path.join(repoRoot, relative), content)",
  ]
  for (const source of red) assert.ok(repoWriteViolations('x.test.mjs', source).length > 0, source)
})

test('放行：写临时目录、写 .tmp 草稿区、只把真实仓库当拷贝来源', () => {
  const green = [
    "fs.writeFileSync(path.join(tempDir, 'a.ts'), 'x')",
    "fs.writeFileSync(path.join(repoRoot, '.tmp', 'x.json'), '{}')",
    "fs.mkdirSync(path.join(repoRoot, '.tmp-gen-1'))",
    "fs.copyFileSync(path.join(repoRoot, 'scripts/a.mjs'), path.join(tempDir, 'a.mjs'))",
    "fs.cpSync(path.join(repoRoot, 'electron'), path.join(tempDir, 'electron'), { recursive: true })",
    "fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')",
  ]
  for (const source of green) assert.deepEqual(repoWriteViolations('x.test.mjs', source), [], source)
})
