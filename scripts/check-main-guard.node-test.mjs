// 「入口判断」写法门岗的阳性 / 阴性对照（2026-09-24）。
//
// 一道只会绿的门岗和没有门岗是一回事，所以两个方向都钉：
//   · 假绿——仓库里出现过的每一种手拼写法都必须被报出来；
//   · 假红——正确写法、注释、报错文案、别的 argv 下标，一条都不许误伤。
// 另外钉一条行为：被放行的那种写法在**当前平台**上真的会执行 main()（路径带空格和 `#` 也一样）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { FIX_HINT, main, scanSource } from './check-main-guard.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const rules = (source, file = 'a.mjs') => scanSource(source, file).map((hit) => hit.rule)

test('仓库里出现过的每种手拼写法都必须被抓到', () => {
  // 2026-09-24 实扫到的五种原样写法（7 个门岗/脚本 + research 原型 + attention-cue）
  assert.equal(rules('if (import.meta.url === `file://${process.argv[1]}`) main()').length, 1)
  assert.equal(rules('const ok = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href').length, 1)
  assert.equal(rules('const ok = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href').length, 1)
  assert.equal(rules("if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) run()").length, 1)
  assert.equal(rules('if (import.meta.url !== `file://${process.argv[1]}`) process.exit(0)').length, 1)
  // 同族的变体：字符串拼接、先存进变量再比、直接拿 URL 比路径
  assert.equal(rules("const self = 'file://' + process.argv[1]").length, 1)
  assert.equal(rules('const entry = process.argv[1]\nif (import.meta.url === `file://${entry}`) main()').length, 1)
  assert.equal(rules('if (import.meta.url === process.argv[1]) main()').length, 1)
  assert.deepEqual(rules('if (import.meta.url === `file://${process.argv[1]}`) main()', 'b.ts'), ['meta-url-vs-hand'])
})

test('正确写法与无关用法一条都不许误伤', () => {
  const clean = [
    FIX_HINT,
    'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()',
    'if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main()',
    'if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()',
    'if (process.argv[1] === url.fileURLToPath(import.meta.url)) main()',
    // ponytail 三个脚本：先转换好存变量，再比
    "const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''\nif (import.meta.url === invokedPath) main()",
    // 注释、报错文案里提到坏写法：是字符串 / 注释，不是代码
    '// 手拼 `file://${argv[1]}` 在 Windows 上永远不等',
    "console.log('别写 import.meta.url === `file://${process.argv[1]}`')",
    // 别的 argv 下标可能是用户传进来的真网址；相对 import.meta.url 解析资源是正路
    'const target = new URL(process.argv[2])',
    "const out = new URL('./candidates/', import.meta.url)",
    "await import(pathToFileURL(loaderPath).href)",
    "const u = new URL(pathToFileURL(process.argv[1]))",
  ]
  for (const source of clean) assert.deepEqual(scanSource(source, 'a.mjs'), [], source)
})

test('放行的写法在当前平台真的会执行；被拦的写法遇到 `#` 在任何平台都不执行', (t) => {
  // realpath：macOS 的 tmpdir 是 /var → /private/var 的符号链接，而 import.meta.url 是解过链接的真路径。
  const dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-main-guard-'))), 'dir with space#1')
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }))
  fs.mkdirSync(dir, { recursive: true })
  const runs = (guard) => {
    const file = path.join(dir, `probe-${Math.random().toString(36).slice(2)}.mjs`)
    fs.writeFileSync(file, `import { pathToFileURL } from 'node:url'\nif (${guard}) console.log('RAN')\n`)
    return execFileSync(process.execPath, [file], { encoding: 'utf8' }).includes('RAN')
  }
  assert.equal(runs(FIX_HINT), true, '门岗推荐的写法必须在本平台真的触发 main()')
  assert.equal(runs('import.meta.url === `file://${process.argv[1]}`'), false)
  assert.equal(runs('import.meta.url === new URL(`file://${process.argv[1]}`).href'), false)
})

test('退回旧写法 → 门岗必须红；一个源文件都没扫到 → 也必须红', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-main-guard-repo-'))
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: fixture })
  const lines = []
  const log = (line) => lines.push(line)

  assert.equal(main({ root: fixture, log }), 1, '扫到 0 个文件不能报绿')

  // 阳性对照用真文件：把 check-rule-aliases 的入口判断退回 2026-09-24 之前的样子
  const real = fs.readFileSync(path.join(repoRoot, 'scripts/check-rule-aliases.mjs'), 'utf8')
  const regressed = real.replace(`if (${FIX_HINT}) main()`, 'if (import.meta.url === `file://${process.argv[1]}`) main()')
  assert.notEqual(regressed, real, '替换必须真的命中，否则这条测试是空转')
  fs.mkdirSync(path.join(fixture, 'scripts'))
  fs.writeFileSync(path.join(fixture, 'scripts/check-rule-aliases.mjs'), regressed)
  lines.length = 0
  assert.equal(main({ root: fixture, log }), 1, '退回手拼写法必须被拦下')
  assert.match(lines.join('\n'), /scripts\/check-rule-aliases\.mjs:\d+/)

  fs.writeFileSync(path.join(fixture, 'scripts/check-rule-aliases.mjs'), real)
  assert.equal(main({ root: fixture, log }), 0)
})

test('真仓库当下是干净的，且门岗自己的入口判断在本平台真的执行了', () => {
  // 零输出 + 退出码 0 正是本门岗要抓的症状，所以这里断言的是「打印了结论」，不只是退出码。
  const out = execFileSync(process.execPath, [path.join(repoRoot, 'scripts/check-main-guard.mjs')], { encoding: 'utf8' })
  assert.match(out, /✅ check:main-guard/)
})
