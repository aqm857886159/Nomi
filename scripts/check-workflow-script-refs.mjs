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
import fs from 'node:fs'
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
  if (missing.length > 0) {
    log(`✖ workflow 脚本引用门岗未通过：${missing.length} 处引用了 package.json 里不存在的 script`)
    for (const item of missing) log(`    ${item.file}:${item.line}  pnpm run ${item.script}`)
    log('  → 改名/退役 npm script 时，引用它的 workflow 必须同 commit 跟着改（P1：不留悬空引用）。')
    log('    这类漏网在 PR 上是看不见的——RC/release workflow 不在每个 PR 上跑，会一路绿到发版当天才炸。')
    return 1
  }
  log(`✅ workflow 脚本引用门岗通过：${files.length} 份 workflow、${refCount} 处 \`pnpm run\` 全部解析得到（硬零）`)
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
