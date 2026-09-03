import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertScanCoverage,
  checkFile,
  checkFiles,
  collectByDir,
  collectFiles,
  extractParseError,
  formatFailures,
  main,
} from './check-mjs-parse.mjs'

/**
 * 真跑 `node --check` 的夹具目录（这道门的价值在于「真解析器说了算」，所以自测也用真解析器）。
 * 必须 await 住 run 再清理：同步 finally 会在异步 run 还没跑完时就把夹具删掉，
 * 于是断言对着不存在的文件跑——那种失败长得像「门岗坏了」，其实是自测自己坏了。
 */
async function withFixtureDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-parse-gate-'))
  try {
    return await run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('node --check 抓得住三种「加载即崩」，且放行干净文件', async () => {
  await withFixtureDir(async (dir) => {
    // 带 import 的 .mjs —— 证明它按 ESM 解析（若按 CJS 解析，import 本身就会假红）
    const duplicateEsm = path.join(dir, 'duplicate.mjs')
    fs.writeFileSync(duplicateEsm, 'import fs from "node:fs"\nconst NAMES = [1]\nconst NAMES = [2]\nexport { NAMES, fs }\n')
    const unbalanced = path.join(dir, 'unbalanced.mjs')
    fs.writeFileSync(unbalanced, 'const shape = {\n')
    const duplicateCjs = path.join(dir, 'duplicate.cjs')
    fs.writeFileSync(duplicateCjs, 'const NAMES = 1\nconst NAMES = 2\nmodule.exports = { NAMES }\n')
    const clean = path.join(dir, 'clean.mjs')
    fs.writeFileSync(clean, 'import fs from "node:fs"\nexport const NAMES = [1]\nexport { fs }\n')

    const duplicateEsmFailure = await checkFile(duplicateEsm)
    assert.ok(duplicateEsmFailure, '重复 const（ESM）必须被抓')
    assert.match(duplicateEsmFailure.message, /already been declared/)

    assert.ok(await checkFile(unbalanced), '括号没配平必须被抓')

    const duplicateCjsFailure = await checkFile(duplicateCjs)
    assert.ok(duplicateCjsFailure, '重复 const（CJS）必须被抓')
    assert.match(duplicateCjsFailure.message, /already been declared/)

    assert.equal(await checkFile(clean), null, '干净文件必须放行')
  })
})

test('遍历只收 .mjs/.cjs，并跳过 node_modules 与点目录', async () => {
  await withFixtureDir((dir) => {
    fs.mkdirSync(path.join(dir, 'nested'))
    fs.mkdirSync(path.join(dir, 'node_modules'))
    fs.mkdirSync(path.join(dir, '.cache'))
    fs.writeFileSync(path.join(dir, 'a.mjs'), 'export const a = 1\n')
    fs.writeFileSync(path.join(dir, 'nested', 'b.cjs'), 'module.exports = {}\n')
    fs.writeFileSync(path.join(dir, 'skip.ts'), 'export const skipped: number = 1\n')
    fs.writeFileSync(path.join(dir, 'skip.json'), '{}\n')
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep.mjs'), 'const A = 1\nconst A = 2\n')
    fs.writeFileSync(path.join(dir, '.cache', 'tmp.mjs'), 'const A = 1\nconst A = 2\n')

    const found = collectFiles(dir).map((file) => path.relative(dir, file)).sort()
    assert.deepEqual(found, ['a.mjs', path.join('nested', 'b.cjs')])
  })
})

test('扫到 0 个文件时 fail-closed，而不是打印一片绿', async () => {
  await withFixtureDir((dir) => {
    fs.mkdirSync(path.join(dir, 'tests'))
    fs.mkdirSync(path.join(dir, 'evals'))
    fs.writeFileSync(path.join(dir, 'tests', 'a.mjs'), 'export const a = 1\n')

    const byDir = collectByDir(dir, ['tests', 'evals'])
    assert.throws(() => assertScanCoverage(byDir), /evals/, '空目录必须报错——扫到 0 个还报绿等于门岗静默失效')
    assert.doesNotThrow(() => assertScanCoverage(collectByDir(dir, ['tests'])))
  })
})

test('并发跑不丢文件，失败顺序稳定可复现', async () => {
  const files = Array.from({ length: 25 }, (_, i) => `file-${i}.mjs`)
  const seen = []
  const failures = await checkFiles(files, {
    concurrency: 4,
    check: async (file) => {
      seen.push(file)
      const index = Number(file.split('-')[1].replace('.mjs', ''))
      return index % 7 === 0 ? { file, message: `boom ${index}` } : null
    },
  })
  assert.equal(seen.length, files.length, '每个文件都要被检查一次')
  assert.deepEqual(
    failures.map((failure) => failure.file),
    ['file-0.mjs', 'file-7.mjs', 'file-14.mjs', 'file-21.mjs'],
    '失败必须按输入顺序回，报告才可复现',
  )
})

test('stderr 里挑出的是那一行报错，不是代码摘录', () => {
  const stderr = [
    '/repo/tests/ux/walk.mjs:3',
    'const NAMES = [2]',
    '      ^',
    '',
    "SyntaxError: Identifier 'NAMES' has already been declared",
    '    at compileSourceTextModule (node:internal/modules/esm/utils:340:16)',
  ].join('\n')
  assert.equal(extractParseError(stderr), "SyntaxError: Identifier 'NAMES' has already been declared")
  assert.match(extractParseError(''), /没有 stderr/)
  assert.deepEqual(formatFailures([{ file: '/repo/tests/ux/walk.mjs', message: 'SyntaxError: boom' }], '/repo'), [
    '    tests/ux/walk.mjs  SyntaxError: boom',
  ])
})

test('端到端：干净夹具回 0、坏夹具回 1（这道门真会红）', async () => {
  await withFixtureDir(async (dir) => {
    fs.mkdirSync(path.join(dir, 'tests'))
    fs.writeFileSync(path.join(dir, 'tests', 'clean.mjs'), 'export const a = 1\n')
    const quiet = []
    assert.equal(await main({ root: dir, dirs: ['tests'], log: (line) => quiet.push(line) }), 0)

    fs.writeFileSync(path.join(dir, 'tests', 'dup.mjs'), 'const A = 1\nconst A = 2\nexport { A }\n')
    const noisy = []
    assert.equal(await main({ root: dir, dirs: ['tests'], log: (line) => noisy.push(line) }), 1)
    assert.match(noisy.join('\n'), /dup\.mjs/)
  })
})
