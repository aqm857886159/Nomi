#!/usr/bin/env node
/* global console, process */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MARKER_RELATIVE_PATH = '.claude/agent-worktree-stop.json'
export const DEFAULT_GRACE_MS = 15 * 60 * 1000
/**
 * 未登记 worktree 回收可再生目录的静默期。比 marker 的 15 分钟宽限长得多：没有 marker 就没有
 * 「会话已结束」这个明确信号，只能靠「很久没人动过」来推断，所以门槛要保守。
 */
export const DEFAULT_UNMANAGED_IDLE_MS = 3 * 24 * 60 * 60 * 1000

export function decideAction({
  kind,
  clean,
  active,
  detached = false,
  marker,
  markerAgeMs,
  graceMs = DEFAULT_GRACE_MS,
  idleAgeMs = Number.NaN,
  unmanagedIdleMs = DEFAULT_UNMANAGED_IDLE_MS,
  reclaimableDirs = [],
}) {
  if (active) return { kind: 'skip', reason: 'active' }
  if (!marker || marker.kind !== 'agent-worktree-lease' || marker.status !== 'stopped') {
    // 没有 marker 就没有「会话已正常结束」的凭据，所以**目录本身永远不删**——它可能装着
    // 别人的未提交改动。但依赖目录是可再生物（pnpm install 就回来），删它不需要任何安全
    // 证明，只需要确认长时间没人动过。marker 因此从「所有动作的前置」降级为「删目录的前置」。
    if (reclaimableDirs.length === 0) return { kind: 'skip', reason: 'unmanaged' }
    if (!Number.isFinite(idleAgeMs) || idleAgeMs < unmanagedIdleMs) {
      return { kind: 'skip', reason: 'unmanaged-recent' }
    }
    return { kind: 'prune-reclaimable', reason: 'unmanaged-idle-reclaimable-only' }
  }
  if (!Number.isFinite(markerAgeMs) || markerAgeMs < graceMs) {
    return { kind: 'skip', reason: 'grace-period' }
  }
  if (kind === 'full-clone') {
    return reclaimableDirs.length > 0
      ? { kind: 'prune-reclaimable', reason: 'full-clone-reclaimable-only' }
      : { kind: 'skip', reason: 'full-clone-protected' }
  }
  if (kind !== 'linked-worktree') return { kind: 'skip', reason: 'unknown-kind' }
  if (detached) {
    return reclaimableDirs.length > 0
      ? { kind: 'prune-reclaimable', reason: 'detached-reclaimable-only' }
      : { kind: 'skip', reason: 'detached-protected' }
  }
  if (clean) return { kind: 'remove-worktree', reason: 'stopped-clean-inactive' }
  return reclaimableDirs.length > 0
    ? { kind: 'prune-reclaimable', reason: 'stopped-dirty-inactive' }
    : { kind: 'skip', reason: 'dirty-no-reclaimable' }
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

function tryExec(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: options.timeout ?? 10_000,
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function parseWorktreeList(text) {
  const worktrees = []
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) }
      worktrees.push(current)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length)
    } else if (current && line === 'detached') {
      current.detached = true
    }
  }
  return worktrees
}

function markerPath(worktreePath) {
  return join(worktreePath, MARKER_RELATIVE_PATH)
}

