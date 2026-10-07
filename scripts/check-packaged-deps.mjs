#!/usr/bin/env node
// 随包依赖门岗 check:packaged-deps（contracts，静态，不用打包；2026-09-28 发版审计 A）。
//
// 判据：package.json 的 `dependencies` 里每个包都要有「主进程运行时要它」的证据，没有证据的挪进
// `devDependencies`；主进程产物要的包也必须在 `dependencies` 里。
//
// ── 为什么要这道门 ──
// electron-builder 把 `dependencies` 连同传递依赖整包装进 app.asar，`files` 怎么配都拦不住；
// `devDependencies` 不装。界面用的库早被 Vite 打进 dist/assets，留在 dependencies 里就是原样多装一份：
// 0.22.4 Windows 版 app.asar 654MB，界面代码本身只有 30MB（docs/plan/2026-09-28-release-audit.md §1）。
//
// ── 证据从哪来（三类，缺一类就会把运行时要的包判成多余）──
// ① 主进程与 preload 的构建产物：用 build:electron 的同一组 tsconfig 在**内存里** emit（与 dist-electron
//   同源），再用 scripts/lib/moduleReferences.mjs 读每个产物的 require / import / import() / resolve。
//   · 不读盘上的 dist-electron：门岗不许依赖「先 build 过」，盘上那份也可能是别的分支留下的旧产物。
//   · 扫**全部**产物，不从 main.js 顺导入图走：第二个 preload、createRequire 别名、按路径加载的文件
//     在导入图里看不见，少算一个就是装机版 `Cannot find module`；多算最多让包里多留一个库。
//   · 字面量里按名字提到某个依赖（`'node_modules', 'onnxruntime-web'` 这种）也算证据，单列 mention 供人核对。
// ② runtimeAllowlist（docs/engineering/package-budget.json）：按路径加载二进制/资产的包，每条带理由与出处。
// ③ 已随包的包声明的非可选 peerDependencies：electron-builder 只跟 dependencies/optionalDependencies，
//   不跟 peer（app-builder-lib 的 pnpmNodeModulesCollector 只取 manifest 里这两项），peer 只能由我们的
//   dependencies 带进包里。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { externalPackageOf, loadTypeScript, mentionedPackage, scanModuleReferences } from './lib/moduleReferences.mjs'

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BUDGET_FILE = 'docs/engineering/package-budget.json'
/** build:electron 编的两个工程（scripts/build-electron.mjs）：CommonJS 宿主 + NodeNext 的 pi 岛。 */
export const ELECTRON_BUILD_CONFIGS = Object.freeze(['electron/tsconfig.json', 'electron/tsconfig.pi.json'])

function formatDiagnostic(ts, diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

/**
 * 按 build:electron 的配置在内存里 emit 主进程产物。返回 Map<相对 dist-electron 的路径, JS 文本>。
 * 类型错误不在这里管（那是 typecheck 的事），所以关掉 noEmitOnError：要的是「会产出什么」。
 */
export function emitMainProcessBuild(rootDir, { ts = loadTypeScript(), configs = ELECTRON_BUILD_CONFIGS } = {}) {
const files = new Map()
  for (const config of configs) {
    const configPath = path.join(rootDir, config)
    const fatal = []
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => fatal.push(formatDiagnostic(ts, diagnostic)),
    })
    if (!parsed || fatal.length > 0 || parsed.errors.length > 0) {
      const messages = [...fatal, ...(parsed?.errors ?? []).map((diagnostic) => formatDiagnostic(ts, diagnostic))]
      throw new Error(`读不了 ${config}：${messages.join('; ')}`)
    }
    const options = {
      ...parsed.options,
      noEmit: false,
      noEmitOnError: false,
      sourceMap: false,
      inlineSourceMap: false,
      declaration: false,
      declarationMap: false,
      incremental: false,
      composite: false,
    }
    const outDir = options.outDir
    if (!outDir) throw new Error(`${config} 没有 outDir，推不出产物路径`)
    const program = ts.createProgram({ rootNames: parsed.fileNames, options, projectReferences: parsed.projectReferences })
    program.emit(undefined, (fileName, text) => {
      if (!/\.[cm]?js$/.test(fileName)) return
      files.set(path.relative(outDir, fileName).split(path.sep).join('/'), text)
    })
  }
  if (files.size === 0) throw new Error('主进程一个产物都没 emit 出来——配置或路径错了，门岗不能在空集上判绿')
  return files
}

