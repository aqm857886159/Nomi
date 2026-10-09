// scripts/pre-push-contracts.mjs（pre-push 钩子入口）+ scripts/lint-changed.mjs 的行为测试。
// 红测试走真实路径：在一个真实 git 仓库副本（共享对象的 clone，稀疏检出）里改文件、提交、再用真实的入口脚本跑——
// 不 mock 门岗，门岗红就是门岗脚本真的 exit 1。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'
import { judgeLint } from './lint-changed.mjs'
import { GATE_INPUTS, touchesGateInputs } from './pre-push-gate-inputs.mjs'
import {
  BODY_GATES,
  LINT_GATE,
  PRE_PUSH_GATES,
  TAG_IN_MAIN_NOTICE,
  formatSummary,
  gateCommands,
  parsePushRefs,
  pushDecision,
  selectGates,
} from './pre-push-contracts.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')
const pkg = JSON.parse(read('package.json'))

const CARD = [
  '## 设计卡',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者推送前就看到全部门岗结果以便当场改掉 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 门岗清单归 package.json 的 gates:contracts | git grep |',
  '| ★3 一致与复用 | 同类别处 | 复用 pr-body-criteria，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 全过 红 取不到基线 无 PR 各一句话 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 本测试表加回滚 revert 本提交 | 命令 |',
].join('\n')

// ── 纯函数 ───────────────────────────────────────────────────────────────────────

test('门岗清单：每一项都在 package.json 的 gates:contracts 里、命令是 node 脚本（命令只此一份，不另抄）', () => {
  const contracts = pkg.scripts['gates:contracts']
  for (const name of [...PRE_PUSH_GATES.map((gate) => gate.name), ...BODY_GATES]) {
    assert.ok(contracts.split(/\s+/).includes(name), `${name} 不在 gates:contracts 里：推送前跑的门岗必须是 CI 也跑的那一个`)
    assert.doesNotThrow(() => gateCommands(pkg.scripts[name], []), `${name} 的命令不是 node 脚本`)
  }
  assert.ok(contracts.split(/\s+/).includes('lint:ci'), 'lint:changed 是 lint:ci 的子集，CI 侧必须还在跑 lint:ci')
  assert.equal(LINT_GATE.name, 'lint:changed')
})

test('命令选取：平时只跑检查脚本本体；改到门岗自己的单测 / 脚本时连单测一起跑', () => {
  const script = pkg.scripts['check:mjs-parse']
  assert.deepEqual(gateCommands(script, ['src/a.ts']), [['./scripts/check-mjs-parse.mjs']])
  const withTests = gateCommands(script, ['scripts/check-mjs-parse.node-test.mjs'])
  assert.equal(withTests.length, 2)
  assert.deepEqual(withTests[0].slice(0, 2), ['--test', './scripts/check-mjs-parse.node-test.mjs'])
  assert.throws(() => gateCommands('pnpm exec tsx scripts/x.ts', []), /只认 node 命令/)
})

test('按改动选门岗：该片地没动就不跑；纯文档只跑登记类；算不出改动全跑', () => {
  const always = ['check:filesize', 'check:self-written', 'check:boundary-owners']
  assert.deepEqual(selectGates(['docs/engineering/x.md']), always)
  const electron = selectGates(['electron/main.ts'])
  assert.ok(electron.includes('check:ipc-sender-binding') && electron.includes('check:test-waits') && electron.includes('lint:changed'))
  assert.ok(!electron.includes('check:mjs-parse'), 'electron/ 下没有 .mjs/.cjs 改动，不必跑 mjs-parse')
  const scripts = selectGates(['scripts/foo.mjs'])
  assert.ok(scripts.includes('check:mjs-parse') && !scripts.includes('check:ipc-sender-binding'))
  const everything = selectGates(null)
  for (const gate of PRE_PUSH_GATES) assert.ok(everything.includes(gate.name))
  assert.ok(everything.includes('lint:changed'))
})

