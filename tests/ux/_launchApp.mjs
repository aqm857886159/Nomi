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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { ensureElectronSignature } from '../../scripts/ensure-electron-signature.mjs'

const require = createRequire(import.meta.url)

/** 仓库根：本文件在 <repo>/tests/ux/ 下。 */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 默认等窗口的上限。取 60s：明显短于 Playwright 默认的 180s，让**我们的**错误信息先落地。 */
const DEFAULT_WINDOW_TIMEOUT_MS = 60_000

/**
 * 拼一套「窗口一定能起来」的 env。抽成纯函数是为了让那条不变量能被单测钉住
 * （见 _launchApp.test.mjs）：**必需 env 排在 extraEnv 之后，调用方覆盖不掉**。
 */
export function buildNomiLaunchEnv({ extraEnv = {}, userDataDir, settingsDir, projectsDir, capabilityDir, baseEnv = process.env }) {
  const env = {
    ...baseEnv,
    ...extraEnv,
    // ↓ 放在 extraEnv **之后**：这两条是「窗口能不能起来」的前提，调用方不该、也不能覆盖掉。
    //   不变量靠代码成立，不靠每个脚本作者自觉抄全（抄漏就是静默超时）。
    NOMI_E2E: '1',
    NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
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
  return env
}

/**
 * Linux CI 没有可用的 setuid chrome-sandbox；所有测试进程统一显式关闭 Chromium sandbox。
 * 另：Chromium ≥139 移除了 SwiftShader 软件 WebGL 自动回退（安全策略，
 * https://chromestatus.com/feature/5166674414927872），xvfb 无 GPU 环境下 WebGL 上下文
 * 直接创建失败 → scene3d/轨迹面板不挂载（Electron 43 升级时 smoke 在 CI 死于此，macOS 本地全绿）。
 * headless 测试正是官方点名保留的 opt-in 场景 → Linux 测试进程统一带 --enable-unsafe-swiftshader。
 * 只影响测试启动器；生产桌面端有真 GPU，不带此旗标。
 */
export function withLinuxNoSandbox(args, platform = process.platform) {
  const normalized = [...args]
  if (platform === 'linux' && !normalized.includes('--no-sandbox')) normalized.push('--no-sandbox')
  if (platform === 'linux' && !normalized.includes('--enable-unsafe-swiftshader')) normalized.push('--enable-unsafe-swiftshader')
  return normalized
}

/** 起飞前先确认构建产物在不在——没 build 就直接说，别让人等满超时才发现。 */
function assertBuilt() {
  // 入口从 package.json 的 main 派生，不 hardcode 路径（改打包布局时这里自动跟着走）。
  const mainEntry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).main
  const entryPath = path.join(repoRoot, mainEntry)
  if (!fs.existsSync(entryPath)) {
    throw new Error(
      `Electron 主进程入口不存在：${mainEntry}\n` +
        `→ 走查脚本跑的是构建产物，先执行：pnpm run build`,
    )
  }
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
 * @param {string} [options.capabilityDir]  单独指定（默认 <tempRoot>/capability）
 * @param {number} [options.timeout]        等窗口上限（ms）
 * @param {number} [options.settleMs=1500]  domcontentloaded 后再等一会儿（渲染层挂载）
 * @returns {Promise<{app: import('playwright').ElectronApplication, win: import('playwright').Page,
 *   tempRoot: string, userDataDir: string, settingsDir: string, projectsDir: string, close: () => Promise<void>}>}
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
  } = options

  // 开发 electron 二进制要靠 `.` 指到仓库根去加载 dist-electron；**打包好的 .app 自带产物**，
  // 再塞个 `.` 反而会被当成「要打开的路径」参数。所以这两件事都跟着「是不是开发构建」走。
  const isDevElectron = executablePath === require('electron')
  if (isDevElectron) {
    assertBuilt()
    // Apple 会在首次启动时直接删除已吊销公证的 Electron.app。走查必须在 spawn 前复用
    // dev 启动器的静态探测与重签，否则表现为 60s 超时且一张截图也产不出来。
    ensureElectronSignature(executablePath)
  }

  // isolate:false = 用用户**真实** profile 起（交互式 dev driver ui-driver.mjs 才这么用：
  // 它要能打开已有/示例项目，这是它注释里写明的既定设计，不是漏配）。此时不传 --user-data-dir、
  // 不覆盖三个目录 env，等价于「裸起一个 Nomi」；NOMI_E2E 那两条仍然强制。
  const isolate = options.isolate !== false
  const tempRoot = isolate ? (options.tempRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))) : null
  const userDataDir = isolate ? (options.userDataDir ?? path.join(tempRoot, 'user-data')) : null
  const settingsDir = isolate ? (options.settingsDir ?? path.join(tempRoot, 'settings')) : null
  const projectsDir = isolate ? (options.projectsDir ?? path.join(tempRoot, 'projects')) : null
  const capabilityDir = isolate ? (options.capabilityDir ?? path.join(tempRoot, 'capability')) : null

  // 只建目录，**绝不清空**：不少走查会在起飞前往 projectsDir/settingsDir 里预埋工程或 catalog
  //（如 toolbar-order.walk.mjs 先写好 project.json 再启动）。启动器擅自 rm 会把它们的前置条件擦掉。
  // 想要干净 profile 的脚本自己在调用前 rmSync——语义留在看得见的地方。
  if (isolate) for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

  const launchOptions = {
    executablePath,
    args: withLinuxNoSandbox([
      ...(isDevElectron ? ['.'] : []),
      ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
      ...extraArgs,
    ]),
    cwd: repoRoot,
    env: buildNomiLaunchEnv({ extraEnv, userDataDir, settingsDir, projectsDir, capabilityDir }),
    timeout,
  }

  // 主进程输出留底：窗口起不来时，真正的线索基本都在 stderr 里。
  const logTail = []
  const keepTail = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) logTail.push(line)
    }
    if (logTail.length > 40) logTail.splice(0, logTail.length - 40)
  }

  let app
  try {
    app = await electron.launch(launchOptions)
  } catch (error) {
    throw new Error(diagnose(`Electron 起不来（electron.launch 失败/超时，${timeout}ms）`, name, error, logTail))
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
      await app.close().catch(() => undefined)
      throw new Error(diagnose(`等了 ${timeout}ms 没等到窗口`, name, error, logTail))
    }
    await win.waitForLoadState('domcontentloaded')
    if (settleMs > 0) await win.waitForTimeout(settleMs)
  }

  return {
    app,
    win,
    tempRoot,
    userDataDir,
    settingsDir,
    projectsDir,
    capabilityDir,
    close: () => closeNomiApp(app),
  }
}

