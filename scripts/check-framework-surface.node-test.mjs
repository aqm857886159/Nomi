// 框架接触面门岗自己的测试（R17：加规则必须先证它会红）。
//
// 判据部分喂**假登记表 + 假事实**，抽取部分喂**假 .d.ts + 假源码**（临时目录），
// 两半都不依赖真仓库的存量——只测得到「今天的存量」的门岗，测不到「明天新增一条会不会红」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { evaluateSurface, normalizeValue, validateSurfaceRegistry } from './framework-surface-lib.mjs'
import { declaredFields, scanAssignments } from './framework-surface-extract.mjs'

const TODAY = '2026-09-07'

function registryWith(fields, overrides = {}) {
  return {
    frameworks: [{
      id: 'fake', packages: ['fake-sdk'], fourColumnTable: 'docs/x.md',
      capabilities: [{ id: 'c', provides: 'p', evidence: 'e', scope: ['src/'], forbidden: [{ id: 'r', pattern: 'x', why: 'w' }] }],
      surface: {
        scope: ['src/'],
        sources: [{
          package: 'fake-sdk', dtsPath: 'node_modules/fake-sdk/index.d.ts',
          types: [{
            name: 'Options', why: '为什么要逐字段裁',
            anchors: [{ kind: 'callArgument', name: 'create' }],
            fields, ...overrides,
          }],
        }],
      },
    }],
  }
}

const run = (fields, { declaredNames = Object.keys(fields), sites = {}, overrides } = {}) => evaluateSurface({
  registry: registryWith(fields, overrides),
  declared: new Map([['fake/Options', declaredNames]]),
  assignments: new Map(Object.entries(sites).map(([field, list]) => [`fake/Options::${field}`, list])),
  today: TODAY,
})

const literal = (text) => [{ file: 'src/a.ts', line: 3, literal: true, text }]
const dynamic = (text) => [{ file: 'src/a.ts', line: 4, literal: false, text }]

test('登记表校验：五种裁决之外的一律拒绝，理由/到期日缺一不可', () => {
  assert.match(validateSurfaceRegistry(registryWith({ a: { verdict: 'maybe' } })).join('\n'), /verdict 必须是/)
  assert.match(validateSurfaceRegistry(registryWith({ a: { verdict: 'derived' } })).join('\n'), /derived 必须写 at/)
  assert.match(validateSurfaceRegistry(registryWith({ a: { verdict: 'constant', value: 1 } })).join('\n'), /必须写 reason/)
  assert.match(validateSurfaceRegistry(registryWith({ a: { verdict: 'unused' } })).join('\n'), /必须写 why/)
  assert.match(
    validateSurfaceRegistry(registryWith({ a: { verdict: 'upstream-default', why: 'w' } })).join('\n'),
    /必须写 default/,
  )
  assert.match(
    validateSurfaceRegistry(registryWith({ a: { verdict: 'debt', owner: 'o', why: 'w', due: '下周' } })).join('\n'),
    /due（YYYY-MM-DD）/,
  )
  assert.equal(validateSurfaceRegistry(registryWith({ a: { verdict: 'unused', why: '不用' } })).length, 0)
})

test('constant 的理由不许是偏好（R29：偏好不是理由）', () => {
  const errors = validateSurfaceRegistry(registryWith({
    a: { verdict: 'constant', value: 1, reason: '这样写更简单' },
  }))
  assert.match(errors.join('\n'), /偏好套话/)
})

test('红①：上游有这个字段、登记表里没有 —— 升级加字段就会红', () => {
  const { errors } = run({ a: { verdict: 'unused', why: '不用' } }, { declaredNames: ['a', 'brandNew'] })
  assert.match(errors.join('\n'), /brandNew: 上游有这个字段，登记表里没有它的裁决/)
})

test('红②：登记 derived、代码里却是字面量 —— 这就是 executionMode 那条', () => {
  const { errors } = run(
    { a: { verdict: 'derived', at: 'src/a.ts:3' } },
    { sites: { a: literal("'sequential'") } },
  )
  assert.match(errors.join('\n'), /登记为 derived，代码里却是\*\*写死的字面量\*\*/)
})

