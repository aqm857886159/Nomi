// R13 真机走查（2026-07-30 拍板的三件事）· 零额度：全程不发一次 vendor 请求。
//
// 验三条用户可见的断言：
//   ① Imagen 4 已退役 —— 模型下拉里不再有它（新装机不会开箱就撞必死模型）。
//   ② 病模型（近 24h 连败≥2）沉到下拉最后一条、灰掉、右侧标「最近多次失败」，且仍可点。
//   ③ 节点选中的模型被下线后，用户**不会**卡在英文技术报错上：要么被「供应商断开自愈」
//      改选到同档案的替代模型（useNodeModelAutoSelect 既有机制），要么落中文「这个模型已经下线了」
//      + 主按钮「换个模型」。两种结局都可接受，不可接受的是英文 `Model is …` + 误导的「稍等重试」。
//
// ③ 分两次启动：先用 UI 选中一个走查专用模型（非 curated，摘掉后不会被种子插回来），
// 再把它从目录摘掉重启。生成若真发出也会在 findExecutableModel 就抛错，早于付费调用，不花钱。
//
// 用法：pnpm build 后 node scripts/retired-model-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.retired-walk')
mkdirSync(outDir, { recursive: true })

const settingsDir = path.join(os.tmpdir(), 'nomi-retired-walk-settings')
const projectsDir = path.join(os.tmpdir(), 'nomi-retired-walk-projects')
// 独立 user-data-dir：localStorage(健康记忆) 不污染用户真实 App。
const userDataDir = path.join(os.tmpdir(), 'nomi-retired-walk-userdata')
for (const d of [settingsDir, projectsDir, userDataDir]) mkdirSync(d, { recursive: true })

const devCatalog = path.join(os.homedir(), 'Library', 'Application Support', 'nomi', 'model-catalog.json')
if (!existsSync(devCatalog)) {
  console.log('✗ 缺 dev catalog（' + devCatalog + '）')
  process.exit(1)
}
const catalogPath = path.join(settingsDir, 'model-catalog.json')
copyFileSync(devCatalog, catalogPath)

// 走查专用模型：第一阶段用 UI 真选中它，第二阶段把它从目录摘掉 → 复现「节点存的模型已下线」。
// 必须是**非 curated** 的：curated 模型摘掉后会被 applyBuiltinSeeds 当场插回来（互斥机制在起作用，
// 上一版走查就栽在这——删了 z-image-turbo，重启又回来了）。
const DOOMED_KEY = 'walkthrough-doomed-model'
const DOOMED_LABEL = '走查专用模型'
{
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  catalog.models.push({
    modelKey: DOOMED_KEY, vendorKey: 'apimart', modelAlias: null, labelZh: DOOMED_LABEL,
    kind: 'image', enabled: true, meta: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  writeFileSync(catalogPath, JSON.stringify(catalog))
}

let failed = false
const fail = (msg) => { console.log('  ✗ ' + msg); failed = true }
const pass = (msg) => console.log('  ✓ ' + msg)

function launch() {
  return launchNomiApp({
    name: 'retired-model',
    settingsDir,
    projectsDir,
    userDataDir,
  })
}

async function openCanvas(win, { fresh }) {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  if (fresh) {
    await win.getByText('新建空白项目', { exact: false }).first().click()
  } else {
    // 复进：项目库里点最近那个项目卡。
    await win.locator('[data-project-card]').first().click().catch(async () => {
      await win.getByText('未命名项目', { exact: false }).first().click()
    })
  }
  await win.waitForTimeout(2500)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1500)
}

/** 读下拉里每一行的文案 + 是否灰掉（dimmed 走 opacity-45 类）。 */
async function readPickerRows(win) {
  await win.locator('[aria-label="模型"]').first().click()
  await win.waitForTimeout(1000)
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('[role="option"]')).map((el) => ({
      text: (el.textContent || '').trim(),
      dimmed: Boolean(el.querySelector('.opacity-45')),
    })),
  )
}

