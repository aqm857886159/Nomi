import test from 'node:test'
import assert from 'node:assert/strict'

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_GRACE_MS,
  DEFAULT_UNMANAGED_IDLE_MS,
  RECLAIMABLE_DIR_NAMES,
  decideAction,
  findReclaimableDirs,
} from './agent-worktree-janitor.mjs'
import { buildStopHookCommand, mergeStopHook } from './install-agent-worktree-janitor.mjs'

const oldMarker = {
  kind: 'agent-worktree-lease',
  status: 'stopped',
  stoppedAt: '2026-09-01T00:00:00.000Z',
}

test('removes only an inactive clean linked worktree after the grace period', () => {
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: true,
      active: false,
      marker: oldMarker,
      markerAgeMs: 60 * 60 * 1000,
      graceMs: 15 * 60 * 1000,
    }),
    { kind: 'remove-worktree', reason: 'stopped-clean-inactive' },
  )
})

test('prunes dependencies but preserves dirty linked-worktree code', () => {
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: false,
      active: false,
      marker: oldMarker,
      markerAgeMs: 60 * 60 * 1000,
      graceMs: 15 * 60 * 1000,
      reclaimableDirs: ['node_modules'],
    }),
    { kind: 'prune-reclaimable', reason: 'stopped-dirty-inactive' },
  )
})

test('protects detached code and full-clone code while allowing dependency pruning', () => {
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      detached: true,
      clean: true,
      active: false,
      marker: oldMarker,
      markerAgeMs: 60 * 60 * 1000,
      graceMs: 15 * 60 * 1000,
      reclaimableDirs: ['node_modules'],
    }),
    { kind: 'prune-reclaimable', reason: 'detached-reclaimable-only' },
  )

  assert.deepEqual(
    decideAction({
      kind: 'full-clone',
      clean: true,
      active: false,
      marker: oldMarker,
      markerAgeMs: 60 * 60 * 1000,
      graceMs: 15 * 60 * 1000,
      reclaimableDirs: ['node_modules'],
    }),
    { kind: 'prune-reclaimable', reason: 'full-clone-reclaimable-only' },
  )
})

test('fails closed for active, unmanaged, and fresh worktrees', () => {
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: true,
      active: true,
      marker: oldMarker,
      markerAgeMs: 60 * 60 * 1000,
    }),
    { kind: 'skip', reason: 'active' },
  )
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: true,
      active: false,
      marker: null,
      markerAgeMs: 60 * 60 * 1000,
    }),
    { kind: 'skip', reason: 'unmanaged' },
  )
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: true,
      active: false,
      marker: oldMarker,
      markerAgeMs: 5 * 60 * 1000,
    }),
    { kind: 'skip', reason: 'grace-period' },
  )
})

// 未登记的 worktree 曾经整个被跳过，于是 janitor 只覆盖它自己标记过的那一小撮：
// 2026-09-03 实测 82 个 worktree 里只有 8 个带 marker，其余 74 个（Codex 建的、手工
// git worktree add 的、以及早于 janitor 上线的）永远不清。目录本身仍然不许删——里面
// 可能有别人的未提交改动——但 node_modules 是可再生物，删了只是下次重装，够久没动就该回收。
test('reclaims dependencies from an idle unmanaged worktree without touching its code', () => {
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: false,
      active: false,
      marker: null,
      idleAgeMs: 7 * 24 * 60 * 60 * 1000,
      unmanagedIdleMs: 3 * 24 * 60 * 60 * 1000,
      reclaimableDirs: ['node_modules'],
    }),
    { kind: 'prune-reclaimable', reason: 'unmanaged-idle-reclaimable-only' },
  )
})

test('never removes an unmanaged worktree, however clean or idle it looks', () => {
  for (const extra of [{ clean: true }, { clean: true, detached: true }, { kind: 'full-clone', clean: true }]) {
    const action = decideAction({
      kind: 'linked-worktree',
      active: false,
      marker: null,
      idleAgeMs: 365 * 24 * 60 * 60 * 1000,
      unmanagedIdleMs: 3 * 24 * 60 * 60 * 1000,
      reclaimableDirs: ['node_modules'],
      ...extra,
    })
    assert.notEqual(action.kind, 'remove-worktree', JSON.stringify(extra))
  }
})

