// 本机只回答相对 merge-base 的变化；Playwright 负责所有像素比较。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { LAB_SCREEN_IDS, pendingApprovalScreens, readLabStates } from './labStates.mjs'
import { labChildEnv } from './labServer.mjs'
import { collectDiffImages, formatLabFailure, triageLabRun } from './failureTriage.mjs'

export function cacheKey(inputs) {
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
}

function gitCommand(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `git ${args[0]} failed`)
  return result.stdout.trim()
}

export async function withBaselineSource({ repoRoot, commit, tempRoot, git = gitCommand }, render) {
  const container = fs.mkdtempSync(path.join(tempRoot, 'source-'))
  const source = path.join(container, 'repo')
  let added = false
  try {
    git(repoRoot, ['worktree', 'add', '--detach', source, commit])
    added = true
    const sameLock = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml')).equals(fs.readFileSync(path.join(source, 'pnpm-lock.yaml')))
    if (sameLock) fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(source, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    else {
      const installed = await runCommand('pnpm', ['install', '--frozen-lockfile'], source)
      if (installed.code !== 0) throw new Error('基准依赖安装失败')
    }
    return await render(source)
  } finally {
    if (added) git(repoRoot, ['worktree', 'remove', '--force', source])
    fs.rmSync(container, { recursive: true, force: true })
  }
}

export function localConfigSource({ sourceRoot, snapshots, results, report, calibration, unstable = [] }) {
  const file = (name) => path.join(sourceRoot, 'tests/ux/design-lab', name)
  const excluded = unstable.map((name) => {
    const [screen, state] = name.split('/')
    return `design lab · ${screen} 状态 ${state} ·`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  return `import base from ${JSON.stringify(pathToFileURL(file('playwright.config.mjs')).href)}\nexport default { ...base,
  testDir: ${JSON.stringify(path.dirname(file('playwright.config.mjs')))},
  globalSetup: ${JSON.stringify(file('labOwnershipSetup.mjs'))},
  snapshotPathTemplate: ${JSON.stringify(path.join(snapshots, '{arg}{ext}'))},
  outputDir: ${JSON.stringify(results)},
  reporter: [['list'], ['json', { outputFile: ${JSON.stringify(report)} }]],
  grepInvert: ${excluded.length ? `new RegExp(${JSON.stringify(excluded.join('|'))})` : 'undefined'},
  use: { ...base.use, viewport: ${JSON.stringify({ width: calibration.viewport.width, height: calibration.viewport.height })}, deviceScaleFactor: ${JSON.stringify(calibration.viewport.deviceScaleFactor)}, colorScheme: ${JSON.stringify(calibration.colorScheme)} },
  webServer: { ...base.webServer, cwd: ${JSON.stringify(sourceRoot)} }
}\n`
}

export function readRelativeReport(report, { baseline, unstable = [] }) {
  if (report.errors?.length) throw new Error(report.errors.map((error) => error.message).join('\n'))
  const current = new Set()
  const changed = []
  const added = []
  const baselineSet = new Set(baseline)
  const visit = (suite, screen) => {
    screen = /^design lab · (.+)$/.exec(suite.title)?.[1] ?? screen
    for (const spec of suite.specs ?? []) {
      const state = /^状态 (\S+) ·/.exec(spec.title)?.[1]
      for (const test of spec.tests ?? []) {
        const result = test.results?.at(-1)
        if (!result || !['passed', 'failed'].includes(result.status)) throw new Error(`用例未完成：${spec.title}`)
        const errors = result.errors ?? []
        if (result.status === 'failed' && !errors.length) throw new Error(`失败没有错误证据：${spec.title}`)
        if (errors.some((error) => !/Screenshot comparison failed|A snapshot doesn't exist at|\d+ pixels?[\s\S]*?are different|Expected an image \d+px by \d+px, received \d+px by \d+px/.test(error.message ?? ''))) {
          throw new Error(errors.map((error) => error.message).join('\n'))
        }
        if (!state) {
          if (result.status !== 'passed') throw new Error(`注册表验证失败：${spec.title}`)
          continue
        }
        if (!screen) throw new Error(`缺屏标识：${spec.title}`)
        const name = `${screen}/${state}`
        current.add(name)
        if (!baselineSet.has(name)) added.push(name)
        else if (result.status === 'failed') {
          const diff = result.attachments?.find((attachment) => attachment.path?.endsWith('-diff.png'))?.path
          if (!diff) throw new Error(`像素未比成：${name}`)
          changed.push({ name, diff })
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, screen)
  }
  for (const suite of report.suites ?? []) visit(suite)
  if (!current.size) throw new Error('没有完成任何视觉格，不能报告没变')
  const ignored = new Set(unstable)
  return {
    compared: [...current].filter((name) => baselineSet.has(name)).length,
    changed, added,
    removed: baseline.filter((name) => !current.has(name) && !ignored.has(name)),
    unstable,
  }
}

async function runCommand(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: labChildEnv(env), stdio: ['ignore', 'pipe', 'pipe'], ...(process.platform === 'win32' ? { shell: true } : {}) })
    let output = ''
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', (chunk) => { output += String(chunk); sink.write(chunk) })
    }
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

async function render({ sourceRoot, snapshots, results, report, configDir, calibration, update = false, unstable, screen }) {
  const config = path.join(configDir, 'playwright.local.config.mjs')
  fs.writeFileSync(config, localConfigSource({ sourceRoot, snapshots, results, report, calibration, unstable }))
  fs.rmSync(report, { force: true })
  const result = await runCommand('pnpm', ['exec', 'playwright', 'test', '-c', config, ...(update ? ['--update-snapshots'] : [])], sourceRoot, {
    ...process.env,
    // 缓存总是完整渲染；当前分支的 --screen 只过滤最终比较。
    NOMI_DESIGN_LAB_SCREEN: screen ?? '',
  })
  let json
  try {
    json = JSON.parse(fs.readFileSync(report, 'utf8'))
    readRelativeReport(json, { baseline: [] })
  } catch (error) {
    const { labOriginFor } = await import(pathToFileURL(path.join(sourceRoot, 'tests/ux/design-lab/labServer.mjs')).href)
    const triage = triageLabRun({ output: result.output, diffImages: collectDiffImages(results), exitCode: result.code || 1 })
    const message = triage.verdict === 'visual' ? '视觉道还存在非像素错误，不能给出变化结论' : formatLabFailure(triage, { resultsDir: results, origin: labOriginFor('visual') })
    throw new Error(`${message}\n${error.message}`, { cause: error })
  }
  if (update && result.code !== 0) throw new Error(`基准渲染失败（退出码 ${result.code}）`)
  if (result.code !== 0 && !json.stats?.unexpected) throw new Error('进程失败且没有用例失败证据，渲染未完成')
  return json
}

function snapshotNames(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) =>
    fs.readdirSync(path.join(root, entry.name)).filter((file) => file.endsWith('.png')).map((file) => `${entry.name}/${file.slice(0, -4)}`),
  ).sort()
}

function pruneCache(root, keep) {
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
    .map((entry) => ({ dir: path.join(root, entry.name), mtime: fs.statSync(path.join(root, entry.name, 'manifest.json')).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const entry of entries.filter((entry) => entry.dir !== keep).slice(3)) fs.rmSync(entry.dir, { recursive: true, force: true })
}

export async function runLocalRelative({ repoRoot, runner, calibration, resultsDir, screen }) {
  const started = Date.now()
  const resultDir = path.join(repoRoot, 'outputs/design-lab')
  fs.mkdirSync(resultDir, { recursive: true })
  const resultFile = path.join(resultDir, 'relative.json')
  fs.writeFileSync(path.join(resultDir, 'runner.json'), `${JSON.stringify(runner, null, 2)}\n`)
  fs.writeFileSync(resultFile, `${JSON.stringify({ status: 'running' })}\n`)
  const cacheRoot = path.join(os.homedir(), '.cache/nomi/design-lab')
  fs.mkdirSync(cacheRoot, { recursive: true })
  const scratch = fs.mkdtempSync(path.join(cacheRoot, 'run-'))
  try {
    const commit = gitCommand(repoRoot, ['merge-base', 'HEAD', 'origin/main'])
    const browser = await chromium.launch()
    let browserVersion
    try { browserVersion = browser.version() } finally { await browser.close() }
    const identity = { format: 1, runner, host: os.hostname(), kernel: os.release(), browser: browserVersion, viewport: calibration.viewport, colorScheme: calibration.colorScheme, commit }
    const cache = path.join(cacheRoot, cacheKey(identity))
    const manifestFile = path.join(cache, 'manifest.json')
    const reused = fs.existsSync(manifestFile)
    let manifest
    if (reused) {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      fs.utimesSync(manifestFile, new Date(), new Date())
      console.log(`↷ 复用同机基准 ${commit}：${cache}`)
    } else {
      console.log(`↷ 同机渲染基准 ${commit}（两趟核稳定性）：${cache}`)
      const staging = path.join(scratch, 'baseline')
      const snapshots = path.join(staging, 'snapshots')
      fs.mkdirSync(snapshots, { recursive: true })
      await withBaselineSource({ repoRoot, commit, tempRoot: scratch }, async (sourceRoot) => {
        const { chromium: baselineChromium } = await import(pathToFileURL(path.join(sourceRoot, 'node_modules/@playwright/test/index.mjs')).href)
        const baselineBrowser = await baselineChromium.launch()
        try {
          if (baselineBrowser.version() !== browserVersion) throw new Error('两端浏览器内核版本不同，不能给出同机像素结论')
        } finally { await baselineBrowser.close() }
        const options = { sourceRoot, snapshots, calibration, configDir: scratch, results: path.join(staging, 'test-results'), report: path.join(staging, 'render.json') }
        await render({ ...options, update: true })
        const baseline = snapshotNames(snapshots)
        const stability = readRelativeReport(await render(options), { baseline })
        if (stability.added.length || stability.removed.length) throw new Error('同一份代码的格清单不稳定')
        if (stability.changed.length > Math.max(5, baseline.length * 0.1)) throw new Error(`同机大面积不稳定：${stability.changed.length}/${baseline.length} 格，停线`)
        manifest = { identity, baseline, unstable: stability.changed.map(({ name }) => name) }
      })
      fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      fs.renameSync(staging, cache)
    }
    const snapshots = path.join(cache, 'snapshots')
    if (!manifest.baseline.length || manifest.baseline.some((name) => !fs.existsSync(path.join(snapshots, `${name}.png`)))) throw new Error(`基准缓存不完整：删除 ${cache} 后重跑`)
    pruneCache(cacheRoot, cache)
    const baseline = screen ? manifest.baseline.filter((name) => name.startsWith(`${screen}/`)) : manifest.baseline
    const pending = pendingApprovalScreens()
    const currentNames = new Set(LAB_SCREEN_IDS.filter((id) => !pending[id] && (!screen || screen === id)).flatMap((id) => readLabStates(id).map((state) => `${id}/${state.id}`)))
    const unstable = manifest.unstable.filter((name) => currentNames.has(name))
    fs.rmSync(resultsDir, { recursive: true, force: true })
    const json = await render({ sourceRoot: repoRoot, snapshots, calibration, configDir: scratch, results: resultsDir, report: path.join(scratch, 'current.json'), unstable, screen })
    const summary = { status: 'complete', baseCommit: commit, cache, cacheHit: reused, runner, browser: browserVersion, ...readRelativeReport(json, { baseline, unstable }), elapsedMs: Date.now() - started }
    fs.writeFileSync(resultFile, `${JSON.stringify(summary, null, 2)}\n`)
    console.log(`\n✅ ${summary.changed.length} 格相对主分支变了；基准 ${commit}；比了 ${summary.compared} 格；新增 ${summary.added.length} 格；删除 ${summary.removed.length} 格；本机不稳定，没比 ${unstable.length} 格。`)
    for (const { name, diff } of summary.changed) console.log(`  变化 ${name}：${diff}`)
    for (const [kind, names] of [['新增', summary.added], ['删除', summary.removed], ['本机不稳定，没比', unstable]]) for (const name of names) console.log(`  ${kind} ${name}`)
    console.log(`结果：${resultFile}\n合并以 CI 的 Design Lab (macOS) 为准。`)
    return 0
  } catch (error) {
    fs.writeFileSync(resultFile, `${JSON.stringify({ status: 'failed', error: error.message, elapsedMs: Date.now() - started }, null, 2)}\n`)
    console.error(`\n🚧 本机相对检查失败，未得出完整变化结论：${error.message}`)
    return 1
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}
