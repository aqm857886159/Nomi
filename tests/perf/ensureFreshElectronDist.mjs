import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { sourceIdentity } from '../../scripts/package-build-stamp.mjs'

const DEFAULT_STAMP_REL = path.join('dist-electron', '.source-tree')

function resolvePath(repoRoot, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath)
}

function readRecordedTree(stampPath) {
  try {
    return fs.readFileSync(stampPath, 'utf8').trim()
  } catch {
    return null
  }
}

function artifactsExist(repoRoot, requiredArtifacts) {
  return requiredArtifacts.every((rel) => fs.existsSync(resolvePath(repoRoot, rel)))
}

/**
 * 复用仓库唯一的源码指纹主人 `package-build-stamp.mjs#sourceIdentity` 判断 dist-electron 是否过期：
 * 任一必需产物缺失、未写戳、或记录的源码 tree 哈希与当前工作区不一致，即判定过期。
 */
export function isElectronDistStale({
  repoRoot,
  requiredArtifacts,
  stampFile = DEFAULT_STAMP_REL,
  computeTree = (dir) => sourceIdentity(dir).tree,
}) {
  if (!artifactsExist(repoRoot, requiredArtifacts)) return true
  const recorded = readRecordedTree(resolvePath(repoRoot, stampFile))
  if (!recorded) return true
  return recorded !== computeTree(repoRoot)
}

/**
 * 产物缺失或源码 tree 变化时自动跑 `scripts/build-electron.mjs` 重建并写下最新 tree 戳，
 * 避免性能量具静默读到过期 `dist-electron` 产物。
 */
export function ensureFreshElectronDist({
  repoRoot,
  requiredArtifacts,
  stampFile = DEFAULT_STAMP_REL,
  computeTree = (dir) => sourceIdentity(dir).tree,
  rebuild = () => {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build-electron.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  },
}) {
  const stampPath = resolvePath(repoRoot, stampFile)
  const currentTree = computeTree(repoRoot)
  if (artifactsExist(repoRoot, requiredArtifacts) && readRecordedTree(stampPath) === currentTree) {
    return false
  }
  rebuild()
  fs.mkdirSync(path.dirname(stampPath), { recursive: true })
  fs.writeFileSync(stampPath, `${currentTree}\n`, 'utf8')
  return true
}