test('leaves a recently touched unmanaged worktree alone', () => {
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: false,
      active: false,
      marker: null,
      idleAgeMs: 60 * 60 * 1000,
      unmanagedIdleMs: 3 * 24 * 60 * 60 * 1000,
      reclaimableDirs: ['node_modules'],
    }),
    { kind: 'skip', reason: 'unmanaged-recent' },
  )
})

test('fails closed when an unmanaged worktree has no readable idle signal', () => {
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: false,
      active: false,
      marker: null,
      idleAgeMs: Number.NaN,
      unmanagedIdleMs: 3 * 24 * 60 * 60 * 1000,
      reclaimableDirs: ['node_modules'],
    }),
    { kind: 'skip', reason: 'unmanaged-recent' },
  )
})

test('installs an idempotent repository-relative Stop hook', () => {
  const command = buildStopHookCommand()
  const installed = mergeStopHook({})
  const installedAgain = mergeStopHook(installed)
  assert.match(command, /\$CLAUDE_PROJECT_DIR\/scripts\/agent-worktree-janitor\.mjs/)
  assert.match(command, /if \[ -f "\$CLAUDE_PROJECT_DIR\/scripts\/agent-worktree-janitor\.mjs" \]; then/)
  assert.equal(installed.hooks.Stop[0].hooks[0].command, command)
  assert.deepEqual(installedAgain, installed)
})

test('finds build output as reclaimable, not just installed dependencies', () => {
  // 这条测的是「找得到哪些目录」，而不是 decideAction 拿到清单后怎么判——后者收的是参数，
  // 无论清单怎么退化都会绿。今天真实烧掉磁盘的形态正是这种树：依赖早清过，
  // 但 6 轮 gates 把 dist/release 堆到了几百 MB，旧实现会判它「没有可回收物」整棵跳过。
  const root = mkdtempSync(join(tmpdir(), 'janitor-reclaim-'))
  try {
    for (const dir of ['node_modules', 'dist', 'release', 'src']) {
      mkdirSync(join(root, dir), { recursive: true })
    }
    // 嵌套在依赖里的构建产物不应被重复列出（-prune 命中后不再下潜）。
    mkdirSync(join(root, 'node_modules', 'some-pkg', 'dist'), { recursive: true })

    const found = findReclaimableDirs(root).sort()
    assert.deepEqual(found, ['dist', 'node_modules', 'release'])
    assert.ok(!found.includes('src'), '源码目录绝不能被当成可回收物')
    assert.ok(
      !found.some((p) => p.includes('node_modules/')),
      '依赖内部的嵌套产物不该被单独列出',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('still refuses to touch an active worktree however much build output it holds', () => {
  // 回归护栏：这次放宽的是「回收什么」，绝不是「可以动谁」。
  assert.deepEqual(
    decideAction({
      kind: 'linked-worktree',
      clean: true,
      active: true,
      marker: oldMarker,
      markerAgeMs: DEFAULT_GRACE_MS + 1,
      reclaimableDirs: ['node_modules', 'dist', 'release'],
    }),
    { kind: 'skip', reason: 'active' },
  )
})

test('still never removes an unmanaged worktree, whatever it now counts as reclaimable', () => {
  // 回归护栏：未登记的树可以被回收可再生目录，但目录本身永远不删。
  const decision = decideAction({
    kind: 'linked-worktree',
    clean: true,
    active: false,
    markerAgeMs: Number.NaN,
    idleAgeMs: DEFAULT_UNMANAGED_IDLE_MS + 1,
    reclaimableDirs: ['dist', 'release'],
  })
  assert.equal(decision.kind, 'prune-reclaimable')
  assert.notEqual(decision.kind, 'remove-worktree')
})

test('every reclaimable directory name is actually gitignored', () => {
  // 防漂移闸：清单是人手维护的，这条断言保证它只会长出「本来就不入库」的名字。
  // 若有人往里加了一个源码目录，git clean -fdx 会真的删掉用户的代码——这里必须先红。
  // 注意必须带结尾斜杠：check-ignore 对不存在的裸名会报「未忽略」，
  // 这个假阴性在本次开发中真的误导过一次判断。
  for (const name of RECLAIMABLE_DIR_NAMES) {
    const ignored = (() => {
      try {
        execFileSync('git', ['check-ignore', '-q', `${name}/`], { stdio: 'ignore' })
        return true
      } catch {
        return false
      }
    })()
    assert.equal(ignored, true, `${name} 不在 .gitignore 里，不能当作可回收目录`)
  }
})
