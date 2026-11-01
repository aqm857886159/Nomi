import { makeTempDir } from '../../_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { resolveCacheDir, rawFilePath, writeRawFile, listRawRecords, readState, writeState, writeReport, reportsDir } from './store.mjs'

function tmpDir() {
  return makeTempDir('intake-store-test-')
}

test('resolveCacheDir 优先用 NOMI_INTAKE_CACHE 覆盖', () => {
  assert.equal(resolveCacheDir({ NOMI_INTAKE_CACHE: '/custom/dir' }, 'win32', '/home/x'), '/custom/dir')
})

test('resolveCacheDir Windows 默认落在 LOCALAPPDATA\\nomi-intake', () => {
  const dir = resolveCacheDir({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32', 'C:\\Users\\x')
  assert.equal(dir, path.join('C:\\Users\\x\\AppData\\Local', 'nomi-intake'))
})

test('resolveCacheDir macOS/Linux 落在各自的标准缓存位置', () => {
  assert.equal(resolveCacheDir({}, 'darwin', '/Users/x'), path.join('/Users/x', 'Library', 'Caches', 'nomi-intake'))
  assert.equal(resolveCacheDir({}, 'linux', '/home/x'), path.join('/home/x', '.cache', 'nomi-intake'))
})

test('rawFilePath 把 R2 key 的 / 换成本地路径分隔符', () => {
  const p = rawFilePath('/cache', 'feedback/2026-09-27/a.json')
  assert.equal(p, path.join('/cache', 'feedback', '2026-09-27', 'a.json'))
})

test('listRawRecords 读出全部记录，单个坏文件不拖垮其余的', () => {
  const cacheDir = tmpDir()
  writeRawFile(cacheDir, 'feedback/2026-09-27/good.json', Buffer.from(JSON.stringify({ ok: true })))
  const brokenPath = rawFilePath(cacheDir, 'feedback/2026-09-27/broken.json')
  fs.mkdirSync(path.dirname(brokenPath), { recursive: true })
  fs.writeFileSync(brokenPath, 'not json at all {')

  const { records, corrupt } = listRawRecords(cacheDir, 'feedback/')
  assert.equal(records.length, 1)
  assert.equal(records[0].key, 'feedback/2026-09-27/good.json')
  assert.equal(corrupt.length, 1)
  assert.equal(corrupt[0].key, 'feedback/2026-09-27/broken.json')
})

test('listRawRecords 前缀目录还不存在时返回空数组（不是这一批数据这次一条都没有 ≠ 错误）', () => {
  const cacheDir = tmpDir()
  const { records, corrupt } = listRawRecords(cacheDir, 'trajectories/')
  assert.deepEqual(records, [])
  assert.deepEqual(corrupt, [])
})

test('state 往返：读空目录得到空状态，写完能读回同样的内容', () => {
  const cacheDir = tmpDir()
  const empty = readState(cacheDir)
  assert.deepEqual(empty.seenKeys, {})

  writeState(cacheDir, { schemaVersion: 1, seenKeys: { 'feedback/a.json': '2026-09-29T00:00:00.000Z' }, lastRunAt: '2026-09-29T00:00:00.000Z', lastRunOk: true })
  const state = readState(cacheDir)
  assert.deepEqual(state.seenKeys, { 'feedback/a.json': '2026-09-29T00:00:00.000Z' })
  assert.equal(state.lastRunOk, true)
})

test('state 文件损坏时退回空状态而不是抛错', () => {
  const cacheDir = tmpDir()
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(path.join(cacheDir, 'state.json'), '{not valid json')
  const state = readState(cacheDir)
  assert.deepEqual(state.seenKeys, {})
})

test('writeReport 写出同名 .md 与 .json 到 reports/ 子目录，文件名到秒且不带冒号（Windows 不收）', () => {
  const cacheDir = tmpDir()
  const { mdPath, jsonPath } = writeReport(cacheDir, '2026-09-29T08:01:02.345Z', { markdown: '# hi', json: { a: 1 } })
  assert.equal(mdPath, path.join(reportsDir(cacheDir), '2026-09-29T080102Z.md'))
  assert.equal(fs.readFileSync(mdPath, 'utf8'), '# hi')
  assert.deepEqual(JSON.parse(fs.readFileSync(jsonPath, 'utf8')), { a: 1 })
})

test('writeReport 同一天多跑、甚至同一秒多跑，都不盖掉前一份', () => {
  const cacheDir = tmpDir()
  const first = writeReport(cacheDir, '2026-10-31T19:45:15.000Z', { markdown: 'first', json: { n: 1 } })
  const later = writeReport(cacheDir, '2026-10-31T22:45:43.000Z', { markdown: 'later', json: { n: 2 } })
  const sameSecond = writeReport(cacheDir, '2026-10-31T22:45:43.000Z', { markdown: 'again', json: { n: 3 } })
  assert.equal(new Set([first.mdPath, later.mdPath, sameSecond.mdPath]).size, 3)
  assert.equal(fs.readFileSync(first.mdPath, 'utf8'), 'first')
  assert.equal(fs.readFileSync(later.mdPath, 'utf8'), 'later')
  assert.equal(fs.readFileSync(sameSecond.mdPath, 'utf8'), 'again')
  assert.deepEqual(JSON.parse(fs.readFileSync(sameSecond.jsonPath, 'utf8')), { n: 3 })
})
