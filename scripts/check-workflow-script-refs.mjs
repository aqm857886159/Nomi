#!/usr/bin/env node
// 门岗：`.github/workflows/` 里每一处 `pnpm run <script>` 都必须在 package.json 里解析得到（硬零）。
//
// 抓的是一类**在 PR 上看不见、只在特定流水线跑起来才炸**的失效：把一个 npm script 改名或退役时，
// 引用它的 workflow 没跟着改。PR 的 Quality Gate 不跑 RC / release 那些 workflow，所以一片绿照样合进 main，
// 直到某次发版才发现「pnpm: Command "test:mcp" not found」——那时改动早已远去，排查从零开始。
//
// 本门岗的由来（2026-09-03 真事）：J-MCP1 退役把 `test:mcp` 从 package.json 删掉，
// 也清了文档引用，但漏了 `.github/workflows/desktop-rc.yml:56` 的 `xvfb-run -a pnpm run test:mcp`。
// 退役 PR 的 CI 全绿（RC workflow 只在发布候选时跑），是人工收货逐条核对退役面时才抓出来的。
// 「靠人记得核对」不是结构保证——这道门把它变成机器的事。
//
// 边界（诚实标注）：只校验 `pnpm run <script>` 这一种引用形态。直接 `node scripts/x.mjs` 那类路径引用
// 不在这道门里（它们由 check-e2e-launch / check-walkthroughs 一族按各自语义管），
// `pnpm <script>`（省略 run）也不认——仓库现状全是 `pnpm run`，真出现省略写法时这里会漏，
// 故下面的正则同时接受 `pnpm run x` 与 `pnpm -s run x` 这类插旗写法，避免「换个写法就绕过」。
//
// 第二条（硬零）：workflow 里不许用 `ubuntu-latest` / `macos-latest` / `windows-latest` 这类会漂的机器标签。
// GitHub 换默认镜像是一两个月里分批切的，同一个标签这次分到旧系统、下次分到新系统，
// 于是 PR 上绿、合进 main 后同一项检查红（2026-11-04 真事：ubuntu-latest 开始分到 26.04，
// 项目当时的 Playwright 不支持那上面的 Chromium，main 上 Unit 装浏览器就挂，合并收据红）。
// 写死版本号（ubuntu-24.04 / macos-26 / windows-2025），换系统就成了一次看得见、在 PR 上验过的改动。
//
// 第三条（硬零）：每个机器标签都得有一份**自动跑**的 workflow（push / merge_group / schedule 触发）也在用。
// 写死版本的代价是 GitHub 会按期下线旧镜像；只在发版或手动时才跑的 workflow 若用了一台日常没人用的机器，
// 下线前几周的限时停用和正式下线都没人看见，要到发版当天才炸（2026-11-07 真事：desktop-rc / desktop-preview
// 一直写着 macos-14，GitHub 11-02 下线它，0.24.1 候选包的 Mac 打包一秒被取消；每个 PR 跑的检查早已是 macos-26）。
// 只认 push / merge_group / schedule：pull_request 不算，因为有的 workflow 只在打了标签时才真跑。
import fs from 'node:fs'
import { load } from 'js-yaml'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const WORKFLOW_DIR = '.github/workflows'

/** `pnpm [flags] run <script>`；flags 如 `-s`/`--silent`/`-C dir` 都放行，防「换个写法就绕过」。 */
const PNPM_RUN = /\bpnpm\s+(?:(?:-{1,2}[A-Za-z0-9-]+(?:[= ][^\s]+)?)\s+)*run\s+([A-Za-z0-9:_-]+)/g

export function listWorkflowFiles(root = repoRoot, { fsImpl = fs } = {}) {
  const dir = path.join(root, WORKFLOW_DIR)
  if (!fsImpl.existsSync(dir)) return []
  return fsImpl
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => path.join(dir, name))
    .sort()
}

/** 从一份 workflow 文本里抽出所有被引用的 script 名 + 行号。 */
export function extractScriptRefs(source) {
  const refs = []
  source.split('\n').forEach((line, index) => {
    PNPM_RUN.lastIndex = 0
    let match
    while ((match = PNPM_RUN.exec(line)) !== null) refs.push({ script: match[1], line: index + 1 })
  })
  return refs
}

/** 回所有「引用了但 package.json 里没有」的 script。 */
export function findMissingRefs(files, scripts, { fsImpl = fs, root = repoRoot } = {}) {
  const missing = []
  for (const file of files) {
    for (const ref of extractScriptRefs(fsImpl.readFileSync(file, 'utf8'))) {
      if (!Object.hasOwn(scripts, ref.script)) {
        missing.push({ file: path.relative(root, file), line: ref.line, script: ref.script })
      }
    }
  }
  return missing
}

/** 会漂的机器标签：GitHub 托管机器的 `<系统>-latest`（含 -large / -xlarge 变体）。注释行不算。 */
const FLOATING_RUNNER = /\b(?:ubuntu|macos|windows)-latest(?:-large|-xlarge)?\b/

