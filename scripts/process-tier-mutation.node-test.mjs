// 流程档位护栏的「真红」自检：在隔离副本里逐字节改坏判据或夹具，对应的断言必须红，还原后必须回绿。
// 真实工作区一个字节都不碰（副本机制见 scripts/gate-mutation-harness.mjs）。
// 每条反例都点名「红在哪个断言」——护栏那条单独断言它红，不和别的测试合取；被测标题与 scripts/process-tier.node-test.mjs 里的是同一串。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createGateMutationHarness } from './gate-mutation-harness.mjs'

const LIB = 'scripts/pr-judgement-lib.mjs'
const BODY = 'scripts/pr-body-criteria.mjs'
const TESTS = 'scripts/process-tier.node-test.mjs'
const FIXTURE = 'scripts/fixtures/process-tiering-replay.json'
const harness = createGateMutationHarness({
  gate: TESTS,
  shareDirs: ['docs', 'src', 'electron', 'tests', 'evals', 'outputs', 'marketing', 'skills', 'infra', 'worker', 'workers', 'agent-skills', 'public', 'resources', 'build'],
})

const GUARD = '回放护栏：夹具里每个 PR（空正文、无声明）新规判严 ⇔ 现行四类 inferRoutes(...).fourClass'
const COVERAGE = '回放护栏覆盖：四类里每一类，夹具中都至少有一个 PR 只因这一类才严'
const COUNT = '回放夹具：只存输入，PR 数等于生成时记下的数'
const CONFLICT = '声明短档、界面清单有差异或核实不了：落标准档，不升严'
const LEDGER = '让逃逸账本转 fixed 的 PR 永远不进短档：四类之外至少标准，四类之内仍是严'
const BOARD = '短档不免清单合同的批准：纯文档 PR 改了拍板清单，没有协调确认记录照样红'

/** 判据里「严档就是四类」那一行：所有反例都改它（或它旁边）。 */
const STRICT_GATE = '  if (inferred?.fourClass) {'
const TIER_RETURN = '  return { tier: short ? PROCESS_TIERS.SHORT : PROCESS_TIERS.STANDARD, declaration, autoShort, uiVerification: ui, failures, lines }'
const LEDGER_LINE = '  if (ledgerTransitions.length) failures.push('
// 旧判法整套原样（来自把关键词当硬线的那一版）：路径关键词 + 变更意图正文关键词
const HARD_PATH = '/(?:security|credential|secret|auth|permission|crash|panic|fatal|schema|migrat|persist|projectFile|projectStore|projectVersion|direction-check)/i'
const HARD_BODY = '/(?:数据格式|安全|崩溃|crash|security|data[- ]format|direction[- ]check)/i'

/** 在副本里跑判定 + 护栏测试文件；failed = 没通过的测试标题。 */
function runTests() {
  // 本文件自己就跑在 node:test 里：子进程继承 NODE_TEST_CONTEXT 会拒绝再起一次 --test，要清掉
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', TESTS], { cwd: harness.copyRootForTests(), encoding: 'utf8', env })
  const failed = [...child.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1].trim())
  return { status: child.status, failed, output: `${child.stdout}${child.stderr}`.slice(-1500) }
}
const mutate = (edits) => harness.withMutation(edits, runTests)
const redAt = (run, title, why) => assert.ok(run.failed.includes(title), `${why}\n没有在「${title}」红；实际红的：${JSON.stringify(run.failed)}\n${run.output}`)

test('基线：副本里未改坏时，判定与护栏全绿', () => {
  const baseline = runTests()
  assert.equal(baseline.status, 0, baseline.output)
  assert.deepEqual(baseline.failed, [])
})

test('反例 ①：把旧关键词硬线（HARD_PATH / HARD_BODY）整套加回去 → 护栏本身红（单独断言）', () => {
  const keywordGate = `  const HARD_PATH = ${HARD_PATH}\n  const HARD_BODY = ${HARD_BODY}\n  if (inferred?.fourClass || files.some((file) => HARD_PATH.test(norm(file.path))) || HARD_BODY.test(String(extractSection(body, INTENT_SECTION) || ''))) {`
  const run = mutate([[LIB, STRICT_GATE, keywordGate]])
  redAt(run, GUARD, '关键词加回去，会把四类之外的 PR 也判严，护栏必须红')
  assert.equal(runTests().status, 0, '还原后回绿')
})

