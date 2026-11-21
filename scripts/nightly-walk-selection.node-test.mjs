import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { load } from 'js-yaml'
import { loadNightlyExclusions, NIGHTLY_WALK_BATCH_COUNT, nightlyWalkBatchIds, nightlyWalkInventory, selectNightlyWalks, walksForBatch } from './nightly-walk-selection.mjs'
import { expectedBatches } from './nightly-walk-summary.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('nightly exclusions are a reviewed B-category data registry', () => {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/ux/nightly-ci-exclusions.json'), 'utf8'))
  assert.equal(source.version, 1)
  assert.ok(source.exclusions.length > 0)
  const paths = source.exclusions.map((entry) => entry.path)
  assert.equal(new Set(paths).size, paths.length)
  for (const entry of source.exclusions) {
    assert.equal(entry.category, 'B')
    assert.match(entry.path, /^tests\/ux\/.*\.walk\.mjs$/)
    assert.ok(fs.existsSync(path.join(repoRoot, entry.path)), entry.path)
    assert.ok(entry.reason.length > 10, entry.path)
  }
})

test('nightly selection removes only registered exclusions and paid walks', () => {
  const excluded = [...loadNightlyExclusions().keys()]
  const files = [
    'tests/ux/z.walk.mjs',
    'tests/ux/agent-askback-real-model.walk.mjs',
    'tests/ux/paid.paid.mjs',
    'tests/ux/a.walk.mjs',
  ]
  assert.deepEqual(selectNightlyWalks(files), ['tests/ux/a.walk.mjs', 'tests/ux/z.walk.mjs'])
  assert.ok(excluded.includes('tests/ux/agent-askback-real-model.walk.mjs'))
})

test('the repository nightly inventory is reduced exactly by the B registry', () => {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/ux/nightly-ci-exclusions.json'), 'utf8'))
  const files = fs.readdirSync(path.join(repoRoot, 'tests/ux'))
    .map((file) => `tests/ux/${file}`)
  const allWalks = files.filter((file) => file.endsWith('.walk.mjs') && !file.endsWith('.paid.mjs'))
  const selected = selectNightlyWalks(files)
  assert.equal(selected.length, allWalks.length - source.exclusions.length)
  assert.equal(new Set(selected).size, selected.length)
})

test('夜跑清单就是工作流跑的那份：CLI 输出 = nightlyWalkInventory()', () => {
  const cli = execFileSync(process.execPath, [path.join(repoRoot, 'scripts/nightly-walk-selection.mjs'), 'tests/ux'], { cwd: repoRoot, encoding: 'utf8' })
  assert.deepEqual(cli.trim().split('\n'), nightlyWalkInventory())
})

// ---- 夜跑选中的走查自己不许去拿用户真实资料（2026-10-24，夜跑 run 40035294026；N-nightly 第 2 轮并入）----
// 同一条走查在作者本机读真实资料、夜跑机器上读不到：本机绿、夜跑红，而且本机那一遍碰了用户的东西。
// 判据只看代码里真正的调用（注释、字符串里写一句跑法不算）：
//   · 不调真实资料 owner（tests/ux/_realProfile.mjs）读 / 拷 / 删真实资料的那几个口；
//   · prepareIsolation 必须显式 `requireCatalog: false`（缺省就是去拷真实模型目录）；
//   · 不许 launchNomiApp({ isolate: false })（= 用户真实 profile）。
// 确实要真实资料的走查登记进 tests/ux/nightly-ci-exclusions.json（写明去处），或改成 .paid.mjs。
// 已知限制：只认走查文件里亲手写的调用；经辅助模块间接拿的，靠辅助模块自己的隔离（evals/lib/isoApp.mjs、tests/ux/_paidRun.mjs）。

/** _realProfile.mjs 里会读、拷或删用户真实资料的导出。 */
const REAL_DATA_DOORS = ['realNomiProfile', 'readRealCatalog', 'seedRealCredentials', 'seedRealCredentialStore', 'seedRealModels', 'realProfileFingerprint', 'removeRealCredentials']
/** _realProfile.mjs 里不碰资料的导出：常量，和「真 Nomi 在不在跑」的进程探测。 */
const REAL_PROFILE_NO_DATA = ['REAL_PROFILE_ENV', 'REAL_CATALOG_FILE', 'REAL_CREDENTIAL_MARKER', 'realNomiIsRunning', 'realNomiProcessesAlive']