test('推送判定：依据远端 ref + 本地 SHA，不看 localRef 写法；删除跳过；tag 看是否已在 origin/main；SHA ≠ HEAD 拒绝', () => {
  const head = 'a'.repeat(40)
  const zero = '0'.repeat(40)
  const decide = (line, inMain) => pushDecision(parsePushRefs(line + '\n'), head, inMain)
  assert.deepEqual(decide(`HEAD ${head} refs/heads/x ${zero}`), { check: true })
  assert.deepEqual(decide(`refs/heads/x ${head} refs/heads/x ${zero}`), { check: true })
  assert.equal(decide(`(delete) ${zero} refs/heads/x ${head}`).check, false)
  assert.equal(decide(`refs/tags/v1 ${head} refs/tags/v1 ${zero}`, () => false).check, true)
  assert.equal(decide(`refs/tags/v1 ${head} refs/tags/v1 ${zero}`, () => true).check, false)
  assert.match(decide(`refs/heads/y ${'b'.repeat(40)} refs/heads/y ${zero}`).blocked, /先 checkout/)
  assert.match(decide(`HEAD ${'b'.repeat(40)} refs/heads/y ${zero}`).blocked, /先 checkout/)
})

test('具名豁免：只对「已在 origin/main 的 tag」；其余非零更新一律先校验 SHA === HEAD', () => {
  const head = 'a'.repeat(40)
  const old = 'c'.repeat(40)
  const zero = '0'.repeat(40)
  const inMain = (sha) => sha === old
  const decide = (line) => pushDecision(parsePushRefs(line + '\n'), head, inMain)
  const tagInMain = decide(`refs/tags/v1 ${old} refs/tags/v1 ${zero}`)
  assert.equal(tagInMain.check, false)
  assert.equal(tagInMain.reason, TAG_IN_MAIN_NOTICE)
  assert.match(TAG_IN_MAIN_NOTICE, /tag 指向已在 origin\/main 的提交，不带新内容，跳过门岗/)
  assert.deepEqual(decide(`refs/tags/v1 ${head} refs/tags/v1 ${zero}`), { check: true }, '不在 main 的 tag（= HEAD）要跑门岗')
  assert.match(decide(`refs/tags/v1 ${'d'.repeat(40)} refs/tags/v1 ${zero}`).blocked, /先 checkout/, '不在 main 的 tag 且 ≠ HEAD：阻断')
  assert.match(decide(`refs/heads/x ${old} refs/heads/x ${zero}`).blocked, /先 checkout/, '分支指向 main 上的旧提交也不豁免')
  assert.match(decide(`refs/notes/x ${old} refs/notes/x ${zero}`).blocked, /先 checkout/, '非 tag 的其它 ref 同理')
  assert.match(decide(`refs/tags/v1 ${old} refs/heads/x ${zero}`).blocked, /先 checkout/, '远端 ref 不是 tag 就不豁免（看远端 ref，不看本地写法）')
})

test('汇总：失败项一次全部列出（不是第一项红就停），并给出只重跑失败项的命令', () => {
  const { text, failed } = formatSummary([
    { name: 'check:filesize', status: 1, output: 'a\nb', ms: 1000 },
    { name: 'check:self-written', status: 0, output: '', ms: 500 },
    { name: 'check:ipc-sender-binding', status: 1, output: 'c', ms: 800 },
  ])
  assert.equal(failed.length, 2)
  assert.match(text, /BLOCKED：2 项没过：check:filesize、check:ipc-sender-binding/)
  assert.match(text, /pnpm run check:filesize/)
  assert.match(text, /pnpm run check:ipc-sender-binding/)
  assert.doesNotMatch(text, /--only/, '重跑提示不走钩子入口，也没有缩小门岗集合的参数')
})

