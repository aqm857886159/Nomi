import { makeTempDir } from './_test-temp.mjs'
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

import { scanDirectListing, scanSource } from './check-git-path-quoting.mjs'

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

test('绕开 gitPaths 直接起 ls-files 必须被抓到，带了 -z 也一样（缓冲上限只在 gitPaths）', () => {
  assert.equal(scanDirectListing(`execFileSync('git', ['ls-files', '-z'], { cwd })`, 'a.mjs').length, 1)
  assert.equal(scanDirectListing(`execSync("git ls-files -z")`, 'a.mjs').length, 1)
  assert.equal(scanDirectListing(`const out = gitLines(root, ['ls-files', '--', '*.ts'])`, 'a.mjs').length, 1)
  assert.equal(scanDirectListing(`execFileSync('git', [\n  'ls-files', '-z',\n], { cwd })`, 'a.mjs').length, 1)
})

test('走 gitPaths、测试文件、shell、注释、不起进程的字符串，都不算', () => {
  assert.deepEqual(scanDirectListing(`const files = gitPaths(['ls-files', 'src'], { cwd })`, 'a.mjs'), [])
  assert.deepEqual(scanDirectListing(`return gitPaths(\n  ['ls-files', '--cached'],\n  { cwd },\n)`, 'a.mjs'), [])
  assert.deepEqual(scanDirectListing(`execFileSync('git', ['ls-files', '-z'], { cwd: temp })`, 'a.node-test.mjs'), [])
  assert.deepEqual(scanDirectListing(`execFileSync('git', ['ls-files', '-z'], { cwd: temp })`, 'a.test.ts'), [])
  assert.deepEqual(scanDirectListing(`git ls-files -z`, 'h.sh'), [])
  assert.deepEqual(scanDirectListing(`// execFileSync('git', ['ls-files'])`, 'a.mjs'), [])
  assert.deepEqual(scanDirectListing(`sites.push({ kind: 'git ls-files|grep' })`, 'a.mjs'), [])
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

  // 阳性对照：一个 shell 调用点退回不带 -z，门岗必须红；同一行带着 -z，必须放行。
  // 那一行就是 2026-09-07 栽过的原样写法（pre-push 闸的 is_docs_only 按行读 git diff）。2026-10-24 推送前的本机门岗戳删除后
  // push 闸不再列路径（doc-only 判据只用来判「要不要戳」，随戳一起删了），仓库里没有现成的 shell 调用点可以退回，
  // 所以把那一行原样放进 fixture——门岗走的仍是真实的 CLI 路径、真实的目录扫描。
  // realpath：macOS 的 tmpdir 是 /var → /private/var 的符号链接，而门岗的「我是不是主模块」
  // 判据比的是 `path.resolve(process.argv[1])` 与 `import.meta.url`，前者不解符号链接。
  // 不 realpath 的话 CLI 那段根本不执行，测试拿到的 exit 0 是「没跑」而不是「跑了没问题」。
  const fixture = makeTempDir('nomi-quotepath-gate-')
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }))
  fs.mkdirSync(path.join(fixture, 'scripts/claude-hooks'), { recursive: true })
  const fixtureGate = path.join(fixture, 'scripts/check-git-path-quoting.mjs')
  fs.copyFileSync(gate, fixtureGate)
  const probe = path.join(fixture, 'scripts/claude-hooks/path-listing-probe.sh')
  fs.writeFileSync(probe, 'is_docs_only < <(git diff -z --name-only origin/main...HEAD 2>/dev/null) && continue\n')
  assert.equal(run(fixtureGate), 0, '带 -z 的调用点必须放行（对照组）')
  fs.writeFileSync(probe, 'is_docs_only < <(git diff --name-only origin/main...HEAD 2>/dev/null) && continue\n')
  assert.equal(run(fixtureGate), 1, '退回默认 quotePath 的调用点必须被门岗拦下')
})
