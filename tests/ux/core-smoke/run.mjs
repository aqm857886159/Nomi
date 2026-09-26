// 核心流程冒烟的跑法（唯一入口：pnpm run test:core-smoke -- --fixture <empty|used|profile-copy>）。
//
// 按「夹具 × 场景 × 用例」逐个起子进程（沿用 canvas-real-suite 的 runCanvasScenario：超时、日志、失败摘要同一套），
// 汇总写到 outputs/core-smoke/<fixture>/summary.json。三条硬规矩：
//   1. 清单先自检（scenarios.mjs）：写了没登记的依赖 → 起进程之前就红（「缺依赖」），不静默跳过。
//   2. 冒烟**不许写已跟踪文件**：跑完 `git status --porcelain` 必须与跑之前一字不差；CI 上还要求两头都为空。
//   3. profile-copy 只在本机：深拷贝用户真实 profile（fs.cpSync，不用硬链接），只在拷贝上跑，跑完删；
//      原库的关键文件跑前跑后比指纹，变了就红（说明有东西写到了原库——或者你同时开着 Nomi，关掉再跑）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REAL_PROFILE_ENV, realNomiProfile } from '../_realProfile.mjs'
import { runCanvasScenario } from '../canvas-real-suite.mjs'
import { checkCoreSmokeScenarios, CORE_SMOKE_FIXTURES, CORE_SMOKE_SCENARIOS, expandCoreSmokeRuns, LOCAL_ONLY_FIXTURES } from './scenarios.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export function parseCoreSmokeArgv(argv) {
  const options = { fixture: null, locale: 'zh-CN' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--fixture') options.fixture = argv[++index]
    else if (arg === '--locale') options.locale = argv[++index]
    else throw new Error(`不认识的参数：${arg}（用法：--fixture <${[...CORE_SMOKE_FIXTURES, ...LOCAL_ONLY_FIXTURES].join('|')}> [--locale zh-CN|en]）`)
  }
  if (!options.fixture) throw new Error(`必须指定 --fixture <${[...CORE_SMOKE_FIXTURES, ...LOCAL_ONLY_FIXTURES].join('|')}>`)
  if (!['zh-CN', 'en'].includes(options.locale)) throw new Error(`--locale 只能是 zh-CN 或 en，收到 ${options.locale}`)
  return options
}

export function gitPorcelain(cwd = repoRoot) {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' })
}

/** 冒烟前后工作树必须一字不差；CI 上两头都得是空的（CI 的检出是干净的，冒烟不许改脏它）。 */
export function checkWorkingTreeUntouched({ before, after, ci }) {
  const problems = []
  if (before !== after) {
    const beforeLines = new Set(before.split('\n').filter(Boolean))
    const changed = after.split('\n').filter((line) => line && !beforeLines.has(line))
    problems.push(`冒烟改动了仓库里的文件（冒烟只许写不跟踪的目录，如 tests/ux/shots、outputs、artifacts）：\n  ${changed.join('\n  ') || '(有文件从脏变回干净——同样说明冒烟写过它)'}`)
  }
  if (ci && after.trim() !== '') problems.push(`CI 上冒烟跑完工作树不干净：\n${after}`)
  return problems
}

// ── profile-copy ──────────────────────────────────────────────
function defaultRealProfile() {
  // 资料目录在哪只问 owner（三平台 + NOMI_REAL_PROFILE_USER_DATA 覆盖口都在那里）。
  const userData = realNomiProfile().userDataDir
  if (!fs.existsSync(userData)) {
    throw new Error(`profile-copy 找不到用户真实资料目录（${userData}）。用 ${REAL_PROFILE_ENV} 指向它`)
  }
  let projectsRoot = process.env.NOMI_REAL_PROFILE_PROJECTS
  if (!projectsRoot) {
    const locationFile = path.join(userData, 'project-location.json')
    const configured = fs.existsSync(locationFile) ? JSON.parse(fs.readFileSync(locationFile, 'utf8')).projectsRoot : null
    projectsRoot = configured || path.join(os.homedir(), 'Documents', 'Nomi Projects')
  }
  return { userData, projectsRoot }
}

function fingerprint(files) {
  // 只用于「跑之前 / 跑之后是否一字不差」这一次相等比较，不当摘要用，所以不必散列。
  return files.map((file) => {
    if (!fs.existsSync(file)) return `${file}:missing`
    const stat = fs.statSync(file)
    return `${file}:${stat.size}:${stat.mtimeMs}`
  }).join('|')
}

function sourceWatchList({ userData, projectsRoot }) {
  const files = ['recent-workspaces.json', 'model-catalog.json', 'preferences.json', ...realNomiProfile().credentialStoreFiles]
    .map((name) => path.join(userData, name))
  if (fs.existsSync(projectsRoot)) {
    for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(path.join(projectsRoot, entry.name, '.nomi', 'project.json'))
    }
  }
  return files.sort()
}

