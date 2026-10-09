// scripts/pre-push-contracts.mjs（pre-push 钩子入口）+ scripts/lint-changed.mjs 的行为测试。
// 红测试走真实路径：在一个真实 git 仓库副本（共享对象的 clone，稀疏检出）里改文件、提交、再用真实的入口脚本跑——
// 不 mock 门岗，门岗红就是门岗脚本真的 exit 1。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { before } from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'
import { judgeLint } from './lint-changed.mjs'
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
  assert.doesNotMatch(entry, /SKIP|NO_VERIFY|BYPASS|process.env.(?!NOMI_PR_BODY)w*(?:SKIP|DISABLE|OFF)/i)
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
}

function commitChange(edit) {
  git('reset', '-q', '--hard', baseSha)
  edit()
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'test change')
}

// 真钩子调用时 git 会把 <remote名> <url> 作为参数传进来；脚本只有收到这两个参数才读 stdin 的 ref 行
const HOOK_ARGS = ['origin', 'https://example.invalid/r.git']
function prePush({ body, cwd = work, args = HOOK_ARGS, refLine } = {}) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  const env = { ...process.env, ...(body === undefined ? {} : { NOMI_PR_BODY: body }) }
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
