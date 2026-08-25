// F16 走查：素材上传/公共托管**第二张确认卡**（KIE 视频上传 / 公共托管确认）是否真的可见、居中、可点。
//
// 背景与结论（本轮复核实测 —— 见 docs/plan/2026-08-25-f16-hosting-consent-dialog.md）：
//   走查现场曾报「该卡容器 getBoundingClientRect = {x:0,y:847,w:1440,h:0}，高 0、看不见」。复核发现
//   那是拿 [data-confirm-dialog] 量到的——该属性落在 Mantine Modal 的 **root**（静态壳，子层
//   position:fixed 脱流），root 天生 {w:100vw,h:0}，**每个** Mantine Modal（正常/异常）都如此，
//   不是塌陷。真正的卡（[role=dialog] / .mantine-Modal-content）实测 380×134、居中、可点，
//   「合成事件点继续上传后生成恢复」也印证按钮本就是活的 → F16「零高不可见」是**测量假警报**。
//
// 所以本走查不是修 bug 的回归证，而是**永久护栏 + 反再误诊**：钉死「确认卡的真表面有真实高度、
// 居中、按钮 elementFromPoint 命中自身、取消后遮罩清干净」，并显式对照证明 root 恒 0 是结构使然。
// 若将来某次改动真把卡压塌，这条会当场报红。
//
// 触发方式：localStorage['__nomiE2E']=1 打开 ConfirmDialogHost 的 E2E 桥
//（window.__nomiConfirmDialogE2E = 真 confirmDialog），以素材托管确认卡的**真 i18n 文案**
//（generationCommon.assetUploadConsent.*）驱动同一棵组件树。零额度、不触真供应商、不依赖付费/形象确认卡。
import { clickOrFail, expectVisible, proveProbe, expectAbsent, screenshotSettled } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/hosting-consent-dialog')
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-hosting-consent-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const { app, win: initialWindow } = await launchNomiApp({
  name: 'hosting-consent-dialog',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = initialWindow
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live[live.length - 1] || win
  return win
}
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
}

// 真 i18n 文案（与 src/i18n/locales/generationCommon.ts 的 assetUploadConsent 逐字一致）。
// 键名严格对齐 confirmDialog 签名（title/message/confirmLabel/cancelLabel）——传错成 confirm/cancel
// 会静默落到默认「确认/取消」文案，就测不出真卡。
const CONSENT = {
  title: 'KIE 视频上传 / 公共托管确认',
  message:
    '当前没有配置 KIE 视频上传。KIE 的文件上传本身免费，配置后会优先使用它；现在也可以继续使用公共临时托管，但素材会离开本机，链接通常只短期有效并存在隐私风险。',
  confirmLabel: '继续上传',
  cancelLabel: '取消生成',
}

