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

/** 生成恰好 `lines + 2` 行格式化代码（`export function name() {` + `lines` 条 const + `}`）。 */
function fixtureContent(lines, { name = 'fixture', comments = false } = {}) {
  const body = Array.from({ length: lines }, (_, index) => `  const ${name}_${index} = ${index}`)
  if (!comments) return `export function ${name}() {\n${body.join('\n')}\n}\n`
  return `export function ${name}() {\n${body.map((line) => `${line} // comment ${line}`).join('\n')}\n}\n`
}

function frozenEntry(max, kind = 'frozen') {
  return { kind, max, reason: '新口径落地时已超线，冻结，按职责逐步拆', topDeclarations: [] }
}

function createFixture({
  files = {},
  baselineEntries = {},
  baselineMutator = null,
  originBaseline = null,
  originLegacyAllowlist = null,
  commitAfterOrigin = false,
} = {}) {
  const root = makeTempDir('nomi-file-sizes-')
  temporaryRoots.push(root)
  fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'scripts/check-file-sizes.mjs'), path.join(root, 'scripts/check-file-sizes.mjs'))
  fs.copyFileSync(path.join(repoRoot, 'scripts/lib/gitPaths.mjs'), path.join(root, 'scripts/lib/gitPaths.mjs'))
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  const baselinePath = path.join(root, 'scripts/file-size-baseline.json')
  const baseline = { version: 1, entries: structuredClone(baselineEntries) }
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
    if (commitAfterOrigin) {
      execFileSync('git', ['add', '--', 'scripts/file-size-baseline.json'], { cwd: root })
      execFileSync('git', ['commit', '--quiet', '-m', 'branch-change'], { cwd: root })
    }
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

function run(root, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-file-sizes.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NOMI_FILESIZE_SKIP_BASELINE_COMPARE: '1', ...extraEnv },
  })
}

function runWithOrigin(root, extraEnv = {}) {
  const env = { ...process.env, NOMI_FILESIZE_ORIGIN_REF: 'origin/main', ...extraEnv }
  delete env.NOMI_FILESIZE_SKIP_BASELINE_COMPARE
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-file-sizes.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env,
  })
}

