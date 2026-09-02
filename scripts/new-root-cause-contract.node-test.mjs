// 钉住脚手架与 validator 的咬合（2026-09-02）：buildSkeleton 的字段面必须和
// scripts/root-cause-contracts.mjs 的结构层要求一一对齐——validator 加了必填字段而骨架没跟上，
// 这里的「填完即绿」用例会当场红；骨架带着 TODO 想混过门，「未填必红」用例保证它混不过。
// 随 check:root-cause-contracts 一起跑（package.json 同一条 script）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSkeleton, writeSkeleton } from './new-root-cause-contract.mjs'
import { validateRootCauseChange } from './root-cause-contracts.mjs'

const CONTRACT_FILE = 'docs/fixes/test-scaffold.root-cause.json'
const BOUNDARY = 'scripts/example-boundary.mjs'
const CLASS_TEST = 'tests/example/scaffold-class.test.mjs'
const SECOND_ENTRY = 'electron/example/other-entry.ts'

// 结构层的「宇宙」：validator 的存在性/变化性检查对照的是传入集合，不是真实磁盘——
// 这正好让本测试只钉结构层（字段形状、枚举、⊆ 关系），不掺进真实 diff。
const existingFiles = new Set([CONTRACT_FILE, BOUNDARY, CLASS_TEST, SECOND_ENTRY])
const changedFiles = [CONTRACT_FILE, BOUNDARY, CLASS_TEST]

/** 把骨架的每个 TODO 换成一套自洽的具体值——模拟「用户按行内说明填完」。 */
function filledSkeleton() {
  const c = buildSkeleton('test-scaffold')
  const text = (value) => `已填：${value}`
  for (const key of ['problem_type', 'symptom', 'direct_cause', 'class_root', 'migration', 'generality_proof']) {
    c[key] = text(key)
  }
  for (const key of ['affected_population', 'entry_points', 'invariants', 'residual_risks']) {
    c[key] = [text(key)]
  }
  c.scope_paths = ['scripts/']
  c.regression_tests = [CLASS_TEST]
  c.class_regression_tests = [CLASS_TEST]
  delete c.internal_only_reason
  c.external_sources = [
    { kind: 'source-code', url: 'https://example.com/upstream', checked_at: '2026-09-02', purpose: text('对账') },
  ]
  c.recurrence = { classification: 'recurring', reason: text('复发机制'), same_class_scan: ['scripts/foo.mjs:12'] }
  c.shared_boundaries = [{ path: BOUNDARY, symbol: 'guard()', responsibility: text('拦截') }]
  c.same_class_entry_points = [
    { path: BOUNDARY, entry_point: 'guard', disposition: 'enforced', evidence: text('证据一') },
    { path: SECOND_ENTRY, entry_point: 'other', disposition: 'not-affected', evidence: text('证据二') },
  ]
  c.prevention = {
    kind: 'static-gate',
    enforcement_path: BOUNDARY,
    invariant: text('不变量'),
    failure_mode: text('报红方式'),
    exception_policy: 'none',
    strategy: text('策略'),
    artifacts: [BOUNDARY],
  }
  c.legacy_paths = { status: 'not-applicable', removed_paths: [], rationale: text('无旧可删') }
  c.dependency_lifecycle = { decision: 'not-applicable', rationale: text('无依赖决策'), exit_criteria: [] }
  return c
}

function validate(contract) {
  return validateRootCauseChange({
    changedFiles,
    contracts: [{ ...contract, __file: CONTRACT_FILE }],
    existingFiles,
  })
}

test('未填的骨架不可能混过 validator（枚举位是非法 TODO，必红）', () => {
  const result = validate(buildSkeleton('test-scaffold'))
  assert.equal(result.ok, false)
  assert.ok(result.errors.length > 0)
})

test('按行内说明填完 TODO 后，recurring 合同过 validator 结构层', () => {
  const result = validate(filledSkeleton())
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
})

test('降档为 one_off（删 prevention）同样过结构层', () => {
  const contract = filledSkeleton()
  contract.recurrence.classification = 'one_off'
  delete contract.prevention
  const result = validate(contract)
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
})

test('writeSkeleton 落盘为合法 JSON、拒绝覆盖、拒绝越界 id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-contract-scaffold-'))
  try {
    const target = writeSkeleton('2026-09-02-demo', dir)
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    assert.equal(parsed.schema_version, 3)
    assert.equal(parsed.id, '2026-09-02-demo')
    assert.throws(() => writeSkeleton('2026-09-02-demo', dir), /已存在/)
    assert.throws(() => writeSkeleton('../escape', dir), /非法 id/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
