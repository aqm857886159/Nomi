import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as temp from './_test-temp.mjs'
import { cleanupTestTemp, makeTempDir, makeTempDirAsync } from './_test-temp.mjs'
import { killProcessTree, processTreeSpawnOptions } from './lib/processTree.mjs'

test('shared node:test temp roots are removed synchronously and asynchronously', async () => {
  const syncRoot = makeTempDir('nomi-node-test-sync-')
  const asyncRoot = await makeTempDirAsync('nomi-node-test-async-')
  assert.equal(fs.existsSync(syncRoot), true)
  assert.equal(fs.existsSync(asyncRoot), true)
  cleanupTestTemp(syncRoot)
  cleanupTestTemp(asyncRoot)
  assert.equal(fs.existsSync(syncRoot), false)
  assert.equal(fs.existsSync(asyncRoot), false)
})

// macOS 的 tmpdir 是符号链接（/var → /private/var）。在 Linux CI 上用一个指向真目录的链接当 TMPDIR 复现同一处境，
// 让「临时目录返回链接路径」这类问题在 CI 就红，而不是只在 Mac 本机红。
test('temp roots are canonical even when TMPDIR is a symlink', async (t) => {
  const real = makeTempDir('nomi-real-tmp-')
  const link = `${real}-link`
  fs.symlinkSync(real, link, 'dir')
  const savedTmp = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }
  t.after(() => {
    for (const [key, value] of Object.entries(savedTmp)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(link, { force: true })
    fs.rmSync(real, { recursive: true, force: true })
  })
  process.env.TMPDIR = link
  process.env.TMP = link
  process.env.TEMP = link
  assert.equal(os.tmpdir(), link, 'precondition: os.tmpdir() follows TMPDIR')

  const syncRoot = makeTempDir('nomi-canonical-sync-')
  const asyncRoot = await makeTempDirAsync('nomi-canonical-async-')
  for (const root of [syncRoot, asyncRoot]) {
    assert.equal(root, fs.realpathSync(root))
    assert.ok(root.startsWith(real), `${root} should live under the resolved ${real}`)
    // 真实消费者：脚本自己的 import.meta.url 是真路径，入口判断拿 argv[1] 去比必须相等
    const probe = path.join(root, 'probe.mjs')
    fs.writeFileSync(probe, "import { pathToFileURL } from 'node:url'\nconsole.log(import.meta.url === pathToFileURL(process.argv[1]).href)\n")
    assert.equal(execFileSync(process.execPath, [probe], { encoding: 'utf8' }).trim(), 'true')
    cleanupTestTemp(root)
  }
})

// ── 目录归属与回收（2026-10-28）──────────────────────────────────────────────────────────────────
// 起因：10-24 到 10-28 门岗超时用 SIGKILL 杀进程组，创建目录的进程被杀，process.once('exit') 不会跑，漏了 10 份、约 8.6G。
// 现在每个目录名带创建者进程号（nomi-<前缀>-p<进程号>-<6 位随机>），谁都能回答「创建者还活着吗」：
//   · 创建者自己正常退出：退出钩子立刻删（即时那一半）；
//   · 被杀：下一个进程第一次分配时回收，或杀它的 runner 等整棵树没了再回收。
// 下面的用例全部在隔离的临时根里跑（子进程的 TMPDIR 指到 base），不碰系统临时目录里别人的东西。

const here = path.dirname(fileURLToPath(import.meta.url))
const helperUrl = pathToFileURL(path.join(here, '_test-temp.mjs')).href

/**
 * 起一个独立进程跑 ESM 脚本；它的 TMPDIR / TEMP / TMP 指到 base，所以它第一次分配扫的是 base。
 * 用例失败也不留活进程（挂住的子进程会让整个 node --test 一直不退出）：收尾时还活着就整组杀掉。
 */