function exportedNames(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const names = []
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.push(statement.name.text)
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.push(element.name.text)
    }
  }
  return names
}

function hasFalseProperty(node, name, source) {
  return Boolean(node && ts.isObjectLiteralExpression(node) && node.properties.some((property) =>
    ts.isPropertyAssignment(property) && property.name.getText(source) === name && property.initializer.kind === ts.SyntaxKind.FalseKeyword))
}

/** 一份走查里亲手写的「去拿真实资料」的调用。 */
function realDataCalls(text, fileName = 'walk.mjs') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const calls = []
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null
      if (callee && REAL_DATA_DOORS.includes(callee)) calls.push({ line: lineOf(node), detail: `${callee}()` })
      if (callee === 'prepareIsolation' && !hasFalseProperty(node.arguments[1], 'requireCatalog', source)) calls.push({ line: lineOf(node), detail: 'prepareIsolation() 没写 requireCatalog: false（缺省就是要真实目录）' })
      if (callee === 'launchNomiApp' && hasFalseProperty(node.arguments[0], 'isolate', source)) calls.push({ line: lineOf(node), detail: 'launchNomiApp({ isolate: false })（= 用户真实 profile）' })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return calls
}

function nightlyRealDataViolations(root) {
  return nightlyWalkInventory({ root }).flatMap((file) => realDataCalls(fs.readFileSync(path.join(root, file), 'utf8'), file)
    .map(({ line, detail }) => `${file}:${line} ${detail}`))
}

test('夜跑选中的走查自己不去拿用户真实资料（要真实资料就登记进 nightly-ci-exclusions.json 或改成 .paid.mjs）', () => {
  assert.deepEqual(nightlyRealDataViolations(repoRoot), [])
})

test('_realProfile.mjs 的每个导出都归了类：拿真实资料的口，或不碰资料的常量 / 进程探测——新加的导出不归类就红', () => {
  const file = path.join(repoRoot, 'tests/ux/_realProfile.mjs')
  assert.deepEqual(exportedNames(fs.readFileSync(file, 'utf8'), file).sort(), [...REAL_DATA_DOORS, ...REAL_PROFILE_NO_DATA].sort())
})

test('夜跑走查自己去拿真实资料的几种写法都认得出；注释与字符串不算', () => {
  const details = (code) => realDataCalls(code).map((entry) => entry.detail)
  assert.deepEqual(details('seedRealCredentials({ settingsDir, userDataDir })'), ['seedRealCredentials()'])
  assert.deepEqual(details('if (fs.existsSync(realNomiProfile().catalogPath)) x()'), ['realNomiProfile()'])
  assert.deepEqual(details('profileTools.readRealCatalog()'), ['readRealCatalog()'])
  assert.equal(details('const iso = prepareIsolation(dir)').length, 1, '缺省 requireCatalog 就是要真实目录')
  assert.equal(details('const iso = prepareIsolation(dir, { requireCatalog: true })').length, 1)
  assert.deepEqual(details('const iso = prepareIsolation(dir, { requireCatalog: false })'), [])
  assert.equal(details("await launchNomiApp({ name: 'x', isolate: false })").length, 1)
  assert.deepEqual(details("await launchNomiApp({ name: 'x' })"), [])
  assert.deepEqual(details('// seedRealCredentials({ settingsDir })\nconst s = "realNomiProfile()"'), [])
})

