import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 生成框「+」走查（协调 2026-11-12 拍板 A：删掉手动切方式之后「+」的倒退，不修不能合）。**零额度**（全程不点生成）。
//
// 用户现场：文生视频的空镜头点「+」上传一段音频 → 被拒「这个位置只收图片、视频」（「+」走的是建画布卡的旧入口）；
// 图生视频放了首帧之后「+」不见了，想再放一张没地方点。以前靠面板里手动切方式绕过去，那个开关删掉之后这条路就断了，
// 而本该拦它的那几份走查点的正是被删掉的开关，早就不跑了。
//
// 这份走查按真实路径点：新建项目 → 视频节点 → Seedance 2.0 → 「+」→ 上传本地文件，读底栏方式格。中文、英文各走一遍：
//   ① 空节点「+」给的类别里有音频，上传一段音频 → 方式格自己变成全能参考；
//   ② 放一张图、方式菜单点图生视频 →「+」还在 → 再放一张 → 方式格自己换到收得下两张的那种，行尾说一句。
// 截图进 tests/ux/shots/mode-bar-add-reference/（每张都要人眼 Read 过）。
//
// 用法：node tests/ux/mode-bar-add-reference.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, expect, expectVisible, clickOrFail, screenshotSettled } from './_assert.mjs'
import { canvasAddBar, newProjectEntry } from './_shell.mjs'
import { closeModeMenu, modeName, openModeMenu, pickMode, readModeCell } from './_modeMenu.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/mode-bar-add-reference')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = makeTempDir('nomi-mode-bar-add-')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(projectsDir, { recursive: true })

