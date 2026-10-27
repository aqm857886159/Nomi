import { cleanupTestTemp, makeTempDir, registerTestTemp } from '../../scripts/_test-temp.mjs'
// tests/ux 与 evals 唯一的 Electron 启动器（2026-08-11 收敛，见 docs/plan/2026-08-11-e2e-launcher-convergence.md）。
//
// 为什么必须收敛成一份：走查脚本手抄 launch 样板时抄漏 env，会**静默挂死**——一张截图不产、
// 无任何提示，干等到超时，排查时看起来像脚本自己写错了。两条已知死法症状完全一样：
//
//   1) 少 NOMI_E2E_ALLOW_MULTI_INSTANCE=1
//      → 用户本机 Nomi.app 在跑时 requestSingleInstanceLock() 拿不到锁，新实例主动让出并退出
//        （electron/main.ts:74-75）。窗口永不出现。
//   2) 少 NOMI_E2E=1
//      → COOP/COEP cross-origin isolation 不关，Playwright 的 CDP target 握手直接卡死
//        （electron/main.ts:684-689 注释已写明）。连不上。
//
// 所以这里做两件事：把那套必需 env **钉死**（调用方覆盖不掉），以及在起不来时抛一条**说人话**
// 的错——带上主进程 stderr 尾巴，别让人再对着静默超时猜。
//
// 用法：
//   import { launchNomiApp } from './_launchApp.mjs'
//   const { app, win, projectsDir } = await launchNomiApp({ name: 'my-walk' })
import { _electron as electron } from 'playwright'
import { require as tsxRequire } from 'tsx/cjs/api'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { ensureElectronSignature } from '../../scripts/ensure-electron-signature.mjs'
import { installFeelObserver } from './_feel-observer.mjs'
import { assertElectronBuildArtifacts } from '../../scripts/electron-build-artifacts.mjs'
import { assertFreshBuild } from '../../scripts/package-build-stamp.mjs'
import { registerWalkProcess } from './_walkInstances.mjs'

const require = createRequire(import.meta.url)
const catalogVersionManifest = require('../../electron/catalog/catalogVersion.json')

export function currentCatalogVersion() {
  const version = Number(catalogVersionManifest.current)
  if (!Number.isInteger(version) || version < 1) throw new Error('catalog version manifest is invalid')
  return version
}

/**
 * 检查隔离 settings 里调用方预埋的 catalog seed。
 *
 * 旧版走查会把真实用户 catalog 原样复制进隔离 profile；真实 catalog 可能来自更新的
 * Nomi，随后旧版被测 app 的正确只读保护会让 UI 写入静默失效。future seed 不能被改写
 * 成当前版本（那会丢字段），所以留在隔离目录里 quarantine，app 无盘首启自建。
 */
export function prepareIsolatedCatalog(settingsDir, { testedCatalogVersion = currentCatalogVersion() } = {}) {
  if (!Number.isInteger(testedCatalogVersion) || testedCatalogVersion < 1) {
    throw new Error(`tested catalog version is invalid: ${testedCatalogVersion}`)
  }
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  if (!fs.existsSync(catalogPath)) return { status: 'missing', catalogPath }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch {
    return { status: 'unreadable', catalogPath }
  }
  const diskVersion = parsed?.version
  if (!Number.isInteger(diskVersion) || diskVersion <= testedCatalogVersion) {
    return { status: 'compatible', catalogPath, diskVersion }
  }

  const prefix = path.join(settingsDir, `model-catalog.future-v${diskVersion}`)
  let quarantinePath = `${prefix}.json`
  let suffix = 1
  while (fs.existsSync(quarantinePath)) quarantinePath = `${prefix}.${suffix++}.json`
  fs.renameSync(catalogPath, quarantinePath)
  console.warn(`[walkthrough] quarantined catalog seed v${diskVersion} > tested app v${testedCatalogVersion}: ${quarantinePath}`)
  return { status: 'quarantined', catalogPath, quarantinePath, diskVersion, testedCatalogVersion }
}

/**
 * 隔离 settings 里预埋的 catalog 有没有 safeStorage 加密的凭据。
 *
 * 夹具（agent-runtime-fixture / _mcpL2Fixture）在 Linux 上用 Chromium 的 basic 合成后端加密占位 key；
 * 被测 App 若不用同一个后端起，就解不开它——模型在渲染层一律 `credential_locked`（「当前不可用」），
 * 付费卡上一颗参数 chip 都没有（2026-10-08 Linux CI run 37795697410 的两条付费走查红，Windows 绿：
 * Windows 的 DPAPI 不分后端，所以只在 Linux 暴露）。「加密用哪个后端」和「起 App 用哪个后端」原来是
 * 两处各自决定的，这里把后者改成从盘上那份 catalog 推出来——写了加密凭据的隔离 profile 不可能再忘。
 */
export function isolatedCatalogHasSafeStorageCredentials(settingsDir) {
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  if (!fs.existsSync(catalogPath)) return false
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch {
    return false
  }
  return Object.values(parsed?.apiKeysByVendor ?? {}).some((entry) => entry?.enc === 'safeStorage')
}

/** 仓库根：本文件在 <repo>/tests/ux/ 下。 */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function registerTempRoot(root) {
  return registerTestTemp(root)
}

export function cleanupTempRoot(root) {
  cleanupTestTemp(root)
}

/** 默认等窗口的上限。取 60s：明显短于 Playwright 默认的 180s，让**我们的**错误信息先落地。 */
const DEFAULT_WINDOW_TIMEOUT_MS = 60_000

/** Content pixels, not native-window bounds: Canvas Acceptance's measured Linux baseline. */
export const ACCEPTANCE_VIEWPORT = Object.freeze({ width: 1280, height: 933 })
export const ACCEPTANCE_WIDE_VIEWPORT = Object.freeze({ width: 1680, height: 1050 })


/** Seed ordinary persisted preferences before the renderer's first script.
 * Electron's -r module runs before the application's main entry; the session
 * preload leaves the product preload and existing profile values intact. */
export function prepareLocalStorageSeed(tempRoot, entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.values(entries).some((value) => typeof value !== 'string')) {
    throw new TypeError('initialLocalStorage must contain string values')
  }
  const framePath = path.join(tempRoot, 'initial-local-storage.cjs')
  const registerPath = path.join(tempRoot, 'register-local-storage.cjs')
  fs.writeFileSync(framePath, `if (process.isMainFrame) {
  for (const [key, value] of ${JSON.stringify(Object.entries(entries))}) {
    if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value)
  }
}\n`)
  fs.writeFileSync(registerPath, `const { app } = require('electron')
app.once('session-created', (session) => {
  session.registerPreloadScript({ type: 'frame', filePath: ${JSON.stringify(framePath)} })
})\n`)
  return ['-r', registerPath]
}

