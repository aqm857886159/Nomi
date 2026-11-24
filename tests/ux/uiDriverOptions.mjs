// 常驻驱动（ui-driver.mjs）的启动参数：纯函数，驱动和它的测试共用一份。
//
// 默认 = 隔离 + 安静（屏外、不抢焦点）：临时资料、临时能力目录、不碰创作者的真实资料。
// 要真实资料必须显式 `--real-profile`，并且仍要现有的前台放行变量 NOMI_WALK_FOREGROUND_OK=1（没设按 125 跳过，不起 App）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyOldUserData, listOldUserData } from '../world/oldUserData.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 能直接点名的窗口内容尺寸（宽 × 高，CSS 像素）。 */
export const SIZE_PRESETS = Object.freeze({
  '1280x800': Object.freeze({ width: 1280, height: 800 }),
  '1100x690': Object.freeze({ width: 1100, height: 690 }),
  '1100x720': Object.freeze({ width: 1100, height: 720 }),
  '700x720': Object.freeze({ width: 700, height: 720 }),
})
export const DEFAULT_SIZE = '1280x800'
export const LOCALES = Object.freeze({ zh: 'zh-CN', 'zh-CN': 'zh-CN', en: 'en' })
export const THEMES = Object.freeze(['light', 'dark'])

/**
 * 起始数据只许从这份清单里选（不收任意路径）：空资料，或仓库里旧版本真实落盘的数据夹具。
 * 清单由 tests/fixtures/old-user-data 的目录派生（tests/world/oldUserData.mjs），这里不再手写第二份；
 * 值是相对仓库根的目录，见那里的 README。
 */
export const DATA_FIXTURES = Object.freeze({
  empty: null,
  ...Object.fromEntries(listOldUserData().map((item) => [item.name, `tests/fixtures/old-user-data/${item.id}`])),
})

export const USAGE = [
  '用法：node tests/ux/ui.mjs up [--locale zh|en] [--theme light|dark] [--size 1280x800|1100x720|1100x690|700x720]',
  `                              [--data ${Object.keys(DATA_FIXTURES).join('|')}] [--out <证据目录>]`,
  '                              [--vendor fake-apimart] [--vendor-pending <非负整数>] [--vendor-drop-submit <非负整数>] [--vendor-fail-task <非负整数>]',
  '      显式要真实资料：NOMI_WALK_FOREGROUND_OK=1 node tests/ux/ui.mjs up --real-profile',
].join('\n')

function fail(message) {
  const error = new Error(`${message}\n${USAGE}`)
  error.code = 'USAGE'
  return error
}

/** 证据默认落点：系统临时区里按工作树、按这次会话建目录（仓库外）。 */
export function defaultEvidenceDir({ root = repoRoot, tmp = os.tmpdir(), now = new Date() } = {}) {
  const tree = crypto.createHash('sha1').update(root).digest('hex').slice(0, 10)
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return path.join(tmp, 'nomi-verify', tree, stamp)
}

/** 证据目录不许落在仓库里（截图不进仓库）。 */
export function assertOutsideRepo(dir, root = repoRoot) {
  const rel = path.relative(path.resolve(root), path.resolve(dir))
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw fail(`证据目录 ${dir} 在仓库里；截图和日志只落仓库外（不给 --out 默认落系统临时区）`)
  }
  return dir
}

/** 解析 `up` 的参数。env 只认三条：前台放行、兼容的 NOMI_UI_USER_DATA、打包版二进制。 */
export function parseDriverArgs(argv = [], env = process.env, { root = repoRoot, now = new Date() } = {}) {
  const options = {
    locale: 'zh-CN',
    theme: 'light',
    sizeName: DEFAULT_SIZE,
    size: SIZE_PRESETS[DEFAULT_SIZE],
    data: 'empty',
    realProfile: false,
    vendor: null,
    vendorPending: 0,
    vendorDropSubmit: 0,
    vendorFailTask: 0,
    out: null,
    userDataDir: env.NOMI_UI_USER_DATA || env.NOMI_UI_USERDATA || null,
    executablePath: env.NOMI_UI_EXECUTABLE || null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const value = () => {
      const next = inline ?? argv[++i]
      if (next === undefined || next.startsWith('--')) throw fail(`${flag} 缺值`)
      return next
    }
    if (flag === '--locale') {
      const raw = value()
      if (!LOCALES[raw]) throw fail(`不认识的语言 ${raw}（可选 zh / en）`)
      options.locale = LOCALES[raw]
    } else if (flag === '--theme') {
      const raw = value()
      if (!THEMES.includes(raw)) throw fail(`不认识的配色 ${raw}（可选 ${THEMES.join(' / ')}）`)
      options.theme = raw
    } else if (flag === '--size') {
      const raw = value()
      if (!SIZE_PRESETS[raw]) throw fail(`不认识的尺寸 ${raw}（可选 ${Object.keys(SIZE_PRESETS).join(' / ')}）`)
      options.sizeName = raw
      options.size = SIZE_PRESETS[raw]
    } else if (flag === '--data') {
      const raw = value()
      if (!Object.prototype.hasOwnProperty.call(DATA_FIXTURES, raw)) throw fail(`起始数据只许点名清单里的一项：${Object.keys(DATA_FIXTURES).join(' / ')}（不收任意路径：${raw}）`)
      options.data = raw
    } else if (flag === '--out') {
      options.out = path.resolve(value())
    } else if (flag === '--real-profile') {
      options.realProfile = true
    } else if (flag === '--vendor') {
      options.vendor = value()
      if (options.vendor !== 'fake-apimart') throw fail(`不认识的假供应商 ${options.vendor}（可选 fake-apimart）`)
    } else if (flag === '--vendor-pending') {
      const raw = value()
      options.vendorPending = Number(raw)
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(options.vendorPending)) throw fail('--vendor-pending 要非负整数')
    } else if (flag === '--vendor-drop-submit') {
      // 前 n 次下单：收完请求体就断开连接、不回话——Nomi 那侧是「发出去了、没等到回话」，即结果未知。
      const raw = value()
      options.vendorDropSubmit = Number(raw)
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(options.vendorDropSubmit)) throw fail('--vendor-drop-submit 要非负整数')
    } else if (flag === '--vendor-fail-task') {
      // 前 n 个建好的任务：查询时供应商说「生成失败」——Nomi 那侧是一镜普通失败，可以重试。
      const raw = value()
      options.vendorFailTask = Number(raw)
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(options.vendorFailTask)) throw fail('--vendor-fail-task 要非负整数')
    } else {
      throw fail(`不认识的参数 ${arg}`)
    }
  }
  if (options.vendor && (options.realProfile || options.userDataDir)) throw fail('假供应商只能用本次新建的隔离资料；不能和 --real-profile / NOMI_UI_USER_DATA 同用，避免改写已有凭据')
  for (const flag of ['--vendor-pending', '--vendor-drop-submit', '--vendor-fail-task']) {
    if (argv.some((arg) => arg.split('=')[0] === flag) && !options.vendor) throw fail(`${flag} 必须和 --vendor fake-apimart 同用`)
  }
  if (options.realProfile && options.data !== 'empty') throw fail('--real-profile 和 --data 不能同时用（真实资料就是起始数据）')
  if (options.realProfile && options.userDataDir) throw fail('--real-profile 和 NOMI_UI_USER_DATA 不能同时用')
  options.out = assertOutsideRepo(options.out ?? defaultEvidenceDir({ root, now }), root)
  options.isolated = !options.realProfile
  return options
}

