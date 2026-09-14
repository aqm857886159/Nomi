// 走查：导入中节点的进度驱动渐显（2026-09-14）。真人点法——走产品真实的「导入」file input。
// 不改产品代码；隔离 profile；每 200ms 连拍 + 量 DOM。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

// 证据目录由调用方给（截图 + 逐帧量测 + 那两个真实素材都住在那里）。没给就明说，
// 别让 path.join(undefined) 抛一句看不懂的话。
const SP = process.env.IMPORT_REVEAL_OUT
if (!SP) {
  console.error('IMPORT_REVEAL_OUT 未设置：请指向放 assets/frame4k.png 与 assets/<视频> 的证据目录')
  process.exit(1)
}
const LABEL = process.argv[2] || 'gpu'
const shots = path.join(SP, 'shots', LABEL)
fs.rmSync(shots, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

const PNG = path.join(SP, 'assets/frame4k.png')
const MOV = path.join(SP, process.env.WALK_VIDEO || 'assets/clip60s.mov')
const timeline = []
const failures = []
const log = (...a) => console.log(...a)
const check = (ok, message) => { if (!ok) failures.push(message) }

const { app, win } = await launchNomiApp({
  name: `import-reveal-${LABEL}`,
  settleMs: 2500,
  args: process.env.NO_GPU ? ['--disable-gpu', '--use-gl=swiftshader'] : [],
})

try {
  await win.setViewportSize({ width: 1440, height: 950 })
  const cap = await win.evaluate(() => {
    let renderer = null
    try {
      const gl = document.createElement('canvas').getContext('webgl')
      if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : '' }
    } catch { renderer = null }
    return { renderer, prefersReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
  })
  const reduced = cap.prefersReduced || cap.renderer === null || /swiftshader|llvmpipe|software/i.test(cap.renderer || '')
  log('CAPABILITY', JSON.stringify({ ...cap, shouldReduceProcessMotion: reduced }))

  const newProject = win.locator('text=新建空白项目').first()
  await newProject.waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await newProject.click()
  await win.waitForTimeout(2500)
  const confirm = win.locator('button', { hasText: /^\s*(创建|确定|确认|开始|Create|Confirm)\s*$/ }).first()
  if (await confirm.count()) { await confirm.click().catch(() => {}); await win.waitForTimeout(2500) }
  // 顶部工作区切换是分段控件，文案就是「生成」两个字（不是「生成画布」）。
  const genTab = win.locator('button', { hasText: /^\s*生成\s*$/ }).first()
  await genTab.waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await genTab.click()
  await win.waitForTimeout(2500)
  const stage = win.locator('[data-nomi-generation-canvas-import-target="true"]').first()
  await expectVisible(stage, '生成画布没进到可导入状态（后面量到的一切都不算数）', stationTimeout({ operations: 3 }))
  await win.screenshot({ path: path.join(shots, '00-canvas-ready.png') })

  const input = win.locator('input[type="file"][accept="image/*,video/*"]').first()
  await input.waitFor({ state: 'attached', timeout: stationTimeout() })
  // 直接旁听主进程的广播，确认「渲染层到底收到了什么」——不靠猜。
  await win.evaluate(() => {
    window.__importEvents = []
    window.nomiDesktop?.assets?.onLocalizationStarted?.((event) => window.__importEvents.push({ at: Date.now(), ...event }))
    // 30ms 高频采样：200ms 连拍只够留人眼证据，马赛克「随字节长」要靠密采样才量得出来。
    window.__revealSamples = []
    const start = Date.now()
    window.__revealTimer = setInterval(() => {
      const cards = Array.from(document.querySelectorAll('[data-progress-reveal]'))
      if (!cards.length) return
      window.__revealSamples.push({ t: Date.now() - start, cards: cards.map((e) => ({
        ratio: Number(e.getAttribute('data-reveal-ratio')), cells: Number(e.getAttribute('data-reveal-cells')), total: Number(e.getAttribute('data-reveal-total')),
      })) })
    }, 30)
  })
  const t0 = Date.now()
  await input.setInputFiles(process.env.ONLY_PNG ? [PNG] : [PNG, MOV])

  const probe = () => win.evaluate(() => {
    const q = (s) => Array.from(document.querySelectorAll(s))
    const reveals = q('[data-progress-reveal]')
    const band = q('[data-process-static-band]')
    return {
      nodes: q('[data-node-id]').length,
      waiting: q('[data-generation-waiting]').length,
      importing: q('[data-generating-placement="import"]').length,
      generating: q('[data-generating-placement="surface"]').length,
      band: band.length,
      bandBg: band[0] ? getComputedStyle(band[0]).backgroundImage.slice(0, 60) : null,
      bandRect: band[0] ? (({ width, height, top }) => ({ w: Math.round(width), h: Math.round(height), y: Math.round(top) }))(band[0].getBoundingClientRect()) : null,
      progressLine: q('[data-process-progress]').length,
      reveal: reveals.map((e) => ({
        ratio: Number(e.getAttribute('data-reveal-ratio')),
        cells: Number(e.getAttribute('data-reveal-cells')),
        total: Number(e.getAttribute('data-reveal-total')),
      })),
      labels: q('[data-process-label]').map((e) => e.textContent),
      skeleton: q('.generation-canvas-v2-node__media-loading').length,
      media: { img: q('[data-node-id] img').length, video: q('[data-node-id] video').length },
    }
  })

  const FRAMES = Number(process.env.WALK_FRAMES || 120)
  for (let i = 0; i < FRAMES; i += 1) {
    const t = Date.now() - t0
    const snapshot = await probe()
    timeline.push({ t, ...snapshot })
    await win.screenshot({ path: path.join(shots, `t${String(t).padStart(6, '0')}ms.png`) })
    if (i % 8 === 0) log(`  t=${t}ms`, JSON.stringify(snapshot))
    if (snapshot.nodes >= 2 && snapshot.waiting === 0 && snapshot.media.img + snapshot.media.video >= 2 && t > 4000) break
    await win.waitForTimeout(120)
  }

  await win.waitForTimeout(3000)
  await win.screenshot({ path: path.join(shots, 'zz-settled.png') })
  const final = await probe()
  log('FINAL', JSON.stringify(final))
  const events = await win.evaluate(() => window.__importEvents || [])
  const samples = await win.evaluate(() => { clearInterval(window.__revealTimer); return window.__revealSamples || [] })
  const growth = samples.filter((s) => s.cards.some((c) => c.cells > 0 && c.cells < c.total))
  log('DENSE-SAMPLES', samples.length, 'growing frames', growth.length, JSON.stringify(growth.slice(0, 12)))
  log('IPC-EVENTS', events.length, JSON.stringify(events.slice(0, 6)))

  // ——判据（记录并继续，不早退）——
  const withReveal = timeline.filter((f) => f.reveal.length > 0)
  // 按「同一张卡」比较：跨节点取 max 会在第一张卡先完成时假装比例回退了。
  const perCard = new Map()
  for (const frame of timeline) frame.reveal.forEach((r, index) => {
    const key = `${frame.reveal.length}:${index}`
    if (!perCard.has(key)) perCard.set(key, [])
    perCard.get(key).push(r.ratio)
  })
  const ratios = withReveal.map((f) => Math.max(...f.reveal.map((r) => r.ratio)))
  const verdict = {
    neverWoreGenerationOverlay: timeline.every((f) => f.generating === 0),
    noSolidBandWithGpu: reduced ? 'n/a（本趟就是无 GPU 兜底）' : timeline.every((f) => f.band === 0),
    fallbackBandIsGradient: reduced ? timeline.some((f) => f.band > 0 && /gradient/.test(f.bandBg || '')) : 'n/a',
    noProgressLineEver: timeline.every((f) => f.progressLine === 0),
    revealRatioMonotonic: [...perCard.values()].every((series) => series.every((r, i) => i === 0 || r >= series[i - 1])),
    revealCellsTrackRatio: withReveal.every((f) => f.reveal.every((r) => !r.total || Math.abs(r.cells - Math.round(r.ratio * r.total)) <= 1)),
    revealReachedFull: ratios.some((r) => r >= 0.999),
    settledHasNoOverlay: final.waiting === 0 && final.importing === 0,
    settledHasRealMedia: final.media.img + final.media.video >= 2,
    skeletonFlashFrames: timeline.filter((f) => f.skeleton > 0).map((f) => f.t),
    ratios,
    ipcEvents: events.length,
    ipcNodes: [...new Set(events.map((e) => e.nodeId))].length,
    denseSamples: samples.length,
    partialMosaicFrames: growth.length,
  }
  log('VERDICT', JSON.stringify(verdict, null, 2))

  // ——断言（这一趟要证明的四件事，任一不成立就红）——
  check(verdict.neverWoreGenerationOverlay, '导入中的节点套上了生成等待层（[data-generating-placement="surface"]）——「导入借生成状态」那条根因回来了')
  check(verdict.noProgressLineEver === true, '导入过程中出现了底部进度线——2026-09-14 用户拍板：马赛克本身就是进度，不要线')
  check(verdict.revealRatioMonotonic, '同一张卡的渐显比例回退过——马赛克必须只增不减')
  check(verdict.revealCellsTrackRatio, '画出来的格子数对不上进度比例——渐显不是由「已拷贝字节 / 总字节」驱动的')
  check(verdict.settledHasNoOverlay, '导入完成后覆盖层还挂着（媒体被遮住）')
  if (reduced) check(verdict.fallbackBandIsGradient === true, '无 GPU 兜底画的不是柔和扫光渐变（实心蓝条又回来了）')
  else check(verdict.noSolidBandWithGpu === true, '有 GPU 的这一趟出现了兜底色块——img-fx 没被准入')
  // 探针活性：导入结束后那张卡上不该再有「导入中」标签。基线取自过程中——
  // timeline 里确实出现过带文本的标签，证明这个选择器测得到东西，不是空洞的「没看到」。
  check(timeline.some((f) => f.labels.length > 0), '整趟没出现过「导入中」标签——下面那条「已经消失」的断言因此不作数')
  const labelProof = await proveProbe(win.locator('[data-node-id]').first(), '画布上的节点')
  await expectAbsent(win.locator('[data-process-label]'), {
    provenBy: labelProof, message: '导入结束后左上角还挂着「导入中」标签（它只该在过程中出现）',
  }).catch((error) => failures.push(String(error.message || error)))
  fs.writeFileSync(path.join(shots, 'timeline.json'), JSON.stringify({ capability: { ...cap, shouldReduceProcessMotion: reduced }, verdict, timeline, final, events, samples }, null, 2))
} catch (error) {
  failures.push(`走查中途异常：${String(error).slice(0, 300)}`)
  console.error('WALK ERROR:', String(error).slice(0, 3000))
  try { await win.screenshot({ path: path.join(shots, 'zz-error.png') }) } catch {}
  fs.writeFileSync(path.join(shots, 'timeline.json'), JSON.stringify({ error: String(error), timeline }, null, 2))
} finally {
  await app.close().catch(() => {})
}

if (failures.length > 0) {
  console.error(`\n✖ 导入渐显走查未通过（${failures.length} 条）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\n✓ 导入渐显走查通过')
