// `check:mcp-operation-constructible` 这道门自己的完整性测试（R17「加规则必须先验它会红」的常驻版）。
//
// 这道门 2026-09-18 从「可构造」升级成「可填」。升级的那一半特别容易变成摆设：**它自己会把缺的字段
// 补上**，所以尺子坏了的表现就是一句「✅ 全部可构造」——比没有门更糟。这里不测被测对象，测尺子：
// 把登记表与传输 schema 逐条变异，门必须每一条都红；变异撤掉，门必须回绿。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertGateIsOnContracts, createGateMutationHarness } from './gate-mutation-harness.mjs'

// 门岗只当数据读这些目录，不执行也不变异它们：junction 过去，省掉 20 多秒复制。
const SHARED_DATA_DIRS = ['docs', 'src', 'tests', 'evals', '.design-sync', 'outputs', 'worker', 'workers', 'infra']

const { runGate, withMutation } = createGateMutationHarness({
  gate: 'scripts/check-mcp-operation-constructible.mjs',
  shareDirs: SHARED_DATA_DIRS,
})

test('门岗在今天的代码上是绿的', () => {
  const outcome = runGate()
  assert.equal(outcome.red, false, `门岗本该绿：\n${outcome.output}`)
})

test('这道门岗进了 contracts 档，不是一个没人跑的脚本', () => {
  assertGateIsOnContracts('check:mcp-operation-constructible')
})

const MUTATIONS = [
  ['可填 · 删掉一条来源登记（这个字段外面从哪拿到，没人答得出）', [
    ['scripts/check-mcp-operation-constructible.mjs',
      "  'nomi_canvas_edit :: nodeIds': 'from-tool:nomi_read',\n", ''],
  ], /答不出|从哪拿到/],
  ['可填 · 来源指向一个 tools\\/list 上没有的工具（那个工具后来被删了/改名了）', [
    ['scripts/check-mcp-operation-constructible.mjs',
      "  'nomi_canvas_edit :: nodeIds': 'from-tool:nomi_read',",
      "  'nomi_canvas_edit :: nodeIds': 'from-tool:nomi_read_canvas',"],
  ], /没有这个工具/],
  ['可填 · 过期的登记（那个字段已经不必填了，或者那个 operation 没了）', [
    ['scripts/check-mcp-operation-constructible.mjs',
      "const PROVENANCE_ARCHETYPE =",
      "MCP_INPUT_PROVENANCE['nomi_canvas_edit :: aFieldNobodyNeeds'] = 'caller-authored'\nconst PROVENANCE_ARCHETYPE ="],
  ], /过期的声明/],
  ['可填 · 传输 schema 新长出一个必填字段而没人登记它的来源（真正要拦的那件事）', [
    ['electron/shared/agentCapabilities/canvasDelete.ts',
      '    reason: z.string().trim().max(300).optional(),',
      '    reason: z.string().trim().max(300).optional(),\n    requestedBy: z.string().trim().min(1),'],
  ], /requestedBy/],
]

for (const [name, edits, expected] of MUTATIONS) {
  test(`变异验红 · ${name}`, () => {
    const outcome = withMutation(edits, runGate)
    assert.equal(outcome.red, true, `把登记表或 schema 改坏之后门岗仍然绿 —— 这道门在这一类上是瞎的（${name}）`)
    assert.match(outcome.output, expected, `红了，但红在别的判据上（${name}）：\n${outcome.output}`)
  })
}

test('变异全部撤掉之后门岗回绿（证明上面的红来自变异，不是仪器坏了）', () => {
  assert.equal(runGate().red, false)
})
