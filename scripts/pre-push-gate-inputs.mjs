// 推送前门岗的「输入范围」声明：每道按路径选的门岗，在这里写明自己读哪些根目录、哪些扩展名、哪些固定文件；
// 它的实现依赖（相对 import，传递闭包）不手写，由 implementationFiles() 从入口脚本现读。
// 选择器（pre-push-contracts.mjs 的 selectGates）只用这份声明，不再手写路径正则——
// 10-09 复审实证：选择器与扫描器各写一份路径规则，tokens 漏了 .css 与它的依赖脚本、vocabularies 漏了 .mts / .cts。
// 谁改了扫描器的范围，就改这里；scripts/pre-push-contracts.node-test.mjs 的契约测试拿扫描器实际会读的样例路径喂选择器，漏了就红。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { touchesTypecheck } from './lib/typecheckCoverage.mjs'

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
  // check-store-lifetime.mjs：src 下非测试的 ts / tsx（zustand store 的 declareStoreLifetime 声明与释放点）
  'check:store-lifetime': { roots: ['src'], exts: ['ts', 'tsx'], files: [], entries: ['scripts/check-store-lifetime.mjs'] },
  // check-icon-semantics.mjs：src / electron 下的 .tsx（图标用法）与词典；基线 icon-semantics-baseline.json；设计系统文档里的图标登记表
  'check:icon-semantics': { roots: ['src', 'electron'], exts: ['ts', 'tsx'], files: ['scripts/icon-semantics-baseline.json', 'docs/design/nomi-design-system.md'], entries: ['scripts/check-icon-semantics.mjs'] },
  // check-error-surface.mjs：错误码词表、翻译与键映射，扫 src / electron
  'check:error-surface': { roots: ['src','electron'], exts: ['ts','tsx'], files: ['scripts/error-surface-baseline.json'], entries: ['scripts/check-error-surface.mjs'] },
  // check-heavy-path.mjs：src / electron 下非测试 ts 源
  'check:heavy-path': { roots: ['src','electron'], exts: ['ts','tsx','mts','cts'], files: ['scripts/heavy-path-baseline.json'], entries: ['scripts/check-heavy-path.mjs'] },
  // check-builtin-vendor-literals.mjs：ROOTS = electron、src，扩展名 ts / tsx
  'check:builtin-vendor-literals': { roots: ['electron','src'], exts: ['ts','tsx'], files: [], entries: ['scripts/check-builtin-vendor-literals.mjs'] },
  // check-read-path-writes.mjs：src / electron 的 ts / tsx（AST）
  'check:read-path-writes': { roots: ['src','electron'], exts: ['ts','tsx'], files: ['scripts/read-path-writes-baseline.json'], entries: ['scripts/check-read-path-writes.mjs'] },
  // check-batch-machines.mjs：src / electron 下非测试 ts 源
  'check:batch-machines': { roots: ['src','electron'], exts: ['ts','tsx','mts','cts'], files: ['scripts/batch-machines-baseline.json'], entries: ['scripts/check-batch-machines.mjs'] },
  // check-capability-lifecycle.mjs：组件 useEffect 发布 vs 非组件写入，扫 ts / tsx
  'check:capability-lifecycle': { roots: ['src','electron'], exts: ['ts','tsx'], files: [], entries: ['scripts/check-capability-lifecycle.mjs'] },
  // check-no-default-overwrite.mjs：src / electron / workers 的 ts / tsx（AST）
  'check:no-default-overwrite': { roots: ['src','electron','workers'], exts: ['ts','tsx'], files: ['scripts/no-default-overwrite-baseline.json'], entries: ['scripts/check-no-default-overwrite.mjs'] },
  // check-main-console.mjs：electron 主进程里的 console 调用
  'check:main-console': { roots: ['electron'], exts: ['ts','tsx','mts','cts'], files: [], entries: ['scripts/check-main-console.mjs'] },
  // check-asset-evidence.mjs：electron 下非测试 ts 源
  'check:asset-evidence': { roots: ['electron'], exts: ['ts','tsx','mts','cts'], files: ['scripts/asset-evidence-baseline.json'], entries: ['scripts/check-asset-evidence.mjs'] },
  // check-media-import-owner.mjs：媒体导入口的唯一 owner，扫 electron / src
  'check:media-import-owner': { roots: ['electron','src'], exts: ['ts','tsx'], files: ['scripts/media-import-owner-baseline.json'], entries: ['scripts/check-media-import-owner.mjs'] },
  // check-canvas-edge-writers.mjs：画布领地里谁能直接写 .edges（TS 语法树），扫这四个根目录
  'check:canvas-edge-writers': { roots: ['src/workbench/generationCanvas','src/workbench/project','electron/capabilityCore','electron/shared/canvas'], exts: ['ts','tsx'], files: [], entries: ['scripts/check-canvas-edge-writers.mjs'] },
  // check-storyboard-owner.mjs：src/workbench 下的 ts / tsx（谁直接读 shot.params），2026-10-10 修好 Windows 路径后接入
  'check:storyboard-owner': { roots: ['src/workbench'], exts: ['ts','tsx'], files: [], entries: ['scripts/check-storyboard-owner.mjs'] },
  // check-transport-assembly.mjs：受检接口与它的生产装配点，固定四个 electron/capabilityCore 文件
  'check:transport-assembly': { roots: [], exts: [], files: ['electron/capabilityCore/mcpProtocol.ts','electron/capabilityCore/mcpNodeLauncher.ts','electron/capabilityCore/mcpStdioServer.ts','electron/capabilityCore/mcpHttpServer.ts'], entries: ['scripts/check-transport-assembly.mjs'] },
  // check-spend-confirmation-receipt.mjs：花钱确认收据的受检文件 + 存量基线
  'check:spend-receipt': { roots: [], exts: [], files: ['electron/capabilityCore/mcpGateConfirmation.ts','electron/capabilityCore/mcpSemanticGenerationFlow.ts','electron/capabilityCore/generationDispatcher.ts','scripts/spend-confirmation-receipt-baseline.json'], entries: ['scripts/check-spend-confirmation-receipt.mjs'] },
  // check-dangling-tokens.mjs：src 的 css token 定义与 ts / tsx 里的引用
  'check:dangling-tokens': { roots: ['src'], exts: ['css','ts','tsx'], files: ['tailwind.config.ts'], entries: ['scripts/check-dangling-tokens.mjs'] },
  // check-dangling-tailwind.mjs：tailwind.config.ts 的键 vs src 里的类名
  'check:dangling-tailwind': { roots: ['src'], exts: ['css','ts','tsx'], files: ['tailwind.config.ts','scripts/dangling-tailwind-baseline.json'], entries: ['scripts/check-dangling-tailwind.mjs'] },
  // check-walkthroughs.mjs：tests/ux（含 g1）的走查质量 + src 的 ts / tsx / css（比对类名是否存在）
  'check:walkthroughs': { roots: ['tests/ux','src'], exts: ['mjs','js','ts','tsx','css','json'], files: ['scripts/walkthrough-baseline.json'], entries: ['scripts/check-walkthroughs.mjs'] },
  // check-design-lab.mjs --mirrors-only：实验室注册表 / 基线 / 陈列格 mirrors 行号（任何 src 文件挪了位置都可能让行号越界），3 秒级
  'check:design-lab-mirrors': { roots: ['src', 'tests/ux/design-lab'], exts: ['ts', 'tsx', 'json', 'png', 'mjs'], files: ['docs/design/nomi-design-system.md'], entries: ['scripts/check-design-lab.mjs'] },
  // check-script-network-retry.mjs：扫 scripts 下所有 mjs / cjs / js / ts 源文件里的 gh / git 网络 / 控制面 fetch 调用；共用边界与两份单测一并算输入
  'check:script-network-retry': { roots: ['scripts'], exts: ['mjs','cjs','js','ts','mts','cts'], files: [], entries: ['scripts/check-script-network-retry.mjs', 'scripts/check-script-network-retry.node-test.mjs', 'scripts/lib/transientRetry.node-test.mjs'] },
  // pre-push-structure.node-test.mjs：钩子自己的契约 / 结构用例。读 package.json 的 gates:contracts、门表、输入声明、入口脚本（entries 的 import 闭包已含后三者），还有钩子分发表
  'test:pre-push-structure': { roots: [], exts: [], files: ['package.json', 'scripts/git-hooks.json', 'scripts/install-git-hooks.cjs'], entries: ['scripts/pre-push-structure.node-test.mjs'] },
  // electron/quitLifecycleGuard.test.ts：用仓库的 eslint 配置去 lint 反例，所以 eslint 配置与 electron 下的代码都算输入
  'test:quit-lifecycle-guard': { roots: ['electron'], exts: SOURCE_EXTS, files: ['eslint.config.mjs'], entries: ['electron/quitLifecycleGuard.test.ts'] },
})

