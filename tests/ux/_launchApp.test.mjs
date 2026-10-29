import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 钉住启动器的核心不变量（替掉原 helpers/electronFixture.test.mjs，2026-08-11 收敛）。
// 这条不变量就是本次修复的根因：漏掉这两个 env，窗口起不来且**毫无提示**，只会干等到超时。
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { _electron as playwrightElectron } from 'playwright'
import { describe, expect, test, vi } from 'vitest'
import {
  buildNomiLaunchEnv,
  cleanupTempRoot,
  closeElectronWithin,
  descendantPids,
  configureSyntheticCredentialStorage,
  currentCatalogVersion,
  diagnoseLaunchFailure,
  isolatedCatalogHasSafeStorageCredentials,
  prepareIsolatedCatalog,
  prepareLocalStorageSeed,
  launchNomiApp,
  mainRequireArgs,
  withQuietWalk,
  quietElectronSpawn,
  assertForegroundAllowed,
  exitIfWalkSkipped,
  WalkSkippedError,
  WALK_SKIPPED_EXIT_CODE,
  frontGuardVerdict,
  parseLsappinfoInfo,
  summarizeFrontSamples,
  repoRoot,
  registerTempRoot,
  requireBeforePackagedMain,
  withLinuxNoSandbox,
  withLinuxSyntheticCredentialStorage,
  withPackagedPlaywrightOrigin,
  seedSavedFixtureCredentials,
  isolatedHostConfigLeaks,
  prepareHostConfigDir,
  withIsolatedHostConfig,
} from './_launchApp.mjs'
import { MCP_CLIENT_HOST_ENV_VARS, mcpClientLocations, mcpClientPlatform, resolveMcpClientPath } from '../../electron/shared/mcpClientRegistry.ts'

/** 会起 App 的源码：tests / scripts / evals 下的 .mjs / .js（单测故意拼不合法的选项来测拒绝路径，不算入口）。按需解析成 AST。 */
let launchSourceCache = null
function launchSources() {
  launchSourceCache ??= ['tests', 'scripts', 'evals']
    .flatMap((directory) => fs.readdirSync(path.join(repoRoot, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name) && !/\.(?:test|node-test)\.m?js$/.test(entry.name) && !entry.parentPath.includes('node_modules'))
      .map((entry) => path.join(entry.parentPath, entry.name)))
    .map((file) => {
      const text = fs.readFileSync(file, 'utf8')
      let source = null
      return { rel: path.relative(repoRoot, file).split(path.sep).join('/'), text, get source() { return (source ??= ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)) } }
    })
  return launchSourceCache
}
function objectLiterals(file) {
  const found = []
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file.source)
  return found
}
const declaresForeground = (node, source) => node.properties.some((property) => property.name?.getText(source) === 'foreground')
const lineOf = (file, node) => file.source.getLineAndCharacterOfPosition(node.getStart()).line + 1

describe('shared Electron temp-root lifecycle', () => {
  test('cleanup is idempotent for explicit and generated roots', () => {
    const root = makeTempDir('nomi-launch-cleanup-')
    registerTempRoot(root)
    expect(fs.existsSync(root)).toBe(true)
    cleanupTempRoot(root)
    cleanupTempRoot(root)
    expect(fs.existsSync(root)).toBe(false)
  })
})

const dirs = { userDataDir: '/tmp/case/user-data', settingsDir: '/tmp/case/settings', projectsDir: '/tmp/case/projects', hostConfigDir: '/tmp/case/host-config' }
const hostVarsUnder = (root) => Object.fromEntries(MCP_CLIENT_HOST_ENV_VARS.map((name) => [name, path.join(root, name)]))