test('lint 子集：错误一律拦；警告只在比 base 多时拦并指出新增的那几条', () => {
  const warn = (ruleId, message) => ({ severity: 1, ruleId, message, line: 1, column: 1 })
  const error = (ruleId, message) => ({ severity: 2, ruleId, message, line: 2, column: 1 })
  assert.deepEqual(judgeLint([{ file: 'a.ts', head: [warn('x', 'm')], base: [warn('x', 'm')] }]), [], '存量警告不拦')
  assert.deepEqual(judgeLint([{ file: 'a.ts', head: [], base: [warn('x', 'm')] }]), [], '瘦身不拦')
  const more = judgeLint([{ file: 'a.ts', head: [warn('x', 'm'), warn('y', 'new')], base: [warn('x', 'm')] }])
  assert.equal(more.length, 1)
  assert.match(more[0], /警告 1 → 2/)
  assert.match(more[0], /新增 1:1 y new/)
  assert.equal(judgeLint([{ file: 'a.ts', head: [error('z', 'bad')], base: [error('z', 'bad')] }]).length, 1, '错误不看 base')
})

// ── 结构：判据库被两边共用，旧的各自实现已删 ─────────────────────────────────────

test('判据库被两边共用：推送前入口（check-pr-judgement）与合并前扫描（merge-preflight）都从 pr-body-criteria.mjs 判，谁也没有自己的设计卡实现', () => {
  for (const file of ['scripts/check-pr-judgement.mjs', 'scripts/merge-preflight.mjs']) {
    assert.match(read(file), /from '\.\/pr-body-criteria\.mjs'/, `${file} 没有 import 判据库`)
    assert.doesNotMatch(read(file), /function (?:checkDesignCard|checkIndependentAcceptance|checkEscapeContract|cellFilled|ledgerChanges)\b/, `${file} 里又长出了自己的判据实现`)
  }
  assert.match(read('scripts/pr-body-criteria.mjs'), /export function checkDesignCard/)
  assert.ok(!fs.existsSync(path.join(repoRoot, 'scripts/check-pr-body-gates.mjs')), '旧的正文门岗入口应已并入 pre-push-contracts.mjs（P1）')
})

test('钩子入口：pre-push 由分发入口 git-hook.mjs 指向 pre-push-contracts.mjs，钩子文件里不写脚本名，也没有绕过开关', () => {
  const table = JSON.parse(read('scripts/git-hooks.json'))
  assert.deepEqual(table['pre-push'], [['scripts/pre-push-contracts.mjs']])
  assert.doesNotMatch(read('scripts/install-git-hooks.cjs'), /pre-push-contracts/, '安装器不许再写死脚本名')
  const entry = read('scripts/pre-push-contracts.mjs')
  assert.doesNotMatch(entry, BYPASS_PATTERN)
})

// 入口里不许有绕过开关：SKIP / NO_VERIFY / BYPASS 字样，或读任何带 SKIP / DISABLE / OFF 的环境变量（正文来源 NOMI_PR_BODY* 除外）
const BYPASS_PATTERN = /SKIP|NO_VERIFY|BYPASS|process\.env\.(?!NOMI_PR_BODY)\w*(?:SKIP|DISABLE|OFF)/i

test('绕过开关的判据本身有牙：NOMI_SKIP / NOMI_DISABLE / NOMI_OFF 都被拒，正文变量不误伤', () => {
  assert.match('process.env.NOMI_SKIP', BYPASS_PATTERN)
  assert.match('process.env.NOMI_DISABLE_GATES', BYPASS_PATTERN)
  assert.match('process.env.NOMI_OFF', BYPASS_PATTERN)
  assert.doesNotMatch('process.env.NOMI_PR_BODY_FILE', BYPASS_PATTERN)
  assert.doesNotMatch('process.env.NOMI_GIT_HOOK_DISPATCH', BYPASS_PATTERN)
})

// ── 真实路径：真 git 仓库副本里跑真入口 ──────────────────────────────────────────

let work
let baseSha
const ZERO = '0'.repeat(40)
const run = (cwd, command, args, options = {}) => spawnSync(command, args, { cwd, encoding: 'utf8', ...options })
const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8' }).trim()

