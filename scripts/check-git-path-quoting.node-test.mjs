// 「读 git 路径列表」门岗的阳性对照（2026-09-07）。
//
// 一道只会绿的门岗和没有门岗是一回事，所以这里两个方向都钉：
//   · 假绿——把任意一个调用点退回默认 quotePath，必须报出来；
//   · 假红——注释、报错文案、已加 `-z` / `core.quotePath=false` 的写法，一条都不许误伤。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { scanSource } from './check-git-path-quoting.mjs'

test('默认 quotePath 的调用点必须被抓到（JS / shell 两侧）', () => {
  assert.equal(scanSource(`const out = execSync("git diff --name-only HEAD~1")`, 'a.mjs').length, 1)
  assert.equal(scanSource(`execFileSync('git', ['ls-files', 'src'])`, 'a.mjs').length, 1)
  assert.equal(scanSource(`names = git(['diff', '--name-status', base])`, 'a.mjs').length, 1)
  assert.equal(scanSource(`FILES="$(git diff --name-only origin/main...HEAD)"`, 'h.sh').length, 1)
})

test('关掉引号转义的写法一条都不许误伤', () => {
  assert.deepEqual(scanSource(`execSync("git diff -z --name-only HEAD~1")`, 'a.mjs'), [])
  assert.deepEqual(scanSource(`execSync("git -c core.quotePath=false diff --name-only HEAD~1")`, 'a.mjs'), [])
  assert.deepEqual(scanSource(`git diff -z --name-only origin/main...HEAD`, 'h.sh'), [])
  assert.deepEqual(scanSource(`const files = gitPaths(['ls-files', 'src'], { cwd })`, 'a.mjs'), [])
  // 跨行写的调用：判定要看窗口，不能只看命中那一行。
  assert.deepEqual(
    scanSource(`execFileSync('git', [\n  'ls-files', '-z',\n  '--', 'src',\n])`, 'a.mjs'),
    [],
  )
})

test('注释与报错文案不算调用点（会误报的门岗三次之后就被绕过）', () => {
  assert.deepEqual(scanSource(`// 默认 quotePath 会把 git diff --name-only 的非 ASCII 路径转义`, 'a.mjs'), [])
  assert.deepEqual(scanSource(`# 说明：git ls-files 会连已删除的文件一起列出`, 'h.sh'), [])
  assert.deepEqual(scanSource("problems.push(`多半是按行读了 \\`git diff --name-only\\`（quotePath）`)", 'a.mjs'), [])
})

test('真仓库当下是干净的；任意一处退回默认写法 → 门岗必须报红', (t) => {
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const gate = path.join(repoRoot, 'scripts/check-git-path-quoting.mjs')
  // 门岗的扫描根是**它自己所在的位置**推出来的（scripts/.. ），不是 cwd——
  // 所以阳性对照必须跑 fixture 里那份拷贝，跑仓库那份只会再扫一遍真仓库（恒绿的空转）。
  const run = (gatePath) => {
    try {
      execFileSync('node', [gatePath], { encoding: 'utf8' })
      return 0
    } catch (error) {
      return typeof error.status === 'number' ? error.status : 1
    }
  }
  assert.equal(run(gate), 0, '真仓库当下应当全部走 -z / gitPaths')

  // 阳性对照：把 pre-push 闸退回不带 -z，门岗必须红。
  // realpath：macOS 的 tmpdir 是 /var → /private/var 的符号链接，而门岗的「我是不是主模块」
  // 判据比的是 `path.resolve(process.argv[1])` 与 `import.meta.url`，前者不解符号链接。
  // 不 realpath 的话 CLI 那段根本不执行，测试拿到的 exit 0 是「没跑」而不是「跑了没问题」。
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-quotepath-gate-')))
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }))
  fs.mkdirSync(path.join(fixture, 'scripts/claude-hooks'), { recursive: true })
  const fixtureGate = path.join(fixture, 'scripts/check-git-path-quoting.mjs')
  fs.copyFileSync(gate, fixtureGate)
  const hook = fs.readFileSync(path.join(repoRoot, 'scripts/claude-hooks/pre-push-check.sh'), 'utf8')
  const regressed = hook.replaceAll('git diff -z --name-only', 'git diff --name-only')
  assert.notEqual(regressed, hook, '替换必须真的命中，否则这条测试是空转')
  fs.writeFileSync(path.join(fixture, 'scripts/claude-hooks/pre-push-check.sh'), regressed)
  assert.equal(run(fixtureGate), 1, '退回默认 quotePath 的 hook 必须被门岗拦下')
})
