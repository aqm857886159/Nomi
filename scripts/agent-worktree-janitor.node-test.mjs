import test from 'node:test'
import assert from 'node:assert/strict'

import { decideAction } from './agent-worktree-janitor.mjs'
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
      dependencyDirs: ['node_modules'],
    }),
    { kind: 'prune-dependencies', reason: 'stopped-dirty-inactive' },
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
      dependencyDirs: ['node_modules'],
    }),
    { kind: 'prune-dependencies', reason: 'detached-deps-only' },
  )

  assert.deepEqual(
    decideAction({
      kind: 'full-clone',
      clean: true,
      active: false,
      marker: oldMarker,
      markerAgeMs: 60 * 60 * 1000,
      graceMs: 15 * 60 * 1000,
      dependencyDirs: ['node_modules'],
    }),
    { kind: 'prune-dependencies', reason: 'full-clone-deps-only' },
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
      dependencyDirs: ['node_modules'],
    }),
    { kind: 'prune-dependencies', reason: 'unmanaged-idle-deps-only' },
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
      dependencyDirs: ['node_modules'],
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
      dependencyDirs: ['node_modules'],
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
      dependencyDirs: ['node_modules'],
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