function gitSetup() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  work = path.join(makeTempDir('nomi-prepush-'), 'repo')
  execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', repoRoot, work])
  git('checkout', '-q', '--detach', head)
  git('update-ref', 'refs/remotes/origin/main', head)
  baseSha = head
  // 依赖门岗（tokens / vocabularies 要 typescript）需要 node_modules：junction 指回真仓库；退出前先只摘链接（rmdir 不跟进目标）
  nodeModulesLink = path.join(work, 'node_modules')
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), nodeModulesLink, 'junction')
}
let nodeModulesLink = null
after(() => { try { if (nodeModulesLink) fs.rmdirSync(nodeModulesLink) } catch { /* 已不在 */ } })

function commitChange(edit) {
  git('reset', '-q', '--hard', baseSha)
  edit()
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'test change')
}

/**
 * 这些测试要的是「夹具仓库里这一次提交」的判据。CI 的 Contracts job 把 PR 的 base SHA 放进
 * PRIOR_ART_BASE_REF / ROOT_CAUSE_BASE_REF 等环境变量，子进程继承后会拿整个 PR 的 diff 当夹具的 diff
 * （比如 PR 改过 self-written.json，夹具里的 check:prior-art 就判「改了登记表、要先查别人」而变红）。
 * 所以把所有 *_BASE_REF / NOMI_CHANGED_BASE 从子进程环境里拿掉，让每道门岗回到「夹具自己的 origin/main」。断言一字未动。
 */
function isolatedFromCiBaseRefs(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/_BASE_REF$/.test(key) && key !== 'NOMI_CHANGED_BASE'))
}

// 真钩子调用时 git 会把 <remote名> <url> 作为参数传进来；脚本只有收到这两个参数才读 stdin 的 ref 行
const HOOK_ARGS = ['origin', 'https://example.invalid/r.git']
function prePush({ body = CARD, cwd = work, args = HOOK_ARGS, refLine, dispatched = true } = {}) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  // 外层 node --test 会设 NODE_TEST_CONTEXT，子进程里再 node --test 就不真跑了（假绿）——必须清掉
  const env = { ...isolatedFromCiBaseRefs(process.env), ...(body === undefined ? {} : { NOMI_PR_BODY: body }) }
  delete env.NODE_TEST_CONTEXT
  // 真钩子由分发器设内部标记；只给两个参数、没有标记的不算钩子
  if (dispatched) env.NOMI_GIT_HOOK_DISPATCH = 'pre-push'
  else delete env.NOMI_GIT_HOOK_DISPATCH
  return run(cwd, process.execPath, [path.join(cwd, 'scripts/pre-push-contracts.mjs'), ...args], {
    input: refLine ? refLine(sha) : `refs/heads/topic ${sha} refs/heads/topic ${ZERO}\n`,
    env,
  })
}

before(gitSetup)

test('必红：改了 electron/main.ts 超出基线 → 推送前检查红，且报出 check:filesize', () => {
  commitChange(() => {
    const file = path.join(work, 'electron/main.ts')
    fs.appendFileSync(file, `${Array.from({ length: 80 }, (_, i) => `export const prepushPadding${i} = ${i}`).join('\n')}\n`)
  })
  const result = prePush()
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /✖ check:filesize/)
  assert.match(result.stderr, /BLOCKED/)
})

test('对照：没改任何东西时同一个门岗是绿的（红不是环境造成的）', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const result = prePush()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /✅ check:filesize/, result.stderr)
})

test('必红：新增未加固的 ipcMain.on → 推送前红', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'electron/prepushUnboundIpc.ts'), "import { ipcMain } from 'electron'\nipcMain.on('prepush:unbound', () => {})\n"))
  const result = prePush()
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /✖ check:ipc-sender-binding/)
})

test('必红：PR 正文用英文「## Design card」→ 推送前就红，并点明要中文标题（以前只有合并前红）', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const result = prePush({ body: CARD.replace('## 设计卡', '## Design card') })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /没有 `## 设计卡` 一节/)
  assert.match(result.stderr, /英文标题/)
})

test('必红：设计卡没有 ★ 格 → 推送前就红；写全了才绿（同一份正文，两边同一个口径）', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const empty = prePush({ body: '## 设计卡\n随便写写\n' })
  assert.equal(empty.status, 1, empty.stderr)
  assert.match(empty.stderr, /设计卡缺格：1、2、3、4、9/)
  const full = prePush({ body: CARD })
  assert.equal(full.status, 0, full.stderr)
  assert.match(full.stderr, /✅ check:pr-judgement/, full.stderr)
})

