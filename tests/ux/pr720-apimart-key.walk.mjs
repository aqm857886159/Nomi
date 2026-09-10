/**
 * R13/R16 走查 · PR #720 反馈 #4「apimart 填 key 后模型全部消失」逐条复验。
 *
 * 被验的修法（docs/plan/2026-09-10-ux-feedback-triage.md §5 / 本轮执行记录 B2）：
 *   direct-key 供应商（apimart）改用种子里代码拥有的 livenessProbe 验 key，验过就把凭据
 *   与 vendor 一起发布 → curated 模型必须**出现**在模型选择器与 agent 模型下拉里，
 *   不再需要走认证晋升。修之前：转圈 12s → 验证失败 → 模型从两处清单里全部消失。
 *
 * ⚠️ 判据不能用 `listModels()`：apimart 的 33 行目录数据**没 key 时也在**（本轮实测），
 *   用户说的「模型全部消失」指的是**挑不到**——选择器与 agent 下拉里一个都列不出来。
 *   所以两处观测都取「用户真能点开挑到的那份清单」，并做对偶：先证前态确实 0 项。
 *
 * 真人动作：全新 profile（无 catalog、无 key）→ 设置 → 模型 → 点 APIMart → 在输入框里
 *   ⌘V 粘贴 key（和从密码管理器粘贴一样）→ 保存 → 回工作区把三行模型下拉逐个点开看。
 * key 从不进入本脚本、日志或截图：脚本只读**密文**，safeStorage 解密与写剪贴板都在主进程里做，
 *   粘贴完立刻清空剪贴板。
 * 花费：一次 max_tokens:1 的 liveness 探测调用；**不真生成**图/视频。
 *
 * 用法：node tests/ux/pr720-apimart-key.walk.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled, clickOrFail } from './_assert.mjs'
import { CANVAS_PANEL, COMPOSER, COMPOSER_MODEL, MODEL_POPOVER } from './agent-runtime-walk-support.mjs'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const shots = path.join(repoRoot, 'tests/ux/shots/pr720-walkthrough')
fs.mkdirSync(shots, { recursive: true })

/**
 * apimart curated **文本**模型的名字（真实 catalog 实核）。只按文本这一族判，是因为本轮实测：
 * 「图片默认 / 视频默认」两行**不看凭据**——没 key 的全新 profile 里就已经列满 52/54 项
 * （目录里有就列），所以它们对这条修法没有鉴别力；真正被凭据门卡住的是文本这一族
 * （resolveTextBrainKeys 要求凭据 enabled）。别拿「Seedance」这类跨家重名的字样当判据。
 */
const APIMART_TEXT_MODELS = /DeepSeek V4 Pro|DeepSeek V4 Flash|DeepSeek V3\.2|DeepSeek V3\.1 Terminus|Gemini 3\.5 Flash/i

const results = []
function record(id, name, ok, detail) {
  results.push({ id, name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} [${id}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// 全新 profile：**不**拷用户真实 catalog（那份里 apimart 已经有 key，等于没测到修法）。
const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-pr720-apimart-'))
const dirs = {}
for (const d of ['settings', 'projects', 'chromium', 'capability']) {
  dirs[d] = path.join(isoDir, d)
  fs.mkdirSync(dirs[d], { recursive: true })
}

const { app, win } = await launchNomiApp({
  name: 'pr720-apimart-key',
  userDataDir: dirs.chromium, settingsDir: dirs.settings,
  projectsDir: dirs.projects, capabilityDir: dirs.capability,
  args: ['--disable-gpu'], settleMs: 0,
})

/**
 * 把 agent 模型弹层里三行下拉（对话 / 图片默认 / 视频默认）逐个点开，取各自能挑到的选项。
 * 「图片默认 / 视频默认」这两行就是生成模型选择器本体，与画布参数条同一份目录数据。
 * 作用域按每行触发器的 aria-controls 限死——三个 listbox 同时挂在 body 上，不限死会串行。
 */
async function closeModelPopover() {
  for (let i = 0; i < 3; i += 1) {
    if (!(await win.locator(`${CANVAS_PANEL} ${MODEL_POPOVER}`).count())) return
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(350)
  }
}

/** 一行的可挑项。每行都重开一次弹层，且**不吞**点击失败——吞掉就会把仪器故障读成「0 项」。 */
async function optionsForRow(row) {
  await closeModelPopover()
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`), '模型选择器')
  const popover = win.locator(`${CANVAS_PANEL} ${MODEL_POPOVER}`)
  await popover.waitFor({ state: 'visible', timeout: 8000 })
  const trigger = popover.locator(`[data-v4-model-row="${row}"] button`).first()
  if (!(await trigger.count())) { await closeModelPopover(); return { options: [], note: 'row-missing' } }
  await clickOrFail(trigger, `「${row}」那一行的模型下拉`)
  await win.waitForTimeout(900)
  const id = await trigger.getAttribute('aria-controls')
  if (!id) { await closeModelPopover(); return { options: [], note: 'no-aria-controls' } }
  const options = await win.evaluate((boxId) => {
    const box = document.getElementById(boxId)
    return box ? Array.from(box.querySelectorAll('[role="option"]')).map((o) => (o.textContent || '').trim()) : null
  }, id)
  await closeModelPopover()
  return options === null ? { options: [], note: `listbox-${id}-not-mounted` } : { options, note: 'ok' }
}

async function modelPickerOptions(label) {
  const out = {}
  const notes = {}
  for (const row of ['对话', '图片默认', '视频默认']) {
    const { options, note } = await optionsForRow(row)
    out[row] = options
    notes[row] = note
  }
  const summary = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${v.length}(${notes[k]})`]))
  console.log(`    · ${label} 三行可挑项：${JSON.stringify(summary, null, 0)}`)
  return out
}

