// scripts/pre-push-contracts.mjs（pre-push 钩子入口）的「真实路径」行为测试（慢：起 git 副本、spawn 真入口、tsc 探针、超时）。
// 纯函数 / 结构 / 契约用例在 scripts/pre-push-structure.node-test.mjs（快，推送前钩子自己会跑它）。
// 红测试走真实路径：在一个真实 git 仓库副本（共享对象的 clone，稀疏检出）里改文件、提交、再用真实的入口脚本跑——
// 不 mock 门岗，门岗红就是门岗脚本真的 exit 1。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'
import { touchesGateInputs } from './pre-push-gate-inputs.mjs'
import { TAG_IN_MAIN_NOTICE, runNode, runWithDeadline } from './pre-push-contracts.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CARD = [
  '## 设计卡',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者推送前就看到全部门岗结果以便当场改掉 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 门岗清单归 package.json 的 gates:contracts | git grep |',
  '| ★3 一致与复用 | 同类别处 | 复用 pr-body-criteria，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 全过 红 取不到基线 无 PR 各一句话 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 本测试表加回滚 revert 本提交 | 命令 |',
].join('\n')

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

test('必红：新增一个没有 declareStoreLifetime 的 zustand store → 推送前红，点名 check:store-lifetime（#1135 / #1133 在 CI 才撞到）', () => {
  commitChange(() => {
    fs.mkdirSync(path.join(work, 'src/workbench/prepushProbe'), { recursive: true })
    fs.writeFileSync(path.join(work, 'src/workbench/prepushProbe/useProbeStore.ts'), "import { create } from 'zustand'\nexport const useProbeStore = create<{ value: number }>(() => ({ value: 1 }))\n")
  })
  const result = prePush()
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /✖ check:store-lifetime/)
  assert.match(result.stderr, /useProbeStore/, '红的原因要是这个新 store')
})

test('必红：往 GATE_INPUTS 加了一道门、没补 SCANNER_READS → 推送前就红，点名 test:pre-push-structure（#1147 在 CI 才撞到）', () => {
  commitChange(() => {
    const file = path.join(work, 'scripts/pre-push-gate-inputs.mjs')
    const source = fs.readFileSync(file, 'utf8')
    const marker = 'export const GATE_INPUTS = Object.freeze({'
    assert.ok(source.includes(marker))
    fs.writeFileSync(file, source.replace(marker, `${marker}\n  'check:prepush-probe-gate': { roots: ['src'], exts: ['ts'], files: [], entries: [] },`))
  })
  const result = prePush()
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /✖ test:pre-push-structure/)
  // 失败输出只回放最后 25 行，红的具体用例名不一定在里面；是不是「SCANNER_READS 与 GATE_INPUTS 不一致」这一条红，对照下面一行
  const direct = run(work, process.execPath, ['--test', '--test-name-pattern=每道按路径选的新门岗', 'scripts/pre-push-structure.node-test.mjs'], { env: { ...isolatedFromCiBaseRefs(process.env), NODE_TEST_CONTEXT: undefined } })
  assert.notEqual(direct.status, 0)
  assert.match(direct.stdout, /样例表与输入声明的门岗集合必须一致/)
})

test('必红：改了 build 脚本 → 推送前真入口选中并跑 test:related，且 electron-build.test.mjs 在被跑的文件里（#1148）', () => {
  commitChange(() => {
    const file = path.join(work, 'scripts/build-electron.mjs')
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\n// prepush probe\n`)
  })
  const result = prePush()
  assert.match(result.stderr, /test:related/, result.stderr)
  assert.match(result.stderr, /✅ test:related（[\d.]+s） vitest \d+ 个文件通过/, '被选中的 vitest 测试（含 electron-build.test.mjs）真的跑过且通过')
})

// ── typecheck 的选择范围从真实 tsconfig 派生：被选中就一定真被某个 program 编译 ────────────────────────────────

