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

test('installs an idempotent repository-relative Stop hook', () => {
  const command = buildStopHookCommand()
  const installed = mergeStopHook({})
  const installedAgain = mergeStopHook(installed)
  assert.match(command, /\$CLAUDE_PROJECT_DIR\/scripts\/agent-worktree-janitor\.mjs/)
  assert.match(command, /if \[ -f "\$CLAUDE_PROJECT_DIR\/scripts\/agent-worktree-janitor\.mjs" \]; then/)
  assert.equal(installed.hooks.Stop[0].hooks[0].command, command)
  assert.deepEqual(installedAgain, installed)
})
