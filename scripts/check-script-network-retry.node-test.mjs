import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { makeTempDir } from './_test-temp.mjs'
import { main, scanSource, scanTree } from './check-script-network-retry.mjs'

const rules = (source, file = 'scripts/example.mjs') => scanSource(file, source).map((hit) => hit.rule)

test('必红：gh 子进程调用绕过共用边界', () => {
  assert.deepEqual(rules("import { execFileSync } from 'node:child_process'\nexecFileSync('gh', ['pr', 'view'])"), ['gh-raw'])
  assert.deepEqual(rules("const out = execSync('gh api repos/a/b')"), ['gh-raw'])
  assert.deepEqual(rules("spawnSync('gh', ['run', 'list'])"), ['gh-raw'])
  // 带默认值的写法（lib/prBody.mjs 改之前的样子）也算
  assert.deepEqual(rules("execFileSync(opts.bin ?? 'gh', args)"), ['gh-raw'])
  assert.deepEqual(rules("await runCommand('gh', ['api', '/x'])"), ['gh-raw'])
})

test('必红：git 网络调用绕过共用边界', () => {
  assert.deepEqual(rules("execFileSync('git', ['fetch', 'origin'])"), ['git-net'])
  assert.deepEqual(rules("execSync('git ls-remote origin')"), ['git-net'])
  assert.deepEqual(rules("execFileSync('git', ['rev-parse', 'HEAD'])"), [])
})

test('必红：控制面 API 文件里直接 fetch / fetchImpl / 裸引用 / globalThis.fetch', () => {
  const host = "const API = 'https://api.github.com'\n"
  assert.deepEqual(rules(`${host}await fetch(API + '/x')`), ['fetch-bare'])
  assert.deepEqual(rules(`${host}async function f({ fetchImpl }) { return fetchImpl(API) }`), ['fetch-bare'])
  assert.deepEqual(rules(`${host}async function f({ fetchImpl = fetch }) {}`), ['fetch-bare'])
  assert.deepEqual(rules(`${host}const send = globalThis.fetch`), ['fetch-bare'])
  assert.deepEqual(rules("const R2 = `https://api.cloudflare.com/client/v4/${id}`\nawait fetch(R2)"), ['fetch-bare'])
})

test('放行：走共用边界的写法', () => {
  assert.deepEqual(rules("import { execGhReadSync } from './lib/transientRetry.mjs'\nexecGhReadSync(['pr', 'view'])"), [])
  assert.deepEqual(rules("execGhWriteSync(['issue', 'create'])"), [])
  assert.deepEqual(rules("await retryTransient(() => runCommand('gh', ['api', '/x']))"), [])
  assert.deepEqual(rules("retryTransientSync(() => execFileSync('gh', ['pr', 'view']))"), [])
  assert.deepEqual(rules("const API = 'https://api.github.com'\nawait fetchWithRetry(API, {}, { fetchImpl })"), [])
  // 与控制面无关的 fetch（本机服务、模型探测）不归本门管
  assert.deepEqual(rules("await fetch('http://127.0.0.1:8188/queue')"), [])
  // 注释和字符串里的样本不是代码
  assert.deepEqual(rules("// execFileSync('gh', [])\nconst text = \"execFileSync('gh', [])\""), [])
})

test('放行：共用边界自己、测试文件', () => {
  assert.deepEqual(scanSource('scripts/lib/transientRetry.mjs', "execFileSync('gh', args)"), [])
  assert.deepEqual(scanSource('scripts/foo.node-test.mjs', "execFileSync('gh', args)"), [])
})

test('现在的 scripts/ 整树是零违规', () => {
  const { fileCount, hits } = scanTree()
  assert.ok(fileCount > 100)
  assert.deepEqual(hits, [])
})

test('main：有违规退出 1，整树干净退出 0，遍历失效不当作通过', () => {
  const lines = []
  assert.equal(main(undefined, (line) => lines.push(line)), 0)
  assert.match(lines.join('\n'), /✅/)

  const bad = makeTempDir('nomi-net-retry-gate-')
  const empty = makeTempDir('nomi-net-retry-gate-empty-')
  try {
    fs.mkdirSync(path.join(bad, 'scripts'))
    fs.writeFileSync(path.join(bad, 'scripts', 'bad.mjs'), "execFileSync('gh', ['pr', 'view'])\n")
    const out = []
    assert.equal(main(bad, (line) => out.push(line)), 1)
    assert.match(out.join('\n'), /scripts\/bad\.mjs:1 \[gh-raw\]/)
    fs.mkdirSync(path.join(empty, 'scripts'))
    assert.equal(main(empty, () => {}), 1)
  } finally {
    fs.rmSync(bad, { recursive: true, force: true })
    fs.rmSync(empty, { recursive: true, force: true })
  }
})
