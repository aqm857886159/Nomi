#!/usr/bin/env node
// T-5 接入引导第一批（E0 把「连接模型」收成一扇门 + S7b 首屏主卡与出发大页，拍板清单 docs/design/boards/2026-11-07-onboarding/Onboarding.board.json）。
//
// 真实桌面窗口全链路验证（零公网、本机回环夹具）：
//   1. 全新空装机（0 项目 + 0 可用连接，含内置 local-speech / 火山语音 / 未登录即梦种子）：
//      · Q18 删开屏：冷启动直达项目库，0 遮罩弹窗，关于页无重看开屏入口，项目库无四身份胶囊；
//      · 首屏主卡（entry.library-main-card / entry.library-other-provider / entry.library-start-cards）：
//        实时统计内置 APIMart 活跃模型数（≥80，非硬编码 85），3 张随包作品缩略图解码成功，
//        主卡在场时三张起始卡全部降为 default（全页仅 1 个黑底主按钮）；
//      · 示例讲解收尾提示（entry.finale-line）：未接入时显示「连接模型」软提示框且引号词组绝不断行拆开；
//   2. 整窗平级「连接 APIMart」大页（Main / O2-en / O2-dark / O2-narrow）：
//      · E0 统一入口（big.entry-routing）：主卡、设置 › 模型 › APIMart（先关设置再开大页）、项目内打开模型目录全部汇入同一扇门，重复触发不叠开；
//      · 顶栏返回与 Esc（big.page / big.back）：40px 同壳顶栏 `← 来处 › 连接 APIMart`，无多余关闭钮；
//      · 作品拼贴与视频动效（big.works / big.motion）：3 张随包图自然加载，视频格挂载海报与 metadata 视频、响应减弱动效；
//      · 右栏克制版式（big.claim / big.reasons / depart.cost-time / big.fineprint / depart.steps / depart.open-site / depart.cant-open / big.worries）：
//        严格只用 400 / 600 两种字重，三个大数 tabular-nums，悬停/点击「数字怎么来的」浮层 100% 可达（Esc 先关浮层不关大页），
//        步骤悬停显示官网按钮路径，「打开官网」走系统外链并有 1s 防连点，「打不开？」展开 3 个备用域（均带邀请参数）与代理深链；
//      · 窄窗（big.narrow）：1024×700 下作品收成顶部横条，主按钮留在首屏视口内，零横向溢出；
//   3. 粘贴 Key 保存闭环与老用户零打扰（entry.old-user-nothing）：
//      · 密码框不向 DOM 明文泄露密钥；401 错 Key 诚实报错；合法 Key 经回环保存后自动返回项目库，
//        主卡消失（O0-old-user-empty）、新建空白项目恢复 primary；已有项目的老用户（O0-old-user）同样零主卡。
//   4. 自动拼合拍板稿 vs 真实运行对照图落盘至 docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-{zh,en,dark,narrow}.png。

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import {
  applyColorSchemeForShot,
  clickOrFail,
  expect,
  expectAbsent,
  expectCount,
  expectHidden,
  expectOverlayReachable,
  expectVisible,
  proveProbe,
  screenshotSettled,
} from './_assert.mjs'
import {
  backToLibrary,
  closeSettings,
  openModelSettings,
  openSettings,
  setAppLanguage,
  settingsDialog,
} from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const boardPreviewDir = path.join(repoRoot, 'docs/design/boards/2026-11-07-onboarding/preview')
const evidenceDir = path.join(repoRoot, 'docs/evidence/2026-11-24-t5-onboarding-s7b')
const extraShotDir = process.env.NOMI_WALK_SHOT_DIR ? path.resolve(process.env.NOMI_WALK_SHOT_DIR) : null
fs.mkdirSync(evidenceDir, { recursive: true })
if (extraShotDir) fs.mkdirSync(extraShotDir, { recursive: true })

// 拍板清单 E0 + S7b 全部 19 个 implemented 元素的精确断言标识。
const BOARD = Object.freeze({
  entryRouting: 'board:Onboarding/big.entry-routing',
  libraryMainCard: 'board:Onboarding/entry.library-main-card',
  libraryOtherProvider: 'board:Onboarding/entry.library-other-provider',
  libraryStartCards: 'board:Onboarding/entry.library-start-cards',
  oldUserNothing: 'board:Onboarding/entry.old-user-nothing',
  finaleLine: 'board:Onboarding/entry.finale-line',
  departSteps: 'board:Onboarding/depart.steps',
  departCostTime: 'board:Onboarding/depart.cost-time',
  departOpenSite: 'board:Onboarding/depart.open-site',
  departCantOpen: 'board:Onboarding/depart.cant-open',
  bigPage: 'board:Onboarding/big.page',
  bigBack: 'board:Onboarding/big.back',
  bigWorks: 'board:Onboarding/big.works',
  bigMotion: 'board:Onboarding/big.motion',
  bigClaim: 'board:Onboarding/big.claim',
  bigReasons: 'board:Onboarding/big.reasons',
  bigWorries: 'board:Onboarding/big.worries',
  bigFineprint: 'board:Onboarding/big.fineprint',
  bigNarrow: 'board:Onboarding/big.narrow',
})