describe('initial local storage fixture', () => {
  test('seeds missing preferences while preserving explicit values and excluding subframes', () => {
    const root = makeTempDir('nomi-storage-seed-')
    try {
      const args = prepareLocalStorageSeed(root, { 'nomi:splash:v1': 'seen', 'nomi-color-scheme': 'light' })
      let listener
      let registration
      vm.runInNewContext(fs.readFileSync(args[1], 'utf8'), {
        require: () => ({ app: { once: (event, callback) => {
          expect(event).toBe('session-created')
          listener = callback
        } } }),
      })
      listener({ registerPreloadScript: (value) => { registration = value } })
      expect(args[0]).toBe('-r')
      expect(registration.type).toBe('frame')
      const values = new Map([['nomi-color-scheme', 'dark']])
      const context = {
        process: { isMainFrame: false },
        window: { localStorage: {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, value),
        } },
      }
      const script = fs.readFileSync(registration.filePath, 'utf8')
      vm.runInNewContext(script, context)
      expect(values.has('nomi:splash:v1')).toBe(false)
      context.process.isMainFrame = true
      vm.runInNewContext(script, context)
      expect(Object.fromEntries(values)).toEqual({ 'nomi-color-scheme': 'dark', 'nomi:splash:v1': 'seen' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses to seed a real profile before launching Electron', async () => {
    await expect(launchNomiApp({ executablePath: 'unused-by-isolation-guard', isolate: false, initialLocalStorage: { 'nomi:splash:v1': 'seen' } }))
      .rejects.toThrow('requires an isolated Nomi profile')
  })
})

describe('mainRequire（主进程入口前的 -r 模块）', () => {
  test('每个绝对路径拼成一对 -r，顺序保持', () => {
    const root = makeTempDir('nomi-main-require-')
    try {
      const first = path.join(root, 'guard.cjs')
      const second = path.join(root, 'probe.cjs')
      fs.writeFileSync(first, '')
      fs.writeFileSync(second, '')
      expect(mainRequireArgs([first, second])).toEqual(['-r', first, '-r', second])
      expect(mainRequireArgs(undefined)).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('每个隔离启动默认补 quiet-walk；已经带了不重复', () => {
    const guard = path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')
    expect(withQuietWalk(undefined)).toHaveLength(1)
    expect(withQuietWalk([guard])).toHaveLength(2)
    const withQuiet = withQuietWalk([guard])
    expect(withQuiet[1]).toMatch(/_quietWalk.cjs$/)
    expect(withQuietWalk(withQuiet)).toEqual(withQuiet)
    expect(mainRequireArgs(withQuiet)).toHaveLength(4)
  })

  test('foreground 声明缺少放行变量时以退出码 125 跳过', () => {
    expect(() => assertForegroundAllowed(undefined, {})).not.toThrow()
    expect(() => assertForegroundAllowed('需要验证前台激活', {})).toThrow(WalkSkippedError)
    try { assertForegroundAllowed('需要验证前台激活', {}) } catch (error) {
      expect(error).toMatchObject({ code: 'NOMI_WALK_SKIPPED', exitCode: 125 })
    }
    expect(() => assertForegroundAllowed('需要验证前台激活', { NOMI_WALK_FOREGROUND_OK: '1' })).not.toThrow()
  })

  test('exitIfWalkSkipped：跳过就以 125 退出，别的错照抛', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`) })
    try {
      expect(() => exitIfWalkSkipped(new WalkSkippedError('未跑'))).toThrow(`exit ${WALK_SKIPPED_EXIT_CODE}`)
      expect(() => exitIfWalkSkipped(new Error('boom'))).toThrow('boom')
      expect(exit).toHaveBeenCalledTimes(1)
    } finally {
      exit.mockRestore()
    }
  })

  test('门岗只把走查 App PID 在最前判红，foreground 声明豁免', () => {
    expect(frontGuardVerdict({ frontPid: 42, appPid: 42 })).toMatchObject({ ok: false, reason: '走查抢了前台' })
    expect(frontGuardVerdict({ frontPid: 41, appPid: 42 })).toMatchObject({ ok: true })
    expect(frontGuardVerdict({ frontPid: 42, appPid: 42, foreground: true })).toMatchObject({ ok: true, exempt: true })
  })

  // 约 220 条走查结尾自己 process.exit(…)，13 条是 process.exit(0)：判红只设 exitCode 会被它盖成绿。
  test('门岗判红后走查自己 process.exit(0) / exit(125)：退出码仍是 1；没违规照原码退，别的红码不改', () => {
    const launcher = pathToFileURL(path.join(repoRoot, 'tests/ux/_launchApp.mjs')).href
    const run = (frontPid, exitWith) => spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { startMacForegroundGuard } = await import(${JSON.stringify(launcher)})
      const sample = () => ({ asn: 'ASN:0x0-0x1:', pid: ${frontPid}, name: 'walk', applicationType: 'Foreground', appType: 'Foreground' })
      startMacForegroundGuard({ appPid: 42, platform: 'darwin', intervalMs: 60_000, sample })
      process.exit(${exitWith})
    `], { cwd: repoRoot, encoding: 'utf8' })
    const stolen = run(42, 0)
    expect(stolen.status, stolen.stderr).toBe(1)
    expect(stolen.stderr).toContain('走查抢了前台')
    expect(run(42, WALK_SKIPPED_EXIT_CODE).status).toBe(1)
    expect(run(42, 3).status).toBe(3)
    expect(run(41, 0).status).toBe(0)
  }, 60_000)

  test('lsappinfo 输出解析出最前应用的名字、PID、类型', () => {
    expect(parseLsappinfoInfo('"pid"=30987\n"ApplicationType"="Foreground"\n"LSDisplayName"="Claude"\n'))
      .toEqual({ pid: 30987, name: 'Claude', applicationType: 'Foreground' })
    expect(parseLsappinfoInfo('"ApplicationType"="UIElement"\n')).toEqual({ pid: null, name: null, applicationType: 'UIElement' })
    expect(parseLsappinfoInfo('')).toEqual({ pid: null, name: null, applicationType: null })
  })

  test('门岗收尾那一行：全程最前是谁、走查 App 类型、判定', () => {
    const row = (overrides) => ({ phase: 'interval', at: 't1', pid: 30987, name: 'Claude', appType: 'UIElement', ok: true, exempt: false, ...overrides })
    expect(summarizeFrontSamples([row({ phase: 'started', at: 't0' }), row()], 42))
      .toBe('[quiet-walk] 前台抽样 2 次；最前：Claude(pid 30987)×2；走查 App(pid 42) 类型：UIElement×2；没抢前台')
    expect(summarizeFrontSamples([row(), row({ pid: 42, name: 'Electron', appType: 'Foreground', ok: false, at: 't2' }), row({ pid: null, error: 'timeout' })], 42))
      .toBe('[quiet-walk] 前台抽样 3 次；最前：Claude(pid 30987)×1、Electron(pid 42)×1、未知(抽样失败)×1；走查 App(pid 42) 类型：UIElement×2、Foreground×1；抢了前台 1 次（首次 interval t2）')
    expect(summarizeFrontSamples([row({ exempt: true, pid: 42 })], 42)).toContain('foreground 声明，豁免')
    expect(summarizeFrontSamples([row(), row({ phase: 'after-close', appType: null }), row({ appType: null })], 42))
      .toContain('走查 App(pid 42) 类型：UIElement×1、已退出×1、未登记×1；')
  })

  test('相对路径与不存在的文件当场拒（相对路径会被 Node 当包名去找，闸就静默没装上）', () => {
    expect(() => mainRequireArgs(['scripts/walkthrough-network-guard.cjs'])).toThrow('absolute module paths')
    expect(() => mainRequireArgs([path.join(os.tmpdir(), 'nomi-no-such-guard.cjs')])).toThrow('does not exist')
  })

  test('不许装进真实 profile', async () => {
    await expect(launchNomiApp({ executablePath: 'unused-by-isolation-guard', isolate: false, mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')] }))
      .rejects.toThrow('mainRequire requires an isolated Nomi profile')
  })

  // 仪表装不进真实 profile（上一条），非隔离起来的就是一个不安静的 Nomi：没声明 foreground 就不许起，门岗也不该把它判成抢前台。
  test('非隔离启动没声明 foreground：起 App 之前就拒；声明了但没放行：按 125 跳过，同样不起', async () => {
    const launch = vi.spyOn(playwrightElectron, 'launch')
    const allowed = process.env.NOMI_WALK_FOREGROUND_OK
    delete process.env.NOMI_WALK_FOREGROUND_OK
    try {
      const options = { executablePath: '/fixture/Nomi', isolate: false, waitForWindow: false, allowUntrackedProcessForTest: true }
      await expect(launchNomiApp(options)).rejects.toThrow('非隔离启动装不了安静仪表，要声明 foreground')
      await expect(launchNomiApp({ ...options, foreground: '真实资料付费抽检' })).rejects.toMatchObject({ code: 'NOMI_WALK_SKIPPED', exitCode: 125 })
      expect(launch).not.toHaveBeenCalled()
    } finally {
      launch.mockRestore()
      if (allowed === undefined) delete process.env.NOMI_WALK_FOREGROUND_OK
      else process.env.NOMI_WALK_FOREGROUND_OK = allowed
    }
  })

  // 同类入口：新写一条 isolate:false 却忘了声明，CI 里这一条先红，不等到有人在真机上跑才发现。
  test('仓库里每个 isolate: false 的启动选项都同时声明了 foreground', () => {
    const offenders = []
    for (const file of launchSources().filter(({ text }) => /\bisolate\s*:\s*false\b/.test(text))) {
      for (const node of objectLiterals(file)) {
        const isolateFalse = node.properties.some((property) => ts.isPropertyAssignment(property)
          && property.name.getText(file.source) === 'isolate' && property.initializer.kind === ts.SyntaxKind.FalseKeyword)
        if (isolateFalse && !declaresForeground(node, file.source)) offenders.push(`${file.rel}:${lineOf(file, node)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // 不经 launchNomiApp、自己 spawn Electron 的走查也装同一份仪表；放行位在子进程环境里同样钉死，终端 export 的 1 漏不进来。
  test('直接 spawn Electron 的入口：-r 装安静仪表，子进程环境里的放行位钉成空串', () => {
    const spec = quietElectronSpawn(['.', '--disable-gpu'], { cwd: '/fixture', env: { PATH: '/bin', NOMI_WALK_FOREGROUND_OK: '1' } }, 'darwin')
    expect(spec.args).toEqual(['-r', expect.stringMatching(/_quietWalk\.cjs$/), '.', '--disable-gpu'])
    expect(spec.options).toEqual({ cwd: '/fixture', env: { PATH: '/bin', NOMI_WALK_FOREGROUND_OK: '' } })
    expect(quietElectronSpawn(['.'], {}, 'linux').args).toEqual(['-r', expect.stringMatching(/_quietWalk\.cjs$/), '.', '--no-sandbox', '--enable-unsafe-swiftshader'])
    const inherited = process.env.NOMI_WALK_FOREGROUND_OK
    process.env.NOMI_WALK_FOREGROUND_OK = '1'
    try {
      expect(quietElectronSpawn(['.']).options.env.NOMI_WALK_FOREGROUND_OK).toBe('')
    } finally {
      if (inherited === undefined) delete process.env.NOMI_WALK_FOREGROUND_OK
      else process.env.NOMI_WALK_FOREGROUND_OK = inherited
    }
  })

  // 同类入口：新写一处直接 spawn Electron、自己拼 `-r <仪表>` 和 process.env，放行位就又能被继承进去——只许经 spawnQuietElectron。
  test('仓库里直接 spawn Electron 又装安静仪表的，都经 spawnQuietElectron（放行位钉死）', () => {
    const offenders = []
    const spawnLike = /^(?:spawn|spawnSync|execFile|execFileSync|fork)$/
    for (const file of launchSources().filter(({ rel, text }) => rel !== 'tests/ux/_launchApp.mjs' && /_quietWalk|QUIET_WALK_MODULE/.test(text))) {
      const visit = (node) => {
        if (ts.isCallExpression(node) && spawnLike.test(node.expression.getText(file.source).split('.').pop())) {
          const args = node.arguments.map((argument) => argument.getText(file.source)).join(' ')
          if (/require\(\s*['"]electron['"]\s*\)|['"](?:-r|--require)['"]/.test(args)) offenders.push(`${file.rel}:${lineOf(file, node)}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(file.source)
    }
    expect(offenders).toEqual([])
  })

  // P1：屏外 / 不抢焦点的主进程仪表只有一份。旧的 tests/ux/full-walk/offscreenWindow.cjs 已删，不许再长出并行版。
  test('挂 browser-window-created 的主进程走查仪表全仓只有 tests/ux/_quietWalk.cjs', () => {
    const instruments = ['tests', 'scripts', 'evals']
      .flatMap((directory) => fs.readdirSync(path.join(repoRoot, directory), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.c?js$/.test(entry.name) && !entry.parentPath.includes('node_modules'))
        .map((entry) => path.join(entry.parentPath, entry.name)))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('browser-window-created'))
      .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
    expect(instruments).toEqual(['tests/ux/_quietWalk.cjs'])
  })

  // 安静模式下 BrowserWindow 的 focus / moveTop 是空操作、窗口在屏外不可聚焦：靠真焦点、真窗口的走查不声明 foreground，
  // 要么红，要么更糟——悄悄不测还报绿（windows-freeze-sweep 的失焦再聚焦循环就是这样）。
  test('靠真焦点 / 真窗口的走查都声明了 foreground，没放行按 125 退出', () => {
    const FOREGROUND_WALKS = [
      'tests/ux/app-page-zoom.e2e.mjs', // bringToFront、focus 之后按缩放快捷键
      'tests/ux/attention-sound.walk.mjs', // 窗口有没有焦点决定提示音
      'tests/ux/window-drag.e2e.mjs', // show / setBounds / moveTop / focus 之后拖窗口
      'tests/ux/windows-freeze-sweep.walk.mjs', // blur / focus 循环
      'tests/ux/mcp-key-window.walk.mjs', // app.focus({ steal }) 把窗口叫回前台
    ]
    const sources = launchSources()
    // 同类：Playwright 的 bringToFront 只在真前台才有意义，用到它的走查一律要声明。
    const bringToFront = sources.filter(({ text }) => /\.bringToFront\(/.test(text)).map(({ rel }) => rel)
    const missing = []
    for (const rel of [...new Set([...FOREGROUND_WALKS, ...bringToFront])]) {
      const file = sources.find((candidate) => candidate.rel === rel)
      if (!file) { missing.push(`${rel}: 文件不在了`); continue }
      if (!objectLiterals(file).some((node) => declaresForeground(node, file.source))) missing.push(`${rel}: 没声明 foreground`)
      if (!/exitIfWalkSkipped|NOMI_WALK_SKIPPED/.test(file.text)) missing.push(`${rel}: 跳过时没按 125 退出`)
    }
    expect(missing).toEqual([])
  })

  // 打包好的 App 静默忽略 `-r`：闸没装上、请求直奔真网。打包形态必须在主入口第一行之前真的装上。
  test('打包形态：模块在 app.asar/dist-electron/main.js 第一行之前就已加载', async () => {
    const root = makeTempDir('nomi-packaged-premain-')
    const entryDir = path.join(root, 'resources', 'app.asar', 'dist-electron')
    fs.mkdirSync(entryDir, { recursive: true })
    const guard = path.join(root, 'guard.cjs')
    const seen = path.join(root, 'seen.txt')
    fs.writeFileSync(guard, 'globalThis.__nomiGuard = "installed-before-main"\n')
    fs.writeFileSync(path.join(entryDir, 'main.js'), `require('node:fs').writeFileSync(${JSON.stringify(seen)}, String(globalThis.__nomiGuard))\n`)
    const port = await new Promise((resolve) => {
      const server = net.createServer().listen(0, '127.0.0.1', () => { const { port: free } = server.address(); server.close(() => resolve(free)) })
    })
    const child = spawn(process.execPath, [`--inspect-brk=127.0.0.1:${port}`, path.join(entryDir, 'main.js')], { stdio: 'ignore' })
    const exited = new Promise((resolve) => child.once('exit', resolve))
    try {
      await requireBeforePackagedMain({ port, modules: [guard], timeout: 20_000 })
      await exited
      expect(fs.readFileSync(seen, 'utf8')).toBe('installed-before-main')
    } finally {
      child.kill()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('prepareIsolatedCatalog', () => {
  test('quarantines a seed newer than the tested app instead of letting it enter Electron', () => {
    const root = makeTempDir('nomi-catalog-seed-red-')
    const catalog = path.join(root, 'model-catalog.json')
    const future = { version: 12, futureOnlyField: 'preserve-me', vendors: [], models: [], mappings: [], apiKeysByVendor: {} }
    fs.writeFileSync(catalog, JSON.stringify(future))

    const result = prepareIsolatedCatalog(root, { testedCatalogVersion: 11 })

    expect(result.status).toBe('quarantined')
    expect(fs.existsSync(catalog)).toBe(false)
    expect(JSON.parse(fs.readFileSync(result.quarantinePath, 'utf8'))).toEqual(future)
  })

  test('keeps current and older seeds for the app migration chain', () => {
    for (const diskVersion of [currentCatalogVersion(), currentCatalogVersion() - 1]) {
      const root = makeTempDir('nomi-catalog-seed-compatible-')
      const catalog = path.join(root, 'model-catalog.json')
      fs.writeFileSync(catalog, JSON.stringify({ version: diskVersion, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }))

      expect(prepareIsolatedCatalog(root)).toMatchObject({ status: 'compatible', diskVersion })
      expect(JSON.parse(fs.readFileSync(catalog, 'utf8')).version).toBe(diskVersion)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('buildNomiLaunchEnv', () => {
  test('钉死必需 env 并隔离每个可写路径', () => {
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {} })).toEqual({
      NOMI_E2E: '1',
      NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
      // 走查环境里主进程日志必须看得见（否则 CI 的 job 日志里一条 WARN 都没有）。
      NOMI_LOG_STDERR: '1',
      // 安静仪表的放行位：没声明 foreground 就显式是空串。
      NOMI_WALK_FOREGROUND_OK: '',
      NOMI_ELECTRON_USER_DATA_DIR: dirs.userDataDir,
      NOMI_SETTINGS_DIR: dirs.settingsDir,
      NOMI_PROJECTS_DIR: dirs.projectsDir,
      // 宿主自己的配置位置变量（CLAUDE_CONFIG_DIR / CODEX_HOME，名单在注册表）也指进隔离目录。
      ...hostVarsUnder(dirs.hostConfigDir),
    })
  })

  test('调用方覆盖不掉这两条——本次修复的根因就在这里', () => {
    // 走查作者可能出于任何理由传进来（复制粘贴、想「测生产行为」……）。
    // 覆盖成功 = 窗口起不来 + 零提示，所以启动器必须无视它。
    const env = buildNomiLaunchEnv({
      ...dirs,
      baseEnv: {},
      extraEnv: { NOMI_E2E: '0', NOMI_E2E_ALLOW_MULTI_INSTANCE: undefined },
    })
    expect(env.NOMI_E2E).toBe('1')
    expect(env.NOMI_E2E_ALLOW_MULTI_INSTANCE).toBe('1')
  })

  // 跑走查的终端里 export 过 NOMI_WALK_FOREGROUND_OK=1：不钉死的话，没声明 foreground 的走查也起成前台模式，安静仪表整个失效。
  test('安静仪表的放行位只跟 foreground 声明走：继承来的、调用方传的 1 都盖不掉', () => {
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: { NOMI_WALK_FOREGROUND_OK: '1' } }).NOMI_WALK_FOREGROUND_OK).toBe('')
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {}, extraEnv: { NOMI_WALK_FOREGROUND_OK: '1' } }).NOMI_WALK_FOREGROUND_OK).toBe('')
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {}, foreground: true }).NOMI_WALK_FOREGROUND_OK).toBe('1')
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {}, extraEnv: { NOMI_WALK_FOREGROUND_OK: '' }, foreground: true }).NOMI_WALK_FOREGROUND_OK).toBe('1')
  })

  test('launchNomiApp 把这一位接进真正起 App 的 env（只换掉 electron.launch）', async () => {
    const launches = []
    const launch = vi.spyOn(playwrightElectron, 'launch').mockImplementation(async (launchOptions) => {
      launches.push(launchOptions)
      return { process: () => ({}), close: async () => {} }
    })
    const allowed = process.env.NOMI_WALK_FOREGROUND_OK
    process.env.NOMI_WALK_FOREGROUND_OK = '1'
    try {
      for (const options of [{}, { env: { NOMI_WALK_FOREGROUND_OK: '1' } }, { foreground: '测前台' }]) {
        const root = makeTempDir('nomi-launch-quiet-env-')
        const handle = await launchNomiApp({ tempRoot: root, executablePath: '/fixture/Nomi', waitForWindow: false, allowUntrackedProcessForTest: true, ...options })
        await handle.close()
      }
      expect(launches.map((launchOptions) => launchOptions.env.NOMI_WALK_FOREGROUND_OK)).toEqual(['', '', '1'])
    } finally {
      launch.mockRestore()
      if (allowed === undefined) delete process.env.NOMI_WALK_FOREGROUND_OK
      else process.env.NOMI_WALK_FOREGROUND_OK = allowed
    }
  })

  test('额外 env 照常透传（走查各自的开关不受影响）', () => {
    const env = buildNomiLaunchEnv({ ...dirs, baseEnv: { PATH: '/usr/bin' }, extraEnv: { NOMI_TEST_SYSTEM_LOCALE: '1' } })
    expect(env.NOMI_TEST_SYSTEM_LOCALE).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
  })

  test('假凭据（syntheticCredentialStorage: true）默认关在本机：产品测试网闸打开，走查要放行只能显式覆盖', () => {
    // 夜跑 run 40035294026：占位 key 保存时被产品的免费验证发到真供应商，401 →「密钥验证失败」，四条走查当场红。
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {}, fixtureCredentials: true }).NOMI_TEST_NETWORK_GUARD).toBe('1')
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {} }).NOMI_TEST_NETWORK_GUARD).toBeUndefined()
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {}, fixtureCredentials: true, extraEnv: { NOMI_TEST_NETWORK_GUARD: '' } }).NOMI_TEST_NETWORK_GUARD).toBe('')
  })

  test('启动器把显式的 syntheticCredentialStorage: true（且只有它）接成假凭据', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'tests/ux/_launchApp.mjs'), 'utf8')
    expect(source).toMatch(/fixtureCredentials:\s*options\.syntheticCredentialStorage === true/)
  })

  test('seedSavedFixtureCredentials 只给显式的隔离假凭据用，且两次起 App 必须同一组目录，否则当场拒绝', async () => {
    const root = makeTempDir('nomi-seed-guard-')
    const dirs = { settingsDir: path.join(root, 'settings'), userDataDir: path.join(root, 'user-data') }
    await expect(seedSavedFixtureCredentials(dirs, ['apimart'])).rejects.toThrow(/syntheticCredentialStorage: true/)
    await expect(seedSavedFixtureCredentials({ syntheticCredentialStorage: true, settingsDir: dirs.settingsDir }, ['apimart'])).rejects.toThrow(/userDataDir/)
  })

  test('隔离能力核目录也随 env 传入且不与 settings 混用', () => {
    const env = buildNomiLaunchEnv({ ...dirs, capabilityDir: '/tmp/case/capability', baseEnv: {} })
    expect(env.NOMI_CAPABILITY_DIR).toBe('/tmp/case/capability')
    expect(env.NOMI_SETTINGS_DIR).toBe(dirs.settingsDir)
  })
})

