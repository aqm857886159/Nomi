// 拆解视频 v1 —— 真实用户任务闭环 + 共存态截图（R16 + R13）。
//
// 一条参考视频 → 拆解 → 看懂结构表 → 勾选镜头 → 加入画布逐个冒出 + 自动编组（整批一个 Cmd+Z）→ 起稿。
// 外壳/画布/IPC/持久化/store 全真；截图人眼判断（P3：跑通 ≠ 拆得对）。
//
// 两条路合一（对齐编排者要求）：
//   · 有 APIMART_API_KEY → **真跑引擎一次**（会花 APIMart 视觉+whisper ≈ $0.02–0.05），验「拆解→结构表」真通；
//   · 断言可重复部分（勾选/落组/共存态/暗色）一律用**注入的确定性结果**跑——不依赖模型输出，稳定复现。
//
// 走查坑单遵守：isolate profile（默认）· 禁 win.reload()（用 store seam 造现场）· 探针先行（clickOrFail/proveProbe）·
// 截图走 screenshotSettled（等视觉安定）· 主题翻转走 applyColorSchemeForShot（四属性）· 禁私有墙钟轮询（用 _assert 的重试断言）。
//
// 用法：pnpm run build && node tests/ux/deconstruction-panel.walk.mjs
//   真跑闭环：pnpm run build && APIMART_API_KEY=sk-... node tests/ux/deconstruction-panel.walk.mjs
// 产出：tests/ux/shots/deconstruction-panel/*.png
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_TIMEOUT_MS,
  applyColorSchemeForShot,
  clickOrFail,
  expect,
  expectAbsent,
  expectVisible,
  proveProbe,
  screenshotSettled,
} from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/deconstruction-panel')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-deconstruct-panel-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [shotsDir, userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const FIXTURE = path.join(repoRoot, 'tests/ux/fixtures/fixture-video.mp4')
if (!fs.existsSync(FIXTURE)) {
  console.log(`SKIP: 找不到 fixture 视频 ${FIXTURE}`)
  process.exit(0)
}
const REAL_RUN = Boolean(process.env.APIMART_API_KEY)

// 注入用的确定性拆解结果（镜像 DeconstructVideoResult；含一个 visionFailed 镜、一个 carriedOver 镜）。
// ⚠️ 时间戳落在 fixture 的真实时长内（fixture-video.mp4 = 2.0s），这样「加入画布」逐镜抽帧才真抽得出来——
//    抽帧走真实 ffmpeg，超出时长的镜会抽失败。叙事文案是示意（读起来像真广告），时间戳必须贴 fixture。
const INJECTED = {
  durationSeconds: 2,
  hasAudio: true,
  failedShotIndexes: [4],
  shots: [
    { index: 1, startSeconds: 0, endSeconds: 0.4, durationSeconds: 0.4, sourceFrameUrl: '', shotSize: '特写', mood: '温暖', visual: '咖啡杯从暗处缓缓推入画面中心，暖色顶光打在瓶身与热气上。', onScreenText: '熬夜救星', dialogue: '', carriedOver: false, imagePrompt: '特写咖啡杯，暖光顶光，琥珀色背景虚化，热气升腾', motionPrompt: '缓慢推近，从暗到亮', custom: {} },
    { index: 2, startSeconds: 0.4, endSeconds: 0.9, durationSeconds: 0.5, sourceFrameUrl: '', shotSize: '中景', mood: '明快', visual: '女主窗边持杯微笑，自然侧光，街景轻微移动，构图偏左留白。', onScreenText: '限时 3 折', dialogue: '忙到现在，就想喝口热的', carriedOver: false, imagePrompt: '中景，女性窗边持杯微笑，自然侧光', motionPrompt: '', custom: {} },
    { index: 3, startSeconds: 0.9, endSeconds: 1.3, durationSeconds: 0.4, sourceFrameUrl: '', shotSize: '近景', mood: '轻松', visual: '手部近景，指尖搅动拉花，奶泡纹路清晰。', onScreenText: '', dialogue: '这一杯值了', carriedOver: true, imagePrompt: '手部近景搅动拉花，奶泡纹理', motionPrompt: '', custom: {} },
    { index: 4, startSeconds: 1.3, endSeconds: 1.6, durationSeconds: 0.3, sourceFrameUrl: '', shotSize: '', mood: '', visual: '', onScreenText: '', dialogue: '现在下单立减 20', carriedOver: false, imagePrompt: '', motionPrompt: '', custom: {}, visionFailed: true },
    { index: 5, startSeconds: 1.6, endSeconds: 2.0, durationSeconds: 0.4, sourceFrameUrl: '', shotSize: '全景', mood: '收束', visual: '拉远至咖啡馆全景，招牌入画，暖黄灯光，人物走向门口，渐暗收尾。', onScreenText: 'XX 咖啡 · 就在你楼下', dialogue: '', carriedOver: false, imagePrompt: '咖啡馆全景，暖黄灯光，门店招牌', motionPrompt: '', custom: {} },
  ],
}