test('红②之二：登记 derived、锚点里根本没人赋值', () => {
  const { errors } = run({ a: { verdict: 'derived', at: 'src/a.ts:3' } })
  assert.match(errors.join('\n'), /找不到任何赋值/)
})

test('红③：登记有、.d.ts 已无 —— 陈旧登记', () => {
  const { errors } = run({ gone: { verdict: 'unused', why: '不用' } }, { declaredNames: [] })
  assert.match(errors.join('\n'), /已经没有这个字段/)
})

test('红④：debt 过期', () => {
  const fields = { a: { verdict: 'debt', due: '2026-09-01', owner: '阶段 3a', why: '还没裁' } }
  assert.match(run(fields).errors.join('\n'), /已于 2026-09-01 到期/)
})

test('黄：debt 未到期只出 warning，不阻断', () => {
  const { errors, warnings } = run({ a: { verdict: 'debt', due: '2026-12-01', owner: '阶段 3a', why: '还没裁' } })
  assert.deepEqual(errors, [])
  assert.match(warnings.join('\n'), /待裁/)
})

test('红⑤：constant 的值和代码对不上（登记漂移）；对得上就绿', () => {
  const drift = run({ a: { verdict: 'constant', value: 'true', reason: '领域约束：必须恒真' } }, { sites: { a: literal('false') } })
  assert.match(drift.errors.join('\n'), /登记漂移/)
  const same = run({ a: { verdict: 'constant', value: 'true', reason: '领域约束：必须恒真' } }, { sites: { a: literal('true') } })
  assert.deepEqual(same.errors, [])
})

test('红⑥：登记 unused / upstream-default，代码里其实在赋值', () => {
  const unused = run({ a: { verdict: 'unused', why: '不用' } }, { sites: { a: dynamic('value') } })
  assert.match(unused.errors.join('\n'), /代码里却在赋值/)
  const upstream = run(
    { a: { verdict: 'upstream-default', default: 'true', why: '用默认' } },
    { sites: { a: literal('false') } },
  )
  assert.match(upstream.errors.join('\n'), /代码里却在赋值/)
})

test('红⑦之二：debt 其实已经还了 —— 债还了要销账（棘轮只减不增）', () => {
  const { errors } = run(
    { a: { verdict: 'debt', due: '2026-12-01', owner: '阶段 3a', why: '还没裁' } },
    { sites: { a: dynamic('config.a ?? false') } },
  )
  assert.match(errors.join('\n'), /这条债已经还了/)
})

test('红⑦：constant 其实是随输入变的 —— 裁决落后于代码', () => {
  const { errors } = run(
    { a: { verdict: 'constant', value: 'true', reason: '领域约束：必须恒真' } },
    { sites: { a: dynamic('flag') } },
  )
  assert.match(errors.join('\n'), /其实是随输入变的/)
})

test('无锚点类型（只消费不构造）：constant 一律拒绝，derived 靠「at 文件里有没有这个名字」兜底', () => {
  const noAnchor = { anchors: [] }
  assert.match(
    validateSurfaceRegistry(registryWith({ a: { verdict: 'constant', value: 1, reason: '领域约束：X' } }, noAnchor)).join('\n'),
    /没有锚点就核不了/,
  )
  const stale = evaluateSurface({
    registry: registryWith({ before_tool: { verdict: 'derived', at: 'src/host.ts:9' } }, noAnchor),
    declared: new Map([['fake/Options', ['before_tool']]]),
    assignments: new Map(), today: TODAY,
    fileExists: () => true, readFile: () => 'export const nothing = 1',
  })
  assert.match(stale.errors.join('\n'), /那个文件里根本没有「before_tool」/)
})