/**
 * 说人话的失败报告：说清楚卡在哪、可能是什么、下一步敲什么。
 *
 * 注意排序：单实例锁那条**已经被启动器强制解掉了**，所以它不再是首要嫌疑——
 * 把它排第一会把人往错方向带。真实剩下的头号原因是构建产物过期。
 */
function diagnose(headline, name, error, logTail) {
  // Playwright 的 "Call log:" 段与其上的 "Browser logs:" 完全重复；先切掉，
  // 否则下面捞 stderr 会把每行捞两遍。
  const raw = String(error?.message || error || '').split(/\nCall log:/)[0].trim()
  // launch 本身就失败时我们还没拿到子进程句柄，logTail 是空的；但 Playwright 自己把主进程
  // stderr 收进了错误文本（`[pid=123][err] ...`）——从那儿捞出来，别对着空手说「没有输出」。
  const tail = logTail.length
    ? logTail
    : raw
        .split('\n')
        .filter((line) => /^\s*-?\s*\[pid=\d+\]\[err\]/.test(line))
        .map((line) => line.replace(/^\s*-?\s*\[pid=\d+\]\[err\]\s?/, ''))
        .filter((line) => line.trim() && !/Debugger (listening|attached)|inspector|DevTools listening|Waiting for the debugger/.test(line))
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
    lines.push('（没抓到任何主进程输出——通常意味着它压根没起来。)', '')
  }
  lines.push(`原始错误：${raw}`)
  return lines.join('\n')
}

/**
 * 收尾。electron teardown 在部分环境会 hang（app.close() 永不 resolve），串跑时会把整条卡死，
 * 故给 3s 兜底：尽量清干净，但保证一定往下走。
 */
export async function closeNomiApp(app) {
  if (!app) return
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])
}