const apimartTextHits = (options) => (options['对话'] || []).filter((label) => APIMART_TEXT_MODELS.test(label))

/** 供应商行状态（诚实门的真相源：vendor.enabled + hasApiKey）。 */
async function apimartVendorState() {
  return win.evaluate(() => {
    const vendors = window.nomiDesktop?.modelCatalog?.listVendors?.() || []
    const models = window.nomiDesktop?.modelCatalog?.listModels?.() || []
    const vendor = vendors.find((v) => (v.key || v.vendorKey) === 'apimart')
    return {
      vendorEnabled: vendor?.enabled ?? null,
      hasApiKey: vendor?.hasApiKey ?? null,
      catalogRows: models.filter((m) => m.vendorKey === 'apimart').length,
    }
  })
}

try {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) { w.setSize(1680, 1050); w.center() } }).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => { localStorage.setItem('nomi-color-scheme', 'light'); for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen') })
  await win.reload(); await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500)

  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 15000 })
  await win.waitForTimeout(2500)
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: 8000 })
  await win.waitForTimeout(2000)
  await win.locator(`${CANVAS_PANEL} ${COMPOSER}`).first().waitFor({ state: 'visible', timeout: 15000 })

  // ── 对偶前态：没 key 时 apimart 一个都挑不到 ──
  const beforeVendor = await apimartVendorState()
  const beforeOptions = await modelPickerOptions('填 key 前')
  const beforeHits = apimartTextHits(beforeOptions)
  await screenshotSettled(win, { path: path.join(shots, '04a-before-key-model-list.png') })

  // ── 真人动作：设置 → 模型 → APIMart → 粘贴 key → 保存 ──
  await clickOrFail(win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first(), '打开设置')
  const dialog = win.locator('[role="dialog"][aria-modal="true"]').first()
  await dialog.waitFor({ state: 'visible', timeout: 8000 })
  await clickOrFail(dialog.locator('[data-settings-tab-id="models"]').first(), '设置「模型」tab')
  await win.waitForTimeout(1200)
  await clickOrFail(dialog.locator('[data-model-home-available="apimart"]').first(), '模型首页里的 APIMart')
  await win.waitForTimeout(1200)
  const connectPage = dialog.locator('[data-key-only-vendor="apimart"]').first()
  await connectPage.waitFor({ state: 'visible', timeout: 8000 })
  await screenshotSettled(dialog, { path: path.join(shots, '04b-apimart-connect-page.png') })

  // key 从不进入本脚本：这里只读**密文**，解密与写剪贴板都在主进程里做。
  // （app.evaluate 里 require / 动态 import 都不可用，见 docs/lessons，所以文件在这一侧读。）
  const realCatalogPath = path.join(os.homedir(), 'Library', 'Application Support', 'Nomi', 'model-catalog.json')
  let cipher = null
  if (fs.existsSync(realCatalogPath)) {
    const rec = JSON.parse(fs.readFileSync(realCatalogPath, 'utf8'))?.apiKeysByVendor?.apimart
    if (rec?.apiKey && rec.enc === 'safeStorage') cipher = rec.apiKey
  }
  const clipboardReady = cipher ? await app.evaluate(({ safeStorage, clipboard }, encrypted) => {
    let plain = ''
    try { plain = safeStorage.decryptString(Buffer.from(encrypted, 'base64')) } catch { return 'decrypt-failed' }
    if (!plain) return 'decrypt-empty'
    clipboard.writeText(plain)
    return 'ok'
  }, cipher) : 'no-credential'
  if (clipboardReady !== 'ok') throw new Error(`拿不到本机 apimart key（${clipboardReady}）——这条无法验证，不是产品红`)

  const keyInput = connectPage.locator('input#key-only-apimart').first()
  await keyInput.click()
  await win.keyboard.press('Meta+V')
  await win.waitForTimeout(700)
  const pastedLength = await keyInput.evaluate((el) => el.value.length)
  await app.evaluate(({ clipboard }) => clipboard.writeText('')).catch(() => {})
  if (pastedLength < 10) throw new Error(`粘贴没进去（输入框长度 ${pastedLength}）`)

  await clickOrFail(connectPage.locator('[data-platform-key-only] button').last(), '保存 APIMart 密钥')
  // livenessProbe 是一次真实网络调用；给它足够时间落定，再看结果卡。
  const successCard = connectPage.locator('[data-key-only-success]').first()
  await successCard.waitFor({ state: 'visible', timeout: 90_000 })
  await win.waitForTimeout(1500)
  const savedTitle = (await successCard.innerText().catch(() => '')).trim().replace(/\s+/g, ' ')
  await screenshotSettled(dialog, { path: path.join(shots, '04c-apimart-key-saved.png') })

  // 关设置：焦点还在连接页时 Escape 有时被内部消费，所以按几次并等它真的从 DOM 消失，
  // 消失不了就点遮罩（真人也是这么关的）。不确认关掉就去点模型钮 = 被遮罩吃掉点击。
  const overlay = win.locator('[data-settings-overlay="true"]')
  for (let i = 0; i < 4 && await overlay.count(); i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(700)
  }
  if (await overlay.count()) {
    const box = await overlay.first().boundingBox()
    if (box) await win.mouse.click(box.x + 12, box.y + 12)
    await win.waitForTimeout(900)
  }
  await overlay.first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await win.waitForTimeout(2500)

  // ── 后态：curated 模型必须出现在选择器与 agent 下拉里 ──
  const afterVendor = await apimartVendorState()
  const afterOptions = await modelPickerOptions('填 key 后')
  const afterHits = apimartTextHits(afterOptions)
  await screenshotSettled(win, { path: path.join(shots, '04d-after-key-model-list.png') })

  const chatBefore = (beforeOptions['对话'] || []).length
  const chatAfter = (afterOptions['对话'] || []).length
  const imageBefore = (beforeOptions['图片默认'] || []).length
  const imageAfter = (afterOptions['图片默认'] || []).length

  // 正向写：填 key 前列得出来的每一项，填完 key 后都还在（不写「消失 0 项」那种否定式，
  // 它和「探针没生效」在观测上无法区分——门岗拦的正是这族）。
  const beforeTotal = Object.values(beforeOptions).flat().length
  const stillThere = Object.keys(beforeOptions)
    .flatMap((row) => (beforeOptions[row] || []).filter((label) => (afterOptions[row] || []).includes(label))).length

  record('#4', '粘贴 apimart key 后 curated 模型出现在 agent 模型下拉，且没有任何模型消失',
    afterVendor.vendorEnabled === true && afterVendor.hasApiKey === true
    && afterHits.length >= 5 && chatAfter === afterHits.length && chatAfter > chatBefore && stillThere === beforeTotal,
    `保存后提示「${savedTitle.slice(0, 40)}」；vendor.enabled=${afterVendor.vendorEnabled}（回归时这里会翻 false）`
    + ` hasApiKey ${beforeVendor.hasApiKey}→${afterVendor.hasApiKey}；agent 对话下拉 ${chatBefore}→${chatAfter} 项，`
    + `新出现的全是 apimart curated 文本模型 ${JSON.stringify(afterHits)}；`
    + `图片/视频两行 ${imageBefore}→${imageAfter} / ${(beforeOptions['视频默认'] || []).length}→${(afterOptions['视频默认'] || []).length}，`
    + `填 key 前列得出的 ${beforeTotal} 项填完后仍在 ${stillThere} 项（回归时这里会掉一大截）`)
  record('#4-dual', '对偶：对话行新增的项全部来自 apimart（证明上一条不是空断言）',
    chatAfter - chatBefore === afterHits.length && afterHits.length >= 5,
    `前态 vendor.enabled=${beforeVendor.vendorEnabled} hasApiKey=${beforeVendor.hasApiKey}；对话行可挑 ${chatBefore} 项；`
    + `目录里 apimart 行数=${beforeVendor.catalogRows}（数据一直在，消失的是「挑得到」）。`
    + `注：图片/视频两行不看凭据（无 key 即列 ${imageBefore}/${(beforeOptions['视频默认'] || []).length} 项），对本条无鉴别力，故只以文本族判。`)

  fs.writeFileSync(path.join(shots, 'apimart-key-results.json'), JSON.stringify({ results, beforeOptions, afterOptions }, null, 2))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length ? `✖ ${failed.length}/${results.length} 条红` : `✅ ${results.length} 条全绿`}`)
  process.exitCode = failed.length ? 1 : 0
} catch (err) {
  console.log(`\n✖ 走查中断：${err?.stack || err?.message || err}`)
  await win.screenshot({ path: path.join(shots, '04-apimart-key-FAIL.png') }).catch(() => {})
  fs.writeFileSync(path.join(shots, 'apimart-key-results.json'), JSON.stringify({ results }, null, 2))
  process.exitCode = 1
} finally {
  await app.evaluate(({ clipboard }) => clipboard.writeText('')).catch(() => {})
  await app.close().catch(() => {})
}
