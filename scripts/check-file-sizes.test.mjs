import { makeTempDir } from './_test-temp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixtureContent(lines, { name = 'fixture', comments = false } = {}) {
  const body = Array.from({ length: lines }, (_, index) => `  const ${name}_${index} = ${index}`)
  if (!comments) return `export function ${name}() {\n${body.join('\n')}\n}\n`
  return `export function ${name}() {\n${body.map((line) => `${line} // comment ${line}`).join('\n')}\n}\n`
}

function createFixture({ files, baselineMutator = null, originBaseline = null, originLegacyAllowlist = null } = {}) {
  const root = makeTempDir('nomi-file-sizes-')
  temporaryRoots.push(root)
  fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'scripts/check-file-sizes.mjs'), path.join(root, 'scripts/check-file-sizes.mjs'))
  fs.copyFileSync(path.join(repoRoot, 'scripts/lib/gitPaths.mjs'), path.join(root, 'scripts/lib/gitPaths.mjs'))
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  const baselinePath = path.join(root, 'scripts/file-size-baseline.json')
  const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/file-size-baseline.json'), 'utf8'))
  if (baselineMutator) baselineMutator(baseline)
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'electron'), { recursive: true })
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  execFileSync('git', ['init', '--quiet', root])
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
  execFileSync('git', ['add', '--', 'scripts', 'src', 'electron'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root })
  if (originBaseline) {
    fs.writeFileSync(baselinePath, JSON.stringify(originBaseline, null, 2))
    execFileSync('git', ['add', '--', 'scripts/file-size-baseline.json'], { cwd: root })
    execFileSync('git', ['commit', '--quiet', '-m', 'origin-baseline'], { cwd: root })
    execFileSync('git', ['branch', 'origin-main'], { cwd: root })
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'origin-main'], { cwd: root })
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
  }
  if (originLegacyAllowlist) {
    // origin/main 还是旧口径：没有基线 JSON，白名单写在旧脚本的 ALLOWLIST 里。
    const scriptPath = path.join(root, 'scripts/check-file-sizes.mjs')
    const currentScript = fs.readFileSync(scriptPath, 'utf8')
    const allowlist = Object.entries(originLegacyAllowlist).map(([file, max]) => `  "${file}": ${max},`).join('\n')
    fs.writeFileSync(scriptPath, `const ALLOWLIST = {\n${allowlist}\n};\n`)
    fs.rmSync(baselinePath)
    execFileSync('git', ['add', '-A', '--', 'scripts'], { cwd: root })
    execFileSync('git', ['commit', '--quiet', '-m', 'origin-legacy-allowlist'], { cwd: root })
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root })
    fs.writeFileSync(scriptPath, currentScript)
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
  }
  return root
}

function run(root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-file-sizes.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NOMI_FILESIZE_SKIP_BASELINE_COMPARE: '1' },
  })
}

function runWithOrigin(root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-file-sizes.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NOMI_FILESIZE_ORIGIN_REF: 'origin/main' },
  })
}

