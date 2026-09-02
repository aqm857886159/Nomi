#!/usr/bin/env node
/* global console, process */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MARKER_RELATIVE_PATH = '.claude/agent-worktree-stop.json'
export const DEFAULT_GRACE_MS = 15 * 60 * 1000

export function decideAction({
  kind,
  clean,
  active,
  detached = false,
  marker,
  markerAgeMs,
  graceMs = DEFAULT_GRACE_MS,
  dependencyDirs = [],
}) {
  if (active) return { kind: 'skip', reason: 'active' }
  if (!marker || marker.kind !== 'agent-worktree-lease' || marker.status !== 'stopped') {
    return { kind: 'skip', reason: 'unmanaged' }
  }
  if (!Number.isFinite(markerAgeMs) || markerAgeMs < graceMs) {
    return { kind: 'skip', reason: 'grace-period' }
  }
  if (kind === 'full-clone') {
    return dependencyDirs.length > 0
      ? { kind: 'prune-dependencies', reason: 'full-clone-deps-only' }
      : { kind: 'skip', reason: 'full-clone-protected' }
  }
  if (kind !== 'linked-worktree') return { kind: 'skip', reason: 'unknown-kind' }
  if (detached) {
    return dependencyDirs.length > 0
      ? { kind: 'prune-dependencies', reason: 'detached-deps-only' }
      : { kind: 'skip', reason: 'detached-protected' }
  }
  if (clean) return { kind: 'remove-worktree', reason: 'stopped-clean-inactive' }
  return dependencyDirs.length > 0
    ? { kind: 'prune-dependencies', reason: 'stopped-dirty-inactive' }
    : { kind: 'skip', reason: 'dirty-no-dependencies' }
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

function findDependencyDirs(worktreePath) {
  const output = tryExec('find', [worktreePath, '-type', 'd', '-name', 'node_modules', '-prune', '-print'])
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
  const dependencyDirs = findDependencyDirs(path)
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
    dependencyDirs,
  })
  return { ...entry, kind, clean: !status, active, dependencyDirs, action, marker }
}

function runAction(repoRoot, worktree, action, apply) {
  if (action.kind === 'skip') return
  if (!apply) {
    console.log(`[dry-run] ${action.kind}: ${worktree.path} (${action.reason})`)
    return
  }
  if (action.kind === 'prune-dependencies') {
    if (worktree.dependencyDirs.length === 0) return
    execFileSync('git', ['-C', worktree.path, 'clean', '-fdx', '--', ...worktree.dependencyDirs], {
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
