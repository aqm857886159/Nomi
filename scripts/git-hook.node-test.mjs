// 钩子分发入口（scripts/git-hook.mjs）+ 安装器生成的钩子文件的行为测试。真 git 仓库、真 bash、真 node，不 mock。
// 背景（2026-10-09）：钩子文件里写死脚本名，脚本改名 / 删除后旧钩子的 `[ -f ... ] || exit 0` 静默放行，一次推送一道门岗都没跑。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const installer = (await import('./install-git-hooks.cjs')).default
const tableOnDisk = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/git-hooks.json'), 'utf8'))

/** 临时 git 仓：有 / 没有分发入口，分发表由测试自己写。 */
function makeRepo({ withDispatcher = true, table = tableOnDisk } = {}) {
  const root = makeTempDir('nomi-git-hook-')
  execFileSync('git', ['init', '-q'], { cwd: root })
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  if (withDispatcher) {
    fs.copyFileSync(path.join(repoRoot, 'scripts/git-hook.mjs'), path.join(root, 'scripts/git-hook.mjs'))
    fs.writeFileSync(path.join(root, 'scripts/git-hooks.json'), JSON.stringify(table))
  }
  return root
}
const put = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
function runHook(root, name, args = []) {
  const file = path.join(root, `${name}.sh`)
  fs.writeFileSync(file, installer.renderHookContent({ name }))
  return spawnSync('bash', [file, ...args], { cwd: root, encoding: 'utf8', input: '' })
}

test('结构：钩子文件里没有任何脚本名，只分发到 scripts/git-hook.mjs 并透传参数', () => {
  for (const { name } of installer.HOOKS) {
    const content = installer.renderHookContent({ name })
    assert.ok(content.includes(`exec node "$ROOT/scripts/git-hook.mjs" ${name} "$@"`), content)
    assert.doesNotMatch(content, /check-|pre-push-contracts/, '钩子里不许写死脚本名')
  }
  assert.deepEqual(installer.HOOKS.map((h) => h.name).sort(), Object.keys(tableOnDisk).sort(), '装的钩子 = 分发表里的钩子')
})

test('必红：旧入口不存在、新入口存在 → 钩子跑新入口（脚本改名不用重装钩子）', () => {
  const root = makeRepo({ table: { 'pre-push': [['scripts/new-entry.mjs', 'scripts/old-entry.mjs']] } })
  put(root, 'scripts/new-entry.mjs', "console.error('NEW-ENTRY ' + process.argv.slice(2).join(',')); process.exit(0)")
  const result = runHook(root, 'pre-push', ['origin', 'url'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /NEW-ENTRY origin,url/, '参数要透传给脚本')
})

test('只有旧入口（新入口还没合进来）→ 退回旧入口；旧入口红就拦', () => {
  const root = makeRepo({ table: { 'pre-push': [['scripts/new-entry.mjs', 'scripts/old-entry.mjs']] } })
  put(root, 'scripts/old-entry.mjs', "console.error('OLD-ENTRY'); process.exit(7)")
  const result = runHook(root, 'pre-push')
  assert.equal(result.status, 7)
  assert.match(result.stderr, /OLD-ENTRY/)
})

test('必红：分发入口不存在（很老的分支）→ 退出 0，但 stderr 必须说明跳过的原因', () => {
  const root = makeRepo({ withDispatcher: false })
  for (const name of ['pre-push', 'pre-commit', 'commit-msg']) {
    const result = runHook(root, name)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stderr.includes(`[${name}]`) && result.stderr.includes('scripts/git-hook.mjs') && result.stderr.includes('跳过'), `${name} 不许静默跳过：${result.stderr}`)
  }
})

test('必红：分发表里的脚本全都不在 → 退出 0，但点名说「没有可跑的入口」，不静默', () => {
  const root = makeRepo({ table: { 'pre-push': [['scripts/gone-a.mjs', 'scripts/gone-b.mjs']] } })
  const result = runHook(root, 'pre-push')
  assert.equal(result.status, 0)
  assert.match(result.stderr, /\[pre-push\].*scripts\/gone-a\.mjs.*跳过/)
})

