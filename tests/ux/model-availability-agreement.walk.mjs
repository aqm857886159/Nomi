// R16 真实用户任务：「我刚接了个文本模型，三个地方说的得是一回事」。
//
// 2026-09-12 真实付费验收 P0-10 的现场（docs/research/2026-09-12-real-onboarding-acceptance/README.md §6）：
// DeepSeek 的文本模型经 MCP 接进来、**重启之后**——
//   · 设置 → 模型   说「1 个连接 · 2 个模型」「2 个可使用」
//   · 项目库首页横幅 说「创作助手尚未连接模型」
//   · 创作助手模型下拉 说「目录里没有可用的」
// 三份判据各写各的，于是同一时刻给出两个答案。判据现在只有一份
// （electron/shared/modelAvailability.ts），本走查是它的**端到端**证据：真 Electron、真 IPC、
// 真 DOM，三处必须同进同退，**重启之后依然同进同退**（那次事故正是重启后才被发现的）。
//
// 为什么有三个阶段：只测「都说有」会被一个恒真的实现骗过，只测「都说没有」会被一个恒假的骗过。
// 必须让同一台机器在「没钥匙 → 有钥匙 → 钥匙又没了」之间走一圈，三处每一步都得跟着一起翻。
//
// 零额度：全程只写目录、读界面，一次生成都不发。
// 用法：pnpm run build && node tests/ux/model-availability-agreement.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/model-availability-agreement')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-availability-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

/** 回环假供应商：一个不存在的本地端点。全程不发请求，所以它通不通无所谓——要的是目录里有这一家。 */
const VENDOR_KEY = 'walk-loopback-text'
const MODEL_KEYS = ['walk-loopback-flash', 'walk-loopback-pro']