test('钩子入口不接受缩小门岗集合的参数：--only 被拒、空值被拒、未知值被拒（只认 --list）', () => {
  for (const arg of ['--only=check:filesize', '--only=', '--only', '', 'check:filesize']) {
    const result = prePush({ args: [arg] })
    assert.equal(result.status, 2, `参数 ${JSON.stringify(arg)} 应被拒：${result.stderr}`)
    assert.match(result.stderr, /不接受参数/)
  }
})

test('真入口：分离 HEAD 推分支（本地 ref 写 HEAD）照样跑门岗；红了就拦', () => {
  commitChange(() => fs.appendFileSync(path.join(work, 'electron/main.ts'), `${Array.from({ length: 80 }, (_, i) => `export const detached${i} = ${i}`).join('\n')}\n`))
  const result = prePush({ refLine: (sha) => `HEAD ${sha} refs/heads/topic ${ZERO}\n` })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /✖ check:filesize/)
})

test('真入口：删分支（本地 SHA 为零）跳过，不跑门岗', () => {
  const result = prePush({ refLine: (sha) => `(delete) ${ZERO} refs/heads/topic ${sha}\n` })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /跳过/)
  assert.doesNotMatch(result.stderr, /check:filesize/)
})

test('真入口：推 tag——指向的提交不在 origin/main 就跑门岗；已在 origin/main 里才跳过', () => {
  commitChange(() => fs.appendFileSync(path.join(work, 'electron/main.ts'), `${Array.from({ length: 80 }, (_, i) => `export const tagged${i} = ${i}`).join('\n')}\n`))
  const tagLine = (sha) => `refs/tags/v9 ${sha} refs/tags/v9 ${ZERO}\n`
  const fresh = prePush({ refLine: tagLine })
  assert.equal(fresh.status, 1, fresh.stderr)
  assert.match(fresh.stderr, /✖ check:filesize/)
  git('reset', '-q', '--hard', baseSha)
  const merged = prePush({ refLine: tagLine })
  assert.equal(merged.status, 0, merged.stderr)
  assert.ok(merged.stderr.includes(TAG_IN_MAIN_NOTICE), merged.stderr)
  assert.doesNotMatch(merged.stderr, /✅ check:/, '豁免时一道门岗都不跑')
})

test('真入口：非 tag 的 ref 指向 main 上的旧提交、但 ≠ HEAD → 阻断（豁免只给 tag）', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  for (const remoteRef of ['refs/heads/old', 'refs/notes/old']) {
    const result = prePush({ refLine: () => `refs/heads/old ${baseSha} ${remoteRef} ${ZERO}\n` })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /先 checkout 要推的提交再推/)
  }
})

test('真入口：要推的 SHA 和工作树 HEAD 不一致 → 拒绝（fail-closed），提示先 checkout', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const result = prePush({ refLine: () => `refs/heads/other ${'b'.repeat(40)} refs/heads/other ${ZERO}\n` })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /先 checkout 要推的提交再推/)
  assert.doesNotMatch(result.stderr, /✅ check:/, '拒绝时一道门岗都不跑')
})

// ── 手动跑不许挂住 / 正文来源 ────────────────────────────────────────────────────

test('必红：手动跑（无参数）+ 一个永远不关的 stdin 管道 → 几十秒内退出，不读 stdin（以前会挂 600–1700 秒）', async () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [path.join(work, 'scripts/pre-push-contracts.mjs')], {
    cwd: work, env: { ...process.env, NOMI_PR_BODY: CARD }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.on('error', () => {})
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve('HUNG') }, 90_000)
    child.on('close', (code) => { clearTimeout(timer); resolve(code) })
  })
  child.stdin.destroy()
  assert.equal(outcome, 0, `应正常退出，实际：${outcome}
${stderr}`)
  assert.match(stderr, /✅ check:filesize/)
})