const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g
const CANDIDATE_EXTS = ['', '.mjs', '.js', '.cjs', '.mts', '.cts', '.ts', '.tsx', '.jsx', '.json', '/index.mjs', '/index.js', '/index.cjs', '/index.mts', '/index.cts', '/index.ts', '/index.tsx']
// TS 的写法：import './x.js' 实际指向 x.ts（.mjs → .mts，.cjs → .cts）
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }

function resolveImport(fromFile, spec, root) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  const extension = path.posix.extname(base)
  const swapped = (JS_TO_TS[extension] ?? []).map((replacement) => `${base.slice(0, -extension.length)}${replacement}`)
  for (const candidate of [...CANDIDATE_EXTS.map((suffix) => `${base}${suffix}`), ...swapped]) {
    try { if (fs.statSync(path.join(root, candidate)).isFile()) return candidate } catch { /* 下一个候选 */ }
  }
  return null
}

/**
 * 单个文件的相对 import（已解析成仓库相对路径），按 路径 + mtime + 大小 缓存：推送前登记了几十个扫描型守卫测试，
 * 每个的闭包都要走一遍 electron / src 的生产模块，不缓存的话选一次门岗要把同一批文件读几十遍。
 */
const importCache = new Map()
function importsOf(file, root) {
  const absolute = path.join(root, file)
  let stat
  try { stat = fs.statSync(absolute) } catch { return [] }
  const key = `${root}|${file}`
  const cached = importCache.get(key)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.imports
  let text = ''
  try { text = fs.readFileSync(absolute, 'utf8') } catch { return [] }
  const imports = []
  for (const match of text.matchAll(IMPORT)) {
    const resolved = resolveImport(file, match[1], root)
    if (resolved) imports.push(resolved)
  }
  importCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, imports })
  return imports
}