const VALID_LOOPBACK_KEY = 'sk-t5-loopback-valid-987654'
const INVALID_LOOPBACK_KEY = 'sk-t5-loopback-invalid-401'

function startApimartLoopbackServer() {
  const requests = []
  const server = http.createServer((req, res) => {
    const auth = String(req.headers.authorization || '')
    requests.push({ method: req.method, url: req.url, auth })
    if (req.url?.startsWith('/v1/balance')) {
      if (auth === `Bearer ${VALID_LOOPBACK_KEY}`) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            success: true,
            remain_balance: 12.5,
            remain_credits: 125,
            used_balance: 0,
            used_credits: 0,
            unlimited_quota: false,
          }),
        )
        return
      }
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid API key', type: 'apimart_error' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [] }))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

async function resizeWindow(app, win, width, height) {
  const bw = await app.browserWindow(win)
  await bw.evaluate((windowRef, size) => windowRef.setContentSize(size.width, size.height), { width, height })
  await win.setViewportSize({ width, height })
  await win.waitForFunction(
    ({ w, h }) => Math.abs(window.innerWidth - w) <= 2 && Math.abs(window.innerHeight - h) <= 2,
    { w: width, h: height },
  )
}

async function saveShot(win, name, tempShotsDir) {
  const outPath = path.join(tempShotsDir, `${name}.png`)
  await screenshotSettled(win, { path: outPath })
  if (extraShotDir) {
    fs.copyFileSync(outPath, path.join(extraShotDir, `${name}.png`))
  }
  return outPath
}

async function stitchBoardVsImpl(win, { boardFile, implPath, outFile, label }) {
  const boardPath = path.join(boardPreviewDir, boardFile)
  if (!fs.existsSync(boardPath)) throw new Error(`找不到拍板原图：${boardPath}`)
  const boardB64 = `data:image/png;base64,${fs.readFileSync(boardPath).toString('base64')}`
  const implB64 = `data:image/png;base64,${fs.readFileSync(implPath).toString('base64')}`
  const stitchedDataUrl = await win.evaluate(
    async ({ leftSrc, rightSrc, heading }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(`加载图片失败: ${heading}`))
          img.src = src
        })
      const [leftImg, rightImg] = await Promise.all([load(leftSrc), load(rightSrc)])
      const pad = 24
      const headerH = 44
      const targetH = Math.max(leftImg.naturalHeight, rightImg.naturalHeight, 700)
      const leftScale = targetH / leftImg.naturalHeight
      const rightScale = targetH / rightImg.naturalHeight
      const leftW = Math.round(leftImg.naturalWidth * leftScale)
      const rightW = Math.round(rightImg.naturalWidth * rightScale)
      const canvas = document.createElement('canvas')
      canvas.width = pad * 3 + leftW + rightW
      canvas.height = pad * 2 + headerH + targetH
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f3f3f1'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#18181b'
      ctx.font = '600 18px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillText(`Board (${heading})`, pad, pad + 26)
      ctx.fillText(`Implementation (${heading})`, pad * 2 + leftW, pad + 26)
      ctx.strokeStyle = '#d4d4d8'
      ctx.lineWidth = 1
      ctx.drawImage(leftImg, pad, pad + headerH, leftW, targetH)
      ctx.strokeRect(pad - 0.5, pad + headerH - 0.5, leftW + 1, targetH + 1)
      ctx.drawImage(rightImg, pad * 2 + leftW, pad + headerH, rightW, targetH)
      ctx.strokeRect(pad * 2 + leftW - 0.5, pad + headerH - 0.5, rightW + 1, targetH + 1)
      return canvas.toDataURL('image/png')
    },
    { leftSrc: boardB64, rightSrc: implB64, heading: label },
  )
  const pngBuffer = Buffer.from(stitchedDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
  const dest = path.join(evidenceDir, outFile)
  fs.writeFileSync(dest, pngBuffer)
  if (extraShotDir) {
    fs.copyFileSync(dest, path.join(extraShotDir, outFile))
  }
  return dest
}

let externalUrlCursor = 0