function startProbe(t, source, { base, env = {}, ownGroup = false } = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, TMPDIR: base, TEMP: base, TMP: base, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
    ...(ownGroup ? processTreeSpawnOptions() : {}),
  })
  let stdout = ''
  const waiters = []
  const settle = () => {
    for (const waiter of [...waiters]) {
      const match = waiter.pattern.exec(stdout)
      if (!match) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(match)
    }
  }
  child.stdout.on('data', (chunk) => { stdout += chunk; settle() })
  const closed = new Promise((resolve) => child.once('close', (code, signal) => {
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`probe exited (${code ?? signal}) before printing ${waiter.pattern}: ${stdout}`))
    resolve({ code, signal, stdout })
  }))
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { if (ownGroup) killProcessTree(child, 'SIGKILL'); else process.kill(child.pid, 'SIGKILL') } catch { /* 已经没了 */ }
    }
    await closed
  })
  const printed = (pattern) => new Promise((resolve, reject) => { waiters.push({ pattern, resolve, reject }); settle() })
  return { child, closed, printed }
}

const allocateScript = ({ hang = false } = {}) => [
  `import { makeTempDir } from ${JSON.stringify(helperUrl)}`,
  "const dir = makeTempDir('nomi-probe-')",
  "process.stdout.write('DIR=' + dir + '\\n')",
  ...(hang ? ['setInterval(() => {}, 1000)'] : []),
].join('\n')

/** 一个肯定已经死了的进程号：起一个空进程，等它被收尸。 */
async function exitedPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise((resolve) => child.once('close', resolve))
  return child.pid
}

const mkdirWith = (dir, files = { 'inner/file.txt': 'x' }) => {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}
const trySymlink = (target, link) => { try { fs.symlinkSync(target, link, 'dir'); return true } catch { return false } }
const entryExists = (entry) => fs.lstatSync(entry, { throwIfNoEntry: false }) !== undefined

test('目录名带创建它的进程号：nomi-<前缀>-p<进程号>-<6 位随机>（同步、异步；前缀没带横线、没带 nomi-、是空串都一样）', async () => {
  const roots = [
    makeTempDir('nomi-owner-sync-'),
    await makeTempDirAsync('nomi-owner-async-'),
    makeTempDir('nomi-owner-nodash'),
    makeTempDir('walk-settings-'),
    makeTempDir(''),
  ]
  try {
    const expected = ['nomi-owner-sync-', 'nomi-owner-async-', 'nomi-owner-nodash-', 'nomi-walk-settings-', 'nomi-']
    roots.forEach((root, index) => {
      assert.match(path.basename(root), new RegExp(`^${expected[index]}p${process.pid}-[A-Za-z0-9]{6}$`), root)
    })
  } finally {
    for (const root of roots) cleanupTestTemp(root)
  }
})

