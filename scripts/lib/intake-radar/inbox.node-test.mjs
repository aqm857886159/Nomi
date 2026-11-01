import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { makeTempDir } from '../../_test-temp.mjs'
import { readInbox, reconcileInbox, triageInbox, untriagedItems, writeInbox } from './inbox.mjs'

const NOW = '2026-11-01T00:00:00.000Z'
const item = (key, overrides = {}) => ({ key, id: key.split('/').pop().replace('.json', ''), date: '2026-10-31', surface: 'generation', version: '0.24.0', system: 'win32', summary: '不进账的摘要', note: '不进账的留言', duplicateOf: null, ...overrides })
const empty = () => ({ schemaVersion: 1, items: {} })

test('进账：缓存里有、账上没有的都进来，只记元数据', () => {
  const inbox = reconcileInbox(empty(), { feedbackItems: [item('feedback/a.json')], nowIso: NOW })
  assert.deepEqual(inbox.items['feedback/a.json'], { id: 'a', date: '2026-10-31', surface: 'generation', version: '0.24.0', system: 'win32', firstSeenAt: NOW, triagedAt: null, todo: null, duplicateOf: null })
  assert.doesNotMatch(JSON.stringify(inbox), /不进账/)
})

test('进账不看 seenKeys 判断要不要进：看过的也进，时间用当时的', () => {
  const inbox = reconcileInbox(empty(), { feedbackItems: [item('feedback/a.json')], seenKeys: { 'feedback/a.json': '2026-10-01T00:00:00.000Z' }, nowIso: NOW })
  assert.equal(inbox.items['feedback/a.json'].firstSeenAt, '2026-10-01T00:00:00.000Z')
})

test('进账不改已有的行：出过账的不会被带回来', () => {
  const before = { schemaVersion: 1, items: { 'feedback/a.json': { id: 'a', date: '2026-10-31', triagedAt: NOW, todo: 'T-1', duplicateOf: null } } }
  const after = reconcileInbox(before, { feedbackItems: [item('feedback/a.json')], nowIso: '2026-12-01T00:00:00.000Z' })
  assert.deepEqual(after.items, before.items)
})

test('读不出来的文件也进账', () => {
  const inbox = reconcileInbox(empty(), { feedbackItems: [], corruptKeys: ['feedback/2026-10-31/bad.json'], nowIso: NOW })
  const row = inbox.items['feedback/2026-10-31/bad.json']
  assert.equal(row.unreadable, true)
  assert.equal(row.date, '2026-10-31')
  assert.equal(untriagedItems(inbox).length, 1)
})

test('待分诊：新的在前，出过账的和重复送达的不算', () => {
  const inbox = reconcileInbox(empty(), {
    feedbackItems: [
      item('feedback/old.json', { date: '2026-10-01' }),
      item('feedback/new.json', { date: '2026-10-31' }),
      item('feedback/dup.json', { date: '2026-10-31', duplicateOf: 'new' }),
    ],
    nowIso: NOW,
  })
  assert.deepEqual(untriagedItems(inbox).map((row) => row.id), ['new', 'old'])
  const { inbox: after } = triageInbox(inbox, { ids: ['new'], todo: 'T-1', nowIso: NOW })
  assert.deepEqual(untriagedItems(after).map((row) => row.id), ['old'])
})

test('出账：全有或全无；原来的账不被改动', () => {
  const inbox = reconcileInbox(empty(), { feedbackItems: [item('feedback/a.json'), item('feedback/b.json')], nowIso: NOW })
  assert.throws(() => triageInbox(inbox, { ids: ['a', 'nope'], todo: 'T-1', nowIso: NOW }), /账上没有这个编号：nope/)
  assert.deepEqual(untriagedItems(inbox).map((row) => row.id), ['a', 'b'])
  const { newlyTriaged } = triageInbox(inbox, { ids: ['a'], todo: 'T-1', nowIso: NOW })
  assert.deepEqual(newlyTriaged, ['a'])
  assert.equal(inbox.items['feedback/a.json'].triagedAt, null)
})

test('出账：用完整 key 也行；再出一次不改第一次记的待办', () => {
  const inbox = reconcileInbox(empty(), { feedbackItems: [item('feedback/a.json')], nowIso: NOW })
  const first = triageInbox(inbox, { ids: ['feedback/a.json'], todo: 'T-1', nowIso: NOW })
  assert.deepEqual(first.newlyTriaged, ['a'])
  const again = triageInbox(first.inbox, { ids: ['a'], todo: 'T-2', nowIso: '2026-12-01T00:00:00.000Z' })
  assert.deepEqual(again.newlyTriaged, [])
  assert.equal(again.inbox.items['feedback/a.json'].todo, 'T-1')
})

test('--triaged-through：按日期含当天', () => {
  const inbox = reconcileInbox(empty(), {
    feedbackItems: [item('feedback/a.json', { date: '2026-10-30' }), item('feedback/b.json', { date: '2026-10-31' }), item('feedback/c.json', { date: '2026-11-01' })],
    nowIso: NOW,
  })
  const { inbox: after, newlyTriaged } = triageInbox(inbox, { through: '2026-10-31', todo: '对账', nowIso: NOW })
  assert.deepEqual(newlyTriaged.sort(), ['a', 'b'])
  assert.deepEqual(untriagedItems(after).map((row) => row.id), ['c'])
})

test('写盘：往返不变；写完没有留下临时文件', () => {
  const cacheDir = makeTempDir('intake-inbox-')
  try {
    const inbox = reconcileInbox(empty(), { feedbackItems: [item('feedback/a.json')], nowIso: NOW })
    writeInbox(cacheDir, inbox)
    const read = readInbox(cacheDir)
    assert.deepEqual(read.items, inbox.items)
    assert.equal(read.exists, true)
    assert.equal(read.rebuilt, false)
    assert.deepEqual(fs.readdirSync(cacheDir), ['inbox.json'])
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
})

test('读盘：没有文件和文件坏了是两件事，都不抛', () => {
  const cacheDir = makeTempDir('intake-inbox-')
  try {
    assert.deepEqual(readInbox(cacheDir), { schemaVersion: 1, items: {}, exists: false, rebuilt: false })
    for (const bad of ['{ not json', 'null', '[]', '{"items":[]}', '{"items":"x"}']) {
      fs.writeFileSync(path.join(cacheDir, 'inbox.json'), bad)
      assert.deepEqual(readInbox(cacheDir), { schemaVersion: 1, items: {}, exists: true, rebuilt: true }, bad)
    }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
})
