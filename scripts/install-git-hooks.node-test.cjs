const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { HOOKS, installHooks, renderHook } = require('./install-git-hooks.cjs')

test('installer keeps existing checks and adds Ponytail review to commit and push hooks', () => {
  const preCommit = renderHook(HOOKS.find(({ name }) => name === 'pre-commit'))
  assert.match(preCommit, /check-no-secrets\.mjs/)
  assert.match(preCommit, /scripts\/ponytail-review-hook\.mjs" --scope staged/)
  assert.match(preCommit, /set -euo pipefail/)
  assert.ok(preCommit.indexOf('ponytail-review-hook.mjs') < preCommit.indexOf('check-no-secrets.mjs'), 'Ponytail runs even when a later security gate rejects the commit')

  const prePush = renderHook(HOOKS.find(({ name }) => name === 'pre-push'))
  assert.match(prePush, /scripts\/ponytail-review-hook\.mjs" --scope push/)
  assert.doesNotMatch(prePush, /check-no-secrets\.mjs/)
})

test('commit message hook remains the existing progress gate', () => {
  const commitMsg = renderHook(HOOKS.find(({ name }) => name === 'commit-msg'))
  assert.match(commitMsg, /check-progress-update\.cjs/)
  assert.doesNotMatch(commitMsg, /ponytail-review-hook/)
})

test('installer writes the generated chain to the requested git common dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-hook-install-'))
  fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true })
  try {
    installHooks({ root, commonDir: '.git' })
    const preCommitPath = path.join(root, '.git', 'hooks', 'pre-commit')
    const prePushPath = path.join(root, '.git', 'hooks', 'pre-push')
    assert.match(fs.readFileSync(preCommitPath, 'utf8'), /ponytail-review-hook\.mjs/)
    assert.match(fs.readFileSync(prePushPath, 'utf8'), /--scope push/)
    assert.equal(fs.statSync(prePushPath).mode & 0o111, 0o111)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