// ── 第一次启动：验 ① ②，并让节点选中走查专用模型 ────────────────────────────
{
  const { app, win } = await launch()
  try {
    const bw = await app.browserWindow(win)
    await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1500, height: 1000 })).catch(() => {})
    await openCanvas(win, { fresh: true })
    await addCanvasNodeFromRail(win, 'image')
    await win.waitForTimeout(1500)
    // 先把提示词打上：否则第二阶段点生成会卡在「prompt is required」的入参校验，
    // 根本走不到 findExecutableModel，测不到「模型已下线」那条路。
    const editor = win.locator('div[contenteditable="true"]').last()
    await editor.click()
    await win.keyboard.type('一只棕灰色短毛猫侧身蜷卧在浅灰色平面上', { delay: 8 })
    await win.waitForTimeout(600)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(600)

    // ① Imagen 4 退役
    let rows = await readPickerRows(win)
    console.log('  下拉共 ' + rows.length + ' 条')
    if (rows.some((r) => /Imagen 4/.test(r.text))) fail('① Imagen 4 还在下拉里（退役没生效）')
    else pass('① Imagen 4 已不在模型下拉里')

    // ② 给下拉里第二条模型种「连败 2 次」的健康记忆 → 重开应沉底 + 灰掉
    await win.keyboard.press('Escape')
    console.log('  [准备] 种健康记忆：除首条外的图片模型全部记 2 次失败（造出可观测的沉底态）')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    const imageKeys = catalog.models.filter((m) => m.kind === 'image' && m.enabled).map((m) => m.modelKey)
    await win.evaluate((keys) => {
      const now = Date.now()
      const map = {}
      for (const k of keys) map[k] = { fails: 2, lastFailAt: now }
      localStorage.setItem('nomi:model-health:v1', JSON.stringify(map))
    }, imageKeys.slice(1))
    await win.reload()
    await openCanvas(win, { fresh: false })
    await win.locator('[data-node-id]').first().click()
    await win.waitForTimeout(1200)

    rows = await readPickerRows(win)
    const dimmedCount = rows.filter((r) => r.dimmed).length
    const firstDimmedIdx = rows.findIndex((r) => r.dimmed)
    const lastHealthyIdx = rows.map((r) => r.dimmed).lastIndexOf(false)
    await win.screenshot({ path: path.join(outDir, '01-picker-ailing-sunk.png') })
    console.log('  📸 01-picker-ailing-sunk.png')
    if (dimmedCount === 0) fail('② 没有任何模型被灰掉（沉底/灰化没生效）')
    else if (firstDimmedIdx < lastHealthyIdx) fail('② 病模型没沉到底（还夹在健康模型中间）')
    else {
      pass(`② 病模型 ${dimmedCount} 条全部沉到最后且灰掉`)
      const marked = rows.filter((r) => r.dimmed && /最近多次失败/.test(r.text)).length
      if (marked === 0) fail('② 灰掉了但没标「最近多次失败」')
      else pass('② 右侧标注为「最近多次失败」')
    }
    // 清掉健康记忆，避免影响下一阶段的默认选择
    await win.evaluate(() => localStorage.removeItem('nomi:model-health:v1'))
    await win.keyboard.press('Escape')
    await win.waitForTimeout(800)

    // 用 UI 真选中「走查专用模型」——节点把它存进 meta.modelKey，第二阶段摘掉它即复现下线场景。
    await win.locator('[aria-label="模型"]').first().click()
    await win.waitForTimeout(900)
    await win.getByRole('option', { name: new RegExp(DOOMED_LABEL) }).first().click()
    await win.waitForTimeout(1200)
    const picked = await win.locator('[aria-label="模型"]').first().textContent()
    console.log('  节点已选中: ' + (picked || '').trim())
    if (!new RegExp(DOOMED_LABEL).test(picked || '')) fail('③ 没能选中走查专用模型，场景没构造出来')

    await win.waitForTimeout(1500)
  } catch (error) {
    fail('第一阶段抛错: ' + String(error).slice(0, 300))
  } finally {
    await app.close().catch(() => {})
  }
}

