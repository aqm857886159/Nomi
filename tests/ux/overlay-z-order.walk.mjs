// 浮层层级契约 —— R13 零额度真机走查。
// 用法: node tests/ux/overlay-z-order.walk.mjs
// 产出: tests/ux/shots/overlay-z-order/*.png（自己 Read 亲眼看）
//
// 背景（2026-09-07 实测）：画布/素材库五处浮层硬写 z-[9999] / z-[10000]，
// 全部压过花钱确认卡（NOMI_OVERLAY_Z_INDEX.dialog = 9100）——浮层开着时弹出付费确认，
// 钱要花出去了而那张卡被盖住看不见。根因不是懒：Tailwind 默认 zIndex 只到 50，
// className 侧根本没有合法出口，作者只能硬写数字。修法是把层级契约镜像成 CSS 变量
// 接进 tailwind theme.extend.zIndex（`z-application-modal`），五处改用语义类名。
//
// 这条走查钉死三件事：
//   ① 素材预览浮层（AssetPreviewDialog，portal 到 document.body）开着时，
//      异步弹出的**真实**花钱确认卡必须在最上层（elementFromPoint 打到确认卡）。
//   ② 阳性对照：把该浮层的 z-index 手工改回修复前的 10000，同一测法必须翻红
//      （证明 ① 的断言不是恒真）。
//   ③ 画布 portal 宿主 `.workbench-generation__canvas` 的祖先链是否创建层叠上下文
//      —— 决定另三处 z-[9999] 到底「已证实可达」还是「暂不可达」，结论打印进证据。
//
// 花钱确认卡用 SpendConfirmDialog 在 __nomiE2E==='1' 时挂出的 window.__nomiSpendConfirmE2E
// 驱动**真实** requestConfirm（同 spend-confirm-a11y.walk.mjs），零额度、零网络请求，
// 且忠实还原真实可达路径：MCP / Agent 侧的 capabilityApplyHandler 就是这样**异步**弹卡的，
// 用户当时在看什么浮层它并不知道。
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/overlay-z-order')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-overlay-z-order-'))
const settingsDir = path.join(tempRoot, 'settings')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const ASSET_NAME = 'z-order-fixture.png'
const PROJECT_ID = 'overlay-z-order'
const PROJECT_NAME = '浮层层级验收项目'

function encodeStill(output) {
  const filter = 'color=c=0x1F4E5F:s=640x360,drawbox=x=180:y=90:w=280:h=180:color=0xF2C14E:t=fill'
  const result = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', filter, '-frames:v', '1', output], {
    timeout: 120_000,
  })
  if (result.status !== 0) throw new Error(`夹具编码失败: ${result.stderr?.toString().slice(-500)}`)
}

function seedProject() {
  const projectRoot = path.join(projectsDir, PROJECT_ID)
  const importedDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(importedDir, { recursive: true })
  encodeStill(path.join(importedDir, ASSET_NAME))
  const url = `nomi-local://asset/${encodeURIComponent(PROJECT_ID)}/assets/imported/${encodeURIComponent(ASSET_NAME)}`
  const generationCanvas = {
    nodes: [
      {
        id: `${PROJECT_ID}-asset`,
        kind: 'asset',
        categoryId: 'assets',
        title: '层级夹具',
        position: { x: 120, y: 120 },
        status: 'success',
        meta: { source: 'local-drop', fileName: ASSET_NAME, uploadStatus: 'uploaded' },
        result: { id: `${PROJECT_ID}-asset-result`, type: 'image', url, createdAt: 1 },
      },
    ],
    edges: [],
    selectedNodeIds: [],
    groups: [],
    canvasZoom: 1,
    canvasPan: { x: 0, y: 0 },
  }
  const payload = {
    workbenchDocument: null,
    timeline: null,
    generationCanvas,
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  const record = {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    version: 2,
    createdAt: 1,
    updatedAt: 1,
    savedAt: 1,
    revision: 1,
    lastKnownRootPath: projectRoot,
    workbenchDocument: null,
    timeline: null,
    generationCanvas,
    payload,
  }
  const serialized = JSON.stringify(record, null, 2)
  fs.writeFileSync(path.join(projectRoot, 'project.json'), serialized)
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), serialized)
}

seedProject()