/**
 * 在 App 主入口之前加载的主进程模块（Node 的 `-r`），给走查装仪表用——例如
 * `scripts/walkthrough-network-guard.cjs` 那道「只放行本机」的网络闸。
 *
 * 为什么不走 `NODE_OPTIONS=--require`：Playwright 的 Electron 启动器会 `delete env.NODE_OPTIONS`
 *（它自己也是用 `-r loader.js` 注入的），经 env 传进去的 --require 会被静默丢掉——走查以为装了闸，
 * 其实没装。`-r` 必须排在 App 入口（`.`）之前才对主进程生效，所以由启动器来拼。
 * 只收**绝对路径且文件存在**：相对路径会被 Node 当成包名去 node_modules 里找（MODULE_NOT_FOUND）。
 */
/** 每个隔离走查默认注入同一份主进程安静仪表；调用方不再决定是否屏外。 */
export const QUIET_WALK_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), '_quietWalk.cjs')
export function withQuietWalk(modules) {
  const list = Array.isArray(modules) ? modules : []
  if (list.includes(QUIET_WALK_MODULE)) return list
  return [...list, QUIET_WALK_MODULE]
}

/**
 * 不经 launchNomiApp、自己 spawn Electron 的走查（stdio MCP 子进程、按调试口量内存那条）也装同一份安静仪表：`-r` 排在 App
 * 入口之前；子进程环境里的放行位钉成空串、排在调用方 env 之后——跑走查的终端 export 过 NOMI_WALK_FOREGROUND_OK=1 也漏不进来
 * （launchNomiApp 那边由 buildNomiLaunchEnv 钉）。直接 spawn Electron 又装仪表的只许经这里，_launchApp.test.mjs 扫描钉住。
 */
export function quietElectronSpawn(appArgs, options = {}, platform = process.platform) {
  return {
    command: require('electron'),
    args: withLinuxNoSandbox(['-r', QUIET_WALK_MODULE, ...appArgs], platform),
    options: { ...options, env: { ...(options.env ?? process.env), NOMI_WALK_FOREGROUND_OK: '' } },
  }
}
/** 起的是本仓库的开发构建：和 launchNomiApp 开发版同一套起跑前核对（构建戳、产物、Electron.app 签名）。 */
export function spawnQuietElectron(appArgs, options = {}) {
  const { command, args, options: spawnOptions } = quietElectronSpawn(appArgs, options)
  assertFreshBuild(repoRoot)
  assertElectronBuildArtifacts(repoRoot)
  ensureElectronSignature(command)
  return spawn(command, args, spawnOptions)
}

/** 跳过约定：退出码 125（scripts/nightly-walk-summary.mjs 把它记成「跳过」，不算失败）。 */
export const WALK_SKIPPED_EXIT_CODE = 125

export class WalkSkippedError extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'WalkSkippedError'
    this.code = 'NOMI_WALK_SKIPPED'
    this.exitCode = WALK_SKIPPED_EXIT_CODE
  }
}

/** 跑走查的人放没放行前台（只认显式的 NOMI_WALK_FOREGROUND_OK=1）。 */
export function foregroundAllowed(env = process.env) {
  return env.NOMI_WALK_FOREGROUND_OK === '1'
}

export function assertForegroundAllowed(foreground, env = process.env) {
  if (!foreground || foregroundAllowed(env)) return
  const reason = `未跑：这条走查需要前台，会打扰正在用电脑的人（${foreground}）。确实要跑就带上 NOMI_WALK_FOREGROUND_OK=1`
  console.log(reason)
  throw new WalkSkippedError(reason)
}

/** 顶层 await 起 App 的走查用：`await launchNomiApp({ foreground: '…' }).catch(exitIfWalkSkipped)`——没放行就按 125 退出，别的错照抛。 */
export function exitIfWalkSkipped(error) {
  if (error?.code === 'NOMI_WALK_SKIPPED') process.exit(error.exitCode)
  throw error
}

export function frontGuardVerdict({ frontPid, appPid, foreground = false }) {
  if (foreground) return { ok: true, exempt: true, reason: 'foreground declaration' }
  if (!Number.isInteger(frontPid) || !Number.isInteger(appPid)) return { ok: true, exempt: false, reason: 'front/app pid unavailable' }
  return frontPid === appPid
    ? { ok: false, exempt: false, reason: '走查抢了前台' }
    : { ok: true, exempt: false, reason: 'front pid differs' }
}

/** `lsappinfo info -only …` 的 `"key"="value"` / `"key"=123` 行 → { pid, name, applicationType }。 */
export function parseLsappinfoInfo(text) {
  const field = (key) => new RegExp(`"${key}"=(?:"([^"]*)"|(\\d+))`).exec(String(text ?? ''))
  const pid = Number(field('pid')?.[2])
  return {
    pid: Number.isInteger(pid) ? pid : null,
    name: field('LSDisplayName')?.[1] ?? null,
    applicationType: field('ApplicationType')?.[1] ?? null,
  }
}

const LSAPPINFO_OPTIONS = { encoding: 'utf8', timeout: 2000 }
/** 最前面的应用（名字、PID、类型），外加走查 App 自己的类型：UIElement = 不进 Dock（仪表 ready 时设 accessory），Foreground = 普通前台应用。 */
function readMacFront(appPid) {
  try {
    const asn = execFileSync('lsappinfo', ['front'], LSAPPINFO_OPTIONS).trim()
    const front = parseLsappinfoInfo(execFileSync('lsappinfo', ['info', '-only', 'pid', '-only', 'name', '-only', 'ApplicationType', asn], LSAPPINFO_OPTIONS))
    const walkApp = Number.isInteger(appPid)
      ? parseLsappinfoInfo(execFileSync('lsappinfo', ['info', '-only', 'ApplicationType', String(appPid)], LSAPPINFO_OPTIONS))
      : null
    return { asn, ...front, appType: walkApp?.applicationType ?? null }
  } catch (error) {
    return { asn: null, pid: null, name: null, applicationType: null, appType: null, error: String(error?.message ?? error) }
  }
}

/** 关门时打一行：全程最前是谁、走查 App 自己是什么类型、有没有抢前台——每条走查的日志自带这份证据。 */
export function summarizeFrontSamples(samples, appPid) {
  const tally = (label) => {
    const counts = new Map()
    for (const row of samples) counts.set(label(row), (counts.get(label(row)) ?? 0) + 1)
    return [...counts].map(([key, count]) => `${key}×${count}`).join('、') || '无'
  }
  const fronts = tally((row) => (Number.isInteger(row.pid) ? `${row.name ?? '?'}(pid ${row.pid})` : `未知(${row.error ? '抽样失败' : '无 PID'})`))
  // 关门后那一次抽样 App 已经退出，系统查不到它是正常的；别的时候查不到才是「未登记」。
  const types = tally((row) => row.appType ?? (row.phase === 'after-close' ? '已退出' : '未登记'))
  const violations = samples.filter((row) => !row.ok)
  const verdict = samples.some((row) => row.exempt) ? 'foreground 声明，豁免'
    : violations.length ? `抢了前台 ${violations.length} 次（首次 ${violations[0].phase} ${violations[0].at}）` : '没抢前台'
  return `[quiet-walk] 前台抽样 ${samples.length} 次；最前：${fronts}；走查 App(pid ${appPid ?? '?'}) 类型：${types}；${verdict}`
}

