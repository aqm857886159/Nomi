import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanupTestTemp, makeTempDir, makeTempDirAsync } from './_test-temp.mjs'

test('shared node:test temp roots are removed synchronously and asynchronously', async () => {
  const syncRoot = makeTempDir('nomi-node-test-sync-')
  const asyncRoot = await makeTempDirAsync('nomi-node-test-async-')
  assert.equal(fs.existsSync(syncRoot), true)
  assert.equal(fs.existsSync(asyncRoot), true)
  cleanupTestTemp(syncRoot)
  cleanupTestTemp(asyncRoot)
  assert.equal(fs.existsSync(syncRoot), false)
  assert.equal(fs.existsSync(asyncRoot), false)
})

// macOS 的 tmpdir 是符号链接（/var → /private/var）。在 Linux CI 上用一个指向真目录的链接当 TMPDIR 复现同一处境，
// 让「临时目录返回链接路径」这类问题在 CI 就红，而不是只在 Mac 本机红。
test('temp roots are canonical even when TMPDIR is a symlink', async (t) => {
  const real = makeTempDir('nomi-real-tmp-')
  const link = `${real}-link`
  fs.symlinkSync(real, link, 'dir')
  const savedTmp = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }
  t.after(() => {
    for (const [key, value] of Object.entries(savedTmp)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(link, { force: true })
    fs.rmSync(real, { recursive: true, force: true })
  })
  process.env.TMPDIR = link
  process.env.TMP = link
  process.env.TEMP = link
  assert.equal(os.tmpdir(), link, 'precondition: os.tmpdir() follows TMPDIR')

  const syncRoot = makeTempDir('nomi-canonical-sync-')
  const asyncRoot = await makeTempDirAsync('nomi-canonical-async-')
  for (const root of [syncRoot, asyncRoot]) {
    assert.equal(root, fs.realpathSync(root))
    assert.ok(root.startsWith(real), `${root} should live under the resolved ${real}`)
    // 真实消费者：脚本自己的 import.meta.url 是真路径，入口判断拿 argv[1] 去比必须相等
    const probe = path.join(root, 'probe.mjs')
    fs.writeFileSync(probe, "import { pathToFileURL } from 'node:url'\nconsole.log(import.meta.url === pathToFileURL(process.argv[1]).href)\n")
    assert.equal(execFileSync(process.execPath, [probe], { encoding: 'utf8' }).trim(), 'true')
    cleanupTestTemp(root)
  }
})
