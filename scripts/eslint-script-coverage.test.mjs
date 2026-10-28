// 2026-10-22 scripts / tests/ux / evals 进 ESLint（之前整片 ignore）的几条保险：
// ① 这三片真的不再被忽略（.mjs / .cjs / .ts 都算）；
// ② 「isVisible / isHidden 带 timeout」在代表路径上都红——flat config 里后面的块会整条覆盖 no-restricted-syntax，
//    哪个块漏拼了全仓选择器，那片文件上这条就静默失效，所以按路径逐个核，而不是只核一个文件；
// ③ 走查里的未定义标识符由 ESLint no-undef 管（替掉 check-walkthroughs 里手写的那一套，夜跑 I05 的形状照搬过来）；
// ④ 批量抑制的两条判据：存量变少要收紧；冻结数上涨要协调确认（推送前 / 合并前扫描读本机记录，CI 只提示）；
// ⑥ 渲染层直调 nomi:tasks:run（desktop.tasks.run）只有 src/workbench/api/taskApi.ts 一扇门（令牌路普查数不到成员调用，这条补上）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

import { CANVAS_SHELL_FILE } from './canvas-store-subscriptions.mjs'
import { buildApproval } from './coord-approve.mjs'
import { judgeLint, judgeSuppressionGrowth, judgeUnprunedSuppressions } from './lint-changed.mjs'
import { ciApprovals, localApprovals, suppressionApprovalSubject } from './lib/coordApprovals.mjs'
import { checkSuppressionContracts } from './pr-body-criteria.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NO_WAIT = 'isVisible / isHidden do not wait'

let eslint
beforeAll(() => {
  eslint = new ESLint({ cwd: root })
})

const lint = async (relativePath, source) => {
  const [result] = await eslint.lintText(source, { filePath: path.join(root, relativePath) })
  return result.messages
}

describe('scripts / tests/ux / evals 在 ESLint 范围内', () => {
  it.each(['scripts/a.mjs', 'scripts/a.cjs', 'scripts/a.ts', 'tests/ux/a.walk.mjs', 'tests/ux/fixtures/a.tsx', 'evals/journeys/a.mjs', 'evals/a.ts'])('%s 不被忽略', async (file) => {
    expect(await eslint.isPathIgnored(path.join(root, file))).toBe(false)
  })
})

describe('Playwright isVisible / isHidden 不等待：带 timeout 就红', () => {
  const source = [
    'export async function probe(page, timeout) {',
    "  const a = await page.locator('#a').isVisible({ timeout: 8000 })",
    "  const b = await page.locator('#b').isHidden({ timeout })",
    "  const c = await page.isVisible('#c', { timeout: 1 })",
    "  const d = await page.locator('#d').waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)",
    "  const e = await page.locator('#e').isVisible()",
    "  const f = await page['isVisible']('#f', { timeout })",
    "  const g = await page.locator('#g')['isHidden']({ timeout: 5 })",
    "  const h = await page['isVisible']('#h')",
    '  return [a, b, c, d, e, f, g, h]',
    '}',
    '',
  ].join('\n')

  it.each([
    'tests/ux/a.walk.mjs',
    'tests/ux/a.paid.mjs',
    'tests/ux/full-walk/playbooks/a.walk.mjs',
    'tests/ux/a.cjs',
    'scripts/a.mjs',
    'scripts/a.ts',
    'evals/journeys/a.mjs',
    'evals/a.ts',
    'tests/perf/a.mjs',
    'docs/design/a.mjs',
    'src/a.ts',
    'src/a.test.ts',
    'electron/a.ts',
    'electron/quitTeardown.ts',
    CANVAS_SHELL_FILE,
  ])('%s：点号三种写法、计算属性两种写法都红；waitFor、不带 timeout 的不红', async (file) => {
    const hits = (await lint(file, source)).filter((message) => message.ruleId === 'no-restricted-syntax' && message.message.startsWith(NO_WAIT))
    expect(hits.map((message) => message.line)).toEqual([2, 3, 4, 7, 8])
  })

  it('有意接受的缺口：options 先放进变量再传不拦（静态看不出变量里有没有 timeout）', async () => {
    const messages = await lint('tests/ux/a.walk.mjs', "export async function f(page, timeout) { const options = { timeout }; return page.isVisible('#a', options) }\n")
    expect(messages.filter((message) => String(message.ruleId).endsWith('no-restricted-syntax'))).toEqual([])
  })
})