/** 入口脚本 + 它的相对 import 传递闭包（仓库内文件，正斜杠相对路径）。 */
export function implementationFiles(entries, root = repoRoot) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    queue.push(...importsOf(file, root))
  }
  return seen
}

/** 输入范围不手写、从真实正本现算的门岗：typecheck 取自 TYPECHECK_PROJECTS 指向的 tsconfig 实际展开的根文件（scripts/lib/typecheckCoverage.mjs）。 */
export const DERIVED_INPUT_GATES = Object.freeze(['typecheck'])

/** 某道门岗的选择器：改动里有任何一个文件落在它的输入范围里就选中。 */
export function touchesGateInputs(name, changedFiles, root = repoRoot) {
  if (name === 'typecheck') {
    // typecheck 自己的入口脚本及其 import 闭包（typecheck.mjs / check-test-types.mjs / lib/typecheckProjects.mjs）：改了它们 CI 会红，必须选中
    const impl = implementationFiles(['scripts/typecheck.mjs', 'scripts/check-test-types.mjs'], root)
    const normalized = changedFiles.map((file) => file.split(path.win32.sep).join('/'))
    return touchesTypecheck(normalized, root) || normalized.some((file) => impl.has(file))
  }
  const input = GATE_INPUTS[name]
  if (!input) throw new Error(`没有登记输入范围的门岗：${name}`)
  const impl = implementationFiles(input.entries, root)
  const fixed = new Set(input.files)
  return changedFiles.map((file) => file.split(path.win32.sep).join('/')).some((file) => {
    if (fixed.has(file) || impl.has(file)) return true
    const ext = path.posix.extname(file).slice(1)
    return input.exts.includes(ext) && input.roots.some((dir) => file.startsWith(`${dir}/`))
  })
}