function readMarker(worktreePath) {
  try {
    return JSON.parse(readFileSync(markerPath(worktreePath), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 「多久没人动过这棵树」——未登记 worktree 唯一能拿到的闲置信号（它没有 marker 的 stoppedAt）。
 * 取几个便宜探针里最新的一个：工作区根、它的 .git（linked worktree 是个指针文件，git 操作会
 * 更新它）、以及各依赖目录（装包/构建会动）。任何一个读不到就当它是刚动过——宁可少清，
 * 不可误删。
 */
function worktreeIdleMs(worktreePath, reclaimableDirs, now) {
  const probes = [worktreePath, join(worktreePath, '.git'), ...reclaimableDirs]
  let newest = Number.NaN
  for (const probe of probes) {
    try {
      const { mtimeMs } = statSync(probe)
      if (!Number.isFinite(newest) || mtimeMs > newest) newest = mtimeMs
    } catch {
      // 探针读不到就跳过；全部读不到时返回 NaN，decideAction 会 fail closed。
    }
  }
  return Number.isFinite(newest) ? now - newest : Number.NaN
}

// 可回收目录 = 装出来的依赖 + 构建出来的产物。两者安全等级相同：都在 .gitignore 里、
// 都从不入库、都能重新生成（`pnpm install` / `pnpm build`），区别只是重建代价。
// 刻意用显式清单而不是解析 .gitignore——ignore 规则里还有日志、缓存、用户导出物等
// 「不该由 janitor 代为决定删不删」的条目，全量套用会把语义从「可再生」偷换成「未跟踪」。
// 清单不许悄悄漂移：node-test 里有一条断言逐个验证它们确实被 .gitignore 覆盖，
// 因此新增一个没被忽略（= 可能是源码）的名字会直接把测试打红。
export const RECLAIMABLE_DIR_NAMES = ['node_modules', 'dist', 'dist-electron', 'dist-local', 'release']

export function findReclaimableDirs(worktreePath) {
  // -prune 命中后不再下潜，所以嵌套在 node_modules 内的 dist 不会被重复列出。
  const nameMatchers = RECLAIMABLE_DIR_NAMES.flatMap((name, index) =>
    index === 0 ? ['-name', name] : ['-o', '-name', name],
  )
  const output = tryExec('find', [worktreePath, '-type', 'd', '(', ...nameMatchers, ')', '-prune', '-print'])
  if (!output) return []
  return output
    .split('\n')
    .filter(Boolean)
    .map((path) => relative(worktreePath, path))
}

function isActive(worktreePath) {
  // An unknown process state fails closed and therefore cannot become a deletion decision.
  try {
    const pids = execFileSync('lsof', ['-t', '+D', worktreePath], {
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return pids.length > 0
  } catch (error) {
    if (error?.status === 1) return false
    return true
  }
}

function activePathSet() {
  const output = tryExec('lsof', ['-Fpn', '-a', '-d', 'cwd,txt'], { timeout: 15_000 })
  if (output === null) return null
  return new Set(
    output
      .split('\n')
      .filter((line) => line.startsWith('n'))
      .map((line) => line.slice(1)),
  )
}

function isPathActive(worktreePath, openPaths) {
  if (!openPaths) return isActive(worktreePath)
  const path = resolve(worktreePath)
  for (const openPath of openPaths) {
    if (openPath === path || openPath.startsWith(`${path}/`)) return true
  }
  return false
}

function worktreeKind(worktreePath, commonRoot) {
  const gitDir = tryGit(worktreePath, ['rev-parse', '--path-format=absolute', '--git-dir'])
  const commonDir = tryGit(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!gitDir || !commonDir || resolve(dirname(commonDir)) !== resolve(commonRoot)) return null
  return resolve(gitDir) === resolve(commonDir) ? 'full-clone' : 'linked-worktree'
}

function getStatus(worktreePath) {
  return tryGit(worktreePath, ['status', '--porcelain', '--untracked-files=all'])
}

function isSiblingFullClone(path, scopeRoot) {
  const root = resolve(scopeRoot)
  const candidate = resolve(path)
  return (
    dirname(candidate) === dirname(root) &&
    candidate !== root &&
    basename(candidate)
      .toLowerCase()
      .startsWith(`${basename(root).toLowerCase()}-`)
  )
}

function markCurrent(worktreePath, scopeRoot = null) {
  const path = resolve(worktreePath)
  const topLevel = tryGit(path, ['rev-parse', '--show-toplevel'])
  const commonDir = tryGit(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const gitDir = tryGit(path, ['rev-parse', '--path-format=absolute', '--git-dir'])
  if (!topLevel || !commonDir || !gitDir) return { marked: false, reason: 'not-git' }

  const commonRoot = resolve(dirname(commonDir))
  const kind = resolve(gitDir) === resolve(commonDir) ? 'full-clone' : 'linked-worktree'
  if (resolve(topLevel) === commonRoot) return { marked: false, reason: 'main-worktree' }

  const requestedScope = scopeRoot ? resolve(scopeRoot) : null
  if (requestedScope) {
    const inScope =
      kind === 'linked-worktree' ? commonRoot === requestedScope : isSiblingFullClone(topLevel, requestedScope)
    if (!inScope) return { marked: false, reason: 'outside-scope' }
  }

  const status = getStatus(path)
  const branch = tryGit(path, ['symbolic-ref', '--short', '-q', 'HEAD']) || null
  const repoRoot = requestedScope || commonRoot
  const marker = {
    kind: 'agent-worktree-lease',
    status: 'stopped',
    worktreeKind: kind,
    stoppedAt: new Date().toISOString(),
    worktreePath: resolve(topLevel),
    repoRoot,
    branch,
    detached: !branch,
    head: tryGit(path, ['rev-parse', 'HEAD']),
    cleanAtStop: !status,
  }
  const destination = markerPath(resolve(topLevel))
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, `${JSON.stringify(marker, null, 2)}\n`)
  return { marked: true, path: resolve(topLevel), repoRoot, kind, clean: !status }
}

function inspectWorktree(repoRoot, entry, now = Date.now(), graceMs = DEFAULT_GRACE_MS, openPaths = null) {
  const path = resolve(entry.path)
  if (!existsSync(path)) return null
  const marker = readMarker(path)
  const stoppedAt = marker?.stoppedAt ? Date.parse(marker.stoppedAt) : NaN
  const status = getStatus(path)
  const reclaimableDirs = findReclaimableDirs(path)
  const kind = worktreeKind(path, repoRoot)
  const managedStop = marker?.kind === 'agent-worktree-lease' && marker.status === 'stopped'
  const staleStop = managedStop && Number.isFinite(stoppedAt) && now - stoppedAt >= graceMs
  const active = isPathActive(path, openPaths) || (staleStop && isActive(path))
  const action = decideAction({
    kind,
    clean: !status,
    active,
    detached: Boolean(entry.detached || marker?.detached || !entry.branch),
    marker,
    markerAgeMs: Number.isFinite(stoppedAt) ? now - stoppedAt : NaN,
    graceMs,
    idleAgeMs: worktreeIdleMs(path, reclaimableDirs, now),
    reclaimableDirs,
  })
  return { ...entry, kind, clean: !status, active, reclaimableDirs, action, marker }
}

function runAction(repoRoot, worktree, action, apply) {
  if (action.kind === 'skip') return
  if (!apply) {
    console.log(`[dry-run] ${action.kind}: ${worktree.path} (${action.reason})`)
    return
  }
  if (action.kind === 'prune-reclaimable') {
    if (worktree.reclaimableDirs.length === 0) return
    execFileSync('git', ['-C', worktree.path, 'clean', '-fdx', '--', ...worktree.reclaimableDirs], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    console.log(`pruned dependencies: ${worktree.path}`)
    return
  }
  if (action.kind === 'remove-worktree') {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktree.path], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    console.log(`removed worktree: ${worktree.path}`)
  }
}

function reapSiblingFullClones(mainRoot, options) {
  const parent = dirname(mainRoot)
  let siblings
  try {
    siblings = readdirSync(parent, { withFileTypes: true })
  } catch {
    return []
  }
  const reports = []
  for (const sibling of siblings) {
    if (!sibling.isDirectory()) continue
    const path = resolve(parent, sibling.name)
    if (!isSiblingFullClone(path, mainRoot) || !existsSync(join(path, '.git'))) continue
    const marker = readMarker(path)
    if (!marker || resolve(marker.repoRoot) !== mainRoot || marker.worktreeKind !== 'full-clone') continue
    const report = inspectWorktree(path, { path }, options.now, options.graceMs, options.openPaths)
    if (!report || report.kind !== 'full-clone') continue
    reports.push(report)
    runAction(path, report, report.action, options.apply)
  }
  return reports
}

export function reap(repoRoot, { apply = false, now = Date.now(), graceMs = DEFAULT_GRACE_MS } = {}) {
  const root = resolve(repoRoot)
  const entries = parseWorktreeList(git(root, ['worktree', 'list', '--porcelain']))
  const mainRoot = resolve(dirname(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])))
  const openPaths = activePathSet()
  const reports = []
  for (const entry of entries) {
    if (resolve(entry.path) === mainRoot) continue
    const marker = readMarker(entry.path)
    if (marker?.repoRoot && resolve(marker.repoRoot) !== mainRoot) continue
    const report = inspectWorktree(mainRoot, entry, now, graceMs, openPaths)
    if (!report) continue
    reports.push(report)
    runAction(mainRoot, report, report.action, apply)
  }
  return reports.concat(reapSiblingFullClones(mainRoot, { apply, now, graceMs, openPaths }))
}

function usage() {
  console.log('usage: agent-worktree-janitor.mjs stop <current-path> [--apply] [repo-root ...]')
  console.log('       agent-worktree-janitor.mjs reap [--apply] [repo-root ...]')
}

function main(argv) {
  const [command, ...rawArgs] = argv
  const apply = rawArgs.includes('--apply')
  const args = rawArgs.filter((arg) => arg !== '--apply')
  if (!['stop', 'reap'].includes(command)) {
    usage()
    return 2
  }
  if (command === 'stop') {
    const currentPath = args.shift()
    if (!currentPath) return (usage(), 2)
    const mark = markCurrent(currentPath, args[0] || null)
    if (mark.marked) console.log(`marked ${mark.kind}: ${mark.path}`)
    const repoRoots = args.length > 0 ? args : mark.repoRoot ? [mark.repoRoot] : []
    for (const repoRoot of repoRoots) reap(repoRoot, { apply })
    return 0
  }
  if (args.length === 0) return (usage(), 2)
  for (const repoRoot of args) reap(repoRoot, { apply })
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2))