/** 启动第一行：现在是隔离还是真实资料，以及怎么换。 */
export function profileBanner(options) {
  if (options.isolated) {
    return `PROFILE 隔离（临时资料，不碰你的真实资料；要真实资料：NOMI_WALK_FOREGROUND_OK=1 node tests/ux/ui.mjs up --real-profile）`
  }
  return 'PROFILE 真实资料（窗口会到前台，装不了安静仪表；用完 node tests/ux/ui.mjs down）'
}

/** 隔离实例的首屏偏好：语言、配色，关掉首次启动引导（否则每次都要先点掉它们）。 */
export function initialPreferences(options) {
  return {
    'nomi:locale:v1': options.locale,
    'nomi-color-scheme': options.theme,
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  }
}

/** 把点名的旧数据夹具拷进临时根（占位符换成拷贝位置，由 tests/world/oldUserData.mjs 做）；返回设置目录。 */
export function seedDataFixture(name, tempRoot, root = repoRoot) {
  const source = DATA_FIXTURES[name]
  if (!source) return null
  const target = path.join(tempRoot, 'old-user')
  copyOldUserData(path.join(root, source), target)
  return fs.existsSync(path.join(target, 'model-catalog.json')) ? target : path.join(target, 'userData')
}

/**
 * 交给 launchNomiApp 的入参。隔离实例显式传自己的 capabilityDir：外面设了 NOMI_CAPABILITY_DIR 也不用它
 * （launchNomiApp 的优先级是「显式入参 > env > 派生」，这里用的是它现成的入参，不改启动器）。
 */
export function buildLaunchOptions(options, { tempRoot, settingsDir = null } = {}) {
  const extra = options.executablePath ? { executablePath: options.executablePath } : {}
  if (!options.isolated) {
    return {
      name: 'ui-driver',
      isolate: false,
      settleMs: 0,
      foreground: '交互式驱动显式要了真实资料（--real-profile）',
      ...extra,
    }
  }
  if (!tempRoot) throw new Error('隔离启动要 tempRoot')
  return {
    name: 'ui-driver',
    tempRoot,
    capabilityDir: path.join(tempRoot, 'capability'),
    ...(options.userDataDir ? { userDataDir: options.userDataDir } : {}),
    ...(settingsDir ? { settingsDir } : {}),
    viewportSize: { ...options.size },
    initialLocalStorage: initialPreferences(options),
    env: { NO_PROXY: '127.0.0.1,localhost' },
    settleMs: 0,
    ...extra,
  }
}

/** 截图文件名自动带语言和配色：`<名>.<语言>.<配色>.png`。 */
export function shotFileName(name, { locale, theme }) {
  const base = String(name || 'live').replace(/[^\w.-]+/g, '-').replace(/\.png$/i, '')
  return `${base}.${locale}.${theme}.png`
}

/** 进程还活着吗（单实例锁用）。 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** 单实例锁：一个工作树同时只起一个实例。已有活实例 → 抛，带它的 pid；死锁文件 → 接管。 */
export function acquireInstanceLock(dir, pid = process.pid) {
  fs.mkdirSync(dir, { recursive: true })
  const lock = path.join(dir, 'instance.lock')
  try {
    fs.writeFileSync(lock, String(pid), { flag: 'wx' })
    return lock
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const holder = Number(fs.readFileSync(lock, 'utf8').trim())
  if (holder !== pid && pidAlive(holder)) {
    const busy = new Error(`这个工作树已经起了一个驱动实例（pid ${holder}）。先 node tests/ux/ui.mjs down，或直接接着用它（node tests/ux/ui.mjs doctor）`)
    busy.code = 'INSTANCE_RUNNING'
    busy.pid = holder
    throw busy
  }
  fs.writeFileSync(lock, String(pid))
  return lock
}