/** 'exit' 回调里改的 exitCode 是进程真正的退出码：走查结尾自己 process.exit(0) 也盖不掉抢前台的红。 */
function failOnForegroundViolation() {
  // 0（绿）和 125（跳过，nightly-walk-summary 不算失败）都会把抢前台藏起来；别的非零本来就是红，留走查自己的码。
  const code = Number(process.exitCode ?? 0)
  if (code === 0 || code === WALK_SKIPPED_EXIT_CODE) process.exitCode = 1
}

export function startMacForegroundGuard({ appPid, foreground = false, intervalMs = 1000, sample = readMacFront, platform = process.platform } = {}) {
  const samples = []
  let violation = null
  const take = (phase) => {
    const front = sample(appPid)
    if (!front) return null
    const verdict = frontGuardVerdict({ frontPid: front.pid, appPid, foreground })
    const row = { phase, at: new Date().toISOString(), ...front, ...verdict }
    samples.push(row)
    if (!verdict.ok && !violation) {
      violation = row
      console.error(`[quiet-walk] 走查抢了前台：${JSON.stringify(row)}`)
      process.once('exit', failOnForegroundViolation)
    }
    return row
  }
  if (platform !== 'darwin') return { sample: () => null, stop: () => ({ samples, violation }) }
  take('started')
  const timer = setInterval(() => take('interval'), intervalMs)
  timer.unref?.()
  return {
    sample: take,
    stop: (phase = 'stopped') => {
      clearInterval(timer)
      take(phase)
      console.log(summarizeFrontSamples(samples, appPid))
      return { samples, violation }
    },
  }
}

export function mainRequireArgs(modules) {
  if (!Array.isArray(modules) || modules.length === 0) return []
  return modules.flatMap((file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError(`mainRequire needs absolute module paths: ${file}`)
    if (!fs.existsSync(file)) throw new Error(`mainRequire module does not exist: ${file}`)
    return ['-r', file]
  })
}

/** 打包形态的主入口：app.asar 里的 dist-electron/main.js（与 package.json 的 main 一致）。 */
export const PACKAGED_MAIN_ENTRY = /app\.asar[\\/]dist-electron[\\/]main\.js$/

/**
 * mainRequire / initialLocalStorage 的**打包形态**：在打包好的 App 主入口第一行之前 require 这些模块。
 *
 * 为什么不能照开发版拼 `-r`：`-r` 是 Electron 开发版 default_app 自己解析的参数；打包好的 App 直接跑
 * app.asar 里的 main.js，`-r` 被**静默忽略**——走查以为装了网络模拟，请求其实全发到了真网上。
 * 所以打包形态走 Node 调试口：App 带 `--inspect-brk=127.0.0.1:<port>` 起（启动器负责拼），这里另开一路
 * 调试会话，在主入口第一行下断点，从那一帧 require 这些模块，再放行。Playwright 自己那一路会话不受影响。
 * 调用方先调它、再起 App：它会等调试口出现。
 */