/** 深拷贝（不是硬链接：硬链接会共享 leveldb 锁，也会让拷贝上的写穿透回原库）。用 fs.cpSync 而不是外部 `cp -R`：Windows 上没有 cp。 */
export function prepareProfileCopy(source = defaultRealProfile()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-core-smoke-profile-copy-'))
  const userDataCopy = path.join(root, 'user-data')
  const projectsCopy = path.join(root, 'projects')
  const started = Date.now()
  fs.cpSync(source.userData, userDataCopy, { recursive: true })
  if (fs.existsSync(source.projectsRoot)) fs.cpSync(source.projectsRoot, projectsCopy, { recursive: true })
  else fs.mkdirSync(projectsCopy, { recursive: true })
  for (const name of fs.readdirSync(userDataCopy)) {
    if (/^Singleton|^DevToolsActivePort$/.test(name)) fs.rmSync(path.join(userDataCopy, name), { force: true, recursive: true })
  }
  // 项目表里的路径指向原库——全部改指到拷贝；原库根之外的项目（「打开已有文件夹」那类）直接去掉，绝不让 App 去碰它们。
  const registry = path.join(userDataCopy, 'recent-workspaces.json')
  if (fs.existsSync(registry)) {
    const sourceRoot = path.resolve(source.projectsRoot)
    const entries = JSON.parse(fs.readFileSync(registry, 'utf8'))
    const kept = entries
      .filter((entry) => path.resolve(entry.rootPath).startsWith(`${sourceRoot}${path.sep}`))
      .map((entry) => ({
        ...entry,
        rootPath: path.join(projectsCopy, path.relative(sourceRoot, path.resolve(entry.rootPath))),
        ...(entry.nativeRootPath ? { nativeRootPath: projectsCopy } : {}),
      }))
    fs.writeFileSync(registry, `${JSON.stringify(kept, null, 2)}\n`)
  }
  const locationFile = path.join(userDataCopy, 'project-location.json')
  if (fs.existsSync(locationFile)) fs.rmSync(locationFile)
  console.log(`[core-smoke] profile-copy：已深拷贝 ${source.userData} + ${source.projectsRoot} → ${root}（${Math.round((Date.now() - started) / 1000)}s）`)
  return { root, source, watch: sourceWatchList(source), before: fingerprint(sourceWatchList(source)) }
}

export function runCoreSmoke({ fixture, locale = 'zh-CN', cwd = repoRoot, env = process.env } = {}) {
  const problems = checkCoreSmokeScenarios(CORE_SMOKE_SCENARIOS, { root: cwd })
  if (problems.length) throw new Error(`核心冒烟清单不成立：\n  ${problems.join('\n  ')}`)
  const runs = expandCoreSmokeRuns(fixture)
  const outputDir = path.join(cwd, 'outputs', 'core-smoke', fixture)
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const porcelainBefore = gitPorcelain(cwd)
  const copy = fixture === 'profile-copy' ? prepareProfileCopy() : null
  const results = []
  const startedAt = Date.now()
  try {
    for (const run of runs) {
      console.log(`\n[core-smoke:${fixture}] ${run.id}`)
      results.push({
        ...runCanvasScenario(run, {
          cwd,
          outputDir,
          env: {
            ...env,
            NOMI_CORE_SMOKE_FIXTURE: fixture,
            NOMI_CORE_SMOKE_SCENARIO: run.scenarioId,
            NOMI_CORE_SMOKE_NEEDS: run.needs.join(','),
            NOMI_CORE_SMOKE_LOCALE: locale,
            ...(run.caseId ? { NOMI_CORE_SMOKE_CASE: run.caseId } : {}),
            ...(copy ? { NOMI_CORE_SMOKE_PROFILE_COPY_ROOT: copy.root } : {}),
          },
        }),
        fixture,
        caseId: run.caseId,
      })
    }
  } finally {
    if (copy) fs.rmSync(copy.root, { recursive: true, force: true })
  }
  const invariantProblems = checkWorkingTreeUntouched({ before: porcelainBefore, after: gitPorcelain(cwd), ci: env.CI === 'true' })
  if (copy && fingerprint(copy.watch) !== copy.before) {
    invariantProblems.push(`profile-copy 跑完后原库的关键文件变了（${copy.source.userData} / ${copy.source.projectsRoot}）。要么冒烟写穿到了原库，要么你同时开着 Nomi——关掉 App 再跑一遍确认`)
  }
  const summary = {
    fixture,
    locale,
    durationMs: Date.now() - startedAt,
    passed: results.filter((result) => result.exitCode === 0).length,
    failed: results.filter((result) => result.exitCode !== 0).length,
    invariantProblems,
    results,
  }
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2))
  return summary
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { fixture, locale } = parseCoreSmokeArgv(process.argv.slice(2))
    const summary = runCoreSmoke({ fixture, locale })
    for (const problem of summary.invariantProblems) console.error(`\n✖ ${problem}`)
    const ok = summary.failed === 0 && summary.invariantProblems.length === 0
    console.log(`\ncore-smoke[${fixture}]: ${ok ? 'PASS' : 'FAIL'} (${summary.passed}/${summary.results.length}，${Math.round(summary.durationMs / 1000)}s)`)
    process.exit(ok ? 0 : 1)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