/** 回所有用了会漂的机器标签的位置。 */
export function findFloatingRunners(files, { fsImpl = fs, root = repoRoot } = {}) {
  const floating = []
  for (const file of files) {
    fsImpl.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const code = line.replace(/(^|\s)#.*$/, '')
      const match = FLOATING_RUNNER.exec(code)
      if (match) floating.push({ file: path.relative(root, file), line: index + 1, label: match[0] })
    })
  }
  return floating
}

/** 会让机器天天被分到的触发方式；只有这些 workflow 用的标签才算「日常有人在用」。 */
const AUTOMATIC_TRIGGERS = new Set(['push', 'merge_group', 'schedule'])

/** workflow 的触发方式名单。`on:` 可以是字符串、数组或对象三种写法。 */
export function workflowTriggers(source) {
  const on = (load(source) ?? {}).on
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.map(String)
  if (on && typeof on === 'object') return Object.keys(on)
  return []
}

const RUNS_ON = /^\s*runs-on:\s*["']?([A-Za-z0-9._-]+)["']?\s*(?:#.*)?$/

/** 回所有用了「没有任何自动跑的 workflow 在用」的机器标签的位置。表达式和数组写法的 runs-on 不在此列。 */
export function findUnexercisedRunners(files, { fsImpl = fs, root = repoRoot } = {}) {
  const exercised = new Set()
  const uses = []
  for (const file of files) {
    const source = fsImpl.readFileSync(file, 'utf8')
    const automatic = workflowTriggers(source).some((trigger) => AUTOMATIC_TRIGGERS.has(trigger))
    source.split('\n').forEach((line, index) => {
      const match = RUNS_ON.exec(line)
      if (!match) return
      if (automatic) exercised.add(match[1])
      uses.push({ file: path.relative(root, file), line: index + 1, label: match[1] })
    })
  }
  return uses.filter((use) => !exercised.has(use.label))
}

/**
 * 覆盖不变量：至少要扫到一份 workflow、且至少解析出一处引用。
 * 不断言具体条数（派生值写死会在下次增删 workflow 时假红，而假红会诱人直接改数字）；
 * 要防的是正则/遍历悄悄失效后「扫到 0 处引用」还报一片绿——那种绿和真绿长得一样。
 */
export function assertScanCoverage(fileCount, refCount) {
  if (fileCount === 0) throw new Error(`扫描面失效：${WORKFLOW_DIR} 下一份 workflow 都没读到`)
  if (refCount === 0) {
    throw new Error(
      `扫描面失效：${fileCount} 份 workflow 里一处 \`pnpm run\` 都没解析出来——正则坏了还是引用写法变了？` +
        '解析到 0 处还报绿 = 门岗静默失效，故 fail-closed。',
    )
  }
}

export function main({ root = repoRoot, log = console.log } = {}) {
  const files = listWorkflowFiles(root)
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {}
  const refCount = files.reduce((sum, file) => sum + extractScriptRefs(fs.readFileSync(file, 'utf8')).length, 0)
  assertScanCoverage(files.length, refCount)

  const missing = findMissingRefs(files, scripts, { root })
  const floating = findFloatingRunners(files, { root })
  const unexercised = findUnexercisedRunners(files, { root })
  if (missing.length > 0) {
    log(`✖ workflow 脚本引用门岗未通过：${missing.length} 处引用了 package.json 里不存在的 script`)
    for (const item of missing) log(`    ${item.file}:${item.line}  pnpm run ${item.script}`)
    log('  → 改名/退役 npm script 时，引用它的 workflow 必须同 commit 跟着改（P1：不留悬空引用）。')
    log('    这类漏网在 PR 上是看不见的——RC/release workflow 不在每个 PR 上跑，会一路绿到发版当天才炸。')
  }
  if (floating.length > 0) {
    log(`✖ workflow 机器标签门岗未通过：${floating.length} 处用了会漂的 -latest 标签`)
    for (const item of floating) log(`    ${item.file}:${item.line}  ${item.label}`)
    log('  → 写死版本（ubuntu-24.04 / macos-26 / windows-2025）。-latest 会被 GitHub 分批换成新系统，')
    log('    同一项检查 PR 上分到旧系统是绿的、合进 main 分到新系统就红。')
  }
  if (unexercised.length > 0) {
    log(`✖ workflow 机器标签门岗未通过：${unexercised.length} 处用的机器没有任何自动跑的 workflow 在用`)
    for (const item of unexercised) log(`    ${item.file}:${item.line}  ${item.label}`)
    log('  → 换成 push / merge_group / schedule 触发的 workflow 里在用的那台机器。')
    log('    日常没人用的机器被 GitHub 下线时没人看得见，只在发版 / 手动时才跑的 workflow 要到那天才炸。')
  }
  if (missing.length > 0 || floating.length > 0 || unexercised.length > 0) return 1
  log(`✅ workflow 脚本引用门岗通过：${files.length} 份 workflow、${refCount} 处 \`pnpm run\` 全部解析得到，机器标签全部写死版本且日常有 workflow 在用（硬零）`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`✖ workflow 脚本引用门岗自身出错（fail-closed）：${error.message}`)
    process.exitCode = 1
  }
}
