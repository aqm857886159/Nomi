import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeTempDir } from '../_test-temp.mjs'
import { writeFileAtomic, writeFileAtomicSync } from './atomicFile.mjs'

test('writeFileAtomicSync 原子创建并覆盖目标文件，写完不留暂存件', () => {
  const dir = makeTempDir('atomic-file-sync-')
  const target = path.join(dir, 'nested', 'state.json')
  writeFileAtomicSync(target, '{"step":1}\n')
  assert.equal(fs.readFileSync(target, 'utf8'), '{"step":1}\n')
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['state.json'])

  writeFileAtomicSync(target, '{"step":2,"ok":true}\n', { fsync: false })
  assert.equal(fs.readFileSync(target, 'utf8'), '{"step":2,"ok":true}\n')
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['state.json'])

  writeFileAtomicSync(target, '')
  assert.equal(fs.readFileSync(target, 'utf8'), '')
})

test('writeFileAtomicSync 遇到可续写的部分 writeSync 会循环写满全部字节后再公布', (t) => {
  const dir = makeTempDir('atomic-file-partial-resume-')
  const target = path.join(dir, 'payload.json')
  const payload = '{"status":"complete","items":[1,2,3]}'
  const realWriteSync = fs.writeSync
  let calls = 0
  t.mock.method(fs, 'writeSync', (fd, buffer, offset = 0, length = buffer.length - offset, position) => {
    calls += 1
    const chunk = calls === 1 ? Math.min(4, length) : length
    return realWriteSync(fd, buffer, offset, chunk, position)
  })
  writeFileAtomicSync(target, payload, { fsync: false })
  assert.equal(calls, 2)
  assert.equal(fs.readFileSync(target, 'utf8'), payload)
  assert.deepEqual(fs.readdirSync(dir), ['payload.json'])
})

test('writeFileAtomicSync 注入短写（只写前 4 字节）立即抛错、清理暂存件且绝不公布目标文件', (t) => {
  const dir = makeTempDir('atomic-file-short-write-')
  const target = path.join(dir, 'receipt.json')
  const payload = '{"status":"ok","count":42}'
  const realWriteSync = fs.writeSync
  let renameCalled = false
  let calls = 0
  t.mock.method(fs, 'writeSync', (fd, buffer, offset = 0, length = buffer.length - offset, position) => {
    calls += 1
    if (calls === 1) return realWriteSync(fd, buffer, offset, Math.min(4, length), position)
    return 0
  })
  t.mock.method(fs, 'renameSync', () => {
    renameCalled = true
  })

  assert.throws(
    () => writeFileAtomicSync(target, payload, { fsync: false }),
    (error) => error?.code === 'ESHORTWRITE' && /Short write/i.test(error.message),
  )
  assert.equal(renameCalled, false, '短写时绝不能调用 renameSync')
  assert.equal(fs.existsSync(target), false, '短写后目标文件不得被公布')
  assert.deepEqual(fs.readdirSync(dir), [], '短写失败后应同步清理暂存件')
})

test('writeFileAtomicSync 短写覆盖已有文件时保持原目标内容不被破坏', (t) => {
  const dir = makeTempDir('atomic-file-short-overwrite-')
  const target = path.join(dir, 'existing.json')
  fs.writeFileSync(target, '{"version":1}')
  const realWriteSync = fs.writeSync
  t.mock.method(fs, 'writeSync', (fd, buffer, offset = 0, length = buffer.length - offset, position) => {
    // 即使错误实现只落 4 字节却虚报写满，fstatSync 字节数校验仍须拦截
    realWriteSync(fd, buffer, offset, Math.min(4, length), position)
    return length
  })

  assert.throws(
    () => writeFileAtomicSync(target, '{"version":2,"longer":true}', { fsync: false }),
    (error) => error?.code === 'ESHORTWRITE',
  )
  assert.equal(fs.readFileSync(target, 'utf8'), '{"version":1}')
  assert.deepEqual(fs.readdirSync(dir), ['existing.json'])
})

test('writeFileAtomic 异步原子写支持完整内容与空内容并清理暂存件', async () => {
  const dir = makeTempDir('atomic-file-async-')
  const target = path.join(dir, 'nested', 'async.json')
  await writeFileAtomic(target, '{"async":true}\n', { fsync: false })
  assert.equal(fs.readFileSync(target, 'utf8'), '{"async":true}\n')
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['async.json'])

  await writeFileAtomic(target, '', { fsync: false })
  assert.equal(fs.readFileSync(target, 'utf8'), '')
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['async.json'])
})

test('无 node_modules 的隔离目录可直接 import atomicFile.mjs 并运行 writeFileAtomicSync', () => {
  const dir = makeTempDir('atomic-file-no-nm-')
  const standalone = path.join(dir, 'atomicFile.mjs')
  const target = path.join(dir, 'out.json')
  fs.copyFileSync(fileURLToPath(new URL('./atomicFile.mjs', import.meta.url)), standalone)
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { writeFileAtomicSync } from ${JSON.stringify(pathToFileURL(standalone).href)}; writeFileAtomicSync(${JSON.stringify(target)}, '{"standalone":true}\\n', { fsync: false });`,
    ],
    { cwd: dir, stdio: 'pipe' },
  )
  assert.equal(fs.readFileSync(target, 'utf8'), '{"standalone":true}\n')
})