export async function requireBeforePackagedMain({ port, modules, timeout = DEFAULT_WINDOW_TIMEOUT_MS, entry = PACKAGED_MAIN_ENTRY }) {
  const deadline = Date.now() + timeout
  let socketUrl
  while (!socketUrl) {
    if (Date.now() > deadline) throw new Error(`inspector on 127.0.0.1:${port} never came up`)
    try {
      socketUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0]?.webSocketDebuggerUrl
    } catch { /* 调试口还没起来 */ }
    if (!socketUrl) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const socket = new WebSocket(socketUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('inspector socket failed'))
  })
  let nextId = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  let breakpointId
  let settle
  const injected = new Promise((resolve, reject) => { settle = { resolve, reject } })
  socket.onmessage = async (event) => {
    const message = JSON.parse(String(event.data))
    const waiter = message.id ? pending.get(message.id) : undefined
    if (waiter) {
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result)
      return
    }
    if (message.method !== 'Debugger.paused') return
    try {
      // 只认自己那个断点（`--inspect-brk` 自带的「开头停一下」也会停在这里，原因报成 ambiguous）。
      if ((message.params.hitBreakpoints ?? []).includes(breakpointId)) {
        const expression = `${modules.map((file) => `require(${JSON.stringify(file)})`).join(';')};'loaded'`
        const result = await send('Debugger.evaluateOnCallFrame', { callFrameId: message.params.callFrames[0].callFrameId, expression })
        if (result.exceptionDetails) throw new Error(`require before main failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
        await send('Debugger.resume')
        settle.resolve()
        return
      }
      await send('Debugger.resume')
    } catch (error) {
      settle.reject(error)
    }
  }
  const timer = setTimeout(() => settle.reject(new Error(`main entry never paused (${entry})`)), Math.max(0, deadline - Date.now()))
  try {
    await send('Debugger.enable')
    ;({ breakpointId } = await send('Debugger.setBreakpointByUrl', { urlRegex: entry.source, lineNumber: 0 }))
    await send('Runtime.runIfWaitingForDebugger')
    await injected
  } finally {
    clearTimeout(timer)
    socket.close()
  }
}

async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// ── 宿主配置（Claude Code / Codex / Cursor …）的隔离 ──────────────────────────────────────────────
// 2026-10-24：隔离起的 App 显示「Claude Code 的配置里已有 Nomi」——读到的是本机真实的 ~/.claude.json。
// 三个 NOMI_*_DIR 只管 Nomi 自己的目录；宿主配置在哪由宿主自己的规则定（主目录，或 CLAUDE_CONFIG_DIR / CODEX_HOME），
// 以前这里一条都没管。路径规则只有一份（electron/shared/mcpClientRegistry.ts，主进程算路径也用它），这里不抄。
const HOME_ENV = ['HOME', 'USERPROFILE']

function hostRegistry() {
  return tsxRequire('../../electron/shared/mcpClientRegistry.ts', import.meta.url)
}

/**
 * 隔离起 App 时宿主配置位置怎么定——唯一一处（launchNomiApp、evals 的 isoApp、memory.e2e 都经这里）：
 *  · 调用方在自己的 env 里给了某个宿主变量：照用（它在自己的临时目录里摆好了配置）；
 *  · 调用方换了 HOME / USERPROFILE（假主目录里摆好了 ~/.claude.json 一类）：继承来的宿主变量一律摘掉，
 *    让宿主的默认位置落在那个假主目录下——不摘的话，开发者 shell 里的 CLAUDE_CONFIG_DIR 会把 App 引回真配置；
 *  · 其余：每个宿主变量指到 <hostConfigDir>/<变量名>（调用方先建好：Codex 要求 CODEX_HOME 是已存在的目录）。
 */
export function isolatedHostConfigEnv({ hostConfigDir, callerEnv = {} }) {
  const { MCP_CLIENT_HOST_ENV_VARS } = hostRegistry()
  const redirectsHome = HOME_ENV.some((name) => Object.hasOwn(callerEnv, name))
  const set = {}
  const unset = []
  for (const name of MCP_CLIENT_HOST_ENV_VARS) {
    if (Object.hasOwn(callerEnv, name)) continue
    if (redirectsHome) unset.push(name)
    else set[name] = path.join(hostConfigDir, name)
  }
  return { set, unset }
}

/** 隔离目录里给每个宿主变量建好空目录（宿主要求它存在）；返回建了哪些。 */
export function prepareHostConfigDir(hostConfigDir, callerEnv = {}) {
  const dirs = Object.values(isolatedHostConfigEnv({ hostConfigDir, callerEnv }).set)
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true })
  return dirs
}

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * 隔离实例的宿主配置逐条核（门岗）。按注册表每一条路径（本平台的配置文件 + 安装痕迹），分别用「要传给 App 的 env」和
 * 「用户自己的 env」（含不设宿主变量时的默认位置）解析，App 那一份落进用户真实宿主位置里的：
 *   · 能重定向的（宿主有位置变量，或调用方换了主目录）→ leaks：隔离漏了，App 会读写真配置；
 *   · 只能靠主目录、调用方又没换主目录的（Cursor / WorkBuddy / Claude Desktop）→ residual：启动器挡不住，
 *     名单由 _launchApp.test.mjs 钉住，要挡得产品侧「隔离实例不读真主目录」（交协调拍板）。
 * App 的主目录按 Node 的 os.homedir() 规则推：POSIX 看 HOME，Windows 看 USERPROFILE，都没有就是账户主目录。
 */
export function isolatedHostConfigLeaks(env, { baseEnv = process.env, platform = process.platform, accountHome = os.userInfo().homedir } = {}) {
  const { MCP_CLIENT_HOST_ENV_VARS, mcpClientLocations, mcpClientPlatform, resolveMcpClientPath } = hostRegistry()
  const target = mcpClientPlatform(platform)
  const homeOf = (values) => (target === 'win32' ? values.USERPROFILE : values.HOME) || accountHome
  const context = (values) => ({ platform: target, env: values, homedir: homeOf(values), join: path.join })
  const withoutHostVars = Object.fromEntries(Object.entries(baseEnv).filter(([name]) => !MCP_CLIENT_HOST_ENV_VARS.includes(name)))
  const locations = mcpClientLocations().filter((entry) => entry.platform === target)
  const realRoots = locations.flatMap(({ location }) => [resolveMcpClientPath(location, context(baseEnv)), resolveMcpClientPath(location, context(withoutHostVars))])
  const callerRedirectedHome = homeOf(env) !== homeOf(baseEnv)
  const leaks = []
  const residual = new Set()
  for (const { client, location } of locations) {
    const resolved = resolveMcpClientPath(location, context(env))
    if (!realRoots.some((root) => isInside(root, resolved))) continue
    if (location.hostEnv || callerRedirectedHome) leaks.push({ client, path: resolved })
    else residual.add(client)
  }
  return { leaks, residual: [...residual].sort() }
}

/** 隔离 env 收尾：宿主变量按 isolatedHostConfigEnv 定，再逐条核；漏一条就当场抛，不让 App 起来读真配置。 */
export function withIsolatedHostConfig(env, { hostConfigDir, callerEnv = {}, baseEnv = process.env }) {
  const { set, unset } = isolatedHostConfigEnv({ hostConfigDir, callerEnv })
  const isolated = { ...env, ...set }
  for (const name of unset) delete isolated[name]
  const { leaks } = isolatedHostConfigLeaks(isolated, { baseEnv })
  if (leaks.length) {
    throw new Error(`隔离起 App 却会读写用户真实的宿主配置：${leaks.map((leak) => `${leak.client} → ${leak.path}`).join('；')}。`
      + '宿主变量要指到临时目录（见 isolatedHostConfigEnv），换了主目录就别再带宿主变量。')
  }
  return isolated
}

/**
 * 拼一套「窗口一定能起来」的 env。抽成纯函数是为了让那条不变量能被单测钉住
 * （见 _launchApp.test.mjs）：**必需 env 排在 extraEnv 之后，调用方覆盖不掉**。
 * 隔离起 App（给了任一 Nomi 目录）就必须同时给 hostConfigDir：宿主配置不隔离，App 读到的是本机真配置。
 */
export function buildNomiLaunchEnv({ extraEnv = {}, userDataDir, settingsDir, projectsDir, capabilityDir, hostConfigDir, fixtureCredentials = false, foreground = false, baseEnv = process.env }) {
  if ((userDataDir || settingsDir || projectsDir) && !hostConfigDir) {
    throw new Error('隔离起 App 要给 hostConfigDir（宿主配置的隔离目录）：只隔离 Nomi 自己的目录，App 照样读写本机真实的 Claude Code / Codex 配置')
  }
  const env = {
    ...baseEnv,
    // 假凭据（syntheticCredentialStorage: true = 隔离目录里的非秘密测试 key）不许出这台机器：默认打开产品自带的
    // 测试网闸（electron/testNetworkGuard.ts，只放行本机与登记的重定向）。以前不开——保存占位 key 时产品的免费验证
    // （credentialProbePolicy）把它发给真供应商，401 →「密钥验证失败」，走查当场红（夜跑 run 40035294026 四条），
    // 而且每跑一次都往真供应商发一把假 key。走查真要放行，就在 extraEnv 里显式写 NOMI_TEST_NETWORK_GUARD: ''。
    ...(fixtureCredentials ? { NOMI_TEST_NETWORK_GUARD: '1' } : {}),
    ...extraEnv,
    // ↓ 放在 extraEnv **之后**：这两条是「窗口能不能起来」的前提，调用方不该、也不能覆盖掉。
    //   不变量靠代码成立，不靠每个脚本作者自觉抄全（抄漏就是静默超时）。
    NOMI_E2E: '1',
    NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
    // 主进程日志镜像到 stderr。走查跑的是**打包形态也可能命中**的那条判据（`mirrorToStderr`
    // 在 isPackaged 时默认只落盘），于是 CI 的 job 日志里一条 WARN 都没有——
    // 2026-09-18 C9 那条间歇红的唯一诊断就是这么丢的。走查环境里日志必须看得见。
    NOMI_LOG_STDERR: '1',
    // 安静仪表（_quietWalk.cjs）只看这一条决定放不放前台：声明了 foreground 的走查才是 '1'。没声明写空串、不是不写——
    // 跑走查的终端里 export 过它，不写就会被继承下去，没声明的走查也起成前台模式，仪表整个失效。
    NOMI_WALK_FOREGROUND_OK: foreground ? '1' : '',
    // ↓ 三隔离：不碰用户真实的 userData/设置/项目库。
    //   传 null（isolate:false）时整条不设——写进 env 的 undefined 会变成字符串 "undefined"，
    //   主进程当成真路径去建目录，比不设更糟。
    ...(userDataDir ? { NOMI_ELECTRON_USER_DATA_DIR: userDataDir } : {}),
    ...(settingsDir ? { NOMI_SETTINGS_DIR: settingsDir } : {}),
    ...(projectsDir ? { NOMI_PROJECTS_DIR: projectsDir } : {}),
    ...(capabilityDir ? { NOMI_CAPABILITY_DIR: capabilityDir } : {}),
  }
  // ELECTRON_RUN_AS_NODE=1 会让 electron 退化成纯 node：不开窗、不起渲染层，于是又是一次
  // 「干等到超时」。它常被别的工具链顺手塞进环境里（我们自己 spawn MCP 子进程时也会用），
  // 继承过来纯属误伤——统一摘掉，同一类死法不留第二个入口。
  delete env.ELECTRON_RUN_AS_NODE
  return hostConfigDir ? withIsolatedHostConfig(env, { hostConfigDir, callerEnv: extraEnv, baseEnv }) : env
}

/**
 * Linux CI 没有可用的 setuid chrome-sandbox；所有测试进程统一显式关闭 Chromium sandbox。
 * 另：Chromium ≥139 移除了 SwiftShader 软件 WebGL 自动回退（安全策略，
 * https://chromestatus.com/feature/5166674414927872），xvfb 无 GPU 环境下 WebGL 上下文
 * 直接创建失败 → 导演台/轨迹面板不挂载（Electron 43 升级时 smoke 在 CI 死于此，macOS 本地全绿）。
 * headless 测试正是官方点名保留的 opt-in 场景 → Linux 测试进程统一带 --enable-unsafe-swiftshader。
 * 只影响测试启动器；生产桌面端有真 GPU，不带此旗标。
 */
export function withLinuxNoSandbox(args, platform = process.platform) {
  const normalized = [...args]
  if (platform === 'linux' && !normalized.includes('--no-sandbox')) normalized.push('--no-sandbox')
  if (platform === 'linux' && !normalized.includes('--enable-unsafe-swiftshader')) normalized.push('--enable-unsafe-swiftshader')
  return normalized
}

/**
 * Synthetic credentials used by isolated UI fixtures are deliberately not
 * secrets. Linux CI has no desktop keyring, so Electron's normal safeStorage
 * backend is unavailable there. Opted-in fixtures use Chromium's basic test
 * backend; real-profile and real-provider journeys never receive this flag.
 */
export function withLinuxSyntheticCredentialStorage(args, enabled, platform = process.platform) {
  const normalized = [...args]
  if (!enabled || platform !== 'linux') return normalized

  const configuredBackend = normalized.find((arg) => arg.startsWith('--password-store='))
  if (configuredBackend && configuredBackend !== '--password-store=basic') {
    throw new Error(`synthetic credential storage conflicts with ${configuredBackend}`)
  }
  if (!configuredBackend) normalized.push('--password-store=basic')
  return normalized
}

export async function configureSyntheticCredentialStorage(app, enabled, platform = process.platform) {
  if (!enabled || platform !== 'linux') return false
  const available = await app.evaluate(({ safeStorage }) => {
    safeStorage.setUsePlainTextEncryption(true)
    return safeStorage.isEncryptionAvailable()
  })
  if (!available) {
    throw new Error('Linux synthetic credential storage could not initialize an in-memory safeStorage key')
  }
  return true
}

/** Electron 43's packaged Chromium rejects Playwright's DevTools WebSocket
 * Origin unless it is explicitly allowed. This flag exists only in this E2E
 * launcher (which already forces NOMI_E2E=1); normal product launches never
 * receive a remote-debugging port or this allow-list. */
export function withPackagedPlaywrightOrigin(args, isPackaged) {
  const normalized = [...args]
  const allowOrigin = '--remote-allow-origins=*'
  if (isPackaged && !normalized.includes(allowOrigin)) normalized.push(allowOrigin)
  return normalized
}

/**
 * 起一个隔离的 Nomi 实例，并等到首个窗口可用。
 *
 * @param {object} [options]
 * @param {string} [options.name]           本次走查的名字（临时目录名 + 报错文案里用）
 * @param {Record<string,string>} [options.env]  额外 env（必需的那几条覆盖不掉，见文件头）
 * @param {string[]} [options.args]         额外 chromium 参数（如 '--no-proxy-server' / '--disable-gpu'）
 * @param {string} [options.tempRoot]       profile 根目录；默认在系统临时区新开一个
 * @param {string} [options.userDataDir]    单独指定（默认 <tempRoot>/user-data）
 * @param {string} [options.settingsDir]    单独指定（默认 <tempRoot>/settings）
 * @param {string} [options.projectsDir]    单独指定（默认 <tempRoot>/projects）
 * @param {string} [options.capabilityDir]  优先于 env.NOMI_CAPABILITY_DIR；均未设时隔离实例派生 <tempRoot>/capability
 * @param {string} [options.hostConfigDir]  宿主配置（CLAUDE_CONFIG_DIR / CODEX_HOME …）的隔离目录；默认 <tempRoot>/host-config
 * @param {number} [options.testedCatalogVersion]  被测构建的 catalog 版本；默认读取仓库 canonical manifest
 * @param {{width: number, height: number}} [options.viewportSize] Content viewport; defaults to ACCEPTANCE_VIEWPORT.
 * @param {number} [options.timeout]        等窗口上限（ms）
 * @param {number} [options.settleMs=1500]  domcontentloaded 后再等一会儿（渲染层挂载）
 * @param {Record<string,string>} [options.initialLocalStorage] Existing product preferences for an isolated fixture (dev or packaged); omitted for first-run tests.
 * @param {string[]} [options.mainRequire] 主进程入口前加载的模块（绝对路径，走查仪表专用；见 mainRequireArgs；打包形态见 requireBeforePackagedMain）
 * @param {string} [options.foreground]   这条走查为什么必须在前台跑（测焦点 / 真窗口，或 isolate:false 用真实资料——非隔离必须声明）。
 *   声明了：环境里没有 NOMI_WALK_FOREGROUND_OK=1 就不起 App、按 125 跳过（顶层 await 的走查接 `.catch(exitIfWalkSkipped)`）；起了门岗豁免。
 * @param {(win: import('playwright').Page) => Promise<void>} [options.observeWindow] Optional measurement observer
 * @param {boolean} [options.syntheticCredentialStorage]  仅供隔离目录里的非秘密测试凭据；Linux CI 使用 basic 后端。
 *   不传 = 隔离 catalog 里有 safeStorage 加密凭据就开（夹具加密时用的就是它）；显式 false 用于用户真实资料的拷贝
 * @returns {Promise<{app: import('playwright').ElectronApplication, win: import('playwright').Page,
 *   tempRoot: string, userDataDir: string, settingsDir: string, projectsDir: string, hostConfigDir: string | null, close: () => Promise<void>}>}
 */
export async function launchNomiApp(options = {}) {
  const {
    name = 'nomi-walk',
    env: extraEnv = {},
    args: extraArgs = [],
    timeout = DEFAULT_WINDOW_TIMEOUT_MS,
    settleMs = 1500,
    // 默认起开发构建；打包产物走查（如 mcp-client-activation）传装好的 .app 二进制。
    executablePath = require('electron'),
    waitForWindow = true,
    allowUntrackedProcessForTest = false,
    foreground,
  } = options

  const isolate = options.isolate !== false
  assertForegroundAllowed(foreground)
  if (options.initialLocalStorage && !isolate) {
    throw new Error('initialLocalStorage requires an isolated Nomi profile')
  }
  if (options.syntheticCredentialStorage && !isolate) {
    throw new Error('syntheticCredentialStorage requires an isolated Nomi profile')
  }
  const mainRequire = isolate ? withQuietWalk(options.mainRequire) : options.mainRequire
  if (mainRequire?.length && !isolate) {
    throw new Error('mainRequire requires an isolated Nomi profile')
  }
  // 安静仪表只能经 mainRequire 装（上一条：只许装进隔离资料）。非隔离起来的就是一个不安静的 Nomi：窗口会弹到用户面前，
  // 门岗也会把它判成抢前台。所以非隔离必须声明 foreground——没放行变量按 125 跳过，放行了门岗豁免。
  if (!isolate && !foreground) {
    throw new Error("非隔离启动装不了安静仪表，要声明 foreground：launchNomiApp({ isolate: false, foreground: '<为什么必须用真实资料>' })")
  }

  // 开发 electron 二进制要靠 `.` 指到仓库根去加载 dist-electron；**打包好的 .app 自带产物**，
  // 再塞个 `.` 反而会被当成「要打开的路径」参数。所以这两件事都跟着「是不是开发构建」走。
  const isDevElectron = executablePath === require('electron')
  if (isDevElectron) {
    // 构建戳核对在最前：产物比源码旧时，后面的「文件在不在」都会通过，走查却量到旧代码。
    assertFreshBuild(repoRoot)
    assertElectronBuildArtifacts(repoRoot)
    // Apple 会在首次启动时直接删除已吊销公证的 Electron.app。走查必须在 spawn 前复用
    // dev 启动器的静态探测与重签，否则表现为 60s 超时且一张截图也产不出来。
    ensureElectronSignature(executablePath)
  }

  // isolate:false = 用用户**真实** profile 起（交互式 dev driver ui-driver.mjs 才这么用：
  // 它要能打开已有/示例项目，这是它注释里写明的既定设计，不是漏配）。此时不传 --user-data-dir、
  // 不覆盖三个目录 env，等价于「裸起一个 Nomi」；NOMI_E2E 那两条仍然强制。
  const tempRoot = isolate
    ? (options.tempRoot ? registerTempRoot(options.tempRoot) : makeTempDir(`${name}-`))
    : null
  const userDataDir = isolate ? (options.userDataDir ?? path.join(tempRoot, 'user-data')) : null
  const settingsDir = isolate ? (options.settingsDir ?? path.join(tempRoot, 'settings')) : null
  const projectsDir = isolate ? (options.projectsDir ?? path.join(tempRoot, 'projects')) : null
  // GUI advert/token 与 helper 发现目录必须同源；显式配置优先，最后才派生隔离默认值。
  const capabilityDir = options.capabilityDir
    ?? extraEnv.NOMI_CAPABILITY_DIR
    ?? process.env.NOMI_CAPABILITY_DIR
    ?? (isolate ? path.join(tempRoot, 'capability') : null)
  // isolate:false 用的就是真实 profile 与真实宿主配置（ui-driver / --real-connect 的既定设计），不动宿主变量。
  const hostConfigDir = isolate ? (options.hostConfigDir ?? path.join(tempRoot, 'host-config')) : null

  // 只建目录，**绝不清空**：不少走查会在起飞前往 projectsDir/settingsDir 里预埋工程或 catalog
  //（如 toolbar-order.walk.mjs 先写好 project.json 再启动）。启动器擅自 rm 会把它们的前置条件擦掉。
  // 想要干净 profile 的脚本自己在调用前 rmSync——语义留在看得见的地方。
  if (isolate) for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })
  if (isolate) prepareHostConfigDir(hostConfigDir, extraEnv)
  if (isolate) prepareIsolatedCatalog(settingsDir, { testedCatalogVersion: options.testedCatalogVersion })
  // 显式声明优先（core-smoke 的 profile-copy 刻意传 false：那份 catalog 是用户真实钥匙串加密的）；
  // 没声明时由盘上的 catalog 决定，见 isolatedCatalogHasSafeStorageCredentials。
  const syntheticCredentialStorage = options.syntheticCredentialStorage
    ?? (isolate ? isolatedCatalogHasSafeStorageCredentials(settingsDir) : false)

  // 主入口之前要加载的模块：开发版拼成 `-r` 对；打包版不认 `-r`，改走调试口（见 requireBeforePackagedMain）。
  const preMainArgs = [
    ...(options.initialLocalStorage ? prepareLocalStorageSeed(tempRoot, options.initialLocalStorage) : []),
    ...mainRequireArgs(mainRequire),
  ]
  // Assembly tests replace electron.launch and do not have a packaged main entry or inspector.
  // Keep the real packaged injection for every actual launch; only the explicit test hook skips
  // opening a debugger socket that the mock cannot service.
  const packagedPreMain = !isDevElectron && preMainArgs.length && !allowUntrackedProcessForTest
    ? { port: await freeLoopbackPort(), modules: preMainArgs.filter((_, index) => index % 2 === 1) }
    : null

  const launchOptions = {
    executablePath,
    args: withLinuxNoSandbox(withLinuxSyntheticCredentialStorage(
      withPackagedPlaywrightOrigin([
        ...(isDevElectron ? preMainArgs : []),
        ...(packagedPreMain ? [`--inspect-brk=127.0.0.1:${packagedPreMain.port}`] : []),
        ...(isDevElectron ? ['.'] : []),
        ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
        ...extraArgs,
      ], !isDevElectron),
      syntheticCredentialStorage,
    )),
    cwd: repoRoot,
    // 只认显式的 syntheticCredentialStorage: true：盘上推出来的那一档也可能是拷进来的真实资料（core-smoke 那种），不能替它关网。
    env: buildNomiLaunchEnv({
      extraEnv,
      userDataDir, settingsDir, projectsDir, capabilityDir, hostConfigDir,
      fixtureCredentials: options.syntheticCredentialStorage === true,
      foreground: Boolean(foreground),
    }),
    timeout,
  }

  // 主进程输出留底：窗口起不来时，真正的线索基本都在 stderr 里。
  const logTail = []
  const keepTail = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) logTail.push(line)
    }
    // 400 行而不是 40：40 行只够回答「窗口为什么没起来」（失败就在最后几行）。
    // 一条**跑到半路才断言红**的旅程，线索在几十秒前的主进程日志里，40 行根本追不到。
    if (logTail.length > 400) logTail.splice(0, logTail.length - 400)
  }

  const preMainInjection = packagedPreMain ? requireBeforePackagedMain({ ...packagedPreMain, timeout }) : null
  preMainInjection?.catch(() => undefined) // 下面等它；先挂上，免得 App 先起不来时报成未处理的拒绝

  let app
  try {
    app = await electron.launch(launchOptions)
  } catch (error) {
    cleanupTempRoot(tempRoot)
    throw new Error(diagnoseLaunchFailure(`Electron 起不来（electron.launch 失败/超时，${timeout}ms）`, name, error, logTail))
  }
  // 走查里直接写的 `await app.close()`（经这里起 App 的近 300 个文件）也走有上限的关闭：Playwright 的 close 要等子进程的标准输出 / 错误
  // 管道全关；Linux 上 Electron 的帮手进程继承了这两根管道，主进程退了它们还攥着，close 就永远不 resolve
  // （夜跑 run 40035294026：断言全过的 preview-export-busy / editing-real-user-pass 挂到 600 秒）。
  const rawClose = app.close.bind(app)
  app[RAW_CLOSE] = rawClose
  app.close = () => closeElectronWithin(app, rawClose, GRACEFUL_CLOSE_BOUND_MS)
  const instanceRegistration = registerWalkProcess(app.process(), { worktree: repoRoot, name, allowUntrackedProcessForTest })
  const foregroundGuard = startMacForegroundGuard({ appPid: app.process()?.pid, foreground: Boolean(foreground) })
  const close = async () => {
    try {
      foregroundGuard.sample('before-close')
      await closeNomiApp(app)
    } finally {
      foregroundGuard.stop('after-close')
      instanceRegistration.cleanup()
      cleanupTempRoot(tempRoot)
    }
  }

  if (preMainInjection) {
    try {
      await preMainInjection
    } catch (error) {
      await close()
      throw new Error(`[${name}] 打包形态没能在主入口之前装上 ${packagedPreMain.modules.join(', ')}：${error.message}`)
    }
  }

  try {
    app.process().stdout?.on('data', keepTail)
    app.process().stderr?.on('data', keepTail)
  } catch {
    // 拿不到子进程句柄不致命——只是报错时少了 stderr 尾巴。
  }

  // waitForWindow:false = 压根不开窗的用法（如 evals/verify-shot-smoke.mjs：只在主进程
  // app.evaluate 里解密+调模型）。这种脚本等 firstWindow 只会白等到超时。
  let win = null
  if (waitForWindow) {
    try {
      win = await app.firstWindow({ timeout })
    } catch (error) {
      // 两种失败形状都落这儿：等超时，以及 app 提前退出导致的 TargetClosedError
      //（单实例锁没抢到就是后者——主进程自己 quit 了）。诊断是同一套。
      await close()
      throw new Error(diagnoseLaunchFailure(`等了 ${timeout}ms 没等到窗口`, name, error, logTail))
    }
    await win.waitForLoadState('domcontentloaded')
    // 这里原先等过一次启动路由改写（09-12「热启动时 browserWindow 句柄随页面导航失效」）。那个归因不成立：
    // `app.browserWindow(win)` 的句柄活在主进程，不绑页面上下文。当时那句「Execution context was destroyed」
    // 与 10-18 起打包冒烟的间歇红是同一类——主进程正忙时 Playwright 的 evaluate 结果被 GC 收掉
    // （"Promise was collected" 被改写成导航报错），已在共享边界修掉：patches/playwright-core@1.60.0.patch，
    // 回归见 tests/ux/playwright-main-evaluate.e2e.mjs。等路由只是挪了时机，按 P1 同批删掉。
    const viewportSize = options.viewportSize ?? ACCEPTANCE_VIEWPORT
    // Native resize alone may be clamped by CI's display; bind Chromium content geometry too.
    const browserWindow = await app.browserWindow(win)
    await browserWindow.evaluate((window, size) => window.setContentSize(size.width, size.height), viewportSize)
    await win.setViewportSize(viewportSize)
    const actualViewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    if (actualViewport.width !== viewportSize.width || actualViewport.height !== viewportSize.height) {
      await close()
      throw new Error(`Acceptance viewport mismatch: expected ${JSON.stringify(viewportSize)}, got ${JSON.stringify(actualViewport)}`)
    }
    console.log('[walkthrough] content viewport', JSON.stringify(actualViewport))
    // Optional test observer owns measurement; installed before caller setup/actions.
    try {
      if (options.observeWindow) await options.observeWindow(win)
    } catch (error) {
      await close()
      throw error
    }
    if (options.initialLocalStorage) {
      const missing = await win.evaluate((keys) => keys.filter((key) => localStorage.getItem(key) === null), Object.keys(options.initialLocalStorage))
      if (missing.length) {
        await close()
        throw new Error(`initialLocalStorage was not seeded before the first document: ${missing.join(', ')}`)
      }
    }
    if (settleMs > 0) await win.waitForTimeout(settleMs)
    installFeelObserver(win, { name })
    let nextWindow = 1
    app.on('window', (page) => installFeelObserver(page, { name: `${name}-window-${++nextWindow}` }))
  }

  try {
    await configureSyntheticCredentialStorage(app, syntheticCredentialStorage)
  } catch (error) {
    await close()
    throw error
  }

  return {
    app,
    win,
    tempRoot,
    userDataDir,
    settingsDir,
    projectsDir,
    capabilityDir,
    hostConfigDir,
    /** 主进程 stdout+stderr 的尾巴（最多 400 行）。断言红时给调用方看，不必只在启动失败时才有。 */
    mainLogTail: () => logTail.slice(),
    close,
  }
}

/**
 * 说人话的失败报告：说清楚卡在哪、可能是什么、下一步敲什么。
 *
 * 注意排序：单实例锁那条**已经被启动器强制解掉了**，所以它不再是首要嫌疑——
 * 把它排第一会把人往错方向带。真实剩下的头号原因是构建产物过期。
 */
export function diagnoseLaunchFailure(headline, name, error, logTail) {
  const fullError = String(error?.message || error || '')
  // 用 Call log 作子进程输出的真源：electron.launch resolve 之前我们还拿不到
  // app.process()，此时 Playwright 只会把 stderr 收在这一段。原始错误摘要仍去掉
  // Call log，避免与下面已清洗的主进程尾巴重复。
  const callLogMarker = '\nCall log:'
  const callLogIndex = fullError.indexOf(callLogMarker)
  const raw = (callLogIndex >= 0 ? fullError.slice(0, callLogIndex) : fullError).trim()
  const playwrightProcessOutput = callLogIndex >= 0
    ? fullError.slice(callLogIndex + callLogMarker.length)
    : fullError
  // launch 本身就失败时我们还没拿到子进程句柄，logTail 是空的；但 Playwright 自己把主进程
  // stderr 收进了错误文本（`[pid=123][err] ...`）——从那儿捞出来，别对着空手说「没有输出」。
  const observedOutput = logTail.length
    ? logTail
    : playwrightProcessOutput
        .split('\n')
        .filter((line) => /^\s*-?\s*\[pid=\d+\]\[err\]/.test(line))
        .map((line) => line.replace(/^\s*-?\s*\[pid=\d+\]\[err\]\s?/, ''))
  const tail = observedOutput
    .filter((line) => line.trim() && !/Debugger (listening|attached)|inspector|DevTools listening|Waiting for the debugger/i.test(line))
    .slice(-20)

  const lines = [
    '',
    `❌ Nomi 走查启动失败（${name}）：${headline}`,
    '',
    '按可能性排查：',
    '  1) 构建产物过期 —— 走查跑的是 dist-electron 的产物，不是源码。改完代码没重新构建，',
    '     或主进程启动时就抛错，都会长这样。→ pnpm run build 后重跑。',
    '  2) 主进程启动即退/崩溃 —— 看下面那几行主进程输出，真正的线索基本都在那儿。',
    '  3) 单实例锁 —— 本启动器**已强制** NOMI_E2E_ALLOW_MULTI_INSTANCE=1，本机 Nomi.app 开着也不该被挡；',
    '     只有当别的进程正占着同一个 --user-data-dir 时才可能重新出现。',
    '',
  ]
  if (tail.length) {
    lines.push('主进程最后几行输出：', ...tail.map((l) => `  │ ${l}`), '')
  } else {
    lines.push('（启动器未捕获到主进程输出；这不能证明进程未启动，仍需结合系统进程或采样确认。）', '')
  }
  lines.push(`原始错误：${raw}`)
  return lines.join('\n')
}

const RAW_CLOSE = Symbol('nomi.rawElectronClose')
/** 走查自己 `app.close()` 时等优雅退出的上限：产品的退出收尾自己最多 3 秒（electron/quitTeardown.ts），这里留足余量。 */
export const GRACEFUL_CLOSE_BOUND_MS = 15_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 这个进程此刻的全部子孙 pid（POSIX）。主进程一退，子孙就被过继给 init，再按父子关系就找不到了——所以要在关之前拍。 */
export function descendantPids(rootPid, list = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })) {
  if (!rootPid || process.platform === 'win32') return []
  let out
  try { out = list() } catch { return [] }
  const children = new Map()
  for (const line of out.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid) continue
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid).push(pid)
  }
  const found = []
  const stack = [rootPid]
  while (stack.length) {
    for (const child of children.get(stack.pop()) ?? []) { found.push(child); stack.push(child) }
  }
  return found
}

/**
 * 关掉一个 Electron，保证一定往下走：优雅关闭最多等 boundMs；过了就 SIGKILL 它和关之前拍下的子孙进程
 * （只动这一棵树，不按名字杀），再放掉它的标准输入 / 输出 / 错误管道和进程句柄——Linux 上帮手进程攥着的管道
 * 不放，走查进程自己也退不出去。
 */
export async function closeElectronWithin(app, rawClose, boundMs) {
  // 已经关过的 app（走查先 `app.close()`、再调启动器的 `close()` / `closeNomiApp`）：Playwright 的 process() 这时会抛
  // 「Cannot read properties of undefined (reading '_object')」——句柄早没了，也就没有树可拍，照样把 close 再走一遍。
  let child
  try { child = app.process?.() } catch { child = undefined }
  const tree = child?.pid ? descendantPids(child.pid) : []
  let closed = false
  await Promise.race([
    Promise.resolve().then(rawClose).then(() => { closed = true }).catch(() => undefined),
    sleep(boundMs),
  ])
  if (closed) return
  // 留痕：优雅关闭没在上限内完成（产品退出卡住，或帮手进程攥着管道）——强杀不是静默的。
  console.warn(`[launchNomiApp] app.close() 等满 ${boundMs}ms 没结束，按进程树强杀 pid=${child?.pid ?? '?'}（子孙 ${tree.length} 个）`)
  if (process.platform === 'win32' && child?.pid) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已经没了 */ }
  } else {
    for (const pid of [child?.pid, ...tree]) {
      if (!pid) continue
      try { process.kill(pid, 'SIGKILL') } catch { /* 已经没了 */ }
    }
  }
  for (const stream of [child?.stdin, child?.stdout, child?.stderr]) {
    try { stream?.destroy() } catch { /* 已经关了 */ }
  }
  try { child?.unref() } catch { /* 没有句柄 */ }
  await sleep(100)
}

/**
 * 收尾。electron teardown 在部分环境会 hang（app.close() 永不 resolve），串跑时会把整条卡死，
 * 故给 3s 兜底：尽量清干净，但保证一定往下走（不在乎优雅退出的场合用它；要等产品自己收尾的走查直接 app.close()）。
 */
export async function closeNomiApp(app) {
  if (!app) return
  await closeElectronWithin(app, app[RAW_CLOSE] ?? (() => app.close()), 3000)
}

/**
 * 给隔离 profile 备好「这几家各有一把可用的测试 key」：先起一次 App，经产品自己的保存口把占位 key 存成密文，
 * 关掉后在盘上把这几家的凭据和供应商翻成已启用，调用方再用同一组 options 正式起 App。
 *
 * 为什么不在正式那次里直接调 upsertVendorApiKey：保存即验证（credentialProbePolicy，APIMart / Runway 有免费探测）。
 * 开着网，占位 key 真发给供应商、401（夜跑 run 40035294026）；假凭据默认关网（见 buildNomiLaunchEnv），验证打不出去，
 * 产品照语义存成「未验证、停用」，这家的模型进不了下拉。也不能在盘上直接种明文 key：自 019d80f1d 起明文不算可用凭据。
 * 这里只翻「验证通过」会翻的标志（凭据 enabled、去掉 verificationPending；供应商 enabled），密文由产品自己写——
 * 和 credential-connect-honesty 态②同一个做法。只给隔离目录里的非秘密测试 key 用。
 */
export async function seedSavedFixtureCredentials(options, vendorKeys, apiKey = 'nomi-e2e-placeholder') {
  // 两次起 App 必须同一组目录：密文由 userDataDir 里的加密身份解（Windows 的 DPAPI 密钥只在它的 Local State 里）。
  if (options.syntheticCredentialStorage !== true || !options.settingsDir || !options.userDataDir) {
    throw new Error('seedSavedFixtureCredentials 只给隔离目录里的非秘密测试 key 用：要显式 syntheticCredentialStorage: true、settingsDir 和 userDataDir')
  }
  const { app, win } = await launchNomiApp({ ...options, name: `${options.name ?? 'nomi-walk'}-seed-credentials`, settleMs: 0 })
  try {
    for (const vendorKey of vendorKeys) {
      await win.evaluate(({ key, value }) => window.nomiDesktop.modelCatalog.upsertVendorApiKey(key, { apiKey: value, enabled: true }), { key: vendorKey, value: apiKey })
    }
  } finally {
    await app.close()
  }
  const catalogPath = path.join(options.settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  for (const vendorKey of vendorKeys) {
    const record = catalog.apiKeysByVendor?.[vendorKey]
    if (!record?.apiKey || record.enc !== 'safeStorage') throw new Error(`${vendorKey} 的测试 key 没以密文落盘（保存口没写下它）`)
    record.enabled = true
    delete record.verificationPending
    const vendor = catalog.vendors?.find((item) => item.key === vendorKey)
    if (vendor) vendor.enabled = true
  }
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
}