test('第一次分配时回收同一临时根下「创建者已死」的同形目录；创建者活着的、进程号为 1 的、别的形状的、老格式的、文件、符号链接一律不动', async (t) => {
  const base = makeTempDir('nomi-reclaim-base-')
  t.after(() => cleanupTestTemp(base))
  const deadPid = await exitedPid()
  const outside = mkdirWith(path.join(base, 'outside'), { 'sentinel.txt': 'must survive' })

  const dead = mkdirWith(path.join(base, `nomi-dead-p${deadPid}-AaAaAa`))
  const innerLinked = trySymlink(outside, path.join(dead, 'inner-link'))
  const kept = [mkdirWith(path.join(base, `nomi-live-p${process.pid}-BbBbBb`))]
  // 进程号为 1：普通用户发信号会 EPERM（有这个进程、只是没权限）→ 当活；Windows 没有这个进程号，跳过
  if (process.platform !== 'win32') kept.push(mkdirWith(path.join(base, 'nomi-init-p1-CcCcCc')))
  // 形状不对的一律不认：随机段长短不对、没有进程号的老格式、进程号前不是横线
  kept.push(
    mkdirWith(path.join(base, `nomi-dead-p${deadPid}-short`)),
    mkdirWith(path.join(base, `nomi-dead-p${deadPid}-toolong1`)),
    mkdirWith(path.join(base, 'nomi-legacy-AbCdEf')),
    mkdirWith(path.join(base, `nomi-deadp${deadPid}-GgGgGg`)),
  )
  // 别的程序的目录：形状碰巧一样（创建者进程号已死），但名字不以 nomi- 开头——不是本仓库发放的，不碰
  kept.push(
    mkdirWith(path.join(base, `foreign-tool-p${deadPid}-KkKkKk`)),
    mkdirWith(path.join(base, `p${deadPid}-LlLlLl`)),
  )
  // 不是目录的不碰：普通文件
  const file = path.join(base, `nomi-file-p${deadPid}-DdDdDd`)
  fs.writeFileSync(file, 'not a directory')
  kept.push(file)
  // 顶层符号链接（指向外面）不碰：lstat 看到的是链接，不是目录
  const link = path.join(base, `nomi-link-p${deadPid}-EeEeEe`)
  if (trySymlink(outside, link)) kept.push(link)

  const outcome = await startProbe(t, allocateScript(), { base }).closed
  assert.equal(outcome.code, 0, outcome.stdout)

  assert.equal(entryExists(dead), false, '创建者已死的同形目录应被回收')
  for (const keep of kept) assert.equal(entryExists(keep), true, `不该被回收：${path.basename(keep)}`)
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'must survive', '回收不跟进符号链接：外面的内容必须还在')
  assert.equal(innerLinked || process.platform === 'win32', true, '这台机器上能建符号链接，才算验到了「目录里的链接不被跟进」')
})

test('只在这个进程第一次用某个临时根时扫一遍：之后再分配不再扫（热循环里不反复 readdir）', async (t) => {
  const base = makeTempDir('nomi-reclaim-once-')
  t.after(() => cleanupTestTemp(base))
  const deadPid = await exitedPid()
  const early = mkdirWith(path.join(base, `nomi-early-p${deadPid}-EeEeEe`))
  const late = path.join(base, `nomi-late-p${deadPid}-FfFfFf`)
  const source = [
    `import { makeTempDir } from ${JSON.stringify(helperUrl)}`,
    "import fs from 'node:fs'",
    `const early = ${JSON.stringify(early)}`,
    `const late = ${JSON.stringify(late)}`,
    "makeTempDir('nomi-first-')",
    "process.stdout.write('EARLY=' + fs.existsSync(early) + '\\n')",
    'fs.mkdirSync(late)',
    "makeTempDir('nomi-second-')",
    "process.stdout.write('LATE=' + fs.existsSync(late) + '\\n')",
  ].join('\n')
  const outcome = await startProbe(t, source, { base }).closed
  assert.equal(outcome.code, 0, outcome.stdout)
  assert.match(outcome.stdout, /EARLY=false/, '第一次分配应当扫（对照：没扫就看不出「只扫一次」）')
  assert.match(outcome.stdout, /LATE=true/, '第二次分配又扫了一遍')
})

test('别的用户的目录不收：uid 对不上就不动，哪怕创建者已经死了（对照：uid 对得上就收）', { skip: typeof process.getuid !== 'function' }, async (t) => {
  const base = makeTempDir('nomi-reclaim-uid-')
  t.after(() => cleanupTestTemp(base))
  const deadPid = await exitedPid()
  const foreign = mkdirWith(path.join(base, `nomi-foreign-p${deadPid}-HhHhHh`))
  const asOtherUser = [
    'const realUid = process.getuid()',
    'process.getuid = () => realUid + 1',
    `import { makeTempDir } from ${JSON.stringify(helperUrl)}`,
    "makeTempDir('nomi-probe-')",
  ].join('\n')
  const first = await startProbe(t, asOtherUser, { base }).closed
  assert.equal(first.code, 0, first.stdout)
  assert.equal(entryExists(foreign), true, '属主不是当前用户的目录不能动')

  const second = await startProbe(t, allocateScript(), { base }).closed
  assert.equal(second.code, 0, second.stdout)
  assert.equal(entryExists(foreign), false, '对照：本人的、创建者已死的同形目录是会被收的——上面没动是 uid 校验的功劳')
})