async function openConsentDialog() {
  return getWin().evaluate((opts) => {
    const bridge = window.__nomiConfirmDialogE2E
    if (typeof bridge !== 'function') throw new Error('window.__nomiConfirmDialogE2E 未挂载：E2E 桥没生效')
    window.__nomiConsentResult = undefined
    bridge(opts).then((value) => {
      window.__nomiConsentResult = value
    })
    return true
  }, CONSENT)
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1800)
  await getWin().evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  for (let i = 0; i < 3; i += 1) {
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(120)
  }

  // ── 光模式：弹卡 ─────────────────────────────────────────────────────────
  await openConsentDialog()
  // 卡的真表面 = content 内的 wrapper（带 data-confirm-dialog-surface，有真实宽高）。
  // 盯它、不盯 root（root 是静态壳、恒 {w:100vw,h:0}，见下方对照断言）。
  const surface = getWin().locator('[data-confirm-dialog-surface="confirm"]')
  await expectVisible(surface, '素材托管确认卡没弹出来（E2E 桥没把 confirmDialog 送进渲染管线，或卡真塌了）')

  const geom = await surface.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, vh: window.innerHeight, vw: window.innerWidth }
  })
  console.log('  surface rect =', JSON.stringify(geom))
  // 核心护栏：真表面有真实高度（若将来某次改动真把卡压塌，这里报红）。
  check('确认卡真表面有真实高度（没被压塌）', geom.h > 60, `height=${geom.h}`)
  check('确认卡真表面有真实宽度', geom.w > 180, `width=${geom.w}`)
  const cy = geom.y + geom.h / 2
  check('确认卡竖直方向大致居中（没贴到视口边缘）', cy > geom.vh * 0.2 && cy < geom.vh * 0.8, `centerY=${Math.round(cy)} / vh=${geom.vh}`)

  // 反再误诊的对照：root（[data-confirm-dialog]）恒 h:0 是 Mantine 结构使然，不代表卡不可见。
  // 这条把「F16 假警报的来源」钉进测试本身——谁再拿 root 量高度，看到这行就明白别盯 root。
  const rootH = await getWin().locator('[data-confirm-dialog="confirm"]').evaluate((el) => el.getBoundingClientRect().height)
  check('对照：Modal root 恒 0 高（子层 fixed 脱流，非塌陷；勿据此判卡不可见）', rootH === 0, `rootHeight=${rootH}`)

  // 按钮：文案对得上，且 elementFromPoint 命中的确实是按钮本身（遮挡检测同款手法）。
  const confirmBtn = getWin().locator('[data-confirm-dialog-confirm="true"]')
  const cancelBtn = getWin().locator('[data-confirm-dialog-cancel="true"]')
  await expectVisible(confirmBtn, '「继续上传」按钮不可见')
  await expectVisible(cancelBtn, '「取消生成」按钮不可见')
  check('确认按钮文案是「继续上传」', (await confirmBtn.innerText()).includes(CONSENT.confirmLabel), await confirmBtn.innerText())
  check('取消按钮文案是「取消生成」', (await cancelBtn.innerText()).includes(CONSENT.cancelLabel), await cancelBtn.innerText())

  const hitTest = async (locator, label) => {
    const ok = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return Boolean(hit && (hit === el || el.contains(hit)))
    })
    check(`「${label}」按钮 elementFromPoint 命中自身（没被遮罩吞点击）`, ok)
  }
  await hitTest(confirmBtn, '继续上传')
  await hitTest(cancelBtn, '取消生成')

  await screenshotSettled(getWin(), { path: path.join(shotsDir, '01-consent-visible-light.png') })

  // ── 点「取消生成」：结果 resolve=false，且遮罩清干净（无残留 overlay 拦点击）──────────
  // 先证探针能测到 overlay（此刻它就在），再点取消，再断言它没了 —— expectAbsent 强制的阳性对照。
  const overlay = getWin().locator('.mantine-Overlay-root, .mantine-ModalBase-overlay')
  const overlayProof = await proveProbe(overlay, '确认卡开着时 Mantine 遮罩确实存在')
  await clickOrFail(cancelBtn, '取消生成')
  await getWin().waitForTimeout(400)
  const cancelResult = await getWin().evaluate(() => window.__nomiConsentResult)
  check('点「取消生成」后 confirmDialog resolve 为 false（= 取消生成、不放行上传）', cancelResult === false, `result=${JSON.stringify(cancelResult)}`)
  await expectAbsent(overlay, { provenBy: overlayProof, message: '取消后 Mantine 遮罩没清干净，会继续吞掉全画布点击' })
  const clearedToPage = await getWin().evaluate(() => {
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    if (!hit) return false
    return !hit.closest('.mantine-Overlay-root, .mantine-ModalBase-overlay, [data-confirm-dialog]')
  })
  check('取消后视口中心点击落到页面本身（指针已从遮罩解放）', clearedToPage)

  // ── 暗模式：再弹一次，确认深色下同样可见可点 ────────────────────────────────
  await getWin().evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'))
  await getWin().waitForTimeout(300)
  await openConsentDialog()
  const darkSurface = getWin().locator('[data-confirm-dialog-surface="confirm"]')
  await expectVisible(darkSurface, '暗模式下确认卡没弹出')
  const darkH = await darkSurface.evaluate((el) => el.getBoundingClientRect().height)
  check('暗模式确认卡真表面同样有真实高度', darkH > 60, `height=${darkH}`)
  // Mantine Modal 有淡入过渡（~150ms）；等它落定再截，否则截到半透明的过渡帧、人眼审查会误以为卡是透的。
  await getWin().waitForTimeout(600)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '02-consent-visible-dark.png') })
  const darkConfirm = getWin().locator('[data-confirm-dialog-confirm="true"]')
  await clickOrFail(darkConfirm, '继续上传')
  await getWin().waitForTimeout(300)
  const continueResult = await getWin().evaluate(() => window.__nomiConsentResult)
  check('点「继续上传」后 confirmDialog resolve 为 true（= 放行上传）', continueResult === true, `result=${JSON.stringify(continueResult)}`)

  console.log(`\n截图目录：${shotsDir}`)
  console.log('✅ F16 素材托管确认卡走查通过：卡可见/居中/可点，取消回落且遮罩清干净（并已对照证明 root 恒 0 属结构使然）')
} catch (error) {
  console.error('素材托管确认卡走查失败:', error)
  await getWin().screenshot({ path: path.join(shotsDir, '99-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