const evidence = []
const check = (ok, message, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${message}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${message}${detail ? ` — ${detail}` : ''}`)
  evidence.push(message)
}

/** 视口正中打到的那个元素属于谁：花钱确认卡，还是素材预览浮层。 */
async function topmostAtCenter(win) {
  return win.evaluate(() => {
    const x = Math.round(window.innerWidth / 2)
    const y = Math.round(window.innerHeight / 2)
    const hit = document.elementFromPoint(x, y)
    const spend = hit?.closest('[data-spend-confirm-dialog]') ?? null
    const overlay = hit?.closest('[data-asset-preview-dialog]') ?? null
    const spendRoot = document.querySelector('[data-spend-confirm-dialog]')
    const overlayRoot = document.querySelector('[data-asset-preview-dialog]')
    const zOf = (el) => (el ? getComputedStyle(el.parentElement ?? el).zIndex : null)
    return {
      point: { x, y },
      owner: spend ? 'spend-confirm' : overlay ? 'asset-preview' : 'other',
      hitTag: hit ? `${hit.tagName.toLowerCase()}.${hit.className?.toString().slice(0, 60)}` : null,
      spendPresent: Boolean(spendRoot),
      overlayPresent: Boolean(overlayRoot),
      spendZ: zOf(spendRoot),
      overlayZ: overlayRoot ? getComputedStyle(overlayRoot).zIndex : null,
    }
  })
}

let app = null
try {
  const launched = await launchNomiApp({
    name: 'overlay-z-order',
    settingsDir,
    userDataDir,
    projectsDir,
    args: ['--disable-gpu', '--no-proxy-server'],
    settleMs: 1800,
  })
  app = launched.app
  const win = launched.win
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((ref) => ref.setBounds({ x: 0, y: 0, width: 1440, height: 960 }))

  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  // 真信号：项目库列表渲染出来了（不是「睡够 2 秒大概好了」）。
  await win.waitForFunction(
    () => document.querySelectorAll('[data-project-card="true"]').length > 0,
    undefined,
    { timeout: 30_000 },
  )

  const card = win.locator('[data-project-card="true"]').filter({ hasText: PROJECT_NAME }).first()
  await expectVisible(card, '夹具项目卡出现')
  await card.dblclick()
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 20_000 })
  // 真信号：工作区外壳（顶栏 + 阶段导航）挂上了。
  await win.waitForFunction(
    () => Boolean(document.querySelector('nav.nomi-stepper')),
    undefined,
    { timeout: 30_000 },
  )
  const resume = win.getByRole('button', { name: /继续创作/ }).first()
  if (await resume.isVisible().catch(() => false)) {
    await resume.click()
    // 真信号：恢复卡消失。
    await win.waitForFunction(
      () => ![...document.querySelectorAll('button')].some((el) => /继续创作/.test(el.textContent ?? '')),
      undefined,
      { timeout: 30_000 },
    )
  }
  // 真信号：生成页画布挂上了（三处画布 portal 的宿主）。
  await win.waitForFunction(
    () => Boolean(document.querySelector('.workbench-generation__canvas')),
    undefined,
    { timeout: 30_000 },
  )
  await win.waitForFunction(() => typeof window.__nomiSpendConfirmE2E === 'function', undefined, { timeout: 20_000 })
  check(true, '真实 requestConfirm 桥已挂出（生产同一条渲染管线，不是复刻卡）')

  // ── ③ 先测画布 portal 宿主的层叠上下文（决定另三处的可达性口径） ──────────────
  const canvasStacking = await win.evaluate(() => {
    const host = document.querySelector('.workbench-generation__canvas')
    if (!host) return { found: false }
    const creators = []
    let node = host
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node)
      const reasons = []
      if (s.zIndex !== 'auto' && s.position !== 'static') reasons.push(`z-index:${s.zIndex}/position:${s.position}`)
      if (s.transform !== 'none') reasons.push(`transform:${s.transform.slice(0, 32)}`)
      if (s.filter !== 'none') reasons.push(`filter:${s.filter.slice(0, 24)}`)
      if (s.opacity !== '1') reasons.push(`opacity:${s.opacity}`)
      if (s.isolation === 'isolate') reasons.push('isolation:isolate')
      if (s.willChange !== 'auto') reasons.push(`will-change:${s.willChange}`)
      if (s.contain && /paint|layout|strict|content/.test(s.contain)) reasons.push(`contain:${s.contain}`)
      if (s.mixBlendMode !== 'normal') reasons.push(`mix-blend-mode:${s.mixBlendMode}`)
      if (reasons.length) {
        creators.push({
          selector: `${node.tagName.toLowerCase()}.${node.className?.toString().split(' ')[0] || ''}`,
          zIndex: s.zIndex,
          reasons,
        })
      }
      node = node.parentElement
    }
    return { found: true, creators }
  })
  console.log(`  · 画布 portal 宿主祖先链层叠上下文：${JSON.stringify(canvasStacking, null, 2)}`)
  fs.writeFileSync(path.join(shotsDir, 'canvas-stacking-context.json'), JSON.stringify(canvasStacking, null, 2))
  check(canvasStacking.found, '画布 portal 宿主 .workbench-generation__canvas 存在（可达性口径可判）')

  // ── ① 真实可达场景：素材预览浮层开着 → 异步弹花钱确认卡 ──────────────────────
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-files-panel')))
  // 真信号：素材库面板真的开了（tab 出现）。
  await win.waitForFunction(
    () => [...document.querySelectorAll('[role="tab"]')].some((el) => /全部素材/.test(el.textContent ?? '')),
    undefined,
    { timeout: 30_000 },
  )
  const allAssetsTab = win.getByRole('tab', { name: /全部素材/ }).first()
  if (await allAssetsTab.isVisible().catch(() => false)) {
    await allAssetsTab.click()
    await win.waitForTimeout(800)
  }
  const assetCard = win.getByRole('button', { name: ASSET_NAME, exact: true }).first()
  await expectVisible(assetCard, '素材卡出现（预览浮层的真实入口）')
  await assetCard.click()
  const overlay = win.locator('[data-asset-preview-dialog]').first()
  await expectVisible(overlay, '素材预览浮层已打开')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-asset-preview-open.png') })

  const beforeSpend = await topmostAtCenter(win)
  check(
    beforeSpend.owner === 'asset-preview' && !beforeSpend.spendPresent,
    '开卡前视口正中确实是预览浮层（阳性前提：它真的挡在那里）',
    JSON.stringify(beforeSpend),
  )

  await win.evaluate(() => {
    window.__nomiZOrderResult = 'pending'
    window
      .__nomiSpendConfirmE2E({
        title: '浮层层级走查 · 花钱确认',
        message: '这一步会真花额度。走查只验层级，不发任何生成请求。',
        confirmLabel: '确认花费 ¥1.20',
        details: [
          { label: '节点', value: '层级夹具 ×1' },
          { label: '预估', value: '¥1.20' },
        ],
      })
      .then((ok) => {
        window.__nomiZOrderResult = ok ? 'confirmed' : 'cancelled'
      })
  })
  const spendDialog = win.locator('[data-spend-confirm-dialog]').first()
  await expectVisible(spendDialog, '浮层开着时花钱确认卡仍然弹得出来')
  await win.waitForTimeout(500)

  const afterSpend = await topmostAtCenter(win)
  check(
    afterSpend.owner === 'spend-confirm',
    '花钱确认卡压在素材预览浮层之上（视口正中真实命中确认卡）',
    JSON.stringify(afterSpend),
  )
  check(
    Number(afterSpend.spendZ) > Number(afterSpend.overlayZ),
    '层级数字也对得上：确认卡 z 高于浮层 z',
    `spendZ=${afterSpend.spendZ} overlayZ=${afterSpend.overlayZ}`,
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '02-spend-confirm-above-overlay.png') })

  // ── ② 阳性对照：把浮层 z 手工改回修复前的 10000，同一测法必须翻回「被盖住」 ───
  await win.evaluate(() => {
    document.querySelector('[data-asset-preview-dialog]').style.zIndex = '10000'
  })
  await win.waitForTimeout(300)
  const regressed = await topmostAtCenter(win)
  check(
    regressed.owner === 'asset-preview',
    '阳性对照：把浮层改回修复前的 z-index:10000，确认卡当场被盖住（证明上面的断言不恒真）',
    JSON.stringify(regressed),
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '03-positive-control-regressed.png') })

  await win.evaluate(() => {
    document.querySelector('[data-asset-preview-dialog]').style.zIndex = ''
  })
  await win.waitForTimeout(300)
  const restored = await topmostAtCenter(win)
  check(restored.owner === 'spend-confirm', '撤掉对照覆盖后回到正确层级', JSON.stringify(restored))

  console.log(`\n证据 ${evidence.length} 条，截图在 ${shotsDir}`)
} finally {
  if (app) await app.close().catch(() => {})
}