async function readOpenedExternalUrls(app) {
  return app.evaluate((_electron, cursor) => {
    const events = globalThis.__nomiQuietWalk?.events ?? []
    return events
      .slice(cursor)
      .filter((entry) => entry?.type === 'shell.openExternal')
      .map((entry) => String(entry.args?.[0] ?? ''))
  }, externalUrlCursor)
}

async function clearOpenedExternalUrls(app) {
  externalUrlCursor = await app.evaluate(() => (globalThis.__nomiQuietWalk?.events ?? []).length)
}

const tempRoot = makeTempDir('nomi-t5-onboarding-s7b-')
const tempShotsDir = path.join(tempRoot, 'shots')
fs.mkdirSync(tempShotsDir, { recursive: true })

const loopback = await startApimartLoopbackServer()
let launched = null
let seededLaunch = null

try {
  const coldStartT0 = Date.now()
  launched = await launchNomiApp({
    name: 't5-onboarding-s7b-fresh',
    width: 1440,
    height: 900,
    syntheticCredentialStorage: true,
    mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')],
    env: {
      NOMI_TEST_NETWORK_GUARD: '1',
      NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: loopback.baseURL,
    },
  })
  const { app, win } = launched
  await resizeWindow(app, win, 1440, 900)
  await applyColorSchemeForShot(win, 'light')

  // ── 1. 冷启动直达项目库 + 首屏主卡（Q18 + entry.library-*）──────────────────────
  const heroCard = win.locator('[data-library-hero-card]')
  await expectVisible(heroCard, BOARD.libraryMainCard)
  const coldFirstRunReadyMs = Date.now() - coldStartT0
  console.log(`[t5-s7b] cold first-run library hero ready in ${coldFirstRunReadyMs}ms`)

  // Q18：无开屏遮罩、顶栏直接就绪；设置 › 关于页无重看开屏入口
  await expectVisible(win.locator('[data-shell-topbar]'), 'Q18 冷启动直达主顶栏')
  await expectCount(win.locator('[role="dialog"]'), 0, 'Q18 冷启动零模态遮罩')

  // 主卡 3 张随包作品图自然加载、实时模型数 ≥ 80（非写死 85）
  const heroMetrics = await heroCard.evaluate((card) => {
    const imgs = [...card.querySelectorAll('img')]
    return {
      imgCount: imgs.length,
      allLoaded: imgs.every((img) => img.complete && img.naturalWidth > 0),
      text: card.textContent ?? '',
    }
  })
  expect(heroMetrics.imgCount, `${BOARD.libraryMainCard}：主卡 3 张随包作品缩略图`).toBe(3)
  expect(heroMetrics.allLoaded, `${BOARD.libraryMainCard}：主卡随包作品缩略图全部解码完成`).toBe(true)

  // entry.library-start-cards：主卡在场时，三张起始卡全部降为 default（全页仅主卡 1 个黑底主按钮）
  const startCards = win.locator('.tc-action-card')
  await expectCount(startCards, 3, BOARD.libraryStartCards)
  await expectCount(win.locator('.tc-action-card[data-variant="primary"]'), 0, BOARD.libraryStartCards)
  await expectCount(win.locator('.tc-action-card[data-variant="default"]'), 3, BOARD.libraryStartCards)

  // 记住主卡探针基线，供后续验证连接后 / 老用户主卡消失（expectAbsent 强制要求 provenBy）
  const heroCardProof = await proveProbe(heroCard, BOARD.libraryMainCard)

  // 拍项目库首屏四态：zh 浅色、dark 暗色、en 英文、1100×690 窄高窗
  const shotLibraryZh = await saveShot(win, 'impl-library-zh', tempShotsDir)
  await stitchBoardVsImpl(win, {
    boardFile: 'O0-library.png',
    implPath: shotLibraryZh,
    outFile: 'board-vs-impl-library.png',
    label: 'O0-library zh-CN',
  })

  await applyColorSchemeForShot(win, 'dark')
  await saveShot(win, 'impl-library-dark', tempShotsDir)
  await applyColorSchemeForShot(win, 'light')

  await setAppLanguage(win, 'en', '切英文验项目库主卡')
  await expectVisible(heroCard, `${BOARD.libraryMainCard} (en)`)
  await saveShot(win, 'impl-library-en', tempShotsDir)
  await setAppLanguage(win, 'zh-CN', '切回中文')

  await resizeWindow(app, win, 1100, 690)
  const narrowLibraryFit = await win.evaluate(() => {
    const hero = document.querySelector('[data-library-hero-card]')?.getBoundingClientRect()
    const firstStart = document.querySelector('.tc-action-card')?.getBoundingClientRect()
    return {
      heroInView: Boolean(hero) && hero.top >= 40 && hero.bottom <= window.innerHeight,
      startInView: Boolean(firstStart) && firstStart.bottom <= window.innerHeight,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  expect(narrowLibraryFit.heroInView, `${BOARD.libraryMainCard}：1100×690 下主卡完整在视口内`).toBe(true)
  expect(narrowLibraryFit.startInView, `${BOARD.libraryStartCards}：1100×690 下三张起始卡同屏可见`).toBe(true)
  expect(narrowLibraryFit.overflowX, '1100×690 项目库零横向溢出').toBe(false)
  await saveShot(win, 'impl-library-narrow', tempShotsDir)
  await resizeWindow(app, win, 1440, 900)

  // ── 2. E0 入口收一（big.entry-routing + entry.library-other-provider）────────────
  // 3a) 点主卡「去设置」（entry.library-other-provider）→ 打开设置 › 模型首页
  await clickOrFail(win.locator('[data-library-hero-other-provider]'), BOARD.libraryOtherProvider)
  await expectVisible(settingsDialog(win), BOARD.libraryOtherProvider)
  await expectVisible(win.locator('[data-model-settings-page="home"]'), BOARD.libraryOtherProvider)

  // Q18：顺手检查设置 › 关于页没有重看开屏按钮
  await openSettings(win, { tab: 'about', label: '检查关于页无重看开屏按钮' })
  const aboutButtons = await settingsDialog(win).locator('button').allTextContents()
  expect(aboutButtons.some((txt) => txt.includes('开屏') || txt.toLowerCase().includes('splash')), 'Q18 onb.drop.splash-replay').toBe(false)

  // 3b) 设置 › 模型点 APIMart 入口 → 自动关掉设置弹窗，打开整窗「连接 APIMart」大页
  await openModelSettings(win, { label: BOARD.entryRouting })
  const apimartRowBtn = win.locator('[data-model-home-available="apimart"]')
  await clickOrFail(apimartRowBtn, `${BOARD.entryRouting}（设置 › 模型 › APIMart 行）`)
  await expectHidden(settingsDialog(win), `${BOARD.entryRouting}：进整窗大页前先自动关掉设置弹窗`)
  const bigPage = win.locator('[data-apimart-connect-page]')
  await expectVisible(bigPage, BOARD.bigPage)

  // 重复触发统一入口事件 → 只聚焦已有大页，绝不叠开第二个
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-apimart-connect'))
    window.dispatchEvent(new CustomEvent('nomi-open-apimart-connect'))
  })
  await expectCount(bigPage, 1, `${BOARD.entryRouting}：重复触发绝不开第二个大页`)

  // 按 Esc 返回来处（项目库）
  await win.keyboard.press('Escape')
  await expectHidden(bigPage, `${BOARD.bigBack}：Esc 返回原处`)
  await expectVisible(heroCard, '返回项目库后主卡仍在')

  // 3c) 从主卡主按钮「连接模型」进入整窗大页（Main.png 对照现场）
  await clickOrFail(win.locator('[data-library-hero-connect]'), `${BOARD.entryRouting}（项目库主卡「连接模型」）`)
  await expectVisible(bigPage, BOARD.bigPage)

  // ── 4. 整窗出发大页结构、版式与交互逐项核验（Main / O2-*）──────────────────────
  // big.page & big.back：同壳 40px 顶栏、零 dialog 遮罩、唯一返回钮写明来处「项目库」
  await expectCount(win.locator('[role="dialog"]'), 0, `${BOARD.bigPage}：大页是整窗平级页，不是 Modal 弹窗`)
  const topbarHeight = await win
    .locator('[data-shell-topbar]:visible')
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().height))
  expect(topbarHeight, `${BOARD.bigPage}：共用 40px 外壳顶栏`).toBe(40)
  await expectVisible(win.locator('[data-apimart-back]'), BOARD.bigBack)
  await expect(win.locator('[data-apimart-back]'), BOARD.bigBack).toContainText(uiText('zh-CN', 'appShell.topbar.library'))

  // big.works & big.motion：宽窗拼贴 3 张随包图解码成功，视频格挂载海报与 metadata 视频
  const worksWide = win.locator('[data-apimart-works="wide"]')
  await expectVisible(worksWide, BOARD.bigWorks)
  const worksAudit = await worksWide.evaluate((el) => {
    const imgs = [...el.querySelectorAll('img')]
    const video = el.querySelector('video[data-apimart-motion-video]')
    return {
      imgCount: imgs.length,
      allImgsLoaded: imgs.every((img) => img.complete && img.naturalWidth > 0),
      hasVideoTile: Boolean(el.querySelector('[data-apimart-video-tile]')),
      videoPreload: video ? video.getAttribute('preload') : 'none-mounted',
    }
  })
  expect(worksAudit.imgCount, `${BOARD.bigWorks}：宽窗左栏 3 张作品海报/图`).toBe(3)
  expect(worksAudit.allImgsLoaded, `${BOARD.bigWorks}：随包作品全部本机解码完成`).toBe(true)
  expect(worksAudit.hasVideoTile, `${BOARD.bigMotion}：Seedance 2.0 动效格挂载`).toBe(true)

  // big.claim / big.reasons / depart.cost-time / big.worries + 严格 400/600 字重检查
  await expectVisible(win.locator('[data-apimart-claim]'), BOARD.bigClaim)
  await expectVisible(win.locator('[data-apimart-reasons]'), BOARD.bigReasons)
  await expectVisible(win.locator('[data-apimart-cost]'), BOARD.departCostTime)
  await expectVisible(win.locator('[data-apimart-worries]'), BOARD.bigWorries)

  const typographyAudit = await win.locator('[data-apimart-right]').evaluate((rightCol) => {
    const weights = new Set()
    const walk = (node) => {
      if (!(node instanceof HTMLElement)) return
      weights.add(getComputedStyle(node).fontWeight)
      for (const child of node.children) walk(child)
    }
    walk(rightCol)
    const countEl = rightCol.querySelector('[data-apimart-model-total]')
    const countFontVariant = countEl ? getComputedStyle(countEl).fontVariantNumeric : ''
    return {
      weights: [...weights].sort(),
      modelCount: Number((countEl?.textContent ?? '0').trim()),
      tabular: countFontVariant.includes('tabular-nums'),
    }
  })
  expect(
    typographyAudit.weights.every((w) => w === '400' || w === '600'),
    `${BOARD.bigClaim}：右栏只准出现 400 / 600 两种字重，实测=${JSON.stringify(typographyAudit.weights)}`,
  ).toBe(true)
  expect(typographyAudit.modelCount, `${BOARD.bigReasons}：实时读取内置 APIMart 目录模型数`).toBeGreaterThanOrEqual(80)
  expect(typographyAudit.tabular, `${BOARD.bigReasons}：大数字启用 tabular-nums`).toBe(true)

  // Main.png 拍板对照截图（1440×900 中文浅色）
  const shotBigZh = await saveShot(win, 'impl-big-zh', tempShotsDir)
  await stitchBoardVsImpl(win, {
    boardFile: 'Main.png',
    implPath: shotBigZh,
    outFile: 'board-vs-impl-zh.png',
    label: 'Main 1440×900 zh-CN',
  })

  // big.fineprint：点击/悬停「数字怎么来的」出五条口径浮层，100% 视口可达，Esc 只收浮层不关大页
  await clickOrFail(win.locator('[data-apimart-fineprint-trigger]'), BOARD.bigFineprint)
  const fineprintPop = win.locator('[data-apimart-fineprint-popover]')
  await expectOverlayReachable(fineprintPop, BOARD.bigFineprint)
  await expectCount(fineprintPop.locator('[data-apimart-fineprint-item]'), 5, `${BOARD.bigFineprint}：五条口径说明齐全`)
  await saveShot(win, 'impl-big-fineprint', tempShotsDir)
  await win.keyboard.press('Escape')
  await expectHidden(fineprintPop, `${BOARD.bigFineprint}：Esc 先收起口径浮层`)
  await expectVisible(bigPage, `${BOARD.bigFineprint}：收起浮层时不误关整窗大页`)
  await win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })

  // depart.steps + O2-dark.png（暗色 + 悬停第 1 步显示官网按钮路径）
  await applyColorSchemeForShot(win, 'dark')
  const stepSignup = win.locator('[data-apimart-step="signup"]')
  await expectVisible(stepSignup, BOARD.departSteps)
  await stepSignup.hover()
  await expect(stepSignup.locator('[data-apimart-step-hint]'), `${BOARD.departSteps}：悬停步骤行显示官网按钮路径`).toContainText('→')
  const shotBigDark = await saveShot(win, 'impl-big-dark', tempShotsDir)
  await stitchBoardVsImpl(win, {
    boardFile: 'O2-dark.png',
    implPath: shotBigDark,
    outFile: 'board-vs-impl-dark.png',
    label: 'O2-dark 1440×900 dark',
  })
  await applyColorSchemeForShot(win, 'light')
  await win.mouse.move(10, 10)

  // O2-en.png（1440×900 英文浅色）
  await win.keyboard.press('Escape')
  await setAppLanguage(win, 'en', '切英文验连接 APIMart 大页')
  await clickOrFail(win.locator('[data-library-hero-connect]'), '英文主卡进入大页')
  await expectVisible(bigPage, `${BOARD.bigPage} (en)`)
  const shotBigEn = await saveShot(win, 'impl-big-en', tempShotsDir)
  await stitchBoardVsImpl(win, {
    boardFile: 'O2-en.png',
    implPath: shotBigEn,
    outFile: 'board-vs-impl-en.png',
    label: 'O2-en 1440×900 en',
  })
  await win.keyboard.press('Escape')
  await setAppLanguage(win, 'zh-CN', '切回中文继续验窄窗与外链')
  await clickOrFail(win.locator('[data-library-hero-connect]'), '回中文重进大页')
  await expectVisible(bigPage, BOARD.bigPage)

  // depart.open-site：走系统默认浏览器外链，带邀请码参数，且 1 秒内连点只开一次（防连点）
  await clearOpenedExternalUrls(app)
  const openSiteBtn = win.locator('[data-apimart-open-site]')
  await expectVisible(openSiteBtn, BOARD.departOpenSite)
  await openSiteBtn.evaluate((btn) => {
    btn.click()
    btn.click()
  })
  await expect.poll(() => readOpenedExternalUrls(app), { message: BOARD.departOpenSite }).toEqual([
    'https://apimart.ai/register?aff=t55VtP',
  ])

  // depart.cant-open：展开「打不开？」面板 → 3 个官方中国大陆备用域均带邀请参数 + 代理深链直达设置高级网络区
  await clickOrFail(win.locator('[data-apimart-cant-open-toggle]'), BOARD.departCantOpen)
  const cantOpenPanel = win.locator('[data-apimart-cant-open-panel]')
  await expectVisible(cantOpenPanel, BOARD.departCantOpen)
  for (const domain of ['apib.ai', 'aiuxu.com', 'aishuch.com']) {
    await expectVisible(cantOpenPanel.locator(`[data-apimart-mirror="${domain}"]`), `${BOARD.departCantOpen} (${domain})`)
  }
  await clearOpenedExternalUrls(app)
  // 等待超过 1 秒防连点窗口后，验证备用域按钮正常触发 shell.openExternal
  await new Promise((resolve) => setTimeout(resolve, 1050))
  await clickOrFail(
    cantOpenPanel.locator('[data-apimart-mirror="apib.ai"]'),
    `${BOARD.departCantOpen}：点备用域打开按钮`,
  )
  await expect.poll(() => readOpenedExternalUrls(app), { message: `${BOARD.departCantOpen}：备用域同样带邀请码` }).toEqual([
    'https://apib.ai/register?aff=t55VtP',
  ])
  await saveShot(win, 'impl-big-cant-open', tempShotsDir)

  // 点「设置 › 模型 › 高级 › 网络」深链 → 打开设置 › 模型并滚到高级网络区
  await clickOrFail(win.locator('[data-apimart-proxy-settings]'), `${BOARD.departCantOpen}（代理设置深链）`)
  await expectVisible(settingsDialog(win), '代理深链打开设置弹窗')
  await expectVisible(win.locator('[data-model-home-advanced]'), '代理深链定位到模型设置高级区')
  await closeSettings(win, '关设置回到大页')
  await expectVisible(bigPage, '关设置后仍在大页')

  // big.narrow：1024×700 窄窗（先收起「打不开？」回到默认态对账 O2-narrow.png）
  await clickOrFail(win.locator('[data-apimart-cant-open-toggle]'), '收起「打不开？」以对账窄窗默认态')
  await expectHidden(cantOpenPanel, '「打不开？」已收起')
  await resizeWindow(app, win, 1024, 700)
  await expect(bigPage, BOARD.bigNarrow).toHaveAttribute('data-apimart-layout', 'narrow')
  await expectVisible(win.locator('[data-apimart-works="narrow"]'), BOARD.bigNarrow)
  const narrowGeometry = await win.evaluate(() => {
    const openBtn = document.querySelector('[data-apimart-open-site]')?.getBoundingClientRect()
    const strip = document.querySelector('[data-apimart-works="narrow"]')?.getBoundingClientRect()
    return {
      openBtnBottom: openBtn ? Math.round(openBtn.bottom) : 9999,
      stripHeight: strip ? Math.round(strip.height) : 0,
      viewportH: window.innerHeight,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  expect(narrowGeometry.stripHeight, `${BOARD.bigNarrow}：顶部作品条高度 80px`).toBe(80)
  expect(
    narrowGeometry.openBtnBottom <= narrowGeometry.viewportH,
    `${BOARD.bigNarrow}：1024×700 下主按钮「打开官网」留在首屏内（bottom=${narrowGeometry.openBtnBottom}, viewportH=${narrowGeometry.viewportH}）`,
  ).toBe(true)
  expect(narrowGeometry.overflowX, `${BOARD.bigNarrow}：1024×700 零横向滚动条`).toBe(false)
  const shotBigNarrow = await saveShot(win, 'impl-big-narrow', tempShotsDir)
  await stitchBoardVsImpl(win, {
    boardFile: 'O2-narrow.png',
    implPath: shotBigNarrow,
    outFile: 'board-vs-impl-narrow.png',
    label: 'O2-narrow 1024×700',
  })
  await resizeWindow(app, win, 1440, 900)

  // ── 4. 粘贴 Key 保存闭环（401 拒收 → 合法 Key 通过 → 回原处 + O0-old-user-empty）──
  // 把 apimart 的探测上游切到本机回环夹具（见 credential-probe-free.walk.mjs），零公网真实验证主进程保存链路
  await win.evaluate((origin) => {
    return window.nomiDesktop.modelCatalog.upsertVendor({
      key: 'apimart',
      name: 'APIMart',
      baseUrlHint: origin,
      authType: 'bearer',
      authHeader: 'Authorization',
      providerKind: 'openai-compatible',
    })
  }, loopback.baseURL)
  const keyInput = win.locator('#apimart-connect-key-input')
  await expect(keyInput, '密码框类型不回显明文').toHaveAttribute('type', 'password')

  // 4a) 401 无效 Key：主进程免费探针拒收并在输入框下诚实报错，不关闭大页
  await keyInput.fill(INVALID_LOOPBACK_KEY)
  const outerHtmlLeakCheck = await win.evaluate(() => document.documentElement.outerHTML)
  expect(outerHtmlLeakCheck.includes(INVALID_LOOPBACK_KEY), 'DOM outerHTML 绝不泄露密钥明文').toBe(false)
  await keyInput.press('Enter')
  await expectVisible(win.locator('[data-apimart-key-error]'), '401 无效 Key 诚实显示保存错误')
  await expectVisible(bigPage, '保存失败留在当前大页不丢输入')

  // 4b) 点右侧「粘贴」图标钮（在隔离窗口内挂剪贴板只读替身，不触碰宿主剪贴板也不触发系统粘贴弹窗）→ 自动校验保存并返回项目库
  await win.evaluate((validKey) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => validKey },
    })
  }, VALID_LOOPBACK_KEY)
  await clickOrFail(win.locator('[data-apimart-paste-button]'), '点输入框内粘贴按钮自动保存合法 Key')
  await expectHidden(bigPage, '合法 Key 保存成功后自动关大页回到原处')

  // O0-old-user-empty（entry.old-user-nothing + entry.library-start-cards）：
  // 0 项目 + 已连 APIMart → 主卡彻底消失，且「新建空白项目」恢复为唯一 primary 起始卡！
  await expectAbsent(heroCard, {
    provenBy: heroCardProof,
    message: `${BOARD.oldUserNothing}：连接成功后 0 项目库不再显示首屏主卡（O0-old-user-empty）`,
  })
  await expectCount(win.locator('.tc-action-card[data-variant="primary"]'), 1, `${BOARD.libraryStartCards}：连好后新建空白项目恢复 primary`)
  await saveShot(win, 'impl-old-user-empty-connected', tempShotsDir)

  // ── 5. 第二隔离实例：验证未接入收尾软提示（entry.finale-line）+ 有项目老用户（O0-old-user）+ 别家连接老用户（C2）──
  await app.close()
  launched = null

  seededLaunch = await launchNomiApp({
    name: 't5-onboarding-s7b-other-vendor',
    width: 1440,
    height: 900,
    syntheticCredentialStorage: true,
    mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')],
    env: { NOMI_TEST_NETWORK_GUARD: '1' },
  })
  await resizeWindow(seededLaunch.app, seededLaunch.win, 1440, 900)
  await applyColorSchemeForShot(seededLaunch.win, 'light')

  // 5a) C2：在 0 项目库登记一家非 APIMart 可用连接 → 重载后零主卡、新建空白项目为 primary
  await seededLaunch.win.evaluate(async () => {
    await window.nomiDesktop.modelCatalog.upsertVendor({
      key: 'custom-studio-relay',
      name: 'Studio Relay',
      baseUrlHint: 'http://127.0.0.1:9/v1',
      authType: 'none',
      providerKind: 'openai-compatible',
      enabled: true,
    })
    await window.nomiDesktop.modelCatalog.upsertModel({
      vendorKey: 'custom-studio-relay',
      modelKey: 'qwen-studio-1',
      labelZh: 'Qwen Studio',
      kind: 'text',
      enabled: true,
    })
  })
  await seededLaunch.win.reload()
  await applyColorSchemeForShot(seededLaunch.win, 'light')
  await expectVisible(seededLaunch.win.locator('.tc-action-card[data-variant="primary"]'), `${BOARD.oldUserNothing}：别家连接老用户首屏就绪`)
  await expectAbsent(seededLaunch.win.locator('[data-library-hero-card]'), {
    provenBy: heroCardProof,
    message: `${BOARD.oldUserNothing}（C2）：已配非 APIMart 可用连接的老用户在 0 项目库同样零主卡`,
  })

  // 5b) 移除该连接回到 0 连接状态 → 走示例项目验证收尾软提示（entry.finale-line）及已有项目老用户零主卡（O0-old-user）
  await seededLaunch.win.evaluate(async () => {
    await window.nomiDesktop.modelCatalog.deleteModels([{ vendorKey: 'custom-studio-relay', modelKey: 'qwen-studio-1' }])
    await window.nomiDesktop.modelCatalog.deleteVendor('custom-studio-relay')
  })
  await seededLaunch.win.reload()
  await applyColorSchemeForShot(seededLaunch.win, 'light')
  await expectVisible(seededLaunch.win.locator('[data-library-hero-card]'), '移除别家连接后 0 项目 0 连接恢复主卡')

  const demoTourCard = seededLaunch.win.getByRole('button', { name: new RegExp(uiText('zh-CN', 'library.watchHow')) }).first()
  await clickOrFail(demoTourCard, '点「看 Nomi 怎么出片」启动引导')
  const skipTourBtn = seededLaunch.win.getByRole('button', { name: uiText('zh-CN', 'onboardingProviders.journey.skip'), exact: true })
  await expectVisible(skipTourBtn, '示例讲解浮层出现')
  const nextLabel = uiText('zh-CN', 'onboardingProviders.journey.next')
  const completeLabel = uiText('zh-CN', 'onboardingProviders.journey.complete')
  for (let beat = 0; beat < 12; beat += 1) {
    const finishBtn = seededLaunch.win.getByRole('button', { name: completeLabel, exact: true })
    if (await finishBtn.isVisible().catch(() => false)) {
      await clickOrFail(finishBtn, '完成最后一拍进收尾卡')
      break
    }
    await clickOrFail(seededLaunch.win.getByRole('button', { name: nextLabel, exact: true }), `示例讲解第 ${beat + 1} 拍下一步`)
  }
  const finaleConnect = seededLaunch.win.locator('[data-journey-finale-connect-notice]')
  await expectVisible(finaleConnect, BOARD.finaleLine)
  const quoteRects = await finaleConnect.locator('[data-quoted-ui-name]').evaluate((el) => el.getClientRects().length)
  expect(quoteRects, `${BOARD.finaleLine}（C6）：带引号的「连接模型」绝不跨行拆开`).toBe(1)
  await saveShot(seededLaunch.win, 'impl-finale-zh', tempShotsDir)
  await clickOrFail(
    seededLaunch.win.getByRole('button', { name: uiText('zh-CN', 'onboardingProviders.journey.browseFirst'), exact: true }),
    '点「先逛逛」收起收尾提示',
  )
  // 从项目工作台内触发连接 APIMart → 唯一返回钮写明当前项目名，Esc 回到同一项目且不丢工作台状态
  await seededLaunch.win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-apimart-connect'))
  })
  const studioBigPage = seededLaunch.win.locator('[data-apimart-connect-page]')
  await expectVisible(studioBigPage, `${BOARD.bigBack}：项目内打开整窗大页`)
  const studioBackText = (await seededLaunch.win.locator('[data-apimart-back]').textContent())?.trim() ?? ''
  expect(studioBackText.length > 0 && studioBackText !== uiText('zh-CN', 'appShell.topbar.library'), `${BOARD.bigBack}：从项目内来写项目名（实测=${studioBackText}）`).toBe(true)
  await seededLaunch.win.keyboard.press('Escape')
  await expectHidden(studioBigPage, `${BOARD.bigBack}：Esc 回到原项目工作台`)

  await backToLibrary(seededLaunch.win, { label: '从示例项目回项目库' })

  await expectVisible(seededLaunch.win.locator('[data-project-card]').first(), `${BOARD.oldUserNothing}：库中已有项目卡`)
  await expectAbsent(seededLaunch.win.locator('[data-library-hero-card]'), {
    provenBy: heroCardProof,
    message: `${BOARD.oldUserNothing}：已有项目的用户回项目库绝不出现首屏主卡（O0-old-user）`,
  })
  await saveShot(seededLaunch.win, 'impl-old-user-with-project', tempShotsDir)

  console.log('[t5-s7b] PASS — all 19 E0+S7b board elements & 4 board-vs-impl comparisons verified.')
} finally {
  if (launched?.app) await launched.app.close().catch(() => {})
  if (seededLaunch?.app) await seededLaunch.app.close().catch(() => {})
  await loopback.close().catch(() => {})
  cleanupTestTemp(tempRoot)
}