test('真杀：进程被 SIGKILL 后目录还在（退出钩子没机会跑，这就是症状）；不经 runner，下一个任意进程第一次分配就把它收掉', async (t) => {
  const base = makeTempDir('nomi-reclaim-kill-')
  t.after(() => cleanupTestTemp(base))
  const victim = startProbe(t, allocateScript({ hang: true }), { base })
  const [, dir] = await victim.printed(/DIR=(.+)\n/)
  process.kill(victim.child.pid, 'SIGKILL')
  await victim.closed
  assert.equal(entryExists(dir), true, 'SIGKILL 下 process.once("exit") 不会跑，目录必然还在')
  assert.ok(path.basename(dir).includes(`-p${victim.child.pid}-`), `目录名要带被杀进程的进程号 ${victim.child.pid}：${path.basename(dir)}`)

  const outcome = await startProbe(t, allocateScript(), { base }).closed
  assert.equal(outcome.code, 0, outcome.stdout)
  assert.equal(entryExists(dir), false, '下一个进程第一次分配时，创建者已死的目录应被收掉')
})

test('经 runner 杀进程树：孙进程建的目录被收走，创建者还活着的目录不动', async (t) => {
  const { terminateAndReclaim } = await import('./pre-push-contracts.mjs')
  const base = makeTempDir('nomi-reclaim-runner-')
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    cleanupTestTemp(base)
  })
  // runner 回收的是它自己进程里的 os.tmpdir()：把本进程的临时根也指到 base，和门岗里「runner 与被杀的子进程同一个临时根」一致
  process.env.TMPDIR = base
  process.env.TEMP = base
  process.env.TMP = base
  const alive = makeTempDir('nomi-runner-alive-')

  // 和 node --test 同形：组长进程再起一个文件子进程，建目录的是孙进程
  const tree = [
    "import { spawn } from 'node:child_process'",
    `spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(allocateScript({ hang: true }))}], { stdio: ['ignore', 'inherit', 'inherit'] })`,
    'setInterval(() => {}, 1000)',
  ].join('\n')
  const victim = startProbe(t, tree, { base, ownGroup: true })
  const [, dir] = await victim.printed(/DIR=(.+)\n/)
  assert.equal(entryExists(dir), true)

  const outcome = await terminateAndReclaim([victim.child])
  await victim.closed
  assert.equal(entryExists(dir), false, 'runner 杀完整棵树、等它们真的没了，应当回收被杀进程留下的目录')
  assert.equal(entryExists(alive), true, '创建者（本进程）还活着的目录不能动')
  assert.ok(outcome.reclaimed.includes(path.basename(dir)), JSON.stringify(outcome))
  assert.equal(outcome.gone, true)
})

test('reclaimAbandonedTestTemp 返回它删掉的目录名；临时根读不了就返回空，不抛', async (t) => {
  const base = makeTempDir('nomi-reclaim-return-')
  t.after(() => cleanupTestTemp(base))
  const deadPid = await exitedPid()
  mkdirWith(path.join(base, `nomi-gone-p${deadPid}-IiIiIi`))
  mkdirWith(path.join(base, `nomi-mine-p${process.pid}-JjJjJj`))
  assert.deepEqual(temp.reclaimAbandonedTestTemp(base), [`nomi-gone-p${deadPid}-IiIiIi`])
  assert.deepEqual(temp.reclaimAbandonedTestTemp(path.join(base, 'does-not-exist')), [])
})
