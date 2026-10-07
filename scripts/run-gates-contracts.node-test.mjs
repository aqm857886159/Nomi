/**
 * `gates:contracts` runner 的阳性对照（R17：改门岗行为必须先证明它会红）。
 *
 * 三件事必须钉死：
 *   ① 两个门岗同时失败时，**两个都出现在汇总里**——这正是废掉 `&&` 早退要买到的东西；
 *   ② 全过时退出 0，且不打任何 warning 注解；
 *   ③ advisory 门岗失败时：job 不失败（exitCode 0）、但确实出了一条 GitHub warning 注解。
 *      ③ 就是「PR 上 docs-index 缺一条只 warning、不阻断」的机器判据。
 * 另加配置面的 fail-closed：链为空 / 门岗重名 / advisory 点名了不在链里的门岗 / 脚本不存在，
 * 全部报错而不是「跳过」——静默不跑的门岗和不存在的门岗在 CI 输出里长得一模一样。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ADVISORY_FILL,
  GateConfigError,
  advisoryNote,
  assertGatesExist,
  parseGateArgs,
  runGateSuite,
  parseScannedCount,
} from './run-gates-contracts.mjs'

/** 收集 runner 的输出，同时假装自己是一堆门岗。 */
function harness(results) {
  const chunks = []
  return {
    write: (text) => chunks.push(text),
    runGate: async (name) => results[name] ?? { code: 0, output: `${name} ok\nscanned=1\n` },
    output: () => chunks.join(''),
  }
}

const ACTIONS_ENV = { GITHUB_ACTIONS: 'true' }

test('门岗自证：缺失、重复或 scanned=0 都 fail-closed，正整数才通过', () => {
  assert.deepEqual(parseScannedCount('scanned=3\n'), { ok: true, count: 3 })
  assert.match(parseScannedCount('门岗通过\n').reason, /缺少 scanned/)
  assert.match(parseScannedCount('scanned=0\n').reason, /scanned=0/)
  assert.match(parseScannedCount('scanned=1\nscanned=2\n').reason, /重复/)
})

test('门岗自证失败即使子命令退出 0 也算阻断失败', async () => {
  const h = harness({ 'check:empty': { code: 0, output: '没有扫描对象\n' } })
  const result = await runGateSuite({ gates: ['check:empty'], advisory: new Set(), runGate: h.runGate, write: h.write, env: {} })
  assert.equal(result.exitCode, 1)
  assert.match(h.output(), /门岗自证失败：缺少 scanned/)
})

test('两个门岗失败时，一轮就把两个都报出来（不再第一个红就停）', async () => {
  const gates = ['check:a', 'check:b', 'check:c', 'check:d']
  const h = harness({
    'check:b': { code: 1, output: 'b line 1\nb 违规：docs/x.md\nscanned=2\n' },
    'check:d': { code: 2, output: 'd 违规：src/y.ts\nscanned=2\n' },
  })
  const result = await runGateSuite({
    gates,
    advisory: new Set(),
    runGate: h.runGate,
    write: h.write,
    env: ACTIONS_ENV,
  })

  assert.equal(result.exitCode, 1)
  assert.deepEqual(result.failures.map((failure) => failure.name), ['check:b', 'check:d'])
  const output = h.output()
  assert.match(output, /2 个门岗阻断失败/)
  // 失败清单里两个都在，且各自的输出尾巴可读——不是只给一行「失败了」。
  assert.match(output, /· check:b（退出码 1）/)
  assert.match(output, /· check:d（退出码 2）/)
  assert.match(output, /b 违规：docs\/x\.md/)
  assert.match(output, /d 违规：src\/y\.ts/)
  // 失败之后仍然跑完了后面的门岗（c 在 b 之后）。
  assert.match(output, /✅ check:c/)
})

test('全过时退出 0，且不打 warning 注解', async () => {
  const h = harness({})
  const result = await runGateSuite({
    gates: ['check:a', 'check:b'],
    advisory: new Set(),
    runGate: h.runGate,
    write: h.write,
    env: ACTIONS_ENV,
  })

  assert.equal(result.exitCode, 0)
  assert.equal(result.failures.length, 0)
  assert.equal(result.advisoryFailures.length, 0)
  assert.doesNotMatch(h.output(), /::warning/)
  assert.match(h.output(), /全部阻断性门岗通过/)
})

