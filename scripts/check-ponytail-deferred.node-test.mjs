// 延后账本门岗的行为测试（2026-09-11）。
// 门岗自己的测试必须能喂假账本，否则它只测得到「今天这台机器的存量」，
// 测不到「明天新增一条 reviewed=no 会不会红」（R17）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-ponytail-deferred.mjs')
const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function ledger(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-ledger-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'ponytail-deferred.log')
  if (rows !== null) fs.writeFileSync(file, rows.length ? rows.join('\n') + '\n' : '')
  return file
}

function row(sha, reviewed, reason = 'codex runner unavailable') {
  return `2026-09-11T03:40:00Z|deferred|branch=task|sha=${sha}|worktree=/tmp/wt|reason=${reason}|reviewed=${reviewed}`
}

function runGate(file, args = []) {
  const result = spawnSync(process.execPath, [GATE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NOMI_PONYTAIL_DEFERRED_LOG_OVERRIDE: file },
  })
  return { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` }
}

test('no ledger means nothing was deferred', (t) => {
  const file = ledger(t, null)
  assert.equal(runGate(file).status, 0)
})

test('an unreviewed deferral is red and names the sha to accept', (t) => {
  const file = ledger(t, [row(SHA_A, 'no')])
  const { status, out } = runGate(file)
  assert.equal(status, 1, '有 reviewed=no 的行必须红')
  assert.ok(out.includes(SHA_A.slice(0, 12)), '报红必须给出可复制的 sha')
  assert.match(out, /--accept/, '报红必须给出处置方式')
})

test('--accept marks one deferral reviewed and leaves the others red', (t) => {
  const file = ledger(t, [row(SHA_A, 'no'), row(SHA_B, 'no')])
  const accepted = runGate(file, ['--accept', SHA_A])
  assert.equal(accepted.status, 1, '还有另一条没审的，仍然红')
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.ok(rows[0].endsWith('reviewed=yes'))
  assert.ok(rows[1].endsWith('reviewed=no'))

  assert.equal(runGate(file, ['--accept', SHA_B]).status, 0, '全部审过 → 绿')
})

test('--accept takes the short sha the gate itself printed', (t) => {
  const file = ledger(t, [row(SHA_A, 'no')])
  assert.equal(runGate(file, ['--accept', SHA_A.slice(0, 12)]).status, 0)
  assert.ok(fs.readFileSync(file, 'utf8').includes('reviewed=yes'))
})

test('--accept on an unknown sha changes nothing and stays red', (t) => {
  const file = ledger(t, [row(SHA_A, 'no')])
  const { status, out } = runGate(file, ['--accept', SHA_B])
  assert.equal(status, 1)
  assert.match(out, /未找到/)
  assert.ok(fs.readFileSync(file, 'utf8').includes('reviewed=no'))
})

test('--clear-reviewed prunes only the reviewed rows', (t) => {
  const file = ledger(t, [row(SHA_A, 'yes'), row(SHA_B, 'no')])
  assert.equal(runGate(file, ['--clear-reviewed']).status, 1)
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(rows.length, 1)
  assert.ok(rows[0].includes(SHA_B))
})

test('a malformed row fails closed instead of being silently skipped', (t) => {
  const file = ledger(t, ['2026-09-11T03:40:00Z|deferred|garbage'])
  const { status, out } = runGate(file)
  assert.equal(status, 1, '读不懂的账本行不许当成「没有延后」')
  assert.match(out, /无法解析/)
})
