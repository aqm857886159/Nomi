// 「改了哪些文件会真被整库类型检查编译」——从真实的 tsconfig（TYPECHECK_PROJECTS）现算，不手写目录清单。
// 被选中 = 一定在某个 program 的根文件里；不在任何 program 里的文件（tests/ux 的 tsx、evals 非 test、packages、workers 等）
// 诚实地不选中 typecheck，而不是假装覆盖（见 scripts/pre-push-gate-table.mjs 的 TYPECHECK_NOT_COVERED）。
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { TYPECHECK_PROJECTS, TYPECHECK_SHARED_CONFIGS } from './typecheckProjects.mjs'

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const cache = new Map()

/** 某份 tsconfig 实际展开的根文件（相对仓库根、正斜杠）。读不了 / 解析出错 = 抛错（宁可阻断，不当没有）。 */
export function programRootFiles(configRel, root = defaultRoot) {
  const ts = createRequire(import.meta.url)('typescript')
  const configPath = path.join(root, configRel)
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) throw new Error(`读不了 ${configRel}：${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), undefined, configPath)
  return parsed.fileNames.map((file) => path.relative(root, file).split(path.sep).join('/'))
}

/** 所有 program 的根文件并集 + 配置文件本身 + 公共配置（现算，进程内缓存）。 */
export function typecheckCoveredFiles(root = defaultRoot) {
  const key = path.resolve(root)
  if (!cache.has(key)) {
    const covered = new Set([...Object.values(TYPECHECK_PROJECTS), ...TYPECHECK_SHARED_CONFIGS])
    for (const config of Object.values(TYPECHECK_PROJECTS)) for (const file of programRootFiles(config, root)) covered.add(file)
    cache.set(key, covered)
  }
  return cache.get(key)
}

export function clearTypecheckCoverageCache() {
  cache.clear()
}

/** 这些文件的存在与否会影响类型检查结果，但不是 tsc 的根文件：依赖版本、棘轮基线。 */
export const TYPECHECK_SIDE_INPUTS = Object.freeze(['package.json', 'pnpm-lock.yaml', 'scripts/test-types-baseline.json'])

export function touchesTypecheck(changedFiles, root = defaultRoot) {
  const sideInputs = new Set(TYPECHECK_SIDE_INPUTS)
  const candidates = changedFiles.filter((file) => /\.(?:ts|tsx|mts|cts|json|yaml)$/.test(file))
  if (candidates.length === 0) return false
  if (candidates.some((file) => sideInputs.has(file))) return true
  const covered = typecheckCoveredFiles(root)
  return candidates.some((file) => covered.has(file))
}