// ── 第二次启动：把走查专用模型从目录摘掉，验 ③ ────────────────────────────────
{
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  catalog.models = catalog.models.filter((m) => m.modelKey !== DOOMED_KEY)
  writeFileSync(catalogPath, JSON.stringify(catalog))
  console.log('  [准备] 已把 ' + DOOMED_KEY + ' 从目录摘掉（节点里那条 modelKey 就此悬空 = 用户升级后的真实状态）')

  const { app, win } = await launch()
  try {
    const bw = await app.browserWindow(win)
    await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1500, height: 1000 })).catch(() => {})
    await openCanvas(win, { fresh: false })
    await win.locator('[data-node-id]').first().click()
    await win.waitForTimeout(1200)

    await win.locator('[aria-label="生成素材"]').first().click()
    await win.waitForTimeout(1200)
    const confirm = win.locator('.fixed.inset-0').last().getByRole('button', { name: '生成', exact: true })
    if ((await confirm.count()) > 0) await confirm.first().click()
    let card = null
    for (let i = 0; i < 15; i += 1) {
      await win.waitForTimeout(2000)
      card = await win.evaluate(() => {
        const el = document.querySelector('[role="alert"][aria-label*="生成失败"]')
        if (!el) return null
        const primary = el.querySelector('button[aria-label], a[aria-label]')
        return {
          text: (el.textContent || '').trim(),
          primaryLabel: primary ? primary.getAttribute('aria-label') || '' : '',
        }
      })
      if (card) break
    }
    if (!card) {
      // 诊断：没红卡时把节点正文与任何 toast 打出来，别只报「没等到」。
      const diag = await win.evaluate(() => ({
        node: (document.querySelector('[data-node-id]')?.textContent || '').trim().slice(0, 300),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((el) => (el.textContent || '').trim().slice(0, 200)),
      }))
      console.log('  [诊断] 节点正文: ' + diag.node)
      console.log('  [诊断] 所有 alert: ' + JSON.stringify(diag.alerts))
    }
    await win.screenshot({ path: path.join(outDir, '02-retired-model-card.png') })
    console.log('  📸 02-retired-model-card.png')

    const label = (await win.locator('[aria-label="模型"]').first().textContent().catch(() => '')) || ''
    const bodyText = await win.evaluate(() => (document.querySelector('[data-node-id]')?.textContent || '').trim())
    const english = /Model is (not enabled|retired)/.test(bodyText) || /Model is (not enabled|retired)/.test(card?.text || '')

    if (english) fail('③ 甩了英文技术报错给用户')
    else if (card) {
      console.log('\n  ── 走「已下线」卡这条路 ──\n  ' + card.text + '\n  主按钮: ' + card.primaryLabel + '\n')
      if (!/已经下线/.test(card.text)) fail('③ 失败卡没说「这个模型已经下线了」')
      else pass('③ 中文人话「这个模型已经下线了」')
      if (!/换个模型/.test(card.primaryLabel)) fail('③ 主按钮不是「换个模型」（是「' + card.primaryLabel + '」）')
      else pass('③ 主按钮 = 换个模型')
      if (/稍等|稍后再试/.test(card.text)) fail('③ 仍在建议「稍等重试」')
      await win.locator('[role="alert"] button').first().click()
      await win.waitForTimeout(1200)
      const opened = await win.evaluate(() => document.querySelectorAll('[role="option"]').length > 0)
      await win.screenshot({ path: path.join(outDir, '03-after-primary-click.png') })
      console.log('  📸 03-after-primary-click.png')
      if (!opened) fail('③ 点主按钮后模型下拉没打开')
      else pass('③ 点主按钮 → 模型下拉真的打开了')
    } else if (label.trim() && !new RegExp(DOOMED_LABEL).test(label)) {
      pass('③ 走「供应商断开自愈」这条路：节点已自动改选到「' + label.trim() + '」，用户没被撂在死模型上')
    } else {
      fail('③ 既没自愈也没给失败卡，节点还钉在已下线的模型上')
    }
  } catch (error) {
    fail('第二阶段抛错: ' + String(error).slice(0, 300))
  } finally {
    await app.close().catch(() => {})
  }
}

console.log(failed ? '\n✗ 走查未通过' : '\n✓ 走查通过：三条断言全中，零 vendor 调用')
process.exit(failed ? 1 : 0)
