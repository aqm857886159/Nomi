#!/usr/bin/env node
// T-5 接入引导第二批（S7a 全部 7 个剩余入口指路收口 + F-D 契约核对，拍板清单 docs/design/boards/2026-11-07-onboarding/Onboarding.board.json）。
//
// 真实桌面窗口全链路验证（零公网、本机回环夹具）：
//   1. 画布生成框连接态与草稿零丢失往返（O1a-canvas：entry.composer-connect + entry.picker-empty）：
//      · 全新未接入进入空白项目画布，添加图片节点并输入提示词草稿；
//      · 左下模型芯片显示「未连模型」，点开下拉仅出「还没连模型 · 连接模型」并直达整窗大页；
//      · 右下原发送位显示胶囊主按钮「连接模型」，悬停浮现草稿保留说明；点入整窗「连接 APIMart」大页（顶栏返回写项目名），
//        按 Esc 返回后画布生成框与已输入草稿 100% 原样保留；
//   2. 顶栏 Nomi 入口与 Agent 面板指路卡（entry.persona-setup + O1c-agent entry.agent-pointer）：
//      · 在画布点顶栏 Nomi 入口展开常驻 Agent 面板，面板内不塞任何输入框表单，只展示身份行、两句说明与「连接 APIMart」指路卡；
//      · 底栏模型按钮显示「未连模型」，弹层底部左「连接模型」直达大页、右「去设置」直达设置 › 模型首页；
//   3. 已有项目未连模型提示条与全仓六处「连接模型」收口（O1b-library：entry.library-banner + entry.copy-unify）：
//      · 回项目库（1 个项目 + 0 可用连接）：不出首屏主卡，顶部出现单段流动提示条「还没连模型 出图、出视频、Agent 都靠一个 APIMart 账户，通常几分钟连好。」+「连接模型」；
//      · 验 zh / dark / en / 1100×690 窄窗（标题不被挤成竖条、零横向溢出）；
//      · 设置 › 通用上手清单第 1 步「连接模型」先关设置再开大页；新手手册四处旧平台名已全部切换为 APIMart 三步；
//   4. 连好即消失与已存 Key 停用文本模型一键自愈（entry.kept-recovery）：
//      · 经本机回环保存合法 Key 后回到项目库，提示条自动消失；
//      · 保留已存 Key 仅停用文本模型后进项目打开 Agent 面板，原样出现「启用 {{model}}」一键恢复卡，点击当场恢复。

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { assertBoardAnchor } from './_boardAnchorAssert.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import {
  applyColorSchemeForShot,
  clickOrFail,
  expect,
  expectAbsent,
  expectCount,
  expectHidden,
  expectVisible,
  proveProbe,
  screenshotSettled,
} from './_assert.mjs'
import {
  AGENT_PANEL,
  NOMI_ENTRY_COLLAPSED,
  backToLibrary,
  collapseAgentPanel,
  createBlankProject,
  ensureAgentPanelOpen,
  nodeModelTrigger,
  openSettings,
  selectOrAddCanvasNode,
  selectedNodeComposer,
  setAppLanguage,
  settingsDialog,
  switchWorkspace,
} from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const boardPreviewDir = path.join(repoRoot, 'docs/design/boards/2026-11-07-onboarding/preview')
const evidenceDir = path.join(repoRoot, 'docs/evidence/2026-11-24-t5-onboarding-s7a')
const extraShotDir = process.env.NOMI_WALK_SHOT_DIR ? path.resolve(process.env.NOMI_WALK_SHOT_DIR) : null
fs.mkdirSync(evidenceDir, { recursive: true })
if (extraShotDir) fs.mkdirSync(extraShotDir, { recursive: true })

// 拍板清单 S7a 全部 7 个 implemented 元素的精确断言标识。
const BOARD = Object.freeze({
  composerConnect: 'board:Onboarding/entry.composer-connect',
  personaSetup: 'board:Onboarding/entry.persona-setup',
  libraryBanner: 'board:Onboarding/entry.library-banner',
  agentPointer: 'board:Onboarding/entry.agent-pointer',
  pickerEmpty: 'board:Onboarding/entry.picker-empty',
  copyUnify: 'board:Onboarding/entry.copy-unify',
  keptRecovery: 'board:Onboarding/entry.kept-recovery',
})