describe('formatted TypeScript file-size gate', () => {
  test('real repository passes check:filesize with zero errors and zero slack', () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/check-file-sizes.mjs')], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, NOMI_FILESIZE_SKIP_BASELINE_COMPARE: '1' },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('文件体积门岗通过')
    const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/file-size-baseline.json'), 'utf8'))
    for (const [file, entry] of Object.entries(baseline.entries)) {
      expect(entry.max, `${file} 基线上限必须严格大于 800`).toBeGreaterThan(800)
    }
  }, 60_000)

  test('rejects a new 801-line production module and names the largest declaration', () => {
    const root = createFixture({ files: { 'electron/harness/oversized.ts': fixtureContent(799, { name: 'oversized' }) } })
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

  test('frozen file at exact cap (>800, zero slack) passes', () => {
    const root = createFixture({
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(850) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(848, { name: 'KIE_CURATED_MAPPINGS' }) },
    })
    const result = run(root)
    expect(result.status, result.stderr).toBe(0)
  })

  test('frozen file growth is red and names its largest declaration', () => {
    const root = createFixture({
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(940) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(950, { name: 'KIE_CURATED_MAPPINGS' }) },
    })
    const result = run(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toMatch(/seedBuiltins\.ts: .*冻结上限 940/)
    expect(result.stderr).toContain('KIE_CURATED_MAPPINGS')
  })

  test('zero-slack ratchet: baseline cap higher than measured lines (850 vs 840) is red', () => {
    const root = createFixture({
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(850) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(838, { name: 'KIE_CURATED_MAPPINGS' }) },
    })
    const result = run(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toMatch(/seedBuiltins\.ts: 登记上限 850 高出当前实测 840 行.*收紧为 840/)
  })

  test('retirement ratchet: baseline entry at or below 800 lines must be removed from baseline', () => {
    const atRedLine = createFixture({
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(800) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(798, { name: 'seed' }) },
    })
    const atRedResult = run(atRedLine)
    expect(atRedResult.status, atRedResult.stderr).toBe(1)
    expect(atRedResult.stderr).toMatch(/seedBuiltins\.ts: 当前实测 800 行 <= 红线 800.*退表移除/)

    const belowRedLine = createFixture({
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(850) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(788, { name: 'seed' }) },
    })
    const belowResult = run(belowRedLine)
    expect(belowResult.status, belowResult.stderr).toBe(1)
    expect(belowResult.stderr).toMatch(/seedBuiltins\.ts: 当前实测 790 行 <= 红线 800.*退表移除/)

    const tinyFile = createFixture({
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(850) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(8, { name: 'seed' }) },
    })
    const tinyResult = run(tinyFile)
    expect(tinyResult.status, tinyResult.stderr).toBe(1)
    expect(tinyResult.stderr).toMatch(/seedBuiltins\.ts: 当前实测 10 行 <= 红线 800.*退表移除/)
  })

  test('retirement ratchet: deleted file still present in baseline is red', () => {
    const root = createFixture({
      baselineEntries: { 'electron/catalog/deleted.ts': frozenEntry(850) },
      files: {},
    })
    const result = run(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toMatch(/electron\/catalog\/deleted\.ts: 基线文件已不存在.*退表移除/)
  })

  test('gracefully skips origin drift comparison when origin/main is absent, while still enforcing zero-slack', () => {
    const root = createFixture({
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(850) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(838, { name: 'seed' }) },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('跳过基线漂移比较')
    expect(result.stderr).toMatch(/登记上限 850 高出当前实测 840 行/)
  })

  test('a new baseline entry is red after the migration window', () => {
    const origin = { version: 1, entries: {} }
    const root = createFixture({
      originBaseline: origin,
      commitAfterOrigin: true,
      baselineEntries: { 'src/harness/new-frozen.ts': frozenEntry(900) },
      files: { 'src/harness/new-frozen.ts': fixtureContent(898, { name: 'newFrozen' }) },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('基线新增 src/harness/new-frozen.ts')
  })

  test('the one-time migration is open only while origin/main has no baseline JSON, whatever its commit id', () => {
    const root = createFixture({
      originLegacyAllowlist: { 'electron/main.ts': 900 },
      baselineEntries: { 'src/harness/new-frozen.ts': frozenEntry(900) },
      files: { 'src/harness/new-frozen.ts': fixtureContent(898, { name: 'newFrozen' }) },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).toContain('一次性基线迁移已启用')
    expect(result.stderr).not.toContain('基线新增 src/harness/new-frozen.ts')
  })

  test('raising a baseline cap relative to merge-base is red even when file matches new cap', () => {
    const origin = { version: 1, entries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(850) } }
    const root = createFixture({
      originBaseline: origin,
      commitAfterOrigin: true,
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(851) },
      files: { 'electron/catalog/seedBuiltins.ts': fixtureContent(849, { name: 'seed' }) },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('基线上调 electron/catalog/seedBuiltins.ts')
  })

  test('lowering a baseline cap in sync with shrinking file (or retiring <=800) passes against merge-base', () => {
    const origin = {
      version: 1,
      entries: {
        'electron/catalog/seedBuiltins.ts': frozenEntry(850),
        'electron/catalog/retired.ts': frozenEntry(820),
      },
    }
    const root = createFixture({
      originBaseline: origin,
      commitAfterOrigin: true,
      baselineEntries: { 'electron/catalog/seedBuiltins.ts': frozenEntry(840) },
      files: {
        'electron/catalog/seedBuiltins.ts': fixtureContent(838, { name: 'seed' }),
        'electron/catalog/retired.ts': fixtureContent(788, { name: 'retired' }),
      },
    })
    const result = runWithOrigin(root)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('基线下调 electron/catalog/seedBuiltins.ts: 840 < origin/main 850')
  })
})