describe('Playwright isVisible / isHidden 不许当值取出来（scripts / tests / evals）', () => {
  const ALIAS = 'Call isVisible / isHidden directly'
  const aliasLines = async (file, ...rows) => (await lint(file, ['export function f(page, loc) {', ...rows, '}', ''].join('\n')))
    .filter((message) => message.ruleId === 'playwright-wait/no-restricted-syntax' && message.message.startsWith(ALIAS))
    .map((message) => message.line)

  it.each([
    ['解构', '  const { isVisible } = page; return isVisible({ timeout: 1 })'],
    ['解构（字符串键）', "  const { 'isHidden': h } = page; return h()"],
    ['取成别名', '  const fn = page.isHidden; return fn({ timeout: 1 })'],
    ['计算属性取值', "  const fn = loc['isVisible']; return fn()"],
    ['当参数传出去', '  return [loc.isVisible].map((m) => m.call(loc))'],
  ])('%s → 红', async (_name, row) => {
    for (const file of ['tests/ux/a.walk.mjs', 'scripts/a.mjs', 'evals/journeys/a.mjs', 'tests/ux/a.ts', 'tests/perf/a.mjs']) expect(await aliasLines(file, row)).toEqual([2])
  })

  it.each([
    ['直接调用', "  return page.isVisible('#a')"],
    ['可选链调用', '  return loc?.isHidden?.()'],
    ['计算属性直接调用', "  return page['isVisible']('#a')"],
    ['同名对象字面量（mock）', '  return { isVisible: () => true, isHidden: () => false }'],
  ])('%s → 不红', async (_name, row) => {
    expect(await aliasLines('tests/ux/a.walk.mjs', row)).toEqual([])
  })

  it('src / electron 不开（那里 isHidden / isVisible 是普通领域字段，例：分类的 isHidden）', async () => {
    for (const file of ['src/workbench/sidebar/a.tsx', 'electron/a.ts', 'src/a.test.ts']) expect(await aliasLines(file, '  return [page.isHidden, loc.isVisible]')).toEqual([])
  })
})

// ⑤ 2026-10-24：vitest 车道的浏览器夹具测试起 vite 开发服务只经 tests/ux/_browserFixture.mjs（冷编译不进用例的操作预算）。
describe('浏览器夹具测试不直接起 vite 开发服务（tests/**/*.test.*）', () => {
  const RULES = ['browser-fixture/no-restricted-imports', 'browser-fixture/no-restricted-syntax']
  const hits = async (file, source) => (await lint(file, source)).filter((message) => RULES.includes(message.ruleId)).map((message) => message.line)
  const source = [
    "import { createServer } from 'vite'",
    "import { createServer as startVite, normalizePath } from 'vite'",
    "import * as vite from 'vite'",
    "export const later = async () => (await import('vite')).createServer",
    "import { normalizePath as other } from 'vite'",
    'export const all = [createServer, startVite, normalizePath, vite, other]',
    '',
  ].join('\n')

  it.each(['tests/ux/a.test.mjs', 'tests/ux/design-lab/a.test.mjs', 'tests/network/a.test.mjs'])('%s：具名、改名、命名空间、动态 import 都红；只取 vite 别的导出不红', async (file) => {
    expect(await hits(file, source)).toEqual([1, 2, 3, 4])
  })

  it.each(['tests/ux/_browserFixture.mjs', 'tests/ux/a.walk.mjs', 'scripts/a.mjs'])('%s：唯一主人与别的车道不归这条规则', async (file) => {
    expect(await hits(file, source)).toEqual([])
  })
})