const VALID_LOOPBACK_KEY = 'sk-t5-s7a-loopback-valid-987654'
const SAMPLE_DRAFT = ['一只橘猫', '坐在窗台上'].join('')

function startApimartLoopbackServer() {
  const server = http.createServer((req, res) => {
    const auth = String(req.headers.authorization || '')
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

async function saveShot(win, name, tempShotsDir, locator = null) {
  const outPath = path.join(tempShotsDir, `${name}.png`)
  if (locator) {
    await locator.screenshot({ path: outPath })
  } else {
    await screenshotSettled(win, { path: outPath })
  }
  const evidenceCopy = path.join(evidenceDir, `${name}.png`)
  fs.copyFileSync(outPath, evidenceCopy)
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

const tempRoot = makeTempDir('nomi-t5-onboarding-s7a-')
const tempShotsDir = path.join(tempRoot, 'shots')
fs.mkdirSync(tempShotsDir, { recursive: true })

const loopback = await startApimartLoopbackServer()
let launched = null

try {
  launched = await launchNomiApp({
    name: 't5-onboarding-s7a-fresh',
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

  // ── 1. 画布生成框连接态与模型下拉空态（O1a-canvas：entry.composer-connect + entry.picker-empty）──
  await createBlankProject(win, '新建空白项目进入工作台')
  await switchWorkspace(win, 'generation', '切到生成画布')
  await collapseAgentPanel(win, '收起常驻 Agent 面板露出整张画布')
  await selectOrAddCanvasNode(win, 'image', '新建并选中图片节点')

  const composer = selectedNodeComposer(win)
  const promptInput = composer.locator('[data-node-composer-prompt] [contenteditable="true"]').first()
  await clickOrFail(promptInput, '聚焦图片节点提示词输入框')
  await promptInput.fill(SAMPLE_DRAFT)
  await expect(composer.locator('[data-node-composer-prompt]'), '草稿已写入图片节点生成框').toContainText(SAMPLE_DRAFT)

  // 左下模型芯片显示「未连模型」，点开菜单核验 entry.picker-empty（还没连模型 · 连接模型）
  const modelTrigger = nodeModelTrigger(win)
  await expectVisible(modelTrigger, BOARD.composerConnect)
  await expect(modelTrigger, BOARD.composerConnect).toContainText(
    uiText('zh-CN', 'onboardingProviders.entries.modelChipEmpty'),
  )
  await clickOrFail(modelTrigger, `${BOARD.pickerEmpty}（展开模型选择器空态）`)
  const pickerConnectOption = win.getByRole('option').first().or(win.getByRole('menuitem').first()).first()
  await expectVisible(pickerConnectOption, BOARD.pickerEmpty)
  await expect(pickerConnectOption, BOARD.pickerEmpty).toContainText(
    uiText('zh-CN', 'generationCommon.parameters.noVendorConnected'),
  )
  await expect(pickerConnectOption, BOARD.pickerEmpty).toContainText(
    uiText('zh-CN', 'generationCommon.parameters.connectVendorAction'),
  )
  await clickOrFail(pickerConnectOption, `${BOARD.pickerEmpty}（点击下拉连接项进大页）`)

  const bigPage = win.locator('[data-apimart-connect-page]')
  await expectVisible(bigPage, `${BOARD.pickerEmpty}：模型下拉空态直达连接 APIMart 大页`)
  const backFromPickerText = (await win.locator('[data-apimart-back]').textContent())?.trim() ?? ''
  expect(
    backFromPickerText.length > 0 && backFromPickerText !== uiText('zh-CN', 'appShell.topbar.library'),
    `${BOARD.pickerEmpty}：从项目内进入大页，返回钮写明当前项目名（实测=${backFromPickerText}）`,
  ).toBe(true)
  await win.keyboard.press('Escape')
  await expectHidden(bigPage, `${BOARD.pickerEmpty}：按 Esc 从大页返回原画布`)

  // 确认原画布图片节点生成框仍在（若未选中则点回节点），且草稿一字未丢
  await selectOrAddCanvasNode(win, 'image', '确认图片节点生成框在场')
  await expect(composer.locator('[data-node-composer-prompt]'), `${BOARD.composerConnect}：草稿原样保留`).toContainText(
    SAMPLE_DRAFT,
  )

  // 右下原发送位主按钮「连接模型」+ 悬停提示「出图要先连一个 APIMart 账户（通常几分钟），这段草稿会留着」
  const manifest = JSON.parse(fs.readFileSync(path.join(boardPreviewDir, '../Onboarding.board.json'), 'utf8'))
  const element = manifest.elements.find(row => row.id === 'entry.composer-connect')
  const composerConnectBtn = composer.locator(element.anchor)
  const browser = await chromium.launch()
  try {
    const reference = await browser.newPage({ javaScriptEnabled: false })
    await reference.goto(pathToFileURL(path.join(boardPreviewDir, 'Onboarding.html')).href)
    await assertBoardAnchor({
      frame: reference.locator('#O1a-canvas'), page: win, screen: composer, element,
      lang: 'zh-CN', theme: 'light', text: true, css: ['font-weight'],
    })
  } finally {
    await browser.close()
  }
  await expect(composerConnectBtn, BOARD.composerConnect).toHaveText(uiText('zh-CN', 'onboardingProviders.entries.connectModel'))
  await saveShot(win, 'impl-o1a-canvas-rest-zh', tempShotsDir)
  await composerConnectBtn.hover()
  const composerTooltip = win.getByRole('tooltip')
  await expectVisible(composerTooltip, `${BOARD.composerConnect}：悬停显示草稿保留说明`)
  await expect(composerTooltip, BOARD.composerConnect).toContainText(
    uiText('zh-CN', 'onboardingProviders.entries.composerTooltipImage'),
  )

  const shotO1aZh = await saveShot(win, 'impl-o1a-canvas-zh', tempShotsDir)
  await stitchBoardVsImpl(win, {
    boardFile: 'O1a-canvas.png',
    implPath: shotO1aZh,
    outFile: 'board-vs-impl-o1a-canvas.png',
    label: 'O1a-canvas 1440×900 zh-CN',
  })

  await applyColorSchemeForShot(win, 'dark')
  await composerConnectBtn.hover()
  await saveShot(win, 'impl-o1a-canvas-dark', tempShotsDir)
  await applyColorSchemeForShot(win, 'light')
  await win.mouse.move(12, 12)

  // 点「连接模型」主按钮 → 打开整窗大页 → Esc 返回 → 草稿 100% 保留
  await clickOrFail(composerConnectBtn, `${BOARD.composerConnect}（点发送位「连接模型」主按钮）`)
  await expectVisible(bigPage, `${BOARD.composerConnect}：打开整窗连接 APIMart 大页`)
  await win.keyboard.press('Escape')
  await expectHidden(bigPage, `${BOARD.composerConnect}：Esc 返回原节点`)
  await selectOrAddCanvasNode(win, 'image', '返回后确认原图片节点仍在')
  await expect(
    composer.locator('[data-node-composer-prompt]'),
    `${BOARD.composerConnect}：往返大页后提示词草稿零丢失`,
  ).toContainText(SAMPLE_DRAFT)

  // 切英文核验 O1a-canvas 英文态
  await setAppLanguage(win, 'en', '切英文验 O1a-canvas')
  await selectOrAddCanvasNode(win, 'image', '英文态选中图片节点')
  await expect(composer.locator('[data-composer-connect="true"]'), `${BOARD.composerConnect} (en)`).toHaveText(
    uiText('en', 'onboardingProviders.entries.connectModel'),
  )
  await composer.locator('[data-composer-connect="true"]').hover()
  await expect(win.getByRole('tooltip'), `${BOARD.composerConnect} tooltip (en)`).toContainText(
    uiText('en', 'onboardingProviders.entries.composerTooltipImage'),
  )
  await saveShot(win, 'impl-o1a-canvas-en', tempShotsDir)
  await setAppLanguage(win, 'zh-CN', '切回中文继续验 Agent 面板指路')

  // ── 2. 顶栏 Nomi 入口与 Agent 面板指路卡（entry.persona-setup + O1c-agent entry.agent-pointer）──
  const topbarNomiEntry = win.locator(NOMI_ENTRY_COLLAPSED).first()
  await expectVisible(topbarNomiEntry, BOARD.personaSetup)
  await clickOrFail(topbarNomiEntry, `${BOARD.personaSetup}（点顶栏 Nomi 入口展开面板）`)

  const agentPanel = win.locator(AGENT_PANEL).first()
  await expectVisible(agentPanel, BOARD.personaSetup)
  const agentPointer = agentPanel.locator('[data-agent-pointer="apimart"]')
  await expectVisible(agentPointer, BOARD.agentPointer)
  await expectCount(
    agentPointer.locator('input, textarea'),
    0,
    `${BOARD.agentPointer}：聊天流指路卡内零配置输入框（Agent 只指路）`,
  )
  await expect(agentPointer, BOARD.agentPointer).toContainText(
    uiText('zh-CN', 'onboardingProviders.entries.agentPointerBody'),
  )
  await expect(agentPointer, BOARD.agentPointer).toContainText(
    uiText('zh-CN', 'onboardingProviders.entries.agentPointerTitle'),
  )
  await expect(agentPointer, BOARD.agentPointer).toContainText(
    uiText('zh-CN', 'onboardingProviders.entries.agentPointerSubtitle'),
  )
  await expect(agentPanel.locator('[data-v4-control="model"]'), BOARD.agentPointer).toContainText(
    uiText('zh-CN', 'onboardingProviders.entries.modelChipEmpty'),
  )

  await saveShot(win, 'impl-o1c-agent-full-zh', tempShotsDir)
  const shotO1cPanelZh = await saveShot(win, 'impl-o1c-agent-zh', tempShotsDir, agentPanel)
  await stitchBoardVsImpl(win, {
    boardFile: 'O1c-agent.png',
    implPath: shotO1cPanelZh,
    outFile: 'board-vs-impl-o1c-agent.png',
    label: 'O1c-agent panel zh-CN',
  })

  await applyColorSchemeForShot(win, 'dark')
  await saveShot(win, 'impl-o1c-agent-dark', tempShotsDir, agentPanel)
  await applyColorSchemeForShot(win, 'light')

  await setAppLanguage(win, 'en', '切英文验 O1c-agent')
  await ensureAgentPanelOpen(win, '英文态确认 Agent 面板展开')
  await expect(agentPanel.locator('[data-agent-pointer="apimart"]'), `${BOARD.agentPointer} (en)`).toContainText(
    uiText('en', 'onboardingProviders.entries.agentPointerTitle'),
  )
  await saveShot(win, 'impl-o1c-agent-en', tempShotsDir, agentPanel)
  await setAppLanguage(win, 'zh-CN', '切回中文')
  await ensureAgentPanelOpen(win, '切回中文确认 Agent 面板展开')

  // 点底栏「未连模型」弹层核验 MS-77 双出口，再点指路卡「连接 APIMart」直达大页
  await clickOrFail(agentPanel.locator('[data-v4-control="model"]'), `${BOARD.agentPointer}（展开底栏模型弹层）`)
  const v4PopoverConnect = win.locator('[data-v4-model-connect="true"]')
  const v4PopoverAssisted = win.locator('[data-v4-model-assisted="true"]')
  await expectVisible(v4PopoverConnect, `${BOARD.agentPointer}（MS-77 连接模型）`)
  await expectVisible(v4PopoverAssisted, `${BOARD.agentPointer}（MS-77 去设置）`)
  await clickOrFail(v4PopoverConnect, '从 Agent 模型弹层底部进入大页')
  await expectVisible(bigPage, 'Agent 模型弹层直达连接 APIMart 大页')
  await win.keyboard.press('Escape')
  await expectHidden(bigPage, 'Esc 返回 Agent 面板')

  await clickOrFail(
    agentPanel.locator('[data-agent-pointer-action="apimart"]'),
    `${BOARD.agentPointer}（点聊天区「连接 APIMart」指路卡）`,
  )
  await expectVisible(bigPage, `${BOARD.agentPointer}：指路卡直达连接 APIMart 大页`)
  await win.keyboard.press('Escape')
  await expectHidden(bigPage, 'Esc 返回工作台')

  // ── 3. 已有项目未连模型提示条与全仓六处「连接模型」统一（O1b-library：entry.library-banner + entry.copy-unify）──
  await backToLibrary(win, { label: '返回已有项目的项目库' })
  await expectCount(win.locator('[data-library-hero-card]'), 0, '已有项目时不出首屏主卡')
  const modelBanner = win.locator('[data-model-banner="true"]')
  await expectVisible(modelBanner, BOARD.libraryBanner)
  await expect(modelBanner, BOARD.libraryBanner).toContainText(uiText('zh-CN', 'library.textModelMissing'))
  await expect(modelBanner, BOARD.libraryBanner).toContainText(uiText('zh-CN', 'library.textModelMissingHint'))
  await expect(modelBanner.locator('button'), BOARD.libraryBanner).toHaveText(
    uiText('zh-CN', 'library.connectTextModel'),
  )
  const bannerProof = await proveProbe(modelBanner, BOARD.libraryBanner)

  const shotO1bZh = await saveShot(win, 'impl-o1b-library-zh', tempShotsDir)
  await stitchBoardVsImpl(win, {
    boardFile: 'O1b-library.png',
    implPath: shotO1bZh,
    outFile: 'board-vs-impl-o1b-library.png',
    label: 'O1b-library 1440×900 zh-CN',
  })

  await applyColorSchemeForShot(win, 'dark')
  await saveShot(win, 'impl-o1b-library-dark', tempShotsDir)
  await applyColorSchemeForShot(win, 'light')

  await setAppLanguage(win, 'en', '切英文验 O1b-library')
  await expectVisible(modelBanner, `${BOARD.libraryBanner} (en)`)
  await expect(modelBanner, `${BOARD.libraryBanner} (en)`).toContainText(uiText('en', 'library.textModelMissing'))
  await saveShot(win, 'impl-o1b-library-en', tempShotsDir)

  // 1100×690 窄窗英文长句排版：整段自然换行、标题不被挤成竖条、零横向溢出
  await resizeWindow(app, win, 1100, 690)
  const narrowBannerMetrics = await modelBanner.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const titleSpan = el.querySelector('span.font-medium')?.getBoundingClientRect()
    return {
      bannerHeight: Math.round(rect.height),
      titleWidth: titleSpan ? Math.round(titleSpan.width) : 0,
      titleHeight: titleSpan ? Math.round(titleSpan.height) : 999,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  expect(narrowBannerMetrics.overflowX, `${BOARD.libraryBanner}：1100×690 零横向溢出`).toBe(false)
  expect(
    narrowBannerMetrics.titleWidth >= 110 && narrowBannerMetrics.titleHeight <= 28,
    `${BOARD.libraryBanner}：窄窗下英文标题保持单行不被挤成竖条（实测=${JSON.stringify(narrowBannerMetrics)}）`,
  ).toBe(true)
  await saveShot(win, 'impl-o1b-library-narrow', tempShotsDir)
  await resizeWindow(app, win, 1440, 900)
  await setAppLanguage(win, 'zh-CN', '切回中文')

  // 点项目库提示条「连接模型」→ 打开大页 → Esc 回项目库
  await clickOrFail(modelBanner.locator('button'), `${BOARD.libraryBanner}（点提示条「连接模型」）`)
  await expectVisible(bigPage, `${BOARD.libraryBanner}：项目库提示条直达连接 APIMart 大页`)
  await win.keyboard.press('Escape')
  await expectHidden(bigPage, 'Esc 回项目库')

  // entry.copy-unify（MS-53 + MS-83）：新手手册无旧平台名，且设置 › 通用上手清单第 1 步先关设置再开大页
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-handbook'))
  })
  const handbookDialog = win.getByRole('dialog').first()
  await expectVisible(handbookDialog, `${BOARD.copyUnify}（打开新手手册核验 MS-83）`)
  const handbookText = (await handbookDialog.textContent()) ?? ''
  expect(handbookText.includes('APIMart'), `${BOARD.copyUnify}：新手手册写明 APIMart 接入步骤`).toBe(true)
  expect(/agnes/i.test(handbookText), `${BOARD.copyUnify}：新手手册零旧平台残留`).toBe(false)
  await win.keyboard.press('Escape')
  await expectHidden(handbookDialog, 'Esc 关闭新手手册')

  const generalDialog = await openSettings(win, { tab: 'general', label: `${BOARD.copyUnify}（打开设置 › 通用）` })
  const checklistStepBtn = generalDialog.locator('[data-onboarding-step-connect="true"]')
  await expectVisible(checklistStepBtn, `${BOARD.copyUnify}（MS-53 上手清单第 1 步）`)
  await expect(checklistStepBtn, BOARD.copyUnify).toContainText(uiText('zh-CN', 'onboarding.steps.model.label'))
  await clickOrFail(checklistStepBtn, `${BOARD.copyUnify}（点上手清单「连接模型」）`)
  await expectHidden(settingsDialog(win), `${BOARD.copyUnify}：先自动关闭设置弹窗`)
  await expectVisible(bigPage, `${BOARD.copyUnify}：上手清单直达整窗连接 APIMart 大页`)

  // ── 4. 保存合法 Key 后项目库提示条消失 + 已存 Key 停用文本模型一键恢复（entry.kept-recovery）──
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
  await win.evaluate((validKey) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => validKey },
    })
  }, VALID_LOOPBACK_KEY)
  await clickOrFail(win.locator('[data-apimart-paste-button]'), '保存回环合法 Key')
  await expectHidden(bigPage, '保存合法 Key 后自动关闭大页回项目库')
  await expectAbsent(modelBanner, {
    provenBy: bannerProof,
    message: `${BOARD.libraryBanner}：连接成功后已有项目库顶部提示条立即消失`,
  })

  // 模拟老用户已有 Key 但停用了全部 text 模型 → 进项目展开 Agent 面板核验 entry.kept-recovery 一键启用
  const disabledModelLabel = await win.evaluate(async () => {
    const models = await window.nomiDesktop.modelCatalog.listModels({ kind: 'text' })
    let firstLabel = ''
    for (const m of models) {
      if (!firstLabel && m.enabled) firstLabel = m.labelZh
      if (m.enabled) {
        await window.nomiDesktop.modelCatalog.upsertModel({
          vendorKey: m.vendorKey,
          modelKey: m.modelKey,
          labelZh: m.labelZh,
          kind: 'text',
          enabled: false,
        })
      }
    }
    window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
    return firstLabel
  })
  expect(disabledModelLabel.length > 0, `${BOARD.keptRecovery}：找到并停用至少一个已配 Key 的文本模型`).toBe(true)

  // 有任一可用生图/生视频模型时，项目库提示条依然不出现（老用户零打扰 C2）
  await expectAbsent(modelBanner, {
    provenBy: bannerProof,
    message: `${BOARD.libraryBanner}（C2）：仍有可用生图/视频连接时项目库绝不误弹未连模型提示条`,
  })

  await clickOrFail(win.locator('[data-project-card]').first(), '重新打开刚才的项目')
  await ensureAgentPanelOpen(win, `${BOARD.keptRecovery}（打开 Agent 面板核验一键启用卡）`)
  const recoveryCard = win.locator('[data-recovery="no-text-model"]').first()
  await expectVisible(recoveryCard, BOARD.keptRecovery)
  const recoveryEnableBtn = recoveryCard.locator('[data-recovery-enable]').first()
  await expectVisible(recoveryEnableBtn, BOARD.keptRecovery)
  await saveShot(win, 'impl-kept-recovery-zh', tempShotsDir, win.locator(AGENT_PANEL).first())

  await clickOrFail(recoveryEnableBtn, `${BOARD.keptRecovery}（点击一键启用已配 Key 的文本模型）`)
  await expectHidden(recoveryCard, `${BOARD.keptRecovery}：一键启用后恢复卡立即退场，Agent 正常就绪`)
  await expect(
    win.locator(AGENT_PANEL).first().locator('[data-v4-control="model"]'),
    `${BOARD.keptRecovery}：底栏模型钮退出未连模型空态`,
  ).not.toContainText(uiText('zh-CN', 'onboardingProviders.entries.modelChipEmpty'))

  console.log('[t5-s7a] PASS — all 7 S7a board elements & 3 board-vs-impl comparisons verified.')
} finally {
  if (launched?.app) await launched.app.close().catch(() => {})
  await loopback.close().catch(() => {})
  cleanupTestTemp(tempRoot)
}
