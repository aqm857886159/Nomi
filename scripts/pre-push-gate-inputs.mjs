// 推送前门岗的「输入范围」声明：每道按路径选的门岗，在这里写明自己读哪些根目录、哪些扩展名、哪些固定文件；
// 它的实现依赖（相对 import，传递闭包）不手写，由 implementationFiles() 从入口脚本现读。
// 选择器（pre-push-contracts.mjs 的 selectGates）只用这份声明，不再手写路径正则——
// 10-09 复审实证：选择器与扫描器各写一份路径规则，tokens 漏了 .css 与它的依赖脚本、vocabularies 漏了 .mts / .cts。
// 谁改了扫描器的范围，就改这里；scripts/pre-push-contracts.node-test.mjs 的契约测试拿扫描器实际会读的样例路径喂选择器，漏了就红。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE_EXTS = ['ts', 'tsx', 'mts', 'cts']

/**
 * roots + exts：目录下该扩展名的任何文件都算输入；files：固定文件（含数据 / 基线）；entries：入口脚本，
 * 它和它的相对 import 闭包（实现依赖）也算输入。
 */
export const GATE_INPUTS = Object.freeze({
  // check-design-tokens.mjs：src 的 ts/tsx（禁用值扫描），以及 src / electron / tailwind.config.ts 的 ts tsx css mjs（color-mix 色相漂移扫描）
  'check:tokens': { roots: ['src', 'electron'], exts: [...SOURCE_EXTS, 'css', 'mjs'], files: ['tailwind.config.ts'], entries: ['scripts/check-design-tokens.mjs'] },
  // check-vocabularies-scan.mjs：src / electron 下的 ts tsx mts cts；基线 scripts/vocabularies-baseline.json
  'check:vocabularies': { roots: ['src', 'electron'], exts: SOURCE_EXTS, files: ['scripts/vocabularies-baseline.json'], entries: ['scripts/check-vocabularies.mjs'] },
  // check-control-contract.mjs：src 下的 .tsx（不含测试）；文案存量 scripts/control-copy-baseline.json
  'check:controls': { roots: ['src'], exts: ['tsx'], files: ['scripts/control-copy-baseline.json'], entries: ['scripts/check-control-contract.mjs'] },
  // check-test-temp-static.node-test.mjs：scripts 与 tests 下的 mjs / js / ts 测试与走查
  'test:temp-helper': { roots: ['scripts', 'tests'], exts: ['mjs', 'js', 'cjs', 'ts'], files: [], entries: ['scripts/check-test-temp-static.node-test.mjs'] },
  // check-test-copy-literals.mjs：src electron scripts tests evals packages 下的测试 / 走查文件，加词典（src/i18n、electron/desktopStrings 在这些根里）
  'check:test-copy-literals': { roots: ['src', 'electron', 'scripts', 'tests', 'evals', 'packages'], exts: [...SOURCE_EXTS, 'js', 'mjs', 'cjs', 'json'], files: [], entries: ['scripts/check-test-copy-literals.mjs'] },
  // check-control-contract.test.mjs：规则红绿证明，只依赖规则脚本本身
  'test:control-contract': { roots: [], exts: [], files: [], entries: ['scripts/check-control-contract.test.mjs'] },
  // electron/quitLifecycleGuard.test.ts：用仓库的 eslint 配置去 lint 反例，所以 eslint 配置与 electron 下的代码都算输入
  'test:quit-lifecycle-guard': { roots: ['electron'], exts: SOURCE_EXTS, files: ['eslint.config.mjs'], entries: ['electron/quitLifecycleGuard.test.ts'] },
})

const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g
const CANDIDATE_EXTS = ['', '.mjs', '.js', '.cjs', '.ts', '.tsx', '/index.mjs', '/index.ts']

function resolveImport(fromFile, spec, root) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  for (const suffix of CANDIDATE_EXTS) {
    const candidate = `${base}${suffix}`
    try { if (fs.statSync(path.join(root, candidate)).isFile()) return candidate } catch { /* 下一个候选 */ }
  }
  return null
}

/** 入口脚本 + 它的相对 import 传递闭包（仓库内文件，正斜杠相对路径）。 */
export function implementationFiles(entries, root = repoRoot) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    let text = ''
    try { text = fs.readFileSync(path.join(root, file), 'utf8') } catch { continue }
    for (const match of text.matchAll(IMPORT)) {
      const resolved = resolveImport(file, match[1], root)
      if (resolved) queue.push(resolved)
    }
  }
  return seen
}

/** 某道门岗的选择器：改动里有任何一个文件落在它的输入范围里就选中。 */
export function touchesGateInputs(name, changedFiles, root = repoRoot) {
  const input = GATE_INPUTS[name]
  if (!input) throw new Error(`没有登记输入范围的门岗：${name}`)
  const impl = implementationFiles(input.entries, root)
  const fixed = new Set(input.files)
  return changedFiles.some((file) => {
    if (fixed.has(file) || impl.has(file)) return true
    const ext = path.posix.extname(file).slice(1)
    return input.exts.includes(ext) && input.roots.some((dir) => file.startsWith(`${dir}/`))
  })
}
