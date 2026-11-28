// 特征测试（2026-10-21，V-gates 第 2 轮复验 R2-B1 / R2-B2 的攻击形状）——实现前跑是红的（6 红 1 绿，收据 D:/Nomi-tmp/gates-evidence/r3-characterization.txt）；用户 10-22 拍板方案 A（默认全拦）并实现后全绿，留作回归测试。
// 同一处（拍板清单的批准范围）已经修了两轮，第 3 轮按 P1 停止修补：先复盘（docs/engineering/direction-check-2026-10-21-gates-evidence.md），
// 用户拍板结构改法之后再实现；实现后这些测试必须全绿，并作为结构改法的验收。
// 类根因：批准范围是「默认放行」——由 PR 自报的认领集合 + 一份「要保护的字段 / 元素」列表决定；没列到的就漏。
// 每个用例的期望都是「应该被拦（本机入口红）」；当前实现返回绿 = 测试红。
import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluatePrBody } from './pr-body-criteria.mjs'
import { boardApprovalSubject, localApprovals } from './lib/coordApprovals.mjs'

const CREATED = '2026-10-23T00:00:00Z'
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const TABLE = {
  effectiveFrom: '2000-01-01',
  categories: { ui: { label: '新界面 / 改交互', evidence: [] } },
  pathRules: [{ category: 'ui', pattern: '^src/.*\\.tsx$', exclude: '^src/devlab/' }],
  evidenceJudgement: { effectiveFrom: '2026-10-22', boardClaimExceptions: [{ id: 'pure-bugfix', label: '纯 bug 修复' }] },
}
const CARD = [
  '## 设计卡',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者点了按钮没有反应以便当场修好它 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 状态归现有面板，不新增第二份状态 | door-map |',
  '| ★3 一致与复用 | 同类别处 | 复用现有按钮，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 空 加载 成功 失败 各一句话 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 另一条线跑冒烟，回滚 revert 本提交 | 命令 |',
  '### 功能分类',
  '- [x] 新界面 / 改交互',
].join('\n')

const el = (id, overrides = {}) => ({ id, label: `元素 ${id}`, anchor: `[data-board="${id}"]`, states: ['selected'], status: 'implemented', assertions: ['x'], ...overrides })
const board = (elements, overrides = {}) => ({ board: 'Foo', stage: 'built', functionCensus: elements.map((element) => ({ function: `旧功能 ${element.id}`, after: element.id })), elements, ...overrides })
const BASE = { Foo: board([el('a'), el('b')]) }

const approvalsWith = (records) => localApprovals({ pr: 7, env: { NOMI_COORD_APPROVALS: 'approvals.jsonl' }, readFile: () => records.map((record) => JSON.stringify(record)).join('\n') })
const recordFor = (baseBoard, headBoard) => ({ pr: 7, kind: 'board', name: 'Foo', sha256: boardApprovalSubject('Foo', baseBoard, headBoard).fingerprint, at: 'T', note: '' })
const run = (head, { claim = '- Foo: a', approvals = approvalsWith([]), files = [{ path: 'src/workbench/Foo.tsx', status: 'M' }], base = BASE } = {}) => evaluatePrBody({
  body: claim === null ? CARD : `${CARD}\n## 拍板图\n${claim}`,
  files, createdAt: CREATED, table: TABLE, scenarios: { ids: [], byId: new Map(), problems: [] },
  evidence: { headSha: HEAD, readReport: () => undefined, readRaw: () => null, boards: { Foo: head }, baseBoards: base, approvals },
})
const text = (result) => result.lines.join('\n')
const mustBlock = (result, why) => assert.equal(result.blocked, true, `${why}：应该被拦（需要协调确认），实际放行了\n${text(result)}`)

test('R2-B1·删掉已批准的元素 b，删掉旧功能普查，正文只认领 a → 应该拦', () => {
  const head = board([el('a')], { functionCensus: [{ function: '旧功能 a', after: 'a' }] })
  mustBlock(run(head), '删元素')
})

test('R2-B1·只改板级合同字段（functionCensus / stage / 设计来源），元素一个没动 → 应该拦', () => {
  mustBlock(run(board([el('a'), el('b')], { designIntent: 'changed' })), '改设计意图')
  mustBlock(run(board([el('a'), el('b')], { functionCensus: [{ function: '旧功能 a', after: 'a' }] })), '删一条旧功能普查')
  mustBlock(run(board([el('a'), el('b')], { sourceBoundary: '把边界说成别的' })), '改板级来源字段')
})

test('R2-B1·批准之后又删了别的元素（批准哈希只覆盖当时的改动）→ 应该拦', () => {
  const approvedHead = board([el('a', { label: '改过的 a' }), el('b')])
  const record = recordFor(BASE.Foo, approvedHead)
  const ok = run(approvedHead, { approvals: approvalsWith([record]) })
  assert.equal(ok.blocked, false, `前提：批准当时的内容应该放行\n${text(ok)}`)
  mustBlock(run(board([el('a', { label: '改过的 a' })]), { approvals: approvalsWith([record]) }), '批准后删 b')
})

test('R2-B2·新增一个未批准的元素，但正文只认领旧元素 a → 应该拦（要确认的集合看真实 diff，不看认领）', () => {
  mustBlock(run(board([el('a'), el('b'), el('new')])), '新增 new 不认领')
})

test('R2-B2·改写了元素 b 的合同，却认领另一个没动的旧元素 a → 应该拦', () => {
  mustBlock(run(board([el('a'), el('b', { anchor: '未定' })])), '改写 b 锚点')
  mustBlock(run(board([el('a'), el('b', { states: ['dark'] })])), '改 b 的 states 认领 a')
})

test('R2-B2·清单变了，正文完全不写 `## 拍板图` 一节（也不是界面改动）→ 应该拦', () => {
  const head = board([el('a'), el('b'), el('new')])
  mustBlock(run(head, { claim: null, files: [{ path: 'docs/design/boards/2026-10-23/Foo.board.json', status: 'M' }] }), '纯清单改动、没有拍板图节')
  mustBlock(run(head, { claim: null }), '改界面但不写拍板图节、清单也变了')
})

test('对照（好例，现在就该绿）：只更新实现进度字段（assertions / owner；status 仍是 implemented）、认领旧元素 → 放行', () => {
  const head = board([el('a', { owner: '#9', assertions: ['y'] }), el('b')])
  const result = run(head)
  assert.equal(result.blocked, false, text(result))
})