// 2026-10-24：隔离起的 App 显示「Claude Code 的配置里已有 Nomi」——读到了本机真实的 ~/.claude.json。
// 门岗：隔离起 App 时，宿主配置路径解析进用户真实的宿主位置（主目录默认位置，或用户自己的 CLAUDE_CONFIG_DIR / CODEX_HOME）就判红。
// 判据按注册表逐条来（electron/shared/mcpClientRegistry.ts），新加一个带位置变量的宿主不用改这里。
describe('宿主配置隔离：隔离起的 App 读写不到用户真实的 Claude Code / Codex 配置', () => {
  const platform = mcpClientPlatform(process.platform)
  const realHome = '/Users/real-person'
  const developerShell = { HOME: realHome, USERPROFILE: realHome, CLAUDE_CONFIG_DIR: `${realHome}/.claude-work`, CODEX_HOME: `${realHome}/.codex-alt` }
  const appHome = (env) => (platform === 'win32' ? env.USERPROFILE : env.HOME) || realHome
  const inside = (root, target) => { const rel = path.relative(root, target); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) }
  const resolvedFor = (env) => mcpClientLocations()
    .filter((entry) => entry.platform === platform && entry.location.hostEnv)
    .map(({ client, location }) => ({ client, path: resolveMcpClientPath(location, { platform, env, homedir: appHome(env), join: path.join }) }))

  test('每个宿主位置变量都指进 hostConfigDir，带变量的宿主路径一条不剩地落在隔离目录里（开发者 shell 里继承的值被换掉）', () => {
    const env = buildNomiLaunchEnv({ ...dirs, baseEnv: developerShell })
    expect(MCP_CLIENT_HOST_ENV_VARS.length).toBeGreaterThan(0)
    for (const name of MCP_CLIENT_HOST_ENV_VARS) expect(env[name], name).toBe(path.join(dirs.hostConfigDir, name))
    const resolved = resolvedFor(env)
    expect(resolved.length).toBeGreaterThan(0)
    for (const entry of resolved) expect(inside(dirs.hostConfigDir, entry.path), `${entry.client} → ${entry.path}`).toBe(true)
  })

  test('调用方换了主目录（假 HOME 里摆好了 ~/.claude.json）：继承来的宿主变量一律摘掉，宿主默认位置落在假主目录下', () => {
    const fakeHome = '/tmp/case/fake-home'
    const env = buildNomiLaunchEnv({ ...dirs, baseEnv: developerShell, extraEnv: { HOME: fakeHome, USERPROFILE: fakeHome } })
    for (const name of MCP_CLIENT_HOST_ENV_VARS) expect(Object.hasOwn(env, name), name).toBe(false)
    for (const entry of resolvedFor(env)) expect(inside(fakeHome, entry.path), `${entry.client} → ${entry.path}`).toBe(true)
    expect(isolatedHostConfigLeaks(env, { baseEnv: developerShell, accountHome: realHome }).leaks).toEqual([])
  })

  test('调用方自己给的宿主变量照用；指回用户真实的宿主位置就当场拒（App 起不来，而不是去读真配置）', () => {
    const own = '/tmp/case/own-claude'
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: developerShell, extraEnv: { CLAUDE_CONFIG_DIR: own } }).CLAUDE_CONFIG_DIR).toBe(own)
    expect(() => buildNomiLaunchEnv({ ...dirs, baseEnv: developerShell, extraEnv: { CLAUDE_CONFIG_DIR: developerShell.CLAUDE_CONFIG_DIR } })).toThrow(/真实的宿主配置/)
    expect(() => buildNomiLaunchEnv({ ...dirs, baseEnv: developerShell, extraEnv: { CODEX_HOME: `${realHome}/.codex` } })).toThrow(/codex/)
    // 主目录里的默认位置同样是真配置（用户自己没设变量的那一份）。
    expect(() => buildNomiLaunchEnv({ ...dirs, baseEnv: { HOME: realHome, USERPROFILE: realHome }, extraEnv: { CLAUDE_CONFIG_DIR: `${realHome}/.claude` } })).toThrow(/claude/)
  })

  test('门岗本身：宿主变量没换掉（=没隔离），按注册表逐条核出来的就是漏口', () => {
    const notIsolated = { ...developerShell, NOMI_E2E: '1' }
    const { leaks } = isolatedHostConfigLeaks(notIsolated, { baseEnv: developerShell, accountHome: realHome })
    expect(leaks.length).toBe(resolvedFor(notIsolated).length)
    expect([...new Set(leaks.map((leak) => leak.client))].sort()).toEqual([...new Set(resolvedFor(notIsolated).map((entry) => entry.client))].sort())
    expect(() => withIsolatedHostConfig(developerShell, { hostConfigDir: dirs.hostConfigDir, baseEnv: developerShell })).not.toThrow()
  })

  test('只给了 Nomi 自己的隔离目录、没给 hostConfigDir：当场拒，不让 App 带着真宿主配置起来', () => {
    expect(() => buildNomiLaunchEnv({ ...dirs, hostConfigDir: undefined, baseEnv: {} })).toThrow(/hostConfigDir/)
  })

  test('isolate:false（真实 profile，ui-driver / --real-connect 的既定设计）不动宿主变量', () => {
    const env = buildNomiLaunchEnv({ userDataDir: null, settingsDir: null, projectsDir: null, capabilityDir: null, hostConfigDir: null, baseEnv: developerShell })
    for (const name of MCP_CLIENT_HOST_ENV_VARS) expect(env[name], name).toBe(developerShell[name])
  })

  test('launchNomiApp 把 hostConfigDir 接进同一个 env 构造，并在起 App 前把目录建好（Codex 要求 CODEX_HOME 已存在）', () => {
    const launcher = fs.readFileSync(path.join(repoRoot, 'tests/ux/_launchApp.mjs'), 'utf8')
    expect(launcher).toMatch(/buildNomiLaunchEnv\(\{[\s\S]*hostConfigDir[\s\S]*\}\)/)
    expect(launcher).toMatch(/if \(isolate\) prepareHostConfigDir\(hostConfigDir, extraEnv\)/)
    const root = makeTempDir('nomi-host-config-')
    try {
      const made = prepareHostConfigDir(root)
      expect(made).toEqual(MCP_CLIENT_HOST_ENV_VARS.map((name) => path.join(root, name)))
      for (const dir of made) expect(fs.statSync(dir).isDirectory()).toBe(true)
      expect(prepareHostConfigDir(root, { HOME: path.join(root, 'fake-home') })).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('现在挡不住的（只认主目录、没有位置变量的宿主），名单钉死：要挡它得产品侧隔离实例不读真主目录（交协调拍板）', () => {
    const env = buildNomiLaunchEnv({ ...dirs, baseEnv: { HOME: realHome, USERPROFILE: realHome } })
    const { leaks, residual } = isolatedHostConfigLeaks(env, { baseEnv: { HOME: realHome, USERPROFILE: realHome }, accountHome: realHome })
    expect(leaks).toEqual([])
    const fixedOnly = [...new Set(mcpClientLocations().filter((entry) => entry.platform === platform && !entry.location.hostEnv).map((entry) => entry.client))].sort()
    expect(residual).toEqual(fixedOnly)
    expect(residual).toEqual(platform === 'linux' ? ['cursor', 'workbuddy'] : ['claude-desktop', 'cursor', 'workbuddy'])
  })
})

describe('closeElectronWithin', () => {
  const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

  test('descendantPids：按 ps 的父子关系收整棵子孙树', () => {
    const ps = () => ['  10     1', '  11    10', '  12    11', '  13    10', '  20     1', ''].join('\n')
    expect(descendantPids(10, ps).sort()).toEqual([11, 12, 13])
    expect(descendantPids(20, ps)).toEqual([])
  })

  test('优雅关闭到上限没结束：杀掉关之前拍下的整棵树、放掉管道（Linux 上帮手进程攥着管道的最小复现）', async () => {
    // 主进程忽略 SIGTERM 且常驻；孙进程继承它的 stdout / stderr——Electron 的帮手进程就是这样让 Playwright 的 close 永远等不到管道关。
    const grandchild = 'process.on("SIGTERM", () => {}); process.stdout.write("grandchild-ready\\n"); setInterval(() => {}, 1000)'
    const script = `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`
    const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
    await new Promise((resolve) => { let seen = ''; child.stdout.on('data', (chunk) => { seen += chunk; if (seen.includes('grandchild-ready')) resolve() }) })
    const tree = descendantPids(child.pid)
    expect(tree.length).toBeGreaterThan(0)
    // 关闭永远不回（new Promise(() => {})）：closeElectronWithin 照样返回，上限就生效了；挂住的话这条测试自己超时变红。
    // 不量墙钟（check:test-waits 的 wallclock-budget-assertion：判据要和机器快慢无关）。
    await closeElectronWithin({ process: () => child }, () => new Promise(() => {}), 300)
    await expect.poll(() => [child.pid, ...tree].filter(alive).length, { timeout: 5000 }).toBe(0)
    expect(child.stdout.destroyed && child.stderr.destroyed).toBe(true)
  })

  test('攥着管道的进程已经不在树里（被过继走了）：照样把管道放掉，走查进程不被它拖住', async () => {
    // 中间进程起一个继承了 stdout / stderr 的常驻进程后立刻退出 → 常驻进程被过继给 init，按父子关系找不到它了。
    const holder = 'process.on("SIGTERM", () => {}); process.stdout.write("holder-ready " + process.pid + "\\n"); setInterval(() => {}, 1000)'
    const middle = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(holder)}], { stdio: 'inherit', detached: true }).unref()`
    const script = `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(middle)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`
    const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
    const holderPid = await new Promise((resolve) => { let seen = ''; child.stdout.on('data', (chunk) => { seen += chunk; const m = /holder-ready (\d+)/.exec(seen); if (m) resolve(Number(m[1])) }) })
    try {
      await expect.poll(() => descendantPids(child.pid).includes(holderPid), { timeout: 5000 }).toBe(false)
      await closeElectronWithin({ process: () => child }, () => new Promise(() => {}), 300)
      expect(alive(child.pid)).toBe(false)
      expect(child.stdout.destroyed && child.stderr.destroyed).toBe(true)
    } finally {
      try { process.kill(holderPid, 'SIGKILL') } catch { /* 已经没了 */ }
    }
  })

  test('已经关过的 app 再关一次（process() 会抛）：不抛、照样走 close——走查先 app.close() 再 close() 是常见写法', async () => {
    let closes = 0
    const closedApp = { process: () => { throw new TypeError("Cannot read properties of undefined (reading '_object')") } }
    await expect(closeElectronWithin(closedApp, async () => { closes += 1 }, 300)).resolves.toBeUndefined()
    expect(closes).toBe(1)
  })

  test('优雅关闭在上限内结束：什么都不杀', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    try {
      await closeElectronWithin({ process: () => child }, async () => undefined, 300)
      expect(alive(child.pid)).toBe(true)
    } finally {
      child.kill('SIGKILL')
    }
  })
})

describe('withLinuxNoSandbox', () => {
  test('Linux direct spawns disable the unavailable setuid sandbox once', () => {
    expect(withLinuxNoSandbox(['.', '--disable-gpu'], 'linux')).toEqual(['.', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader'])
    expect(withLinuxNoSandbox(['.', '--no-sandbox'], 'linux')).toEqual(['.', '--no-sandbox', '--enable-unsafe-swiftshader'])
  })

  test('Linux spawns opt in to SwiftShader WebGL exactly once (Chromium >=139 removed the fallback)', () => {
    expect(withLinuxNoSandbox(['.', '--enable-unsafe-swiftshader'], 'linux'))
      .toEqual(['.', '--enable-unsafe-swiftshader', '--no-sandbox'])
  })

  test('non-Linux spawns keep their original arguments', () => {
    expect(withLinuxNoSandbox(['.', '--disable-gpu'], 'darwin')).toEqual(['.', '--disable-gpu'])
    expect(withLinuxNoSandbox(['.', '--disable-gpu'], 'win32')).toEqual(['.', '--disable-gpu'])
  })
})

describe('isolatedCatalogHasSafeStorageCredentials', () => {
  // 2026-10-08 Linux CI：夹具用合成后端加密了 apimart 占位 key，被测 App 却没开同一个后端 →
  // 模型在渲染层「当前不可用」、付费卡一颗参数 chip 都没有。起 App 的后端必须从盘上的 catalog 推出来。
  // 不是凭据：只是 catalog 里那一格的形状（值从不被解密）。
  const placeholder = 'not-a-secret'
  const withCatalog = (catalog, run) => {
    const root = makeTempDir('nomi-synthetic-cred-')
    try {
      if (catalog !== undefined) fs.writeFileSync(path.join(root, 'model-catalog.json'), typeof catalog === 'string' ? catalog : JSON.stringify(catalog))
      return run(root)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }

  test('a fixture catalog with a safeStorage-encrypted key needs the synthetic backend', () => {
    withCatalog({ apiKeysByVendor: {
      'agent-runtime-loopback': { apiKey: placeholder, enc: 'plain' },
      apimart: { apiKey: placeholder, enc: 'safeStorage' },
    } }, (root) => expect(isolatedCatalogHasSafeStorageCredentials(root)).toBe(true))
  })

  test('plain-only, missing or unreadable catalogs do not switch the backend', () => {
    withCatalog({ apiKeysByVendor: { 'agent-runtime-loopback': { apiKey: placeholder, enc: 'plain' } } },
      (root) => expect(isolatedCatalogHasSafeStorageCredentials(root)).toBe(false))
    withCatalog(undefined, (root) => expect(isolatedCatalogHasSafeStorageCredentials(root)).toBe(false))
    withCatalog('{not json', (root) => expect(isolatedCatalogHasSafeStorageCredentials(root)).toBe(false))
  })
})

describe('withLinuxSyntheticCredentialStorage', () => {
  test('isolated synthetic fixtures get a deterministic Linux backend exactly once', () => {
    expect(withLinuxSyntheticCredentialStorage(['.'], true, 'linux'))
      .toEqual(['.', '--password-store=basic'])
    expect(withLinuxSyntheticCredentialStorage(['.', '--password-store=basic'], true, 'linux'))
      .toEqual(['.', '--password-store=basic'])
  })

  test('real credential journeys and non-Linux hosts keep their storage backend', () => {
    expect(withLinuxSyntheticCredentialStorage(['.'], false, 'linux')).toEqual(['.'])
    expect(withLinuxSyntheticCredentialStorage(['.'], true, 'darwin')).toEqual(['.'])
    expect(() => withLinuxSyntheticCredentialStorage(['.', '--password-store=gnome-libsecret'], true, 'linux'))
      .toThrow('synthetic credential storage conflicts')
  })

  test('activates and verifies Electron safeStorage only for opted-in Linux fixtures', async () => {
    const calls = []
    const app = {
      evaluate: async (callback) => callback({
        safeStorage: {
          setUsePlainTextEncryption: (enabled) => calls.push(enabled),
          isEncryptionAvailable: () => true,
        },
      }),
    }

    await expect(configureSyntheticCredentialStorage(app, true, 'linux')).resolves.toBe(true)
    await expect(configureSyntheticCredentialStorage(app, false, 'linux')).resolves.toBe(false)
    await expect(configureSyntheticCredentialStorage(app, true, 'darwin')).resolves.toBe(false)
    expect(calls).toEqual([true])
  })

  test('fails at the launcher boundary when the Linux fallback is still unavailable', async () => {
    const app = {
      evaluate: async (callback) => callback({
        safeStorage: {
          setUsePlainTextEncryption: () => undefined,
          isEncryptionAvailable: () => false,
        },
      }),
    }

    await expect(configureSyntheticCredentialStorage(app, true, 'linux'))
      .rejects.toThrow('could not initialize an in-memory safeStorage key')
  })

  test('every literal fixture credential explicitly opts into isolated synthetic storage', () => {
    const sources = ['tests/ux', 'scripts'].flatMap((directory) =>
      fs.readdirSync(path.join(repoRoot, directory), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
        .map((entry) => path.join(entry.parentPath, entry.name)),
    )
    const offenders = sources
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return source.includes('upsertVendorApiKey') && /apiKey:\s*['"]/.test(source) &&
          !/syntheticCredentialStorage:\s*true/.test(source)
      })
      .map((file) => path.relative(repoRoot, file))

    expect(offenders).toEqual([])
  })
})

describe('withPackagedPlaywrightOrigin', () => {
  test('packaged E2E admits the Playwright DevTools websocket exactly once', () => {
    expect(withPackagedPlaywrightOrigin(['--user-data-dir=/tmp/case'], true))
      .toEqual(['--user-data-dir=/tmp/case', '--remote-allow-origins=*'])
    expect(withPackagedPlaywrightOrigin(['--remote-allow-origins=*'], true))
      .toEqual(['--remote-allow-origins=*'])
  })

  test('development launches do not broaden the DevTools origin policy', () => {
    expect(withPackagedPlaywrightOrigin(['.', '--disable-gpu'], false)).toEqual(['.', '--disable-gpu'])
  })
})

describe('diagnoseLaunchFailure', () => {
  test('extracts the real main-process stderr from Playwright Call log and filters debugger noise', () => {
    const error = new Error([
      'electron.launch: Timeout 30000ms exceeded.',
      'Call log:',
      '  - <launching> /Applications/Nomi.app/Contents/MacOS/Nomi',
      '  - <launched> pid=4242',
      '  - [pid=4242][err] Debugger listening on ws://127.0.0.1:9229/abc',
      '  - [pid=4242][err] Debugger attached.',
      '  - [pid=4242][err] DevTools listening on ws://127.0.0.1:31337/devtools/browser/abc',
      '  - [pid=4242][err] fatal: catalog migration failed',
    ].join('\n'))

    const report = diagnoseLaunchFailure('Electron launch timed out', 'synthetic-launch', error, [])

    expect(report).toContain('fatal: catalog migration failed')
    expect(report).not.toContain('Debugger listening')
    expect(report).not.toContain('Debugger attached')
    expect(report).not.toContain('DevTools listening')
  })

  test('an empty capture reports only that the launcher did not capture output', () => {
    const report = diagnoseLaunchFailure(
      'Electron launch timed out',
      'no-output-launch',
      new Error('electron.launch: Timeout 30000ms exceeded.'),
      [],
    )

    expect(report).toContain('启动器未捕获到主进程输出')
    expect(report).not.toContain('压根没起来')
  })
})