/** 最小合法 WAV（真文件，走真上传管线）。 */
function writeTinyWav(target) {
  const data = Buffer.alloc(1600)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(target, Buffer.concat([header, data]))
}
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const wav = path.join(tempRoot, 'voice.wav')
writeTinyWav(wav)
const pngA = path.join(tempRoot, 'frame-a.png')
const pngB = path.join(tempRoot, 'frame-b.png')
fs.writeFileSync(pngA, Buffer.from(PNG_1PX, 'base64'))
// 第二张要是另一张图：同样的字节导入后是同一个地址，会被当成「已经放过」静默跳过。
fs.writeFileSync(pngB, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4oaEBAALUARkFUI+kAAAAAElFTkSuQmCC', 'base64'))

const { app, win } = await launchNomiApp({
  name: 'mode-bar-add-reference', userDataDir, settingsDir: userDataDir, projectsDir,
  syntheticCredentialStorage: true, args: ['--no-proxy-server'], settleMs: 0,
})

let passed = 0
const record = (label) => { passed += 1; console.log(`  ✓ ${label}`) }
const shot = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
const composer = win.locator('.generation-canvas-v2-node__composer').first()
const plus = () => composer.locator('button[data-reference-add-entry]').first()

async function newSeedanceNode(locale) {
  await clickOrFail(canvasAddBar(win).locator('button[data-node-kind="video"]'), '工具条「视频」')
  // 新节点落在视口外时画布给一颗「新节点在下方 ↓」的提示：点它把镜头带过去（和用户一样），否则生成框在屏外点不到。
  const arrival = win.locator('button[data-canvas-arrival-hint]').first()
  if (await arrival.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) { await arrival.click(); await win.waitForTimeout(900) }
  await expectVisible(composer, '视频节点的生成框出现')
  await clickOrFail(composer.locator('[data-node-composer-footer] [data-bar-segment="model-params"] button').first(), '底栏模型格')
  const options = win.locator('[role="option"]:visible')
  await expect(options, '模型下拉点开了却一个选项都没有').not.toHaveCount(0)
  const texts = (await options.allTextContents()).map((t) => t.trim())
  const index = texts.findIndex((t) => t.startsWith('Seedance 2.0'))
  if (index < 0) throw new Error(`WALK FAIL: 模型下拉里没有 Seedance 2.0：${JSON.stringify(texts)}`)
  await options.nth(index).click()
  await expect.poll(() => readModeCell(composer, locale), { message: '新节点的方式格应是文生视频' }).toBe(modeName(locale, 'text'))
}

/** 点「+」打开素材选择器，返回上传口的 accept（=「+」给的类别）。 */
async function openPlus(locale) {
  await clickOrFail(plus(), '参考行的「+」')
  const input = win.locator(`input[type="file"][aria-label="${uiText(locale, 'assetLibrary.picker.uploadLocal')}"]`).first()
  await input.waitFor({ state: 'attached' })
  return { input, accept: (await input.getAttribute('accept')) ?? '' }
}

async function scenario(lang, locale) {
  // ① 文生视频的空节点：「+」在，给的类别里有音频；放一段音频 → 全能参考。
  await newSeedanceNode(locale)
  await expectVisible(plus(), '文生视频的空节点也有「+」')
  const empty = await openPlus(locale)
  if (!/audio/.test(empty.accept) || !/image/.test(empty.accept) || !/video/.test(empty.accept)) throw new Error(`WALK FAIL: 空节点「+」给的类别应含图 / 视频 / 音频，实际 accept=${empty.accept}`)
  record(`${lang} · 文生视频空节点「+」给图 / 视频 / 音频（accept=${empty.accept}）`)
  await shot(`${lang}-01-text-plus-picker`)
  await empty.input.setInputFiles(wav)
  await expect.poll(() => readModeCell(composer, locale), { message: '放了音频后方式格应自己换成全能参考', timeout: DEFAULT_TIMEOUT_MS }).toBe(modeName(locale, 'reference'))
  await win.keyboard.press('Escape')
  record(`${lang} · 「+」上传音频 → 方式格「${modeName(locale, 'reference')}」`)
  await shot(`${lang}-02-audio-to-reference`)

  // ② 放一张图 → 菜单点图生视频 →「+」还在 → 再放一张 → 方式自己换走。
  await newSeedanceNode(locale)
  const first = await openPlus(locale)
  await first.input.setInputFiles(pngA)
  await expect.poll(() => readModeCell(composer, locale), { message: '放了一张图后方式格应离开文生视频', timeout: DEFAULT_TIMEOUT_MS }).not.toBe(modeName(locale, 'text'))
  await win.keyboard.press('Escape')
  await pickMode(win, composer, locale, 'image')
  await expect.poll(() => readModeCell(composer, locale), { message: '菜单点了图生视频，方式格应是它' }).toBe(modeName(locale, 'image'))
  await expectVisible(plus(), '图生视频放了首帧之后「+」还在（以前这里没有「+」）')
  record(`${lang} · 图生视频放了首帧后「+」还在`)
  await shot(`${lang}-03-i2v-plus-still-there`)
  const second = await openPlus(locale)
  await second.input.setInputFiles(pngB)
  // 图生视频只收 1 张：再放一张就放不下了，方式格自己换到收得下两张的那一种（换到哪种由 modeForInputs 定，
  // Seedance 2.0 首尾帧 / 全能参考都收得下，它取全能参考；只有首尾帧格的模型换成首尾帧——类测试逐格覆盖），行尾说一句「已改成 X」。
  await expect.poll(() => readModeCell(composer, locale), { message: '图生视频再放一张，方式格应自己换走', timeout: DEFAULT_TIMEOUT_MS }).not.toBe(modeName(locale, 'image'))
  await win.keyboard.press('Escape')
  const switched = await readModeCell(composer, locale)
  if (![modeName(locale, 'firstLast'), modeName(locale, 'reference')].includes(switched)) throw new Error(`WALK FAIL: 再放一张后应换到首尾帧或全能参考，实际「${switched}」`)
  // 菜单里首尾帧仍可点（两张都收得下）：换走的那一种不是唯一出路，用户要首尾帧点一下就是。
  const rows = await openModeMenu(win, composer, locale)
  await closeModeMenu(win)
  const firstLastRow = rows.find((row) => row.name === modeName(locale, 'firstLast'))
  if (!firstLastRow || firstLastRow.disabled) throw new Error(`WALK FAIL: 放了两张图，菜单里「${modeName(locale, 'firstLast')}」应可点：${JSON.stringify(rows)}`)
  const tail = ((await composer.locator('[data-reference-tail-kind="mode-switched"]').first().textContent().catch(() => '')) ?? '').trim()
  if (!tail.includes(switched)) throw new Error(`WALK FAIL: 方式换成「${switched}」了，行尾却没说（行尾：「${tail}」）`)
  record(`${lang} · 图生视频再放一张 → 方式格「${switched}」（owner 现算），行尾「${tail}」，菜单里首尾帧可点`)
  await shot(`${lang}-04-second-image-switched`)
}

async function switchToEnglish() {
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'general' } })))
  const overlay = win.locator('[data-settings-overlay="true"]')
  await overlay.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(overlay.locator('[data-settings-locale="en"]').first(), '设置里的 English')
  await win.waitForTimeout(600)
  await win.keyboard.press('Escape')
  await overlay.waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT_MS })
}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  // 占位 key：只为让 Seedance 2.0 进目录。全程不点生成 → 零额度（测试网闸也拦着出站）。
  await win.evaluate(() => window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('kie', { apiKey: 'nomi-e2e-placeholder', enabled: true }))
  await win.evaluate(() => { for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen') })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((target) => { target.setBounds({ x: 0, y: 0, width: 1600, height: 1050 }); target.center() })

  await clickOrFail(newProjectEntry(win), uiText('zh', 'library.newBlankProject'))
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '顶栏「生成」')
  await expectVisible(canvasAddBar(win), '生成画布工具栏出现')
  await scenario('zh', 'zh-CN')
  await switchToEnglish()
  await scenario('en', 'en')
  console.log(`\n✅ mode-bar-add-reference 走查通过（${passed} 条）；截图：${path.relative(repoRoot, shotsDir)}`)
} catch (error) {
  await shot('failure').catch(() => {})
  console.error('\n❌ 走查失败：', error?.message || error)
  process.exitCode = 1
} finally {
  await app.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