test('抽不出字段就红（抽空了却放行 = 门岗静默失效）', () => {
  const { errors } = evaluateSurface({
    registry: registryWith({ a: { verdict: 'unused', why: '不用' } }),
    declared: new Map(), assignments: new Map(), today: TODAY,
  })
  assert.match(errors.join('\n'), /抽不出任何字段/)
})

test('值比对只归一空白与引号', () => {
  assert.equal(normalizeValue('{ a: 1 }'), normalizeValue('{a:1}'))
  assert.equal(normalizeValue('"Shift"'), normalizeValue("'Shift'"))
})

// ─── 抽取器：假 .d.ts + 假源码 ────────────────────────────────────────────────

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-surface-'))
  fs.mkdirSync(path.join(root, 'node_modules/fake-sdk'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules/fake-sdk/index.d.ts'), `
export interface Base { name: string; description: string }
export type Options = Omit<Base, "description"> & {
  mode?: "a" | "b";
  hooks?: { before?: () => { block?: { reason: string } } };
};
export declare function create(options: Options): void;
`)
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  return root
}

test('抽取：交叉类型 + Omit + 基接口的字段一个都不许漏', () => {
  const root = fixture()
  const fields = declaredFields({
    repoRoot: root,
    source: { package: 'fake-sdk', dtsPath: 'node_modules/fake-sdk/index.d.ts' },
    type: { name: 'Options' },
  })
  // `name` 来自基接口 Base，`description` 被 Omit 掉——正则抓 interface 的写法会把这两件事都搞错。
  assert.deepEqual(fields.sort(), ['hooks', 'mode', 'name'])
})

test('抽取：expand 下钻到钩子的返回形状', () => {
  const root = fixture()
  const fields = declaredFields({
    repoRoot: root,
    source: { package: 'fake-sdk', dtsPath: 'node_modules/fake-sdk/index.d.ts' },
    type: { name: 'Options', expand: ['hooks', 'hooks.before'] },
  })
  assert.ok(fields.includes('hooks.before'), fields.join(','))
  assert.ok(fields.includes('hooks.before.block'), fields.join(','))
})

test('抽取：callParameter 也能当接触面（框架的入口是函数而不是类型时）', () => {
  const root = fixture()
  const fields = declaredFields({
    repoRoot: root,
    source: { package: 'fake-sdk', dtsPath: 'node_modules/fake-sdk/index.d.ts' },
    type: { name: 'create', kind: 'callParameter', parameterIndex: 0 },
  })
  assert.deepEqual(fields.sort(), ['hooks', 'mode', 'name'])
})

test('扫描：字面量与派生分得开；JSX 属性、简写、条件展开都认得', () => {
  const root = fixture()
  fs.writeFileSync(path.join(root, 'src/a.tsx'), `
const mode = 'a'
export const call = () => create({ name: label, mode: 'a', ...(flag ? { extra: 1 } : {}) })
export const view = () => <Widget fixed={false} bare live={count} text="hi" />
`)
  const options = scanAssignments({
    repoRoot: root, frameworkId: 'fake', typeName: 'Options', scope: ['src'],
    anchors: [{ kind: 'callArgument', name: 'create' }],
  })
  assert.equal(options.get('fake/Options::name')[0].literal, false)
  assert.equal(options.get('fake/Options::mode')[0].literal, true)
  // 条件展开里的字段名归得到位，否则一条真 derived 会被判成陈旧登记（假红）。
  assert.equal(options.get('fake/Options::extra')[0].literal, true)

  const jsx = scanAssignments({
    repoRoot: root, frameworkId: 'fake', typeName: 'Props', scope: ['src'],
    anchors: [{ kind: 'jsxElement', name: 'Widget' }],
  })
  assert.equal(jsx.get('fake/Props::fixed')[0].text, 'false')
  assert.equal(jsx.get('fake/Props::bare')[0].text, 'true') // 无 initializer 的属性就是常量 true
  assert.equal(jsx.get('fake/Props::live')[0].literal, false)
  assert.equal(jsx.get('fake/Props::text')[0].literal, true)
})
