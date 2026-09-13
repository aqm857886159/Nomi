// `check:tool-face` 的**规则自测**（R17：加规则必须先验它会红）。
//
// 每条规则配一个阳性对照（刻意违规，断言被抓到）和一个合法近邻（断言不被误伤）。
// 少了后者，一个「什么都判红」的规则也能通过。规则本体是 TS，本文件由 `tsx --test` 跑。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RULES, TOOL_SHAPE_EXEMPTIONS, fieldDescriptions, handwrittenMcp, mutualTiebreak, nameConvention,
  orphanAliases, scanOwnerDrift, transitionalProfiles,
} from './check-tool-face.ts'

test('规则清单里每条都有档位与理由', () => {
  for (const rule of RULES) {
    assert.ok(rule.mode === 'hard' || rule.mode === 'ratchet', rule.id)
    assert.ok(rule.why.length > 10, rule.id)
  }
})

test('single-description-owner：契约上的 projections 块 / *DescriptionForAlias / 清单 intent 被抓到；owner 文件与 verbs/ 不被误伤', () => {
  const drift = scanOwnerDrift([
    { path: 'electron/shared/agentCapabilities/foo.ts', text: 'export const X = {\n  id: "x",\n  projections: { pi: { description: "again" } },\n};' },
    { path: 'electron/shared/agentCapabilities/bar.ts', text: 'export function barPiDescriptionForAlias(alias: string) { return "again"; }' },
    { path: 'electron/harness/tools/manifest.ts', text: 'const t = { name: "x", intent: "again", capabilityRefs: ["x"] }' },
  ])
  assert.deepEqual(drift.map((f) => f.rule), ['single-description-owner', 'single-description-owner', 'single-description-owner'])
  // 合法近邻：owner 本体、verbs/ 目录、测试文件都不算第二份。
  assert.deepEqual(scanOwnerDrift([
    { path: 'electron/shared/agentCapabilities/verbDeclarations.ts', text: 'projections: {' },
    { path: 'electron/shared/agentCapabilities/verbs/x.ts', text: 'function xDescriptionForAlias() {}' },
    { path: 'electron/agentLane/x.test.ts', text: 'projections: {' },
    // `intent:` 只有和 capabilityRefs 同住才是清单——模型档案里的 intent 字段不是。
    { path: 'electron/shared/agentCapabilities/availableModels.ts', text: 'const m = { intent: "single" }' },
  ]), [])
})

test('no-tool-outside-declarations：手写的 {description 字面量, parameters} 形状被抓到；派生构造与登记豁免不被误伤', () => {
  const found = scanOwnerDrift([{
    path: 'electron/agentLane/rogue.mts',
    text: 'export const rogue = {\n  name: "rogue_tool",\n  description: "Hand-written second registry.",\n  parameters: Type.Object({}),\n};',
  }])
  assert.deepEqual(found.map((f) => f.rule), ['no-tool-outside-declarations'])
  // 派生：description 是表达式不是字面量。
  assert.deepEqual(scanOwnerDrift([{
    path: 'electron/agentLane/derived.mts',
    text: 'const t = {\n  name: spec.name,\n  description: laneToolModelDescription(spec),\n  parameters: toModelVisibleSchema(spec.schema),\n};',
  }]), [])
  // 登记过的豁免必须带理由，且理由说的是「不是领域工具」。
  for (const [file, reason] of Object.entries(TOOL_SHAPE_EXEMPTIONS)) {
    assert.match(reason, /不碰领域|不是领域/, file)
    assert.deepEqual(scanOwnerDrift([{ path: file, text: 'description: "x",\nparameters: {}' }]), [])
  }
})

