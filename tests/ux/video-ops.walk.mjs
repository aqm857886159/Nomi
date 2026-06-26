// 视频操作修复 R13 走查 —— 真 app 真 mp4，验四修：素材库导入视频 / 视频成画布节点 /
// 入轨取真实时长(非5s) / 播放轴 scrub。
// 用法: node tests/ux/video-ops.walk.mjs  （先 .tmp/probe-12s.mp4 必须存在）
// 产出: tests/ux/shots/video-ops/*.png + stdout 断言。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/video-ops')
fs.mkdirSync(shotsDir, { recursive: true })
const VIDEO = path.join(repoRoot, '.tmp', 'probe-12s.mp4')
if (!fs.existsSync(VIDEO)) { console.log('缺 .tmp/probe-12s.mp4，先用 ffmpeg 造一个 12s mp4'); process.exit(1) }

const userData = path.join(repoRoot, '.tmp', 'nomi-video-ops')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

let n = 0
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: repoRoot, env: { ...process.env } })
let win = await app.firstWindow()
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  const proj = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } })
  win = proj || live[live.length - 1] || win
  return win
}
async function snap(name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  try { await getWin().screenshot({ path: path.join(shotsDir, `${tag}.png`) }); console.log(`  · shot ${tag}`) } catch (e) { console.log(`  ⚠️ shot ${tag}: ${e.message}`) }
}
async function dismiss() {
  for (let i = 0; i < 6; i++) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(250)
  }
}
async function clickText(sel, text, ms = 1400) {
  const el = getWin().locator(sel, { hasText: text }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await getWin().waitForTimeout(ms); return true }
  return false
}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate(() => { localStorage.setItem('nomi-color-scheme', 'light') })
  await win.reload(); await win.waitForTimeout(1600)
  await dismiss()
  await snap('library')

  // 开一个项目（取第一张可打开卡）
  const card = getWin().locator('[data-project-card][role="button"]').first()
  if (await card.count()) { await card.click({ timeout: 4000 }).catch(() => {}) }
  await win.waitForTimeout(2600)
  await dismiss()
  check('进入项目', /projectId=/.test(getWin().url()), getWin().url().slice(-40))

  // 切到生成画布（导入的视频会落这里）
  await clickText('button, [role="button"], [role="tab"]', '生成', 1600)
  const beforeVideos = await getWin().evaluate(() => document.querySelectorAll('.workbench-canvas video, [data-node-id] video, video').length).catch(() => 0)

  // 打开素材库 → setInputFiles 喂真 mp4（绕原生对话框）
  await getWin().evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-asset-library')))
  await getWin().waitForTimeout(900)
  const accept = await getWin().locator('input[aria-label="素材文件选择器"]').getAttribute('accept').catch(() => null)
  check('素材库上传 accept 含 video', (accept || '').includes('video/'), `accept="${accept}"`)
  await snap('asset-library-open')

  await getWin().locator('input[aria-label="素材文件选择器"]').setInputFiles(VIDEO).catch((e) => console.log('setInputFiles err', e.message))
  // 上传 + 落盘 + 探时长需要时间
  await getWin().waitForTimeout(6000)
  await snap('after-upload')

  // 关闭素材库，回画布看视频节点
  await getWin().keyboard.press('Escape').catch(() => {})
  await getWin().waitForTimeout(800)
  const probe = await getWin().evaluate(() => {
    const vids = Array.from(document.querySelectorAll('video'))
    const onCanvas = vids.filter((v) => v.closest('[data-node-id]') || v.closest('.workbench-canvas'))
    const durations = vids.map((v) => (Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : null)).filter((d) => d !== null)
    return { total: vids.length, onCanvas: onCanvas.length, durations }
  }).catch(() => ({ total: 0, onCanvas: 0, durations: [] }))
  check('视频成画布节点', probe.total > beforeVideos, `videos=${probe.total} (was ${beforeVideos})`)
  check('真 mp4 在渲染层加载且时长=12s', probe.durations.includes(12), `durations=${JSON.stringify(probe.durations)}`)
  await snap('canvas-video-node')

  // 入轨真实时长（修「拖入视频一律 5 秒」）：用节点上的「拖拽到时间轴」按钮（onClick 非 DnD）把
  // 我导入的视频节点加到播放头处——这条 clip 无「生成参数时长」，旧逻辑必落 5s，修后应取真实 12s。
  // 先把播放头挪到已有 10s clip 之后，避免重叠被拒/堆叠。
  const myNode = getWin().locator('[data-node-id]', { hasText: 'probe-12s' }).first()
  if (await myNode.count()) {
    await myNode.click({ timeout: 3000 }).catch(() => {})
    await getWin().waitForTimeout(700)
    const addBtn = getWin().locator('[aria-label="拖拽到时间轴"]:visible').first()
    if (await addBtn.count()) { await addBtn.click({ timeout: 3000 }).catch((e) => console.log('addBtn err', e.message)) }
    else console.log('  ⚠️ 没找到「拖拽到时间轴」按钮')
    await getWin().waitForTimeout(1200)
  }
  await snap('canvas-after-add-to-timeline')
  await clickText('button, [role="button"], [role="tab"]', '预览', 1600)
  await getWin().waitForTimeout(900)
  await snap('preview-timeline')
  // 直接量我的 clip 像素宽 ÷ 标尺每秒像素 → 反推秒数（与其它 clip / 持久化状态无关）。
  const mySec = await getWin().evaluate(() => {
    const ruler = Array.from(document.querySelectorAll('.workbench-timeline__ruler-content')).find((r) => r.getClientRects().length && r.offsetParent !== null)
    if (!ruler) return { sec: null, why: 'no visible ruler' }
    const ticks = Array.from(ruler.querySelectorAll('.workbench-timeline__ruler-tick')).map((t) => {
      const m = /translateX\(([-\d.]+)px\)/.exec(t.style.transform || '')
      const label = (t.textContent || '').trim() // "m:ss"
      const mm = /^(\d+):(\d+)$/.exec(label)
      return m && mm ? { x: parseFloat(m[1]), sec: parseInt(mm[1], 10) * 60 + parseInt(mm[2], 10) } : null
    }).filter(Boolean)
    if (ticks.length < 2) return { sec: null, why: 'few ticks' }
    const a = ticks[0], b = ticks[ticks.length - 1]
    const pxPerSec = (b.x - a.x) / (b.sec - a.sec)
    if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return { sec: null, why: 'bad pxPerSec' }
    const clip = Array.from(document.querySelectorAll('.workbench-timeline-clip, [data-clip-id]')).find((c) => /probe/.test(c.textContent || ''))
    if (!clip) return { sec: null, why: 'my clip not on timeline' }
    return { sec: Math.round((clip.getBoundingClientRect().width / pxPerSec) * 10) / 10, pxPerSec: Math.round(pxPerSec) }
  }).catch((e) => ({ sec: null, why: e.message }))
  check('入轨我的视频取真实 12s（非默认 5s）', mySec.sec !== null && mySec.sec >= 11 && mySec.sec <= 13, `myClip=${mySec.sec}s (pxPerSec=${mySec.pxPerSec || '-'}, ${mySec.why || 'ok'})`)

  // scrub：播放后点时间轴中间，playhead 应跟到点击处（非回 0）。标尺用 :visible 避开 keep-alive 隐藏的生成区那条。
  await getWin().locator('[aria-label="播放"]:visible').first().click({ timeout: 2000 }).catch(() => {})
  await getWin().waitForTimeout(900)
  const ruler = getWin().locator('.workbench-timeline__ruler-content:visible').first()
  const box = await ruler.boundingBox().catch(() => null)
  if (box) {
    await getWin().mouse.click(box.x + box.width * 0.4, box.y + box.height / 2)
    await getWin().waitForTimeout(600)
    const afterClick = await getWin().locator('span.tabular-nums:visible', { hasText: /s \/ .*s/ }).first().textContent().catch(() => '')
    const cur = Number((afterClick.split('/')[0] || '').replace(/[^\d.]/g, ''))
    check('点时间轴中间 → playhead 跳到该处（非回 0）', cur > 0.3, `current=${cur}s`)
  } else {
    check('点时间轴中间 → playhead 跳到该处（非回 0）', false, '找不到可见标尺')
  }
  await snap('timeline-scrub')
} catch (e) {
  console.log('WALK ERROR:', e.stack || e.message)
} finally {
  console.log('\n=== 结果 ===')
  const pass = results.filter((r) => r.ok).length
  console.log(`${pass}/${results.length} 通过`)
  await app.close().catch(() => {})
}