test('夜跑清单里的走查碰真实资料就红；登记进排除表（写明去处）或改成 .paid.mjs 就不在夜跑里、不红', (t) => {
  const root = makeTempDir('nomi-walk-real-data-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text) }
  const realDataWalk = "import { seedRealCredentials } from './_realProfile.mjs'\nseedRealCredentials({ settingsDir: 's', userDataDir: 'u' })\n"
  write('tests/ux/hermetic.walk.mjs', 'const iso = prepareIsolation(dir, { requireCatalog: false })\n')
  write('tests/ux/real.walk.mjs', realDataWalk)
  write('tests/ux/registered.walk.mjs', realDataWalk)
  write('tests/ux/spend.paid.mjs', realDataWalk)
  write('tests/ux/nightly-ci-exclusions.json', JSON.stringify({ version: 1, exclusions: [{ path: 'tests/ux/registered.walk.mjs', category: 'B', reason: 'requires the real profile; run by hand' }] }))
  assert.deepEqual(nightlyRealDataViolations(root), ['tests/ux/real.walk.mjs:2 seedRealCredentials()'])
})

// ── 夜跑分批：批次数只有一处，而且要跑得完 ──
// 2026-11-21 之前批次数写死 4，分散在工作流的列表、工作流里的取模、汇总脚本的取模三处。
// 11-20 那晚（run 44730628678）：四批各 103 条，实测单条平均 50–89 秒，作业上限 90 分钟——
// 两批只跑到 59 条就被取消，应跑 414 条里 91 条当晚没有结果，这样已连续多晚。
const nightlyWorkflow = () => load(fs.readFileSync(path.join(repoRoot, '.github/workflows/nightly-walkthroughs.yml'), 'utf8'))

test('每条走查恰好落在一批里；不是批号的输入当场报错，不悄悄给空清单', () => {
  const inventory = nightlyWalkInventory()
  const batches = nightlyWalkBatchIds().map((batch) => walksForBatch(inventory, batch))
  assert.deepEqual(batches.flat().sort(), [...inventory].sort())
  assert.equal(new Set(batches.flat()).size, inventory.length)
  for (const bad of [String(NIGHTLY_WALK_BATCH_COUNT), '-1', 'packaged-mac', '', '1.5']) assert.throws(() => walksForBatch(inventory, bad), /夜跑批号只有/, bad)
})

test('工作流的批次列表、它跑的清单、汇总脚本的应跑清单，都出自同一处', () => {
  const walks = nightlyWorkflow().jobs.walks
  assert.deepEqual(walks.strategy.matrix.batch.map(String), nightlyWalkBatchIds(), '工作流的批次列表要和 NIGHTLY_WALK_BATCH_COUNT 一致')
  const run = walks.steps.find((step) => step.name === 'Run non-paid walkthrough batch').run
  assert.match(run, /nightly-walk-selection\.mjs tests\/ux --batch "\$BATCH"/)
  assert.doesNotMatch(run, /%\s*\d/, '工作流里不许再自己取模分批')
  const inventory = nightlyWalkInventory()
  const expected = expectedBatches().filter((entry) => entry.batch !== 'packaged-mac')
  assert.deepEqual(expected.map((entry) => entry.batch), nightlyWalkBatchIds())
  for (const entry of expected) assert.deepEqual(entry.walks, walksForBatch(inventory, entry.batch))
})

test('按 11-20 实测的速度，最大的一批在作业上限内跑得完（留余量）；走查多到跑不完时，这里先红', () => {
  // 实测：最慢的两批单条平均 85、89 秒；装依赖 + 装浏览器 + 构建约 6 分钟。
  const SLOWEST_AVERAGE_SECONDS = 89
  const SETUP_MINUTES = 6
  const minutesFor = (count) => SETUP_MINUTES + (count * SLOWEST_AVERAGE_SECONDS) / 60
  const limit = nightlyWorkflow().jobs.walks['timeout-minutes']
  const inventory = nightlyWalkInventory()
  const largest = Math.max(...nightlyWalkBatchIds().map((batch) => walksForBatch(inventory, batch).length))
  assert.ok(minutesFor(largest) <= limit * 0.85, `最大一批 ${largest} 条约 ${Math.round(minutesFor(largest))} 分钟，超过上限 ${limit} 分钟的 85%：调大 NIGHTLY_WALK_BATCH_COUNT`)
  // 旧案对照：改之前每批 104 条，同一把尺子量出来是跑不完的。
  assert.ok(minutesFor(Math.ceil(inventory.length / 4)) > limit, '4 批的旧分法按同一口径应当超时（这条不成立说明尺子量不出旧问题）')
})