test('mutual-tiebreak：同组单向点名被抓到（报的是缺的那一侧）；双向点名不被误伤；不同组不比', () => {
  const a = { name: 'verb_a', describe: { does: '', useWhen: '', notWhen: 'Not for verb_b.', params: '' }, effectGroups: ['g'] }
  const b = { name: 'verb_b', describe: { does: '', useWhen: '', notWhen: 'Nothing here.', params: '' }, effectGroups: ['g'] }
  const c = { name: 'verb_c', describe: { does: '', useWhen: '', notWhen: 'Nothing.', params: '' }, effectGroups: ['other'] }
  const found = mutualTiebreak([a, b, c])
  assert.deepEqual(found.map((f) => f.identity), ['g:verb_b->verb_a'])
  const fixed = { ...b, describe: { ...b.describe, notWhen: 'Use verb_a instead.' } }
  assert.deepEqual(mutualTiebreak([a, fixed, c]), [])
  // 词边界：`verb_ab` 不算点名了 `verb_a`。
  const sloppy = { ...b, describe: { ...b.describe, notWhen: 'Use verb_ab instead.' } }
  assert.equal(mutualTiebreak([a, sloppy]).length, 1)
})

test('no-orphan-alias：未声明的 pi 别名被抓到（主别名与 additional 都查）；method/mcp surface 不查', () => {
  const declared = new Set(['nomi_canvas_read'])
  const found = orphanAliases([
    { id: 'canvas.read', aliases: { pi: 'read_canvas_state', mcp: 'nomi_canvas_read' } },
    { id: 'canvas.write', aliases: { pi: 'nomi_canvas_read' }, additionalAliases: { pi: ['set_node_prompt'], method: ['nomi_operation_create'] } },
  ], declared)
  assert.deepEqual(found.map((f) => f.identity), ['canvas.read:read_canvas_state', 'canvas.write:set_node_prompt'])
  assert.deepEqual(orphanAliases([{ id: 'x', aliases: { method: 'ghost', mcp: 'nomi_x' } }], declared), [])
})

test('field-descriptions-complete：嵌套字段缺 description 被逐个抓到；齐全的不被误伤', () => {
  const found = fieldDescriptions([{
    name: 't',
    schema: { type: 'object', properties: { a: { type: 'string', description: 'ok' }, b: { type: 'array', items: { type: 'object', properties: { c: { type: 'string' } } } } } },
  }])
  assert.deepEqual(found.map((f) => f.identity), ['t#/b', 't#/b/items/c'])
  assert.deepEqual(fieldDescriptions([{ name: 't', schema: { type: 'object', properties: { a: { type: 'string', description: 'ok' } } } }]), [])
})

test('mcp-transport-catalog：resolver 上不在派生集合里的名字被抓到', () => {
  assert.deepEqual(handwrittenMcp(['nomi_a', 'nomi_b'], new Set(['nomi_a'])).map((f) => f.identity), ['nomi_b'])
  assert.deepEqual(handwrittenMcp(['nomi_a'], new Set(['nomi_a'])), [])
})

test('profile-reason-transitional：过渡理由被抓到；领域约束理由不被误伤', () => {
  const base = { describe: { does: '', useWhen: '', notWhen: '', params: '' } }
  const found = transitionalProfiles([
    { ...base, name: 'a', profiles: ['internal'], profileReason: 'mcpHandwrittenTransport' },
    { ...base, name: 'b', profiles: ['mcp'], profileReason: 'headlessHost' },
    { ...base, name: 'c' },
  ])
  assert.deepEqual(found.map((f) => f.identity), ['a'])
})

test('name-convention-uniform：internal 少数派逐个报、全一致不报；mcp 缺前缀是硬红', () => {
  const mixed = nameConvention(['nomi_a', 'nomi_b', 'plain_c'], ['nomi_x', 'bare_y'])
  assert.deepEqual(mixed.ratchet.map((f) => f.identity), ['internal/plain_c'])
  assert.deepEqual(mixed.hard.map((f) => f.identity), ['mcp/bare_y'])
  assert.deepEqual(nameConvention(['nomi_a', 'nomi_b'], ['nomi_x']), { ratchet: [], hard: [] })
  assert.deepEqual(nameConvention(['a', 'b'], []), { ratchet: [], hard: [] })
})