function push(map, key, value) {
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

/** 从 fromDir 起按 Node 的规则往上找 node_modules/<name>；返回真实目录与 manifest，找不到返回 null。 */
export function resolveInstalledPackage(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const manifestPath = path.join(dir, 'node_modules', ...name.split('/'), 'package.json')
    if (fs.existsSync(manifestPath)) {
      const packageDir = fs.realpathSync(path.dirname(manifestPath))
      return { dir: packageDir, manifest: JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function requiredPeers(manifest) {
  const meta = manifest.peerDependenciesMeta ?? {}
  return Object.keys(manifest.peerDependencies ?? {}).filter((name) => meta[name]?.optional !== true)
}

/** 从已判定随包的依赖出发，沿安装树走传递闭包，收集闭包里每个包的非可选 peer。 */
export function collectRequiredPeers(rootNames, { rootDir, resolvePackage = resolveInstalledPackage }) {
  const peers = new Map() // peer → [声明它的包]
  const visited = new Set()
  const queue = rootNames.map((name) => ({ name, from: rootDir }))
  while (queue.length > 0) {
    const { name, from } = queue.shift()
    const installed = resolvePackage(name, from)
    if (!installed || visited.has(installed.dir)) continue
    visited.add(installed.dir)
    for (const peer of requiredPeers(installed.manifest)) push(peers, peer, installed.manifest.name ?? name)
    const children = { ...installed.manifest.optionalDependencies, ...installed.manifest.dependencies }
    for (const child of Object.keys(children)) queue.push({ name: child, from: installed.dir })
  }
  return peers
}

/**
 * allowlist 的出处必须是真话：文件在、文件里提到这个包；行号漂移只提示，不判红
 * （行号是给人跳转用的，同一文件里加一行 import 不该让 contracts 变红）。
 */
export function validateAllowlist(allowlist, { rootDir, dependencyNames }) {
  const problems = []
  const warnings = []
  for (const [name, entry] of Object.entries(allowlist)) {
    if (!dependencyNames.has(name)) problems.push(`${name}：在 runtimeAllowlist 里却不在 dependencies——条目过期了就删掉，真要随包就放回 dependencies`)
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push(`${name}：runtimeAllowlist 条目缺 reason`)
    if (!Array.isArray(entry?.evidence) || entry.evidence.length === 0) {
      problems.push(`${name}：runtimeAllowlist 条目缺 evidence（写 file:line，指到按路径加载它的那一行）`)
      continue
    }
    for (const cite of entry.evidence) {
      const match = /^(.+):(\d+)$/.exec(String(cite))
      if (!match) {
        problems.push(`${name}：出处「${cite}」不是 file:line`)
        continue
      }
      const file = path.join(rootDir, match[1])
      if (!fs.existsSync(file)) {
        problems.push(`${name}：出处文件 ${match[1]} 不存在`)
        continue
      }
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      const hits = lines.flatMap((line, index) => (line.includes(name) ? [index + 1] : []))
      if (hits.length === 0) problems.push(`${name}：出处文件 ${match[1]} 里根本没提到这个包——理由已经不成立了`)
      else if (!hits.includes(Number(match[2]))) warnings.push(`${name}：出处 ${cite} 这一行没提到它，现在在第 ${hits.join('、')} 行`)
    }
  }
  return { problems, warnings }
}

/**
 * 纯判定：给定产物文本、manifest 与预算文件，给出每个依赖的证据与判词。
 * resolvePackage 可注入（单测用假安装树）。
 */
export function analyzePackagedDeps({ rootDir = DEFAULT_ROOT, packageJson, budget, emitted, ts = loadTypeScript(), resolvePackage = resolveInstalledPackage }) {
  const dependencyNames = new Set(Object.keys(packageJson.dependencies ?? {}))
  const declaredNames = new Set([...dependencyNames, ...Object.keys(packageJson.devDependencies ?? {})])
  const allowlist = budget?.runtimeAllowlist && typeof budget.runtimeAllowlist === 'object' ? budget.runtimeAllowlist : {}
  const imports = new Map()
  const mentions = new Map()
  const dynamicLoads = []

  for (const [file, text] of [...emitted.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const where = (line) => `dist-electron/${file}:${line}`
    const { references, unresolved, literals } = scanModuleReferences(file, text, ts)
    for (const reference of references) {
      const name = externalPackageOf(reference.specifier)
      if (name) push(imports, name, { where: where(reference.line), kind: reference.kind, specifier: reference.specifier })
    }
    for (const load of unresolved) dynamicLoads.push({ where: where(load.line), kind: load.kind, expression: load.expression })
    for (const literal of literals) {
      const name = mentionedPackage(literal.value, declaredNames)
      if (name) push(mentions, name, { where: where(literal.line), value: literal.value })
    }
  }

  const evidence = new Map() // dependency → [{ via, detail }]
  for (const name of dependencyNames) {
    if (imports.has(name)) for (const hit of imports.get(name)) push(evidence, name, { via: hit.kind === 'resolve' ? 'resolve' : 'import', detail: hit.where })
    if (allowlist[name]) push(evidence, name, { via: 'allowlist', detail: allowlist[name].reason })
    if (mentions.has(name)) for (const hit of mentions.get(name)) push(evidence, name, { via: 'mention', detail: hit.where })
  }
  // peer 要迭代到不动点：peer 带进来的包也会带自己的 peer。
  const requiredPeers = new Map()
  for (let changed = true; changed;) {
    changed = false
    const peers = collectRequiredPeers([...evidence.keys()], { rootDir, resolvePackage })
    for (const [peer, owners] of peers) {
      requiredPeers.set(peer, owners)
      if (dependencyNames.has(peer) && !(evidence.get(peer) ?? []).some((item) => item.via === 'peer')) {
        for (const owner of owners) push(evidence, peer, { via: 'peer', detail: `${owner} 的 peerDependencies` })
        changed = true
      }
    }
  }

  const unused = [...dependencyNames].filter((name) => !evidence.has(name)).sort()
  const missing = [...imports.keys()].filter((name) => !dependencyNames.has(name)).sort()
    .map((name) => ({ name, declaredAs: declaredNames.has(name) ? 'devDependencies' : '未声明', sites: imports.get(name).map((hit) => hit.where) }))
  const missingPeers = [...requiredPeers.entries()].filter(([peer]) => !dependencyNames.has(peer)).sort(([a], [b]) => a.localeCompare(b))
    .map(([peer, owners]) => ({ name: peer, requiredBy: [...new Set(owners)].sort() }))
  const allowlistCheck = validateAllowlist(allowlist, { rootDir, dependencyNames })
  return {
    ok: unused.length === 0 && missing.length === 0 && missingPeers.length === 0 && allowlistCheck.problems.length === 0,
    scannedFiles: emitted.size,
    dependencies: Object.fromEntries([...evidence.entries()].sort(([a], [b]) => a.localeCompare(b))),
    unused,
    missing,
    missingPeers,
    allowlistProblems: allowlistCheck.problems,
    allowlistWarnings: allowlistCheck.warnings,
    dynamicLoads,
  }
}

function summarizeEvidence(items) {
  const byVia = new Map()
  for (const item of items) push(byVia, item.via, item.detail)
  return [...byVia.entries()].map(([via, details]) => `${via}：${details[0]}${details.length > 1 ? ` 等 ${details.length} 处` : ''}`).join('；')
}

export function formatReport(report) {
  const lines = [`check:packaged-deps：扫了 ${report.scannedFiles} 个主进程产物；dependencies 里有证据的 ${Object.keys(report.dependencies).length} 个`]
  for (const [name, items] of Object.entries(report.dependencies)) lines.push(`  ✓ ${name} — ${summarizeEvidence(items)}`)
  if (report.dynamicLoads.length > 0) {
    lines.push(`  ℹ 参数不是字面量的加载 ${report.dynamicLoads.length} 处（静态看不出要哪个包；按路径加载的包要进 runtimeAllowlist）：`)
    for (const load of report.dynamicLoads) lines.push(`      ${load.where}  ${load.expression}`)
  }
  for (const warning of report.allowlistWarnings) lines.push(`  ⚠ ${warning}`)
  if (report.unused.length > 0) {
    lines.push(`❌ dependencies 里有 ${report.unused.length} 个包找不到任何运行时证据（electron-builder 会把它们原样装进安装包）：`)
    for (const name of report.unused) lines.push(`   · ${name}`)
    lines.push('   → 只在界面用、Vite 已经打进 dist 的，挪进 devDependencies；主进程按路径加载的，登记进', `     ${BUDGET_FILE} 的 runtimeAllowlist（写 reason 与 evidence 的 file:line）。`)
  }
  if (report.missing.length > 0) {
    lines.push(`❌ 主进程产物要的包不在 dependencies（开发态能跑，装机版会 Cannot find module）：`)
    for (const item of report.missing) lines.push(`   · ${item.name}（现在在 ${item.declaredAs}）← ${item.sites.slice(0, 3).join('、')}`)
  }
  if (report.missingPeers.length > 0) {
    lines.push('❌ 随包的库声明了非可选 peer，但 dependencies 里没有（electron-builder 不跟 peer，装机版会缺）：')
    for (const item of report.missingPeers) lines.push(`   · ${item.name} ← ${item.requiredBy.join('、')}`)
  }
  for (const problem of report.allowlistProblems) lines.push(`❌ ${problem}`)
  if (report.ok) lines.push('✅ dependencies 与主进程运行时证据一致')
  return lines.join('\n')
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') options.root = path.resolve(argv[++index])
    else if (arg === '--json') options.json = true
    else throw new Error(`不认识的参数：${arg}（用法：node scripts/check-packaged-deps.mjs [--root <dir>] [--json]）`)
  }
  return options
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const packageJson = JSON.parse(fs.readFileSync(path.join(options.root, 'package.json'), 'utf8'))
  const budget = JSON.parse(fs.readFileSync(path.join(options.root, BUDGET_FILE), 'utf8'))
  const report = analyzePackagedDeps({ rootDir: options.root, packageJson, budget, emitted: emitMainProcessBuild(options.root) })
  console.log(`scanned=${report.scannedFiles}`)
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`)
  return report.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`❌ check:packaged-deps 跑不起来：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