// ⑥ 2026-10-28：渲染层直调主进程的任务口 nomi:tasks:run 只有一扇门。令牌路普查（scripts/spend-token-doors.mjs）按符号名数门，数不到
// `desktop.tasks.run(...)` 这种成员调用——渲染层新文件直接调它，普查和两道 check 全绿（独立验收 R14）；这条规则让它当场红。
// 规则 id 是独立注册的 task-run-bridge/no-restricted-syntax（src/** 已有别的块配了 no-restricted-syntax，同名会被整条覆盖）。
describe('渲染层只有 taskApi.ts 能直调 nomi:tasks:run（desktop.tasks.run）', () => {
  const RULE = 'task-run-bridge/no-restricted-syntax'
  const DOOR = 'src/workbench/api/taskApi.ts'
  const hits = async (file, source) => (await lint(file, source)).filter((message) => message.ruleId === RULE).map((message) => message.line)
  const NEW_FILE = 'src/workbench/someNewFeature.ts'

  it.each([
    ['点号直调', 'export const f = (desktop) => desktop.tasks.run({ vendor: "v", request: {} })'],
    ['方括号取 run', "export const f = (desktop) => desktop.tasks['run']({ vendor: 'v' })"],
    ['方括号取 tasks', "export const f = (desktop) => desktop['tasks'].run({ vendor: 'v' })"],
    ['两个都方括号', "export const f = (desktop) => desktop['tasks']['run']({ vendor: 'v' })"],
    ['可选链', 'export const f = (desktop) => desktop?.tasks?.run?.({ vendor: "v" })'],
    ['当值取出来', 'export const f = (desktop) => { const go = desktop.tasks.run; return go }'],
    ['bind', 'export const f = (desktop) => desktop.tasks.run.bind(desktop.tasks)'],
    ['window 上直取', 'export const f = () => window.nomiDesktop.tasks.run({})'],
    ['先解构出 tasks 再 tasks.run', 'export const f = (desktop) => { const { tasks } = desktop; return tasks.run({}) }'],
    ['先解构出 tasks 再 tasks["run"]', "export const f = (desktop) => { const { tasks } = desktop; return tasks['run']({}) }"],
    ['从 tasks 解构 run', 'export const f = (desktop) => { const { run } = desktop.tasks; return run({}) }'],
    ['从 tasks 解构 run（字符串键 + 改名）', "export const f = (desktop) => { const { 'run': go } = desktop.tasks; return go({}) }"],
    ['一步解构 tasks 里的 run', 'export const f = (desktop) => { const { tasks: { run } } = desktop; return run({}) }'],
    ['参数里解构', 'export const f = ({ tasks: { run } }) => run({})'],
    ['从本地名 tasks 解构 run', 'export const f = (tasks) => { const { run } = tasks; return run({}) }'],
    ['赋值式解构', 'export const f = (desktop) => { let run; ({ run } = desktop.tasks); return run({}) }'],
    ['非空断言', 'export const f = (desktop) => desktop.tasks!.run({})'],
    ['类型断言', 'export const f = (desktop) => (desktop.tasks as any).run({})'],
    ['括起来的可选链', 'export const f = (desktop) => (desktop?.tasks).run({})'],
  ])('红：%s', async (_name, source) => {
    expect(await hits(NEW_FILE, source)).toEqual([1])
    expect(await hits('src/workbench/someNewFeature.tsx', source)).toEqual([1])
  })

  it.each([
    ['tasks 上别的方法', 'export const f = (desktop) => desktop.tasks.runComfyCandidateTest({})'],
    ['文本流式口', 'export const f = (desktop) => desktop.tasks.runTextStream({})'],
    ['铸令牌口（另有门岗，不归这条）', 'export const f = (desktop) => desktop.tasks.grantSpend({ nodeIds: [] })'],
    ['别的对象的 run', 'export const f = (jobs) => jobs.run()'],
    ['tasks 数组上的方法', 'export const f = (plan) => plan.tasks.map((task) => task.id)'],
    ['从 tasks 解构别的成员', 'export const f = (desktop) => { const { runComfyCandidateTest } = desktop.tasks; return runComfyCandidateTest }'],
    ['解构 tasks 但不取 run', 'export const f = (desktop) => { const { tasks } = desktop; return tasks.length }'],
    ['桥本身有个 run', 'export const f = (desktop) => { const { run } = desktop; return run }'],
    ['计算属性是变量不是字符串', 'export const f = (tasks, run) => tasks[run]'],
    ['类型声明里的 run 成员', 'export type Bridge = { tasks: { run: (payload: unknown) => Promise<unknown> } }'],
    ['字符串里提到它', "export const label = 'desktop.tasks.run'"],
    ['注释里提到它', '// desktop.tasks.run only in a comment\nexport const x = 1'],
  ])('不红：%s', async (_name, source) => {
    expect(await hits(NEW_FILE, source)).toEqual([])
  })

  it('按名字认：别的对象恰好叫 tasks 又有 run 成员，也红（语法树看不出类型；改个名字，或把文件登记进允许表）', async () => {
    expect(await hits(NEW_FILE, 'export const f = (plan) => plan.tasks.run()')).toEqual([1])
  })

  it('范围：唯一的门和测试文件不红；渲染层之外不归这条（主进程另有普查，走查脚本在页面里调桥）', async () => {
    const source = 'export const f = (desktop) => desktop.tasks.run({})'
    for (const file of [DOOR, 'src/workbench/api/taskApi.test.ts', 'src/workbench/api/__tests__/probe.ts', 'src/workbench/api/probe.test.tsx']) expect(await hits(file, source), file).toEqual([])
    for (const file of ['electron/probe.ts', 'tests/ux/probe.mjs', 'scripts/probe.mjs', 'evals/probe.mjs']) expect(await hits(file, source), file).toEqual([])
  })

  it('接线：真的 taskApi.ts 原文放在自己的路径上不红，放到别的文件名上就红（允许名单写对了，规则也不是空转）', async () => {
    const real = fs.readFileSync(path.join(root, DOOR), 'utf8')
    expect(real).toContain('desktop.tasks.run(')
    expect(await hits(DOOR, real)).toEqual([])
    expect(await hits('src/workbench/api/taskApiCopy.ts', real)).toHaveLength(1)
  })
})