const { app, win: initialWin } = await launchNomiApp({
  name: 'model-availability-agreement',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  syntheticCredentialStorage: true,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let passed = 0
/** 判定助手（本仓最大的一族写法）：不成立就抛，成立就记一条。 */
function check(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

const snap = async (name) => {
  await screenshotSettled(getWin(), { path: path.join(shotsDir, name) })
  console.log(`  · 截图 ${name}`)
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

async function reloadApp() {
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1600)
  await dismissFirstRun()
}

/** 把回环供应商和两条文本模型写进目录（模拟「接入完成」的那一刻）。 */
const seedCatalog = () => getWin().evaluate(({ vendorKey, modelKeys }) => {
  const catalog = window.nomiDesktop?.modelCatalog
  catalog?.upsertVendor({
    key: vendorKey,
    name: 'Loopback Text',
    baseUrl: 'http://127.0.0.1:9/v1',
    baseUrlHint: 'http://127.0.0.1:9/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    providerKind: 'openai-compatible',
    enabled: true,
  })
  for (const modelKey of modelKeys) {
    catalog?.upsertModel({ vendorKey, modelKey, labelZh: modelKey, kind: 'text', enabled: true })
  }
}, { vendorKey: VENDOR_KEY, modelKeys: MODEL_KEYS })

const setKey = (present) => getWin().evaluate(async ({ vendorKey, present }) => {
  const catalog = window.nomiDesktop?.modelCatalog
  if (present) return catalog?.upsertVendorApiKey(vendorKey, { apiKey: 'nomi-walk-loopback-key', enabled: true })
  return catalog?.clearVendorApiKey(vendorKey)
}, { vendorKey: VENDOR_KEY, present })

/**
 * ① 首页横幅读的那条：主进程 readiness（resolveTextBrainStatus 经 promptLibrary.textBrain）。
 * ② 目录投影下发给渲染层的每行 availability——助手下拉与画布选择器都吃它。
 * 两条都走真 IPC，不是从渲染层内存里抄一份。
 */
const askMainProcess = () => getWin().evaluate(async ({ vendorKey }) => {
  const brain = await window.nomiDesktop?.promptLibrary?.textBrain?.()
  const rows = (window.nomiDesktop?.modelCatalog?.listModels({ kind: 'text' }) || [])
    .filter((row) => row.vendorKey === vendorKey)
  return {
    brainReady: brain?.status === 'ok',
    rowCount: rows.length,
    usableCount: rows.filter((row) => row.availability?.usable === true).length,
    reasons: rows.map((row) => row.availability?.reason ?? 'usable'),
  }
}, { vendorKey: VENDOR_KEY })

/**
 * ③ 设置 → 模型那一页上，用户真正读到的那句「N 个可使用」。
 *
 * 像真人一样点开：入口锚点用 `data-testid`，不认文案（2026-08-15 的改名让另一条走查静默红了十来天）。
 * 读的是 DOM 文本，不是渲染层内存——用户读到的就是这一句。
 */
async function readSettingsUsableCount() {
  await clickOrFail(getWin().locator('[data-testid="open-model-settings"]').first(), '模型设置入口')
  await expectVisible(getWin().locator('[data-model-settings-page]').first(), '模型设置页打开')
  passed += 1
  const text = await getWin().evaluate(() => document.body.innerText || '')
  await getWin().keyboard.press('Escape')
  await getWin().waitForTimeout(600)
  const usable = /(\d+)\s*个可使用/.exec(text)
  return usable ? Number(usable[1]) : 0
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()

  // ── 阶段一：模型接进来了，但钥匙还没填 ────────────────────────────────
  await seedCatalog()
  await reloadApp()

  let main = await askMainProcess()
  check(main.rowCount === MODEL_KEYS.length, '目录里确实有这两条文本模型（否则后面测的是「空目录」）', JSON.stringify(main))
  check(main.usableCount === 0, '没钥匙时：目录判它们不可用', JSON.stringify(main.reasons))
  check(main.brainReady === false, '没钥匙时：首页横幅那条 readiness 说「还没接上」')
  let settingsCount = await readSettingsUsableCount()
  await snap('01-no-key-settings.png')
  check(settingsCount === 0, '没钥匙时：设置页说「0 个可使用」——不再是「2 个可使用」配一个空下拉', String(settingsCount))

  // ── 阶段二：填上钥匙 ────────────────────────────────────────────────
  await setKey(true)
  await reloadApp()

  main = await askMainProcess()
  check(main.usableCount === MODEL_KEYS.length, '填了钥匙：目录判两条都可用', JSON.stringify(main))
  check(main.brainReady === true, '填了钥匙：首页横幅那条 readiness 说「已接上」')
  settingsCount = await readSettingsUsableCount()
  await snap('02-with-key-settings.png')
  check(
    settingsCount >= MODEL_KEYS.length,
    '填了钥匙：设置页的「N 个可使用」与目录一致（三处同一个答案）',
    `设置页 ${settingsCount} / 目录 ${main.usableCount}`,
  )

  // ── 阶段三：钥匙又没了（用户在别处拔掉 / 换了机器解不开）─────────────────
  await setKey(false)
  await reloadApp()

  main = await askMainProcess()
  check(main.usableCount === 0, '拔了钥匙：目录立刻判不可用', JSON.stringify(main.reasons))
  check(main.brainReady === false, '拔了钥匙：首页横幅那条 readiness 跟着翻')
  settingsCount = await readSettingsUsableCount()
  await snap('03-key-removed-settings.png')
  check(settingsCount === 0, '拔了钥匙：设置页也跟着翻（没有一处还停在旧答案上）', String(settingsCount))

  // ── 重启之后依然一致（P0-10 正是重启后才暴露的）──────────────────────
  await setKey(true)
  await reloadApp()
  await reloadApp()
  main = await askMainProcess()
  settingsCount = await readSettingsUsableCount()
  await snap('04-after-restart.png')
  check(
    main.brainReady === true && main.usableCount === MODEL_KEYS.length && settingsCount >= MODEL_KEYS.length,
    '重启之后三处仍然是同一个答案',
    `readiness=${main.brainReady} 目录=${main.usableCount} 设置页=${settingsCount}`,
  )

  console.log(`\n✅ 走查通过：${passed} 条判据`)
} finally {
  await app.close().catch(() => {})
}