test('反例 ②：去掉四类里任意一类的判严（花钱 / 长跑 / 可打断 / 新界面各一次）→ 护栏红', () => {
  for (const label of ['花钱', '长跑', '可打断', '新界面']) {
    const run = mutate([[LIB, STRICT_GATE, `  if ((inferred?.classes ?? []).some((name) => name !== '${label}')) {`]])
    redAt(run, GUARD, `去掉「${label}」的判严，护栏必须红`)
  }
  assert.equal(runTests().status, 0, '还原后回绿')
})

test('反例 ②′：别的升严来源（账本转 fixed、数据格式类别）加回去 → 护栏红', () => {
  const ledger = mutate([[LIB, STRICT_GATE, '  if (inferred?.fourClass || ledgerTransitions.length) {']])
  redAt(ledger, GUARD, '账本转 fixed 判严，护栏必须红（夹具带着账本转换这项输入）')
  // 数据格式是路由类别（不在四类 classification 里）：要连总入口一起改回「把 judgement.inferred 交给判据」才有这个来源
  const dataFormat = mutate([
    [LIB, STRICT_GATE, "  if (inferred?.fourClass || (inferred?.categories ?? []).some((category) => category.id === 'data-format')) {"],
    [BODY, '    inferred: classification,', '    inferred: judgement.inferred,'],
  ])
  redAt(dataFormat, GUARD, '数据格式类别判严，护栏必须红')
  assert.equal(runTests().status, 0, '还原后回绿')
})

test('反例 ③：恢复「声明与核实对不上就升严」→ 对应单测红', () => {
  const conflictGate = '  return { tier: short ? PROCESS_TIERS.SHORT : declaredShort && ui?.known === true && ui.changed === true ? PROCESS_TIERS.STRICT : PROCESS_TIERS.STANDARD, declaration, autoShort, uiVerification: ui, failures, lines }'
  const run = mutate([[LIB, TIER_RETURN, conflictGate]])
  redAt(run, CONFLICT, '声明短档、界面清单有差异就升严，单测必须红')
  assert.equal(runTests().status, 0, '还原后回绿')
})

test('反例 ④：让账本转 fixed 的纯文档单进短档 → 对应单测红', () => {
  const run = mutate([[LIB, LEDGER_LINE, '  if (false && ledgerTransitions.length) failures.push(']])
  redAt(run, LEDGER, '账本转 fixed 的纯文档单进短档，单测必须红')
  assert.equal(runTests().status, 0, '还原后回绿')
})

/** 改夹具：副本里写坏、跑完、字节还原。 */
function mutateFixture(change) {
  const file = path.join(harness.copyRootForTests(), FIXTURE)
  const original = fs.readFileSync(file, 'utf8')
  try {
    const data = JSON.parse(original)
    change(data)
    fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`)
    return runTests()
  } finally {
    fs.writeFileSync(file, original)
  }
}

test('反例 ⑤：从夹具删掉一个 PR（没重跑生成脚本）→ 数量断言红', () => {
  const run = mutateFixture((data) => { data.prs.splice(7, 1) })
  redAt(run, COUNT, '夹具少一个 PR 而生成时记下的数没变，数量断言必须红')
  assert.equal(runTests().status, 0, '还原后回绿')
})

test('反例 ⑥：夹具丢掉 diff 规则要读的新增行（压缩有损）→ 覆盖断言红', () => {
  const run = mutateFixture((data) => { for (const pr of data.prs) delete pr.added })
  redAt(run, COVERAGE, '只因「可打断」才严的 PR 靠新增行认出来，丢了新增行覆盖断言必须红')
  assert.equal(runTests().status, 0, '还原后回绿')
})

test('反例 ⑦：短档连清单合同的批准一起免掉（把 strict 又绑回档位）→ 对应单测红', () => {
  const run = mutate([[BODY, 'strict: strictEvidence, claimsRequired: !short,', 'strict: strictEvidence && !short, claimsRequired: !short,']])
  redAt(run, BOARD, '短档改拍板清单不用协调确认，单测必须红')
  assert.equal(runTests().status, 0, '还原后回绿')
})