describe('走查里的未定义标识符：ESLint no-undef（夜跑 I05 的形状）', () => {
  const undefinedNames = async (file, ...rows) => (await lint(file, rows.join('\n') + '\n'))
    .filter((message) => message.ruleId === 'no-undef')
    .map((message) => message.message.match(/'([^']+)'/)?.[1])

  it('阳性对照：漏 import / 漏声明的标识符被报出来', async () => {
    expect(await undefinedNames('tests/ux/clip.walk.mjs', 'await canvasSetZoomPercent(win, 50)')).toEqual(['canvasSetZoomPercent', 'win'])
    expect(await undefinedNames('evals/journeys/a.mjs', 'const run = {}', "await expectVisible(run.newProjectEntry(win), 'x')")).toEqual(['expectVisible', 'win'])
  })

  it('补了 import / 声明就不报；Node 全局与页内（浏览器）全局都认；.cjs 认 require / module', async () => {
    expect(await undefinedNames('tests/ux/a.walk.mjs', "import { canvasSetZoomPercent } from './_shell.mjs'", 'export async function f(win) { await canvasSetZoomPercent(win, 50) }')).toEqual([])
    expect(await undefinedNames('tests/ux/a.walk.mjs', 'export const dir = process.cwd()', 'export const h = (win) => win.evaluate(() => document.body.scrollHeight + window.innerWidth)')).toEqual([])
    expect(await undefinedNames('tests/ux/a.cjs', "const fs = require('node:fs')", 'module.exports = { fs, ok: typeof document }')).toEqual([])
  })

  it('加载即崩的写法直接红：语法错误、重复声明（2026-09-02 解冲突留下的那种）', async () => {
    const [fatal] = await lint('tests/ux/a.walk.mjs', 'const x = (\n')
    expect(fatal).toMatchObject({ fatal: true, severity: 2 })
    // .mjs 也走 typescript-eslint 的解析器，它不在解析期拒重复声明，由 no-redeclare 报成错误——同样红。
    const redeclared = await lint('tests/ux/a.walk.mjs', 'const A = 1\nconst A = 2\nexport { A }\n')
    expect(redeclared.some((message) => message.severity === 2 && message.line === 2)).toBe(true)
  })
})