test('advisory 门岗失败：只出 warning 注解，job 不失败', async () => {
  const h = harness({
    'check:docs-index': { code: 1, output: '✖ 文档索引回归：1 篇新增未收录方案\n  docs/plan/2026-09-05-x.md\nscanned=1\n' },
  })
  const result = await runGateSuite({
    gates: ['check:docs-index', 'check:filesize'],
    advisory: new Set(['check:docs-index']),
    runGate: h.runGate,
    write: h.write,
    env: ACTIONS_ENV,
  })

  assert.equal(result.exitCode, 0, 'advisory 失败不得阻断 job')
  assert.equal(result.failures.length, 0)
  assert.deepEqual(result.advisoryFailures.map((failure) => failure.name), ['check:docs-index'])
  const output = h.output()
  assert.match(output, /::warning title=docs-autosync::check:docs-index 未通过/)
  assert.match(output, /docs-autosync 工作流自动补齐/)
  // 注解正文必须是单行：workflow command 是按行解析的，混进裸换行会把注解截断。
  const annotationLine = output.split('\n').find((line) => line.startsWith('::warning'))
  assert.ok(annotationLine.length > 40)
  assert.doesNotMatch(output, /阻断失败：\n/)
  // 门岗照样跑了、输出照样在——advisory 不是「关掉」。
  assert.match(output, /✖ 文档索引回归/)
})

test('advisory 之外的门岗失败照样阻断，即使同一轮里有 advisory 失败', async () => {
  const h = harness({
    'check:ledger': { code: 1, output: 'ledger stale\nscanned=1\n' },
    'check:filesize': { code: 1, output: 'filesize 822>814\nscanned=1\n' },
  })
  const result = await runGateSuite({
    gates: ['check:ledger', 'check:filesize'],
    advisory: new Set(['check:ledger']),
    runGate: h.runGate,
    write: h.write,
    env: {},
  })

  assert.equal(result.exitCode, 1)
  assert.deepEqual(result.failures.map((failure) => failure.name), ['check:filesize'])
  assert.deepEqual(result.advisoryFailures.map((failure) => failure.name), ['check:ledger'])
  // 不在 GitHub Actions 里就不打注解（本地跑不该刷一堆 ::warning::）。
  assert.doesNotMatch(h.output(), /::warning/)
})

test('信号中断当失败处理，不当通过', async () => {
  const h = harness({ 'check:slow': { code: 'signal:SIGKILL', output: 'scanned=1\n' } })
  const result = await runGateSuite({
    gates: ['check:slow'],
    advisory: new Set(),
    runGate: h.runGate,
    write: h.write,
    env: {},
  })
  assert.equal(result.exitCode, 1)
})

test('配置面 fail-closed：空链 / 重名 / 过期 advisory / 不存在的脚本全部报错', () => {
  assert.throws(() => parseGateArgs([]), GateConfigError)
  assert.throws(() => parseGateArgs(['check:a', 'check:a']), /门岗重复/)
  assert.throws(() => parseGateArgs(['--advisory=check:gone', 'check:a']), /名单过期/)
  assert.throws(() => parseGateArgs(['--wat', 'check:a']), /未知参数/)
  assert.throws(() => assertGatesExist(['check:a'], {}), /package\.json 里没有这些脚本/)

  const parsed = parseGateArgs(['--advisory=check:a,check:b', 'check:a', 'check:b', 'check:c'])
  assert.deepEqual(parsed.gates, ['check:a', 'check:b', 'check:c'])
  assert.deepEqual([...parsed.advisory], ['check:a', 'check:b'])
})

test('package.json 的 gates:contracts 就是这个 runner，且 advisory 只限两类、逐条点名', async () => {
  const { default: fs } = await import('node:fs')
  const { default: path } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts
  const command = scripts['gates:contracts']
  assert.match(command, /^python3 scripts\/with-gates-lock\.py -- node scripts\/run-gates-contracts\.mjs /)

  const { gates, advisory } = parseGateArgs(command.split(/\s+/).slice(5))
  assertGatesExist(gates, scripts)
  // advisory 名单不许长大。两类各自点名，加一条就得回来改这里并写清它属于哪类——
  // 这就是「不许悄悄降级门岗」那道棘轮本体。
  // 2026-10-01 用户按门岗账本（docs/audit/2026-10-01-gate-ledger.md）拍板：docs-index / doc-status / research-sources
  // 三道 advisory 49/49 次都红、永远不阻断、没有读者，移出 PR 的 Contracts（脚本留着，docs-autosync 还要用）。
  const AUTOSYNC_BACKED = []
  // 判断题提醒：机器原理上补不了，硬拦会逼出假章节。目前没有（research-sources 已移出 PR）。
  const JUDGMENT_REMINDERS = []
  // 降级为提示（用户拍板）：判据仍在、仍会打印，只是不再阻断 PR。symptom-cluster 6 次红全是补一份结构评审文档。
  const DOWNGRADED_HINTS = ['check:concept-owners']
  assert.deepEqual([...advisory].sort(), [...AUTOSYNC_BACKED, ...JUDGMENT_REMINDERS, ...DOWNGRADED_HINTS].sort())
  // 三道被移出的 advisory 不许悄悄回到 PR 的 Contracts 里
  for (const removed of ['check:docs-index', 'check:doc-status', 'check:ledger', 'check:research-sources', 'check:door-map']) {
    assert.ok(!gates.includes(removed), `${removed} 已按用户拍板移出 PR 的 Contracts`)
  }

  // ① 类：每一条都必须有一个真的会跑的自动补齐主体（现在只有 docs-autosync）。
  const autosync = fs.readFileSync(path.join(repoRoot, '.github/workflows/docs-autosync.yml'), 'utf8')
  for (const name of AUTOSYNC_BACKED) {
    assert.match(autosync, new RegExp(name.replace(':', '[:-]')), `${name} 必须由 docs-autosync 验收补齐结果`)
  }
  // ② 类：反过来钉死——它**不该**有机器补齐主体，否则它就该降到 ① 类去。
  for (const name of JUDGMENT_REMINDERS) {
    assert.doesNotMatch(autosync, new RegExp(name.replace(':', '[:-]')), `${name} 能被机器补齐的话就不属于判断题提醒`)
    // 诚实出口必须真的存在：门岗自己得说清「明写理由也算达标」。
    const source = fs.readFileSync(path.join(repoRoot, 'scripts', `${name.replace('check:', 'check-')}.mjs`), 'utf8')
    assert.match(source, /明写|也算达标/u, `${name} 必须给出「明写理由也算达标」的诚实出口`)
  }
})