const envWithoutBody = () => { const env = { ...process.env }; delete env.NOMI_PR_BODY; return env }

test('手动跑可以用 NOMI_PR_BODY_FILE 给正文；文件读不了 = 明确报错退出，不是跳过', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const bodyFile = path.join(path.dirname(work), 'body.md')
  fs.writeFileSync(bodyFile, CARD)
  const ok = run(work, process.execPath, [path.join(work, 'scripts/pre-push-contracts.mjs')], { input: '', env: { ...envWithoutBody(), NOMI_PR_BODY_FILE: bodyFile } })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stderr, /PR 正文取自 NOMI_PR_BODY_FILE/)
  const missing = run(work, process.execPath, [path.join(work, 'scripts/pre-push-contracts.mjs')], { input: '', env: { ...envWithoutBody(), NOMI_PR_BODY_FILE: path.join(path.dirname(work), 'nope.md') } })
  assert.equal(missing.status, 1, missing.stderr)
  assert.match(missing.stderr, /NOMI_PR_BODY_FILE/)
})

// ── 10-09 补进推送前的「几秒能跑完、却在 CI 才红」的门岗：必红 + 路径选择 ───────────────────

test('必红：走查新增 mkdtempSync(os.tmpdir()…) → 推送前就红，点名 test:temp-helper（CI 上 3 个 PR 撞过）', () => {
  commitChange(() => {
    fs.mkdirSync(path.join(work, 'tests/ux'), { recursive: true })
    fs.writeFileSync(path.join(work, 'tests/ux/prepush-probe.walk.mjs'), "import fs from 'node:fs'\nimport os from 'node:os'\nimport path from 'node:path'\nexport const dir = fs.mkdtempSync(path.join(os.tmp" + "dir(), 'probe-'))\n")
  })
  const result = prePush({ body: CARD })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /✖ test:temp-helper/)
})

test('必红：src 新增未登记的 type union（生命周期词）→ 推送前红，点名 check:vocabularies', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'src/prepushProbeVocabulary.ts'), "export type PrepushProbeState = 'queued' | 'running' | 'success'\n"))
  const result = prePush({ body: CARD })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /✖ check:vocabularies/)
  assert.match(result.stderr, /PrepushProbeState/, '红的原因要是这个新 union，不是缺依赖')
})

test('按改动路径选门岗：只改 docs 不跑新增的；改 tests/ 跑临时目录与抄文案；改 src tsx 跑 tokens / vocabularies / controls；改 electron 跑退出守卫', () => {
  const docs = selectGates(['docs/a.md'])
  for (const name of ['check:tokens', 'check:vocabularies', 'check:controls', 'test:temp-helper', 'check:test-copy-literals', 'test:quit-lifecycle-guard']) assert.ok(!docs.includes(name), `docs 改动不该跑 ${name}`)
  const tests = selectGates(['tests/ux/x.walk.mjs'])
  assert.ok(tests.includes('test:temp-helper') && tests.includes('check:test-copy-literals'))
  assert.ok(!tests.includes('check:tokens'))
  const tsx = selectGates(['src/ui/A.tsx'])
  for (const name of ['check:tokens', 'check:vocabularies', 'check:controls', 'check:test-copy-literals']) assert.ok(tsx.includes(name), name)
  assert.ok(selectGates(['electron/main.ts']).includes('test:quit-lifecycle-guard'))
  assert.ok(selectGates(['scripts/control-contract-copy.mjs']).includes('test:control-contract'))
  assert.ok(selectGates(null).includes('test:control-contract'), '算不出改动 = 全跑')
})

test('必红：伪造两个参数、没有分发器标记，再从 stdin 塞一条删除 ref → 门岗照跑，不许当「只是删除」跳过', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const result = prePush({ body: CARD, dispatched: false, refLine: () => `(delete) ${ZERO} refs/heads/topic ${'c'.repeat(40)}\n` })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /✅ check:filesize/, '门岗必须真的跑了')
  assert.doesNotMatch(result.stderr, /只是删除远端 ref/)
})