test('分发表里没有的钩子名 → 退出 0 且打印原因；多步钩子按顺序跑，前一步红就停', () => {
  const root = makeRepo({ table: { 'commit-msg': [['scripts/step-a.mjs'], ['scripts/step-b.mjs']] } })
  put(root, 'scripts/step-a.mjs', "console.error('STEP-A'); process.exit(3)")
  put(root, 'scripts/step-b.mjs', "console.error('STEP-B')")
  const stopped = runHook(root, 'commit-msg')
  assert.equal(stopped.status, 3)
  assert.doesNotMatch(stopped.stderr, /STEP-B/)
  const unknown = runHook(root, 'pre-commit')
  assert.equal(unknown.status, 0)
  assert.match(unknown.stderr, /\[pre-commit\].*分发表.*跳过/)
})

test('一键换钩子：--all-worktrees 把主仓和每个 linked worktree 的钩子都写成新版（只动 .git 下的钩子目录）', () => {
  const main = makeRepo()
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  git(main, 'config', 'user.name', 't'); git(main, 'config', 'user.email', 't@example.com')
  git(main, 'config', 'extensions.worktreeConfig', 'true')
  put(main, 'a.txt', 'a')
  git(main, 'add', '-A'); git(main, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
  const wt = path.join(makeTempDir('nomi-git-hook-wt-'), 'wt')
  git(main, 'worktree', 'add', '-q', '-b', 'topic', wt)
  const stale = '#!/usr/bin/env bash\n[ -f "$ROOT/scripts/gone.mjs" ] || exit 0\n'
  const wtHooks = path.join(git(wt, 'rev-parse', '--absolute-git-dir').trim(), 'hooks')
  fs.mkdirSync(wtHooks, { recursive: true })
  fs.writeFileSync(path.join(wtHooks, 'pre-push'), stale)
  const result = installer.installAllWorktrees({ repoRoot: main, logger: { log() {}, warn() {} } })
  assert.ok(result.updated.length >= 1, JSON.stringify(result))
  assert.match(fs.readFileSync(path.join(wtHooks, 'pre-push'), 'utf8'), /scripts\/git-hook\.mjs/)
  assert.doesNotMatch(fs.readFileSync(path.join(wtHooks, 'pre-push'), 'utf8'), /gone\.mjs/)
})

test('一键换钩子：分支里还没有分发入口的 worktree 跳过并打印路径，旧钩子原样保留', () => {
  const main = makeRepo()
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  git(main, 'config', 'user.name', 't'); git(main, 'config', 'user.email', 't@example.com')
  git(main, 'config', 'extensions.worktreeConfig', 'true')
  put(main, 'a.txt', 'a')
  git(main, 'add', '-A'); git(main, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
  const old = path.join(makeTempDir('nomi-git-hook-old-'), 'old')
  git(main, 'worktree', 'add', '-q', '-b', 'old-branch', old)
  fs.rmSync(path.join(old, 'scripts/git-hook.mjs'))
  const oldHooks = path.join(git(old, 'rev-parse', '--absolute-git-dir').trim(), 'hooks')
  fs.mkdirSync(oldHooks, { recursive: true })
  const legacy = '#!/usr/bin/env bash\n# LEGACY-HOOK\nexit 0\n'
  fs.writeFileSync(path.join(oldHooks, 'pre-commit'), legacy)
  const lines = []
  const result = installer.installAllWorktrees({ repoRoot: main, logger: { log: (line) => lines.push(line), warn() {} } })
  assert.equal(fs.readFileSync(path.join(oldHooks, 'pre-commit'), 'utf8'), legacy, '旧钩子不许被换掉')
  assert.ok(result.skipped.some((item) => item.reason === 'no_dispatcher' && item.root.endsWith('old')), JSON.stringify(result))
  assert.ok(lines.some((line) => line.includes('跳过') && line.includes('分支还没有分发入口') && line.includes('old')), lines.join('\n'))
})
