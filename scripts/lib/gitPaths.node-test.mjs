// gitPaths 的行为对照（2026-09-07）：拿一棵真仓库里含中文 / 空格的路径来验，
// 不是验字符串处理——被修的正是「git 默认怎么输出路径」这件事。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { gitNameStatus, gitPaths, splitNulPaths } from './gitPaths.mjs'

const CN_DOC = 'docs/中文附件说明.md'
const SPACED = 'docs/note with space.md'

function makeRepo(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-gitpaths-')))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'probe@example.com')
  git('config', 'user.name', 'probe')
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'base')
  for (const rel of [CN_DOC, SPACED, 'src/a.ts']) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), 'x\n')
  }
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'add paths')
  return dir
}

test('默认 quotePath 确实会转义——这是本模块存在的理由，不是假想', (t) => {
  const dir = makeRepo(t)
  // git-path-quoting:intentional-default —— 这条**必须**是默认写法，它验的就是默认行为本身。
  const raw = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' })
  assert.ok(raw.includes('\\344\\270\\255'), `git 默认应当输出八进制转义，实际是：${JSON.stringify(raw)}`)
  assert.ok(raw.includes('"'), 'git 默认应当给转义后的路径裹引号——`^docs/` 与 `\\.md$` 正是被它挡掉的')
})

test('gitPaths 拿回未转义的真实路径（中文 / 空格都在）', (t) => {
  const dir = makeRepo(t)
  const changed = gitPaths(['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: dir })
  assert.deepEqual(changed.sort(), [CN_DOC, SPACED, 'src/a.ts'].sort())
  // 拿到手就能直接按前缀/后缀分类——这正是 pre-push 闸那把尺要的。
  assert.deepEqual(changed.filter((f) => f.startsWith('docs/')).sort(), [CN_DOC, SPACED].sort())
  assert.deepEqual(gitPaths(['ls-files', 'docs'], { cwd: dir }).sort(), [CN_DOC, SPACED].sort())
})

test('`-z` 插在子命令后面，不会被 `--` 之后的 pathspec 吞掉', (t) => {
  const dir = makeRepo(t)
  assert.deepEqual(gitPaths(['ls-files', '--', 'docs'], { cwd: dir }).sort(), [CN_DOC, SPACED].sort())
  assert.deepEqual(gitPaths(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs'], { cwd: dir }).sort(), [CN_DOC, SPACED].sort())
})

test('gitNameStatus 给出状态 + 未转义路径；重命名取新路径', (t) => {
  const dir = makeRepo(t)
  const added = gitNameStatus(['diff', '--name-status', 'HEAD~1', 'HEAD'], { cwd: dir })
  assert.deepEqual(
    added.map((e) => e.path).sort(),
    [CN_DOC, SPACED, 'src/a.ts'].sort(),
  )
  assert.ok(added.every((e) => e.status === 'A'), JSON.stringify(added))

  execFileSync('git', ['mv', CN_DOC, 'docs/改名后的中文附件.md'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '--no-verify', '-m', 'rename'], { cwd: dir })
  const renamed = gitNameStatus(['diff', '--name-status', '-M', 'HEAD~1', 'HEAD'], { cwd: dir })
  assert.equal(renamed.length, 1, JSON.stringify(renamed))
  assert.ok(renamed[0].status.startsWith('R'), renamed[0].status)
  assert.equal(renamed[0].path, 'docs/改名后的中文附件.md', '重命名要取新路径，不是旧路径')
})

test('splitNulPaths 丢掉结尾的空记录，不产出空串', () => {
  assert.deepEqual(splitNulPaths('a\0b\0'), ['a', 'b'])
  assert.deepEqual(splitNulPaths(''), [])
})