test('探针：每份被 typecheck 实际编译的 tsconfig，取一个它展开的根文件——选择器选中它，且 tsc --listFilesOnly 真的列出它（选择范围 = 实际覆盖）', async () => {
  const { spawn } = await import('node:child_process')
  const { programRootFiles } = await import('./lib/typecheckCoverage.mjs')
  const { TYPECHECK_PROJECTS } = await import('./lib/typecheckProjects.mjs')
  const tscBin = path.join(repoRoot, 'node_modules/typescript/bin/tsc')
  const probes = Object.entries(TYPECHECK_PROJECTS).map(async ([label, config]) => {
    const roots = programRootFiles(config, repoRoot)
    assert.ok(roots.length > 0, `${config} 没有展开出任何根文件`)
    const sample = roots[roots.length - 1]
    assert.ok(touchesGateInputs('typecheck', [sample]), `${label}：${sample} 应选中 typecheck`)
    const listed = await new Promise((resolve) => {
      let out = ''
      const child = spawn(process.execPath, [tscBin, '-p', config, '--listFilesOnly'], { cwd: repoRoot })
      child.stdout.on('data', (chunk) => { out += chunk })
      child.on('close', () => resolve(out))
    })
    const normalized = listed.split(path.sep).join('/').toLowerCase()
    assert.ok(normalized.includes(sample.toLowerCase()), `${label}（${config}）：tsc 没有编译 ${sample}——选择范围大于实际覆盖`)
  })
  await Promise.all(probes)
})

// ── 硬超时：任何一道门、整个钩子都不会无限挂住 ───────────────────────────────────────────────────────────

test('必红：一道门挂住（子进程永不退出）→ 超时被终止，门名和耗时写进输出，状态非零（不是无限等）', async () => {
  const started = Date.now()
  const result = await runNode(['-e', 'setInterval(() => {}, 1000)'], {}, { timeoutMs: 1500, name: 'probe:hang' })
  assert.ok(Date.now() - started < 20_000, '超时没生效')
  assert.notEqual(result.status, 0)
  assert.match(result.output, /超时：probe:hang/)
  assert.match(result.output, /已终止/)
})

test('必红：整个钩子超过期限 → 点名仍在跑的门、终止子进程、返回 timedOut（不会无限挂住）', async () => {
  const tasks = [
    async () => ({ name: 'probe:a', ...(await runNode(['-e', 'setInterval(() => {}, 1000)'], {}, { timeoutMs: 60_000, name: 'probe:a' })) }),
    async () => ({ name: 'probe:b', ...(await runNode(['-e', 'setInterval(() => {}, 1000)'], {}, { timeoutMs: 60_000, name: 'probe:b' })) }),
  ]
  const started = Date.now()
  const outcome = await runWithDeadline(tasks, 2, 1500)
  assert.ok(Date.now() - started < 20_000)
  assert.equal(outcome.timedOut, true)
  assert.equal(outcome.stillRunning.length, 2)
  assert.match(outcome.stillRunning.join(' '), /probe:a/)
  assert.match(outcome.stillRunning.join(' '), /probe:b/)
})

test('分发器每一步也有硬超时：脚本挂住 → 非零 + 原因 + 耗时', async () => {
  const gitHook = await import('./git-hook.mjs')
  const root = makeTempDir('nomi-hook-timeout-')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts/hang.mjs'), 'setInterval(() => {}, 1000)\n')
  fs.writeFileSync(path.join(root, 'scripts/t.json'), JSON.stringify({ 'pre-commit': [['scripts/hang.mjs']] }))
  const started = Date.now()
  const code = gitHook.runHook('pre-commit', [], { root, table: path.join(root, 'scripts/t.json'), stepTimeoutMs: 1500 })
  assert.ok(Date.now() - started < 20_000)
  assert.notEqual(code, 0)
})

// ── 推送前输出要如实说「哪些只在 CI」 ───────────────────────────────────────────────────────────────────

test('推送前输出点名：只在 CI 跑的门共 N 道，部分覆盖的（check:i18n、lint:ci）本机只跑了哪一部分；钩子是加速器、CI 是最终裁判', () => {
  commitChange(() => fs.writeFileSync(path.join(work, 'docs/engineering/prepush-note.md'), '# note\n'))
  const result = prePush()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /只在 CI 跑的门共 \d+ 道/)
  assert.match(result.stderr, /check:i18n（本机只跑了 check:test-copy-literals）/)
  assert.match(result.stderr, /CI 才是最终裁判/)
})

// ── 复审 3：门自己的实现脚本被改，必须选中这道门本身 ─────────────────────────────────────────────────────