const failures = []
const check = (ok, label) => { console.log(`  ${ok ? '✓' : '✗'} ${label}`); if (!ok) failures.push(label) }
// 生产构建下源码路径不可 import；用 ProductionCanvasLandingHost 在 __nomiE2E==='1' 时挂出的 window.__nomiCanvasStore
// （= useGenerationCanvasStore，.getState() 可用）。这是跟着画布常驻的稳宿主（f15-freeze-gate 同款）。
const canvasState = (win) => win.evaluate(() => {
  const store = window.__nomiCanvasStore
  if (!store) throw new Error('__nomiCanvasStore 未暴露（没 build / 画布没挂 / __nomiE2E 没置）')
  return store.getState()
})

const { app, win } = await launchNomiApp({
  name: 'deconstruction-panel',
  userDataDir,
  settingsDir,
  projectsDir,
  settleMs: 1400,
  env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}` },
})
const snap = async (name) => { await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) }) }

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1680, height: 1020 }))

  // E2E 桥：让 ProductionCanvasLandingHost 在进生成区后挂出 window.__nomiCanvasStore。
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  // 清掉首启开屏/引导，进空白项目 → 生成区。
  for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(160) }
  await clickOrFail(win.getByText('新建空白项目', { exact: false }), '新建空白项目', { noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForTimeout(1500)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: DEFAULT_TIMEOUT_MS })

  // 真跑档：把 APIMart key 落进 catalog（deconstruct 现读 catalog，无需刷新页面）。
  if (REAL_RUN) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: key, enabled: true }), process.env.APIMART_API_KEY)
  }

  // 把 fixture 视频导入成项目素材（拿到 nomi-local:// URL，和用户拖进来同一条路），再 seed 成画布视频节点。
  const bytes = fs.readFileSync(FIXTURE)
  const seeded = await win.evaluate(async ({ b64 }) => {
    const activeId = /projectId=([^&]+)/.exec(location.href)?.[1]
    if (!activeId) return { error: 'no active projectId in url' }
    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const saved = await window.nomiDesktop.assets.importFile({
      projectId: activeId, bytes: binary.buffer, contentType: 'video/mp4', fileName: 'reference.mp4', kind: 'upload',
    })
    const url = saved?.data?.url || saved?.url || ''
    if (!url) return { error: 'asset import failed' }
    const store = window.__nomiCanvasStore.getState()
    const node = store.addNode({ kind: 'video', title: '咖啡馆人物镜头', position: { x: 120, y: 160 } })
    const createdAt = Date.now()
    store.updateNode(node.id, { result: { id: `seed-${createdAt}`, type: 'video', url, createdAt } })
    store.selectNode(node.id)
    return { nodeId: node.id, url }
  }, { b64: bytes.toString('base64') })
  check(Boolean(seeded.nodeId), `seed 源视频节点（${seeded.error || seeded.url?.slice(0, 48)}）`)
  if (!seeded.nodeId) { await snap('00-seed-FAIL'); throw new Error(`seed 失败：${JSON.stringify(seeded)}`) }
  const nodeId = seeded.nodeId
  await win.waitForTimeout(900)

  // ── 入口：视频节点浮条「拆解」钮（探针先行：先证它可见可点，再点开面板）。──
  const node = win.locator(`[data-node-id="${nodeId}"]`).first()
  await node.hover().catch(() => {})
  await win.waitForTimeout(300)
  const deconstructBtn = win.getByRole('button', { name: '拆解' }).first()
  await proveProbe(deconstructBtn, '视频节点浮条上「拆解」钮可见')
  await clickOrFail(deconstructBtn, '视频节点浮条·拆解')
  await win.waitForTimeout(600)

  // 面板占住右槽 + 空态可见（可拆但还没拆）。先证「面板这个定位器确实找得到东西」——
  // 拿这个证明供后面 07 态断言「面板已让位（不占右槽）」用（expectAbsent 强制 provenBy，防瞎探针）。
  const panelLocator = win.locator(`[data-deconstruct-panel="${nodeId}"]`)
  const panelProof = await proveProbe(panelLocator, '拆解面板占槽时这个定位器找得到它')
  await expectVisible(panelLocator.first(), '拆解面板已占住右槽（空态）')
  await expectVisible(win.locator('[data-deconstruct-start="true"]').first(), '空态·开始拆解 可见')
  await snap('01-panel-empty')

  // ── 真跑一次（有 key 才跑；验「拆解→结构表」真通，人眼看打印的表）。──
  if (REAL_RUN) {
    console.log('  → 真跑引擎（APIMart 视觉+whisper，会花 ~$0.02–0.05）…')
    await clickOrFail(win.locator('[data-deconstruct-start="true"]'), '开始拆解（真跑）')
    // 结果态出现 = 拆完（不用私有墙钟轮询；靠 _assert 重试断言等 status=ready，上限放宽到真模型耗时）。
    await expect(
      win.locator(`[data-deconstruct-panel="${nodeId}"][data-deconstruct-status="ready"]`).first(),
      '真跑没落到结果态：引擎抛错 / key 无效 / 模型不可达',
    ).toBeVisible({ timeout: 180_000 })
    const real = await win.evaluate(() => {
      const entry = Object.values(window.__nomiCanvasStore.getState().videoDeconstructions)[0]
      return entry?.result || null
    })
    check(Boolean(real && real.shots.length >= 1), `真跑拆出 ≥1 镜（${real?.shots.length ?? 0} 镜 · 音轨 ${real?.hasAudio ? '有' : '无'}）`)
    console.log('\n———— 真跑拆出来的表（人眼看这一段，别只看勾）————')
    for (const s of real?.shots ?? []) {
      console.log(`[镜 ${s.index}] ${s.startSeconds.toFixed(1)}–${s.endSeconds.toFixed(1)}s · ${s.shotSize || '?'} · ${s.mood || '?'}${s.carriedOver ? ' · 承接' : ''}${s.visionFailed ? ' · ⚠️画面失败' : ''}`)
      if (s.visual) console.log(`  画面：${s.visual}`)
      if (s.dialogue) console.log(`  对白：${s.dialogue}`)
    }
    await snap('01b-panel-real-result')
  }

  // ── 注入确定性结果（断言可重复部分一律走它，稳定复现）。──
  await win.evaluate(({ id, result }) => {
    const store = window.__nomiCanvasStore.getState()
    store.updateNode(id, { meta: { videoDeconstruction: result, durationSeconds: result.durationSeconds } })
    store.setVideoDeconstructionEntry(id, {
      status: 'ready',
      result,
      selectedIndexes: result.shots.filter((s) => !s.visionFailed).map((s) => s.index),
    })
  }, { id: nodeId, result: INJECTED })
  await win.waitForTimeout(500)

  // 结果态：5 行镜头 + 承接标 + 失败镜诚实标 + 单独重拆按钮。
  const shotRows = win.locator('[data-deconstruct-shot]')
  await proveProbe(shotRows, '结果表渲染出镜头行')
  check((await shotRows.count()) === 5, `结果表 5 行镜头（实得 ${await shotRows.count()}）`)
  await expectVisible(win.locator('[data-deconstruct-shot="4"][data-vision-failed="true"]').first(), '镜 4 诚实标 vision-failed')
  await expectVisible(win.locator('[data-deconstruct-retry-shot="4"]').first(), '失败镜有「单独重拆」按钮')
  check((await win.locator('[data-deconstruct-shot="3"] .text-nomi-warning').count()) >= 1, '镜 3 标「承接上镜」')
  await snap('02-panel-result')

  // ── 共存态 06：面板占槽 → AI 栏收成顶栏角标（点它能还原）。──
  await expectVisible(win.locator('[data-generation-collapsed-chip="true"]').first(), '共存 06：AI 栏收成顶栏角标')
  await snap('03-coexist-06-ai-collapsed-chip')

  // ── 落画布：勾选态（默认勾了 4 个非失败镜）→ 加入画布 → 逐个冒 + 自动编组。──
  const addBtn = win.locator('[data-deconstruct-add-to-canvas="true"]').first()
  await proveProbe(addBtn, '「加入画布」按钮可见')
  const groupsBefore = (await canvasState(win)).groups.length
  await clickOrFail(addBtn, '加入画布')
  // 落完面板收起（closePanel）→ 画布上出现一个新组 + 镜头节点。等组数 +1（重试断言，不墙钟）。
  await expect
    .poll(async () => (await canvasState(win)).groups.length, {
      message: '加入画布后没出现新的镜头组',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe(groupsBefore + 1)
  const landed = await win.evaluate(() => {
    const s = window.__nomiCanvasStore.getState()
    const group = s.groups[s.groups.length - 1]
    const members = s.nodes.filter((n) => n.groupId === group.id)
    return {
      groupName: group.name,
      memberCount: members.length,
      allImage: members.every((n) => n.kind === 'image'),
      carriesAnalysis: members.every((n) => Boolean(n.meta?.videoAnalysis)),
      canUndo: s.canUndo,
    }
  })
  check(landed.memberCount === 4, `落组含 4 个镜头节点（实得 ${landed.memberCount}）`)
  check(landed.allImage, '落的都是图片节点')
  check(landed.carriesAnalysis, '每个落节点都带 meta.videoAnalysis（提示词随节点走）')
  check(landed.canUndo, '落组后可撤销（整批一个 Cmd+Z barrier 已打）')
  await win.waitForTimeout(600)
  await snap('04-canvas-landed-group')

  // 整批一个 Cmd+Z：撤一次应把这 4 个节点连同组一起撤掉（回到落前组数）。
  await win.evaluate(() => window.__nomiCanvasStore.getState().undo())
  await win.waitForTimeout(400)
  const afterUndo = (await canvasState(win)).groups.length
  check(afterUndo === groupsBefore, `一个 Cmd+Z 撤掉整批（组数回到 ${groupsBefore}，实得 ${afterUndo}）`)

  // ── 共存态 07：重开面板 → 再打开 AI 栏（互斥）→ 拆解收成节点浮条 + 节点角标。──
  await win.evaluate((id) => {
    const store = window.__nomiCanvasStore.getState()
    store.openVideoDeconstruction(id, { title: '咖啡馆人物镜头', videoUrl: store.nodes.find((n) => n.id === id)?.result?.url || '' })
  }, nodeId)
  await win.waitForTimeout(400)
  // 打开 AI 栏 = 占右槽 → 拆解让位（互斥）。
  await win.evaluate(() => window.__nomiCanvasStore.getState().setGenerationAiCollapsed(false))
  await win.waitForTimeout(600)
  await proveProbe(win.locator(`[data-decon-node-stub="${nodeId}"]`), '共存 07：拆解收成节点「拆解结果」浮条')
  await expectVisible(win.locator(`[data-decon-node-badge="${nodeId}"]`).first(), '共存 07：节点头挂「已拆解 · N 镜」角标')
  // 面板已让位（不占右槽）——用打开态证过的同一个定位器断言它此刻确实不在（provenBy 排除「面板压根没渲染」的假绿）。
  await expectAbsent(panelLocator, { provenBy: panelProof, message: '共存 07：拆解面板应已让位给 Agent（不占右槽）' })
  await snap('05-coexist-07-decon-collapsed-stub')

  // 点浮条把面板叫回，状态不丢（勾选数与收起前一致）。
  await clickOrFail(win.locator(`[data-decon-node-stub="${nodeId}"]`), '拆解结果·浮条')
  await win.waitForTimeout(500)
  await expectVisible(win.locator(`[data-deconstruct-panel="${nodeId}"]`).first(), '点浮条把面板叫回')
  check((await win.locator('[data-deconstruct-shot]').count()) === 5, '叫回后结果表仍是 5 行（状态不丢）')

  // ── 暗色：结果态在暗色 token 下（走生产路径翻主题，等安定再拍）。──
  await applyColorSchemeForShot(win, 'dark')
  await expectVisible(win.locator(`[data-deconstruct-panel="${nodeId}"]`).first(), '暗色·结果态面板可见')
  await snap('06-panel-result-dark')

  console.log(failures.length ? `\n❌ 未达标 ${failures.length} 项：${failures.join('、')}` : `\n✅ 全部达标${REAL_RUN ? '（含真跑闭环）' : '（注入档；真跑闭环需 APIMART_API_KEY）'}`)
} catch (error) {
  console.error('走查异常：', error)
  await win.screenshot({ path: path.join(shotsDir, 'ERROR.png') }).catch(() => {})
  failures.push(`exception: ${error.message}`)
} finally {
  await app.close().catch(() => {})
}
process.exit(failures.length ? 1 : 0)