describe('批量抑制的判据（lint:changed / PR 正文判据 / coord-approve）', () => {
  const frozen = { 'scripts/a.mjs': { 'no-unused-vars': { count: 2 } }, 'tests/ux/b.mjs': { 'no-empty': { count: 1 } } }

  const grownHead = { ...frozen, 'scripts/c.mjs': { 'no-unused-vars': { count: 1 } } }
  const fingerprint = suppressionApprovalSubject(frozen, grownHead).fingerprint
  const approvalsWith = (records, pr = null) => localApprovals({ pr, env: { NOMI_COORD_APPROVALS: 'x' }, readFile: () => records.map((r) => JSON.stringify(r)).join('\n') })
  const record = (extra = {}) => ({ pr: null, kind: 'eslint-suppressions', name: 'eslint-suppressions.json', sha256: fingerprint, at: 'T', note: '', ...extra })

  it('没有任何文件 × 规则上涨就不用确认：不变、只减少都放行', () => {
    expect(judgeSuppressionGrowth(frozen, frozen)).toEqual([])
    expect(judgeSuppressionGrowth(frozen, { 'scripts/a.mjs': { 'no-unused-vars': { count: 1 } } })).toEqual([])
    expect(judgeSuppressionGrowth(frozen, {})).toEqual([])
  })

  it('按文件 × 规则判：先减后增、规则总数不变也要确认；改名 / 搬家同样要确认', () => {
    const swapped = { 'scripts/a.mjs': { 'no-unused-vars': { count: 1 } }, 'scripts/new.mjs': { 'no-unused-vars': { count: 1 } }, 'tests/ux/b.mjs': { 'no-empty': { count: 1 } } }
    const [swap] = judgeSuppressionGrowth(frozen, swapped, approvalsWith([]))
    expect(swap).toContain('scripts/new.mjs no-unused-vars：0 → 1')
    expect(suppressionApprovalSubject(frozen, swapped).grownEntries).toEqual([{ file: 'scripts/new.mjs', rule: 'no-unused-vars', base: 0, head: 1 }])
    const renamed = { 'scripts/renamed.mjs': { 'no-unused-vars': { count: 2 } }, 'tests/ux/b.mjs': { 'no-empty': { count: 1 } } }
    expect(judgeSuppressionGrowth(frozen, renamed, approvalsWith([]))).toHaveLength(1)
    // 确认绑的是这份上涨 diff：对 swapped 的确认放行 swapped，不放行别的搬法
    const swapRecord = record({ sha256: suppressionApprovalSubject(frozen, swapped).fingerprint })
    expect(judgeSuppressionGrowth(frozen, swapped, approvalsWith([swapRecord]))).toEqual([])
    expect(judgeSuppressionGrowth(frozen, renamed, approvalsWith([swapRecord]))).toHaveLength(1)
  })

  it('推送前：涨了又没有确认记录就红（记录文件没配置也红），并给出确认命令', () => {
    const [grown] = judgeSuppressionGrowth(frozen, grownHead, approvalsWith([]))
    expect(grown).toContain('scripts/c.mjs no-unused-vars：0 → 1')
    expect(grown).toContain('node scripts/coord-approve.mjs --suppressions')
    const [unconfigured] = judgeSuppressionGrowth({}, grownHead, localApprovals({ pr: null, env: {} }))
    expect(unconfigured).toContain('NOMI_COORD_APPROVALS')
  })

  it('推送前：哈希对上的确认放行；之后再多冻一处，哈希对不上，重新红', () => {
    expect(judgeSuppressionGrowth(frozen, grownHead, approvalsWith([record()]))).toEqual([])
    const more = { ...grownHead, 'scripts/d.mjs': { 'no-empty': { count: 1 } } }
    expect(judgeSuppressionGrowth(frozen, more, approvalsWith([record()]))).toHaveLength(1)
    // 只是改了配置文件不再自动放行（旧口子）：确认只认记录
    expect(judgeSuppressionGrowth({}, frozen, approvalsWith([]))).toHaveLength(1)
  })

  it('确认与 PR 号：开 PR 前（pr 为空）记的确认，PR 开了以后合并前扫描也认；两边都有号就要相等', () => {
    expect(approvalsWith([record()], 42).lookup('eslint-suppressions', 'eslint-suppressions.json', fingerprint)).toBe(true)
    expect(approvalsWith([record({ pr: 42 })], null).lookup('eslint-suppressions', 'eslint-suppressions.json', fingerprint)).toBe(true)
    expect(approvalsWith([record({ pr: 41 })], 42).lookup('eslint-suppressions', 'eslint-suppressions.json', fingerprint)).toBe(false)
    // board / perf 照旧必须同号
    expect(approvalsWith([{ pr: null, kind: 'board', name: 'b', sha256: 'h' }], 42).lookup('board', 'b', 'h')).toBe(false)
  })

  it('CI 只提示「待协调确认」不红；合并前扫描（本机）没有记录就红、有记录就过；取不到内容本机也红', () => {
    const ci = checkSuppressionContracts({ strict: true, suppressions: grownHead, baseSuppressions: frozen, approvals: ciApprovals })
    expect(ci.ok).toBe(true)
    expect(ci.lines.join('\n')).toContain('待协调确认')
    const local = checkSuppressionContracts({ strict: true, suppressions: grownHead, baseSuppressions: frozen, approvals: approvalsWith([], 42) })
    expect(local.ok).toBe(false)
    expect(local.lines.join('\n')).toContain('--pr 42 --suppressions')
    expect(checkSuppressionContracts({ strict: true, suppressions: grownHead, baseSuppressions: frozen, approvals: approvalsWith([record()], 42) }).ok).toBe(true)
    expect(checkSuppressionContracts({ strict: true, suppressions: frozen, baseSuppressions: frozen, approvals: approvalsWith([], 42) })).toEqual({ ok: true, lines: [] })
    expect(checkSuppressionContracts({ strict: true, suppressions: null, baseSuppressions: frozen, approvals: approvalsWith([], 42) }).ok).toBe(false)
  })

  it('coord-approve --suppressions：按 base / head 的内容算出同一个哈希；没有上涨就拒绝写记录；不带 --pr 用本地 HEAD', () => {
    const files = { BASE: frozen, HEAD_SHA: grownHead }
    const git = (args) => {
      if (args[0] === 'rev-parse') return 'HEAD_SHA'
      if (args[0] === 'merge-base') return 'BASE'
      if (args[0] === 'show') return JSON.stringify(files[args[1].split(':')[0]])
      throw new Error(args.join(' '))
    }
    const approval = buildApproval({ argv: ['--suppressions'], git, now: () => 'T', fetch: false })
    expect(approval).toMatchObject({ pr: null, kind: 'eslint-suppressions', name: 'eslint-suppressions.json', sha256: fingerprint, head: 'HEAD_SHA' })
    expect(buildApproval({ argv: ['--pr', '7', '--suppressions', '--head', 'HEAD_SHA'], git, now: () => 'T', fetch: false }).pr).toBe(7)
    files.HEAD_SHA = frozen
    expect(() => buildApproval({ argv: ['--suppressions'], git, now: () => 'T', fetch: false })).toThrow(/没有上涨/)
    expect(() => buildApproval({ argv: ['--board', 'x'], git, now: () => 'T', fetch: false })).toThrow(/用法/)
  })

  it('存量变少却没收紧 → 拦，并给出收紧命令；超出冻结数时只报错误、不重复报「没收紧」', () => {
    expect(judgeUnprunedSuppressions([{ file: 'scripts/a.mjs', suppressedByRule: { 'no-unused-vars': 2 } }], frozen)).toEqual([])
    const [stale] = judgeUnprunedSuppressions([{ file: 'scripts/a.mjs', suppressedByRule: { 'no-unused-vars': 1 } }], frozen)
    expect(stale).toContain('冻结 2，实际 1')
    expect(stale).toContain('pnpm exec eslint --prune-suppressions')
    const over = [{ ruleId: 'no-unused-vars', severity: 2, line: 1, column: 1, message: 'x' }]
    expect(judgeUnprunedSuppressions([{ file: 'scripts/a.mjs', suppressedByRule: {}, head: over }], frozen)).toEqual([])
    const [error] = judgeLint([{ file: 'scripts/a.mjs', head: over, base: [] }], frozen)
    expect(error).toContain('no-unused-vars 冻结了 2 处存量')
  })
})
