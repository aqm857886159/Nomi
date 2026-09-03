#!/usr/bin/env node
// 门岗：tests/ evals/ scripts/ 下的 .mjs/.cjs 必须能被解析（`node --check`，硬零、无基线）。
//
// 抓的是一类**零报错地合进 main** 的失效：这三片地**没有任何一道现有门看得见**——
//   · `pnpm run typecheck` 只编 .ts（三份 tsconfig 都不含 .mjs/.cjs）；
//   · `check:test-types` 走 tsconfig.test.json，同样只管 .ts（见 docs/lessons/tests-are-not-typechecked.md）；
//   · `eslint.config.mjs` 的 ignores 里明写着 'tests/ux/**'、'evals/**'、'scripts/**/*'
//     （实测：`pnpm exec eslint tests/ux/mcp-l1-handshake.e2e.mjs` 回 "File ignored…"、exit 0）。
// 于是一个 SyntaxError 能一路绿灯合进 main，直到有人**手动跑**那条走查才炸。
//
// 本门岗的由来（2026-09-02 真事）：一次解冲突在 tests/ux/mcp-l1-handshake.e2e.mjs 里留下重复的
// `const READ_ONLY_TOOL_NAMES` —— 硬 SyntaxError、加载即崩，五门全绿照样放行，直到人工跑 E2E 才发现。
// 走查脚本平时不在每次 push 的验证面上（按风险面触发），所以「坏了但没人跑」能存活很久。
//
// 为什么用 `node --check` 而不是把这三片纳入 eslint：解析是最小充分条件，零配置、零存量债，
// 且用的就是运行时那个解析器（.mjs 按 ESM、.cjs 按 CJS），重复声明/坏括号当场 exit 1。
// 把三片纳入 eslint 是另一个量级的工程（大量存量风格债要还），而这道门今天就能硬零。
// 语义边界（诚实标注）：它只保证**能解析**，不保证类型对、不保证逻辑对——`import` 的目标存不存在
// 它一概不知（那是运行时的事）。它挡的是「加载即崩」这一类，不是走查正确性。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 扫描面 = 版本库里被 eslint 整片 ignore 掉的三个目录（与 check-e2e-launch.mjs 的 SCAN_DIRS 同一套，
 * 那道门是同一片地的先例）。其余 ignore 项要么 gitignored（.pose-lab / .ds-sync / .claude），
 * 要么是被工具直接执行的配置文件（根目录那批 config 后缀的 .mjs —— 坏了当场炸在 lint/build 上，不会静默）。
 */
export const SCAN_DIRS = ['tests', 'evals', 'scripts']

/** 解析器认这两个扩展名：.mjs 走 ESM、.cjs 走 CJS，两边的重复声明都会被抓。 */
export const CHECKED_EXTENSIONS = ['.mjs', '.cjs']

/** 默认并发：串行跑 543 个文件要 ~18s（实测），并发后 ~3s，够便宜才配进 40 节的 gates 链。 */
export const DEFAULT_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length))

/** 遍历目录收集待检文件；跳过 node_modules 与点开头目录（构建/缓存产物，非源码）。 */
export function collectFiles(dir, { fsImpl = fs } = {}) {
  const found = []
  if (!fsImpl.existsSync(dir)) return found
  for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collectFiles(full, { fsImpl }))
    else if (CHECKED_EXTENSIONS.includes(path.extname(entry.name))) found.push(full)
  }
  return found
}

/** 每个扫描目录各自的命中数（用于下面的覆盖不变量）。 */
export function collectByDir(root = repoRoot, dirs = SCAN_DIRS, { fsImpl = fs } = {}) {
  const byDir = new Map()
  for (const dir of dirs) byDir.set(dir, collectFiles(path.join(root, dir), { fsImpl }))
  return byDir
}

/**
 * 覆盖不变量：每个扫描目录都必须至少命中一个文件。
 *
 * 这里**故意不断言总数**（「543 个」这种派生值一写死就会在下次增删文件时假红，而且假红会诱使人
 * 直接改数字、把门岗变成橡皮图章）。要防的是另一件事：遍历器悄悄失效（目录改名、扩展名改了、
 * walk 写错）导致「扫了 0 个文件」还打印一片绿——那种绿和真绿长得一模一样。
 */
export function assertScanCoverage(byDir) {
  const empty = [...byDir.entries()].filter(([, files]) => files.length === 0).map(([dir]) => dir)
  if (empty.length > 0) {
    throw new Error(
      `扫描面失效：${empty.join('、')} 下一个 ${CHECKED_EXTENSIONS.join('/')} 都没扫到。` +
        '目录被改名/移走了，还是遍历器坏了？扫到 0 个还报绿 = 门岗静默失效，故此处 fail-closed。',
    )
  }
}

/** 从 `node --check` 的 stderr 里挑出那一行真正有用的报错（其余是代码摘录与栈）。 */
export function extractParseError(stderr) {
  const lines = String(stderr || '').split('\n')
  const errorLine = lines.find((line) => /^[A-Za-z]*Error:/.test(line.trim()))
  if (errorLine) return errorLine.trim()
  const firstNonEmpty = lines.map((line) => line.trim()).find(Boolean)
  return firstNonEmpty || '解析失败但没有 stderr（不该发生，按失败处理）'
}

/** 对单个文件跑 `node --check`；通过回 null，失败回 { file, message }。 */
export function checkFile(file, { run = execFile, nodePath = process.execPath } = {}) {
  return new Promise((resolve) => {
    run(nodePath, ['--check', file], (error, _stdout, stderr) => {
      if (!error) return resolve(null)
      resolve({ file, message: extractParseError(stderr) })
    })
  })
}

/** 并发跑一批文件，回全部失败项（顺序稳定：按输入顺序排，报告才可复现）。 */
export async function checkFiles(files, { concurrency = DEFAULT_CONCURRENCY, check = checkFile } = {}) {
  const failures = new Map()
  let cursor = 0
  const workerCount = Math.max(1, Math.min(concurrency, files.length))
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < files.length) {
        const index = cursor++
        const failure = await check(files[index])
        if (failure) failures.set(index, failure)
      }
    }),
  )
  return [...failures.entries()].sort(([a], [b]) => a - b).map(([, failure]) => failure)
}

export function formatFailures(failures, root = repoRoot) {
  return failures.map((failure) => `    ${path.relative(root, failure.file)}  ${failure.message}`)
}

export async function main({ root = repoRoot, dirs = SCAN_DIRS, log = console.log } = {}) {
  const byDir = collectByDir(root, dirs)
  assertScanCoverage(byDir)
  const files = [...byDir.values()].flat()
  const failures = await checkFiles(files)

  if (failures.length > 0) {
    log(`✖ 脚本解析门岗未通过：${failures.length} 个 .mjs/.cjs 解析失败（它们加载即崩，但 typecheck / eslint 都看不见）`)
    for (const line of formatFailures(failures, root)) log(line)
    log('  → 本地复跑单个文件：node --check <文件>')
    log('    常见成因：解冲突留下重复的 const/let 声明、括号没配平。两者都是加载即崩，不是运行到一半才炸。')
    return 1
  }
  log(`✅ 脚本解析门岗通过：${files.length} 个 .mjs/.cjs 全部可解析（硬零，无基线）`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(`✖ 脚本解析门岗自身出错（fail-closed）：${error.message}`)
      process.exitCode = 1
    })
}