describe('formatted TypeScript file-size gate', () => {
  test('rejects a new 801-line production module and names the largest declaration', () => {
    const root = createFixture({ files: { 'electron/harness/oversized.ts': fixtureContent(801, { name: 'oversized' }) } })
    const result = run(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('electron/harness/oversized.ts')
    expect(result.stderr).toContain('oversized')
  })

  test('keeps 800-line native sources and declaration/test exclusions within the bound', () => {
    const root = createFixture({
      files: {
        'electron/harness/session.mts': 'const session = 1\n'.repeat(800),
        'electron/harness/host.cts': 'const host = 1\n'.repeat(800),
        'electron/harness/session.test.mts': 'const ignored = 1\n'.repeat(801),
        'electron/harness/host.test.cts': 'const ignored = 1\n'.repeat(801),
        'electron/harness/session.d.mts': 'declare const ignored: number\n'.repeat(801),
        'electron/harness/host.d.cts': 'declare const ignored: number\n'.repeat(801),
      },
    })
    const result = run(root)
    expect(result.status, result.stderr).toBe(0)
  })

  test('compressed source is expanded by Prettier and still exceeds 800', () => {
    const statements = Array.from({ length: 900 }, (_, index) => `const compressed${index}=${index};`)
    const root = createFixture({ files: { 'src/harness/compressed.ts': statements.join('').replace(/((?:;){3})/g, '$1\n') } })
    const result = run(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('compressed.ts')
  })

  test('removing comments does not change the formatted code-line count', () => {
    const withComments = createFixture({ files: { 'src/harness/comments.ts': fixtureContent(651, { name: 'comments', comments: true }) } })
    const withoutComments = createFixture({ files: { 'src/harness/comments.ts': fixtureContent(651, { name: 'comments' }) } })
    const first = run(withComments)
    const second = run(withoutComments)
    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(first.stdout + first.stderr).toMatch(/comments\.ts: 653 行达到黄牌/)
    expect(second.stdout + second.stderr).toMatch(/comments\.ts: 653 行达到黄牌/)
  })

  test('651-line source emits a warning with the AST top-level declaration', () => {
    const root = createFixture({ files: { 'src/harness/warning.ts': fixtureContent(651, { name: 'warning' }) } })
    const result = run(root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toMatch(/warning\.ts: 653 行达到黄牌.*warning 653 行/)
  })

  test('frozen file growth is red and names its largest declaration', () => {
    const root = createFixture({
      baselineMutator: (baseline) => { baseline.entries['electron/catalog/seedBuiltins.ts'].max = 940 },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(950, { name: 'KIE_CURATED_MAPPINGS' }) },
    })
    const result = run(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toMatch(/seedBuiltins\.ts: .*冻结上限 940/)
    expect(result.stderr).toContain('KIE_CURATED_MAPPINGS')
  })

  test('frozen file shrink is yellow and lowers the cap', () => {
    const root = createFixture({
      baselineMutator: (baseline) => { baseline.entries['electron/catalog/seedBuiltins.ts'].max = 940 },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(930, { name: 'KIE_CURATED_MAPPINGS' }) },
    })
    const result = run(root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toMatch(/seedBuiltins\.ts: .*行 < 冻结上限 940.*上限下调/)
  })

  test('a new baseline entry is red after the migration window', () => {
    const origin = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/file-size-baseline.json'), 'utf8'))
    const root = createFixture({
      originBaseline: origin,
      baselineMutator: (baseline) => {
        baseline.entries['src/harness/new-frozen.ts'] = { kind: 'frozen', max: 900, reason: '新口径落地时已超线，冻结，按职责逐步拆', topDeclarations: [] }
      },
      files: { 'src/harness/new-frozen.ts': fixtureContent(100, { name: 'newFrozen' }) },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('基线新增 src/harness/new-frozen.ts')
  })

  test('the one-time migration is open only while origin/main has no baseline JSON, whatever its commit id', () => {
    const root = createFixture({
      originLegacyAllowlist: { 'electron/main.ts': 900 },
      baselineMutator: (baseline) => {
        baseline.entries['src/harness/new-frozen.ts'] = { kind: 'frozen', max: 900, reason: '新口径落地时已超线，冻结，按职责逐步拆', topDeclarations: [] }
      },
      files: { 'src/harness/new-frozen.ts': fixtureContent(100, { name: 'newFrozen' }) },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).toContain('一次性基线迁移已启用')
    expect(result.stderr).not.toContain('基线新增 src/harness/new-frozen.ts')
  })

  test('raising a baseline cap is red after the migration window', () => {
    const origin = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/file-size-baseline.json'), 'utf8'))
    const root = createFixture({
      originBaseline: origin,
      baselineMutator: (baseline) => { baseline.entries['electron/catalog/seedBuiltins.ts'].max += 1 },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(100, { name: 'seed' }) },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('基线上调 electron/catalog/seedBuiltins.ts')
  })
})
