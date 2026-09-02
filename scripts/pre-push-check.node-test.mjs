#!/usr/bin/env node
// push 闸（scripts/claude-hooks/pre-push-check.sh）的行为测试。
//
// 为什么值得为一个 hook 写测试：它是 R11 的执行体，而它的失效是**静默**的——
// 闸门放行了不该放行的 push，输出和正常放行一模一样，只有事后在远端才看得见。
// 2026-09-02 就这么栽了一次：戳只认「固定路径 + mtime 新鲜」两维，主仓里一枚别处盖的旧戳
// 把 sibling worktree 里 gates 实际 exit=1 的分支放上了远端。check:claude-hooks 只拦
// 「装的和仓里的不一致」，拦不住「仓里那份逻辑本身错了」——所以要有这一层。
//
// 测的是**闸门语义**，不是实现细节：戳必须同时认树、认 HEAD、认新鲜度，三项缺一都要能拦住。
// 每条用例都在临时 git 仓的真实 worktree 上跑真实 hook（喂真实的 PreToolUse JSON），
// 不 mock git——这个 bug 的栖息地正是「git worktree 的路径/gitdir 语义」，mock 掉就测不到了。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(repoRoot, 'scripts', 'claude-hooks', 'pre-push-check.sh')
const STAMP = path.join(repoRoot, 'scripts', 'stamp-gates-ok.mjs')

let sandbox
/** @type {{root: string, gitDir: string, marker: string}} */
let treeA
/** @type {{root: string, gitDir: string, marker: string}} */
let treeB

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** 起一棵带 origin/main 的 worktree（不需要真远端：直接写 refs/remotes/origin/main）。 */
function makeWorktree(base, name) {
  const root = path.join(sandbox, name)
  git(base, 'worktree', 'add', '-q', '-b', `probe/${name}`, root, 'origin/main')
  // 一次代码改动 —— 闸门只对沾代码的 outgoing 生效（doc-only 本就豁免）。
  fs.writeFileSync(path.join(root, 'probe.ts'), 'export const probe = 1\n')
  git(root, 'add', 'probe.ts')
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'probe: code change')
  const gitDir = git(root, 'rev-parse', '--absolute-git-dir')
  return { root: git(root, 'rev-parse', '--show-toplevel'), gitDir, marker: path.join(gitDir, 'nomi-gates-ok') }
}

/** 跑一次真实 hook，返回 {status, stderr}。cwd 模拟 harness 报的会话目录。 */
function runHook(command, cwd = sandbox) {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd, tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    // 关键：清掉真实会话的 CLAUDE_PROJECT_DIR，否则测试会被跑测试的那棵树污染。
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  })
  return { status: result.status, stderr: result.stderr || '' }
}

const stamp = (cwd) => execFileSync('node', [STAMP], { cwd, encoding: 'utf8' })

before(() => {
  sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nomi-push-gate-'))
  const origin = path.join(sandbox, 'origin')
  fs.mkdirSync(origin)
  git(origin, 'init', '-q', '-b', 'main')
  git(origin, 'config', 'user.email', 'probe@example.com')
  git(origin, 'config', 'user.name', 'probe')
  fs.writeFileSync(path.join(origin, 'seed.ts'), 'export const seed = 0\n')
  git(origin, 'add', '-A')
  git(origin, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'seed')
  // 假装有远端：闸门只读 origin/main 这个 ref，不需要真的能连上。
  git(origin, 'update-ref', 'refs/remotes/origin/main', git(origin, 'rev-parse', 'HEAD'))
  treeA = makeWorktree(origin, 'tree-a')
  treeB = makeWorktree(origin, 'tree-b')
})

after(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
})

describe('push 闸：五门戳必须认树、认 HEAD、认新鲜度', () => {
  test('没盖戳 → 拦', () => {
    fs.rmSync(treeA.marker, { force: true })
    assert.equal(runHook(`cd ${treeA.root} && git push`).status, 2)
  })

  test('本树盖戳 → 放行', () => {
    stamp(treeA.root)
    assert.equal(runHook(`cd ${treeA.root} && git push`).status, 0)
  })

  test('命令里没写 cd 时，按 harness 报的 cwd 认树 → 放行', () => {
    assert.equal(runHook('git push', treeA.root).status, 0)
  })

  test('A 树有新鲜戳，B 树没有 → B 仍被拦（戳不跨树背书）', () => {
    fs.rmSync(treeB.marker, { force: true })
    assert.equal(runHook(`cd ${treeB.root} && git push`).status, 2)
  })

  test('把 A 的戳整份拷进 B 自己的 gitdir → 仍被拦（认娘家，不只认路径）', () => {
    fs.copyFileSync(treeA.marker, treeB.marker)
    const { status, stderr } = runHook(`cd ${treeB.root} && git push`)
    assert.equal(status, 2)
    assert.match(stderr, /另一棵 worktree/)
    fs.rmSync(treeB.marker, { force: true })
  })

  test('盖戳后又提交代码（HEAD 变）→ 重新要求过门', () => {
    stamp(treeA.root)
    fs.writeFileSync(path.join(treeA.root, 'probe2.ts'), 'export const probe2 = 2\n')
    git(treeA.root, 'add', 'probe2.ts')
    git(treeA.root, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'probe: more code')
    const { status, stderr } = runHook(`cd ${treeA.root} && git push`)
    assert.equal(status, 2)
    assert.match(stderr, /盖戳之后又动了代码/)
  })

  test('盖戳后只补 doc/hook → 沿用 doc 豁免那把尺，放行', () => {
    stamp(treeA.root)
    fs.mkdirSync(path.join(treeA.root, 'docs'), { recursive: true })  // git 不跟踪空目录，种子仓里的 docs/ 到不了 worktree
    fs.writeFileSync(path.join(treeA.root, 'docs', 'note.md'), 'note\n')
    git(treeA.root, 'add', 'docs/note.md')
    git(treeA.root, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'probe: docs only')
    assert.equal(runHook(`cd ${treeA.root} && git push`).status, 0)
  })

  test('戳超过 30 分钟 → 拦（只动新鲜度这一个变量）', () => {
    stamp(treeA.root)
    const stale = Date.now() / 1000 - 31 * 60
    fs.utimesSync(treeA.marker, stale, stale)
    const { status, stderr } = runHook(`cd ${treeA.root} && git push`)
    assert.equal(status, 2)
    assert.match(stderr, /已过期/)
  })

  test('旧版「只有时间戳」的空戳不认（不能靠 touch 蒙混）', () => {
    fs.writeFileSync(treeA.marker, new Date().toISOString())
    const { status, stderr } = runHook(`cd ${treeA.root} && git push`)
    assert.equal(status, 2)
    assert.match(stderr, /格式不认识/)
  })

  test('不是 git push 的命令 → 放行', () => {
    fs.rmSync(treeA.marker, { force: true })
    assert.equal(runHook(`cd ${treeA.root} && git status`).status, 0)
  })
})
