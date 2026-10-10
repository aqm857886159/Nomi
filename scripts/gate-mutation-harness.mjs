// 门岗自检的**共用装置**：跑门岗、在**隔离副本**上按变异改生产文件。真实工作区一个字节都不碰。
//
// 为什么是副本（2026-10-10，同一天两次事故）：原来它在真实工作区里原地改生产文件，还原靠 finally、SIGTERM 处理和恢复档。
// 推送前钩子因别的门红了或超时杀掉子进程时，Windows 上杀进程不会跑 SIGTERM 处理，工作区就留着变异后的生产代码
// （一次 `mode: String(durationSec)`，一次 contentHash / version 改成必填）；两个进程并发跑还共用同一个恢复档、互相覆盖；
// 变异期间并行的 typecheck 读到的是半途变异的代码；这段时间里谁 `git add -A` 就会把变异提交进去。
// 三样兜底（finally / 信号 / 恢复档）在「被杀、并发、跨进程」下都兜不住——所以不兜底：让变异**根本没机会落到真实文件上**。
//
// 做法：
//   · 副本放在系统临时目录（仓库共用的 makeTempDir），由 git 跟踪的文件复制而来；没有任何跟踪代码文件的目录用 junction 链过去
//     （docs / marketing 等大头，门岗只读）；node_modules 同样 junction。含代码的目录必须真复制：ESM 加载器会把 junction 解析回
//     真实路径，经 junction 加载的模块算出来的 repoRoot（scripts/lib/repoPaths.mjs 由文件位置推出）就会指回真实仓库。
//   · 变异只写副本；副本每个测试文件建一次、复用；每次变异的 `finally` 只是把副本里的文件还原给下一个用例用，不是安全兜底。
//   · 进程被杀时副本留在系统临时目录，对真实仓库没有任何影响。
//   · 退出时先拆 junction 再删目录（docs/lessons/windows-worktree-remove-follows-junctions.md）。
//
// 提供：
//   · `runGate()`      在副本里跑一次门岗，返回 `{ red, output }`——**不抛**，因为「红了」是这里的正常结果；
//   · `withMutation()` 在副本的一组 [文件, 找, 换] 上改代码、跑 body、还原副本。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from './_test-temp.mjs'
import { gitPaths } from './lib/gitPaths.mjs'
import { repoRoot } from './lib/repoPaths.mjs'

export { repoRoot }

const CODE_FILE = /\.(?:mjs|cjs|js|ts|mts|cts|tsx|jsx)$/

/** 把 git 跟踪的相对路径列表排成树：{ files: Set<名字>, dirs: Map<名字, 子树>, hasCode: boolean }。 */
function buildTree(paths) {
  const root = { files: new Set(), dirs: new Map(), hasCode: false }
  for (const relative of paths) {
    const parts = relative.split('/')
    let node = root
    const isCode = CODE_FILE.test(relative)
    if (isCode) node.hasCode = true
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { files: new Set(), dirs: new Map(), hasCode: false })
      node = node.dirs.get(part)
      if (isCode) node.hasCode = true
    }
    node.files.add(parts.at(-1))
  }
  return root
}

function unlinkLink(link) {
  try { fs.unlinkSync(link) } catch { fs.rmdirSync(link) }
}

/**
 * @param {object} input
 * @param {string} input.gate 门岗脚本的仓库相对路径
 * @param {string[]} [input.shareDirs] 顶层目录名：门岗只当**数据**读、不执行里面的代码，也不会变异它——这些目录整个 junction 过去不复制
 *   （复制 src / tests 要多花 20 多秒）。变异目标落在这里面会被 copyPathOf 拒绝。
 */
export function createGateMutationHarness({ gate, shareDirs = [] }) {
  let copyRoot = null
  const links = []

  // 必须在 makeTempDir 注册它自己的退出清理之前注册：先拆 junction，再让共用工具删目录。
  process.once('exit', () => {
    for (const link of links) { try { unlinkLink(link) } catch { /* 已经没了 */ } }
  })

  function plan(node, realDir, copyDir) {
    fs.mkdirSync(copyDir, { recursive: true })
    for (const name of node.files) {
      const source = path.join(realDir, name)
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(copyDir, name))
    }
    for (const [name, child] of node.dirs) {
      const source = path.join(realDir, name)
      const target = path.join(copyDir, name)
      if (child.hasCode && !(node.isRoot && shareDirs.includes(name))) plan(child, source, target)
      else {
        fs.symlinkSync(source, target, 'junction')
        links.push(target)
      }
    }
  }

  function ensureCopy() {
    if (copyRoot) return copyRoot
    copyRoot = makeTempDir('nomi-gate-mutation-')
    const tree = buildTree(gitPaths(['ls-files'], { cwd: repoRoot }))
    tree.isRoot = true
    plan(tree, repoRoot, copyRoot)
    const modules = path.join(repoRoot, 'node_modules')
    if (fs.existsSync(modules)) {
      fs.symlinkSync(modules, path.join(copyRoot, 'node_modules'), 'junction')
      links.push(path.join(copyRoot, 'node_modules'))
    }
    return copyRoot
  }

  /** 副本里的路径；防呆：目标必须是副本里的真文件，不能是经 junction 指回真实仓库的。 */
  function copyPathOf(relative) {
    const full = path.join(ensureCopy(), relative)
    const inside = path.relative(fs.realpathSync(ensureCopy()), fs.realpathSync(full))
    assert.ok(!inside.startsWith('..') && !path.isAbsolute(inside), `变异目标 ${relative} 不在副本里（经 junction 指回了真实仓库），拒绝写入`)
    return full
  }

  function runGate() {
    const root = ensureCopy()
    try {
      // 不经 pnpm：Windows 上 pnpm 是 pnpm.cmd，execFileSync('pnpm') 直接 ENOENT（输出为空，门岗自检于是在 Windows 上全红）。
      // 用当前 node + tsx 的 --import，与 `pnpm exec tsx <脚本>` 同一加载器，平台无关。
      execFileSync(process.execPath, ['--import', 'tsx', path.join(root, gate)], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
      return { red: false, output: '' }
    } catch (error) {
      return { red: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }

  function withMutation(edits, body) {
    const originals = edits.map(([relative]) => [relative, fs.readFileSync(copyPathOf(relative), 'utf8')])
    try {
      for (const [relative, find, replace] of edits) {
        const full = copyPathOf(relative)
        const text = fs.readFileSync(full, 'utf8')
        assert.ok(text.includes(find), `变异目标不在 ${relative} 里了，这条变异已经过期：${find.slice(0, 70)}`)
        fs.writeFileSync(full, text.replace(find, replace))
      }
      return body()
    } finally {
      for (const [relative, content] of originals) fs.writeFileSync(copyPathOf(relative), content)
    }
  }

  return { runGate, withMutation, repoRoot, copyRootForTests: () => ensureCopy() }
}

/** 「这道门进了 contracts 档」——三道门各自都要核的同一句话。 */
export function assertGateIsOnContracts(scriptName) {
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts
  assert.ok(scripts[scriptName], `package.json 里没有 ${scriptName} 这条 script`)
  assert.ok(scripts['gates:contracts'].includes(scriptName),
    `gates:contracts 里没有 ${scriptName} —— 门岗不在常跑档上等于没有门岗`)
}
