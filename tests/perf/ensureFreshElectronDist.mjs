import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_SOURCE_ROOTS = ['electron']
const DEFAULT_SOURCE_FILES = [
  'scripts/build-electron.mjs',
  'scripts/electron-build-artifacts.mjs',
  'scripts/write-intake-config.mjs',
]
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/

/** 递归找出目录树里最新源码文件的 mtimeMs（跳过隐藏目录、node_modules 与测试文件）。 */
export function newestSourceMtimeMs(repoRoot, sourceRoots = DEFAULT_SOURCE_ROOTS, sourceFiles = DEFAULT_SOURCE_FILES) {
  let newest = 0
  const visitFile = (filePath) => {
    try {
      const { mtimeMs } = fs.statSync(filePath)
      if (mtimeMs > newest) newest = mtimeMs
    } catch {
      // 文件不存在时忽略
    }
  }
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && !TEST_FILE_RE.test(entry.name)) {
        visitFile(full)
      }
    }
  }
  for (const root of sourceRoots) walk(path.join(repoRoot, root))
  for (const file of sourceFiles) visitFile(path.join(repoRoot, file))
  return newest
}

/**
 * 判断 dist-electron 产物是否缺失或比任一源码旧。
 * 只要任一必需产物缺失、或源码最新 mtimeMs 严格大于最旧必需产物的 mtimeMs，就返回 true。
 */
export function isElectronDistStale({
  repoRoot,
  requiredArtifacts,
  sourceRoots = DEFAULT_SOURCE_ROOTS,
  sourceFiles = DEFAULT_SOURCE_FILES,
}) {
  let oldestArtifact = Infinity
  for (const rel of requiredArtifacts) {
    const full = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel)
    try {
      const { mtimeMs } = fs.statSync(full)
      if (mtimeMs < oldestArtifact) oldestArtifact = mtimeMs
    } catch {
      return true
    }
  }
  if (!Number.isFinite(oldestArtifact)) return true
  return newestSourceMtimeMs(repoRoot, sourceRoots, sourceFiles) > oldestArtifact
}

/** 产物缺失或过期时自动跑 scripts/build-electron.mjs 重建，避免性能量具静默读到旧代码。 */
export function ensureFreshElectronDist({
  repoRoot,
  requiredArtifacts,
  sourceRoots = DEFAULT_SOURCE_ROOTS,
  sourceFiles = DEFAULT_SOURCE_FILES,
  rebuild = () => {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build-electron.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  },
}) {
  if (!isElectronDistStale({ repoRoot, requiredArtifacts, sourceRoots, sourceFiles })) return false
  rebuild()
  return true
}