test('有标记 + 两个参数才算钩子：同一条删除 ref 这时才允许跳过（对照）', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const result = prePush({ body: CARD, refLine: () => `(delete) ${ZERO} refs/heads/topic ${'c'.repeat(40)}\n` })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /只是删除远端 ref/)
})

// ── 选择器与扫描器同一份声明：契约测试（10-09 复审：tokens 漏 .css 与依赖脚本、vocabularies 漏 .mts / .cts）──────────────

/** 每道门岗的扫描器「实际会读」的样例路径：新增 / 改动任何一个，选择器都必须选中它。改扫描范围不改 GATE_INPUTS，这条就红。 */
const SCANNER_READS = {
  'check:tokens': ['src/theme/nomi-tokens.css', 'src/ui/A.tsx', 'src/a.ts', 'src/a.mts', 'electron/x.ts', 'electron/theme.css', 'tailwind.config.ts', 'scripts/check-design-tokens.mjs', 'scripts/lib/colorMixHue.mjs', 'scripts/lib/scopedTokenScan.mjs', 'scripts/lib/gitPaths.mjs'],
  'check:vocabularies': ['src/a.ts', 'src/a.tsx', 'src/a.mts', 'src/a.cts', 'electron/b.cts', 'electron/b.mts', 'scripts/check-vocabularies.mjs', 'scripts/check-vocabularies-scan.mjs', 'scripts/vocabularies-baseline.json'],
  'check:controls': ['src/ui/B.tsx', 'scripts/check-control-contract.mjs', 'scripts/control-contract-copy.mjs', 'scripts/control-contract-discarded-commands.mjs', 'scripts/control-copy-baseline.json'],
  'test:temp-helper': ['scripts/x.node-test.mjs', 'tests/ux/y.walk.mjs', 'tests/ux/z.probe.mjs', 'scripts/check-test-temp-static.node-test.mjs', 'scripts/_test-temp.mjs'],
  'check:test-copy-literals': ['src/a.test.ts', 'electron/b.test.ts', 'scripts/c.node-test.mjs', 'tests/ux/d.walk.mjs', 'tests/ux/exempt.json', 'evals/e.test.mjs', 'packages/p/f.test.ts', 'src/i18n/locales/zh.ts', 'electron/desktopStrings.ts', 'scripts/check-test-copy-literals.mjs'],
  'test:control-contract': ['scripts/check-control-contract.test.mjs', 'scripts/control-contract-copy.mjs', 'scripts/control-contract-discarded-commands.mjs', 'scripts/_test-temp.mjs'],
  'test:quit-lifecycle-guard': ['electron/quitLifecycleGuard.test.ts', 'electron/main.ts', 'electron/x.mts', 'eslint.config.mjs'],
}

test('契约：每道按路径选的新门岗都在 GATE_INPUTS 里登记，且扫描器会读的样例路径（css / mts / cts / 依赖脚本 / 基线）都选得中', () => {
  assert.deepEqual(Object.keys(SCANNER_READS).sort(), Object.keys(GATE_INPUTS).sort(), '样例表与输入声明的门岗集合必须一致')
  for (const [name, samples] of Object.entries(SCANNER_READS)) {
    for (const sample of samples) assert.ok(touchesGateInputs(name, [sample]), `${name} 应被 ${sample} 选中（扫描器会读它）`)
    assert.ok(!touchesGateInputs(name, ['docs/engineering/x.md']), `${name} 不该被纯文档选中`)
  }
})

test('契约：选择器只用 GATE_INPUTS，pre-push-contracts.mjs 里没有手写的这七道门岗的路径正则', () => {
  const entry = read('scripts/pre-push-contracts.mjs')
  for (const name of Object.keys(GATE_INPUTS)) {
    const line = entry.split('\n').find((text) => text.includes(`name: '${name}'`))
    assert.ok(line, `${name} 应在入口里登记`)
    assert.match(line, /touchesGateInputs\(/, `${name} 的选择器必须来自 GATE_INPUTS`)
    assert.doesNotMatch(line, /\.test\(file\)/, `${name} 不许再手写路径正则`)
  }
})
