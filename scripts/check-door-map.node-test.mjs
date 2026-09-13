// 数门门岗的判据测试（R21，2026-09-11）。两件事各钉一遍：
//   ① 判据层（door-map-lib）：喂假合同 + 假 PR 正文，验「recurring 没门表 / 正文没引用」必红；
//   ② 数门脚本（door-map.mjs）：拿今天三个真实案例当回归——脚本数不出这些已知的门就是不合格。
// 判据能被喂假仓库，是为了测得到「明天新增一份没数门的合同会不会红」，而不是只测今天的存量（R17）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DOOR_MAP_THRESHOLD_DATE, contractDate, evaluatePullRequest, governedContracts, referencedContracts } from './door-map-lib.mjs'
import { mapDoors } from './door-map.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = 'docs/fixes/2026-09-11-fixture.root-cause.json'
const door = { kind: 'write', path: 'electron/example/entry.ts', line: 12, symbol: 'applyThing' }
const recurring = (doors) => ({ file: FILE, contract: { recurrence: { classification: 'recurring' }, ...(doors ? { doors } : {}) } })

test('阈值与日期解析：没有日期前缀的合同不受管', () => {
  assert.equal(contractDate(FILE), '2026-09-11')
  assert.equal(contractDate('docs/fixes/fixture-media.root-cause.json'), null)
  assert.equal(governedContracts({ contracts: [{ file: 'docs/fixes/fixture.root-cause.json', contract: { recurrence: { classification: 'recurring' } } }] }).length, 0)
})

test('阈值之前的合同不追溯；one_off 不进 PR 侧管辖', () => {
  const older = { file: 'docs/fixes/2026-09-10-fixture.root-cause.json', contract: { recurrence: { classification: 'recurring' } } }
  assert.deepEqual(evaluatePullRequest({ body: '', contracts: [older] }), [])
  const oneOff = { file: FILE, contract: { recurrence: { classification: 'one_off' } } }
  assert.deepEqual(evaluatePullRequest({ body: '', contracts: [oneOff] }), [])
})

test('recurring 合同没门表就红（先验它会红）', () => {
  const errors = evaluatePullRequest({ body: `本 PR 落 ${FILE}`, contracts: [recurring(null)] })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /没有门表/)
  assert.match(errors[0], /door-map\.mjs/)
})

test('门表在、但 PR 正文没引用那份合同，也红', () => {
  const errors = evaluatePullRequest({ body: '修好了，跑了五门。', contracts: [recurring([door])] })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /PR 正文没有引用这份根因合同/)
})

test('门表在且正文引用得到 → 绿', () => {
  assert.deepEqual(evaluatePullRequest({ body: `根因合同：[门表](${FILE})`, contracts: [recurring([door])] }), [])
  assert.deepEqual(referencedContracts(`see ${FILE} and docs/fixes/other.root-cause.json`), [FILE, 'docs/fixes/other.root-cause.json'])
})

test(`门岗默认阈值是 ${DOOR_MAP_THRESHOLD_DATE}`, () => {
  assert.equal(DOOR_MAP_THRESHOLD_DATE, '2026-09-11')
})

// —— 数门脚本对今天三个真实案例的回归 ——
// 这三簇就是本规则的起因。脚本数不出这些已知的门，规则就落不了地——所以它们是断言，不是注释。
const sourceFiles = (() => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(repoRoot, full).split(path.sep).join('/')
      if (/(?:^|\/)(?:node_modules|dist|release|\.tmp)(?:\/|$)/.test(rel)) continue
      if (entry.isDirectory()) walk(full)
      else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/.test(rel)) files.push(rel)
    }
  }
  for (const root of ['src', 'electron']) walk(path.join(repoRoot, root))
  return files
})()

const doorsFor = (targetSymbols, forced = new Map()) => mapDoors({
  files: sourceFiles,
  readFile: (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8'),
  targetSymbols,
  forced,
})

test('案例一（画布写入）：applyCanvasToolCall 的写入口不止一扇，门 B 在 capabilityApplyHandler', () => {
  const doors = doorsFor(['applyCanvasToolCall'])
  const writePaths = new Set(doors.filter((entry) => entry.kind === 'write').map((entry) => entry.path))
  assert.ok(writePaths.size >= 5, `期望 ≥5 个写入口文件，实得 ${writePaths.size}：${[...writePaths].join(', ')}`)
  assert.ok(writePaths.has('src/workbench/capability/capabilityApplyHandler.ts'))
  assert.ok(writePaths.has('src/workbench/generationCanvas/agent/proposalTxn.ts'))
  // 门 A（executeCanvasWriteTarget）隔一跳：它走 applyProposalBatch 进 proposalTxn。
  // 数门脚本只数**直接**调用点——这条限制是刻意的（见 door-map.mjs 头部），所以再数一跳才看得见它。
  const hop = doorsFor(['applyProposalBatch'])
  assert.ok(hop.some((entry) => entry.path === 'src/workbench/generationCanvas/agent/canvasWriteTarget.ts'))
})

test('案例二（付费收据）：收据门的签发方只有一个，核验方却有两个装配点', () => {
  const doors = doorsFor(['createGateApprovalOwner', 'assertCurrentProjectRevision'])
  const issue = doors.filter((entry) => entry.symbol === 'createGateApprovalOwner')
  assert.deepEqual(issue.map((entry) => entry.path), ['electron/productionRun/productionRunService.ts'])
  const verifyPaths = new Set(doors.filter((entry) => entry.symbol === 'assertCurrentProjectRevision' && entry.kind === 'write').map((entry) => entry.path))
  assert.ok(verifyPaths.has('electron/capabilityCore/runOwnedGenerationGateAuthority.ts'))
  assert.ok(verifyPaths.has('electron/capabilityCore/productionTrustGrantChallenge.ts'))
})

test('案例三（技能事实）：SkillRecord 的消费者 ≥7 个模块（docs/audit/2026-09-11-skill-fact-projections-structure.md）', () => {
  const doors = doorsFor(['readSkillRecords', 'discoverSkillRecordsFromRoots'], new Map([
    ['readSkillRecords', 'read'],
    ['discoverSkillRecordsFromRoots', 'read'],
  ]))
  assert.ok(doors.every((entry) => entry.kind === 'read'), '显式 --read= 必须压过默认启发式')
  const consumers = new Set(doors.map((entry) => entry.path).filter((file) => file !== 'electron/skills/skillStore.ts'))
  assert.ok(consumers.size >= 7, `期望 ≥7 个消费者模块，实得 ${consumers.size}：${[...consumers].join(', ')}`)
  for (const expected of [
    'electron/agentLane/laneDesktopRuntime.ts',
    'electron/promptLibrary/curatedPrompts.ts',
    'electron/skills/skillIpc.ts',
    'electron/skills/skillPreview.ts',
    'electron/skills/skillExecutionEvidence.ts',
  ]) assert.ok(consumers.has(expected), `漏数了消费者：${expected}`)
})

test('数门不把声明、import 绑定和对象键当成门', () => {
  const doors = mapDoors({
    files: ['fixture.ts'],
    readFile: () => [
      "import { applyThing } from './other'",
      'export function applyThing() {}',
      'const map = { applyThing: 1 }',
      'applyThing()',
      'const alias = applyThing',
    ].join('\n'),
    targetSymbols: ['applyThing'],
  })
  assert.deepEqual(doors, [
    { kind: 'read', path: 'fixture.ts', line: 5, symbol: 'applyThing' },
    { kind: 'write', path: 'fixture.ts', line: 4, symbol: 'applyThing' },
  ])
})