test('Docs Gate Autosync never writes protected main directly and updates one fixed-branch PR without skipping CI', async () => {
  const { default: fs } = await import('node:fs')
  const { default: path } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const autosync = fs.readFileSync(path.join(repoRoot, '.github/workflows/docs-autosync.yml'), 'utf8')
  assert.match(autosync, /peter-evans\/create-pull-request@v7/)
  assert.match(autosync, /^\s+branch:\s*docs\/autosync\s*$/m)
  assert.doesNotMatch(autosync, /branch-suffix:|\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|skip-checks:\s*true/i)
  assert.doesNotMatch(autosync, /git push[^\n]*HEAD:main/)
  assert.doesNotMatch(autosync, /gh pr create|DOCS_AUTOSYNC_TOKEN|gh workflow run/)
  assert.match(autosync, /token:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/)
})

test('体检：每个 advisory 门岗的提示文案和它真实的补齐机制对得上（有机器补齐主体的才可以说「自动补齐」）', async () => {
  const { default: fs } = await import('node:fs')
  const { default: path } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts
  const { advisory } = parseGateArgs(scripts['gates:contracts'].split(/\s+/).slice(5))
  for (const name of [...advisory, ...Object.keys(ADVISORY_FILL)]) {
    const fill = ADVISORY_FILL[name]
    assert.ok(fill, `${name} 是 advisory 门岗，必须在 ADVISORY_FILL 里声明真实的补齐机制`)
    const note = advisoryNote(name)
    if (fill.kind === 'machine') {
      const workflow = fs.readFileSync(path.join(repoRoot, fill.by), 'utf8')
      assert.match(workflow, new RegExp(name.replace(':', '[:-]')), `${name} 声明由 ${fill.by} 补齐，但那个工作流没提到它`)
      assert.match(note.text, /自动补齐/)
    } else {
      assert.equal(fill.kind, 'human')
      assert.ok(fill.how && fill.how.length >= 12, `${name} 是人工补齐，必须写清谁、怎么补`)
      assert.doesNotMatch(note.text, /自动补齐/, `${name} 要人判断，文案不许说自动补齐`)
    }
  }
  // 没声明的 advisory 一律按人工，不许默认说自动补齐
  assert.doesNotMatch(advisoryNote('check:not-declared').text, /自动补齐/)
})

test('advisory 失败的汇总按门岗各自的补齐机制出文案：concept-owners 不再被说成 docs-autosync 自动补齐', async () => {
  const run = harness({ 'check:concept-owners': { code: 1, output: '登记缺了\nscanned=1\n' }, 'check:docs-index': { code: 1, output: '索引缺了\nscanned=1\n' } })
  await runGateSuite({ gates: ['check:concept-owners', 'check:docs-index'], advisory: new Set(['check:concept-owners', 'check:docs-index']), runGate: run.runGate, write: run.write, env: {} })
  const lines = run.output().split('\n')
  const owners = lines.find((line) => line.includes('· check:concept-owners'))
  const docs = lines.find((line) => line.includes('· check:docs-index'))
  assert.doesNotMatch(owners, /自动补齐/)
  assert.match(owners, /要人判断/)
  assert.match(docs, /自动补齐/)
})
