// 音频成时间轴一等公民 R13 走查 —— 真 app 真 mp3，验三件：
//  ① 素材库音频拖到「音频轨」成 audio clip（Playwright 合成拖拽不带自定义 MIME，故用真 DragEvent+DataTransfer）
//  ② 预览播放能听到（<audio> 元素挂载 + 播放中 currentTime 推进）
//  ③ 真实 ffmpeg 导出 mp4 带 aac 音轨（ffprobe 实证 = 终极证明）
// 用法: node tests/ux/audio-timeline.walk.mjs （先 .tmp/probe-tone-3s.mp3 必须存在）
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/audio-timeline')
fs.mkdirSync(shotsDir, { recursive: true })
const AUDIO = path.join(repoRoot, '.tmp', 'probe-tone-3s.mp3')
if (!fs.existsSync(AUDIO)) { console.log('缺 .tmp/probe-tone-3s.mp3'); process.exit(1) }
const FFPROBE = '/opt/homebrew/bin/ffprobe'

const userData = path.join(repoRoot, '.tmp', 'nomi-audio-timeline')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-audio-timeline-projects')
fs.rmSync(userData, { recursive: true, force: true })
fs.rmSync(projectsDir, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })
const testStart = Date.now()

const results = []
let n = 0
function check(name, ok, detail) { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }

const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: repoRoot, env: { ...process.env, NOMI_PROJECTS_DIR: projectsDir } })
let win = await app.firstWindow()
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
async function snap(name) { n += 1; try { await getWin().screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) }) } catch { /* */ } }
async function dismiss() {
  for (let i = 0; i < 6; i++) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(220)
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

  // 空 NOMI_PROJECTS_DIR → 点「新建空白项目」建并进项目。
  await clickText('button, [role="button"]', '新建空白项目', 2600)
  await dismiss()
  await getWin().waitForTimeout(1500)
  const projectId = (/projectId=([^&]+)/.exec(getWin().url()) || [])[1] || ''
  check('新建并进入项目', Boolean(projectId), decodeURIComponent(projectId).slice(-28))

  // 上传 mp3 进库（音频走项目文件源）
  await getWin().evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-asset-library')))
  await getWin().waitForTimeout(800)
  await getWin().locator('input[aria-label="素材文件选择器"]').setInputFiles(AUDIO).catch((e) => console.log('upload err', e.message))
  await getWin().waitForTimeout(4000)
  await getWin().keyboard.press('Escape').catch(() => {})

  // 切到预览（时间轴在此）
  await clickText('button, [role="button"], [role="tab"]', '预览', 1600)
  await getWin().waitForTimeout(800)

  // 合成拖放：读 workspace 文件拿音频 relativePath → 构造素材库拖拽 payload → 真 DragEvent 投到音频轨。
  const dropResult = await getWin().evaluate(async (pid) => {
    const bridge = window.nomiDesktop
    const listed = await bridge.workspace.listFiles({ projectId: pid, limit: 500 })
    const flat = []
    const walk = (nodes) => { for (const nd of nodes) { flat.push(nd); if (nd.children) walk(nd.children) } }
    walk(listed.items || [])
    const audio = flat.find((f) => f.kind === 'audio' && /probe-tone/.test(f.name))
    if (!audio) return { ok: false, why: 'audio not in workspace files', kinds: flat.map((f) => f.kind) }
    const renderUrl = `nomi-local://asset/${encodeURIComponent(pid)}/${audio.relativePath.split('/').map(encodeURIComponent).join('/')}`
    const payload = JSON.stringify({ kind: 'audio', name: audio.name, renderUrl, origin: { source: 'project', projectId: pid, relativePath: audio.relativePath } })
    const trackClips = document.querySelector('[data-track-type="audio"] .workbench-timeline-track__clips')
    if (!trackClips) return { ok: false, why: 'no audio track in DOM' }
    const rect = trackClips.getBoundingClientRect()
    const dt = new DataTransfer()
    dt.setData('application/x-nomi-asset-ref', payload)
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + 1, clientY: rect.top + 20, dataTransfer: dt }
    trackClips.dispatchEvent(new DragEvent('dragenter', opts))
    trackClips.dispatchEvent(new DragEvent('dragover', opts))
    trackClips.dispatchEvent(new DragEvent('drop', opts))
    return { ok: true, name: audio.name }
  }, projectId).catch((e) => ({ ok: false, why: e.message }))
  check('音频在项目文件源 + 投放到音频轨', dropResult.ok, dropResult.why || dropResult.name)
  await getWin().waitForTimeout(2500) // readAudioDurationSeconds(异步) + 落 clip

  const clipProbe = await getWin().evaluate(() => {
    const clips = document.querySelectorAll('[data-track-type="audio"] .workbench-timeline-clip')
    return { count: clips.length, label: clips[0]?.textContent?.trim().slice(0, 24) || '' }
  })
  check('音频轨上出现 audio clip', clipProbe.count > 0, `count=${clipProbe.count} label="${clipProbe.label}"`)
  await snap('audio-clip-on-track')

  // 预览播放 → <audio> 应挂载且播放中 currentTime 推进
  await getWin().locator('[aria-label="播放"]:visible').first().click({ timeout: 2000 }).catch(() => {})
  await getWin().waitForTimeout(1400)
  const audioPlay = await getWin().evaluate(() => {
    const a = document.querySelector('audio')
    if (!a) return { mounted: false }
    return { mounted: true, hasSrc: Boolean(a.src), paused: a.paused, currentTime: Math.round(a.currentTime * 100) / 100 }
  })
  check('预览 <audio> 挂载且在播放（currentTime 推进）', audioPlay.mounted && audioPlay.hasSrc && audioPlay.currentTime > 0, JSON.stringify(audioPlay))
  await getWin().locator('[aria-label="暂停"]:visible, [aria-label="播放"]:visible').first().click({ timeout: 1500 }).catch(() => {})
  await snap('preview-playing')

  // 真实导出 mp4 → ffprobe 验有 aac 音轨
  await getWin().locator('[aria-label="导出 MP4"]').first().click({ timeout: 3000 }).catch((e) => console.log('export click', e.message))
  // 等导出完成（白底视频+音频混音，几秒）
  let out = null
  for (let i = 0; i < 40 && !out; i++) {
    await getWin().waitForTimeout(1500)
    const docs = projectsDir
    const found = []
    const scan = (dir, depth) => { if (depth > 4) return; let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) scan(p, depth + 1); else if (e.name.endsWith('.mp4') && p.includes('/exports/')) { try { if (fs.statSync(p).mtimeMs > testStart) found.push(p) } catch { /* */ } } } }
    try { scan(docs, 0) } catch { /* */ }
    if (found.length) out = found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  }
  if (out) {
    let probe = ''
    try { probe = execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'default=noprint_wrappers=1:nokey=0', out]).toString() } catch (e) { probe = `ffprobe err: ${e.message}` }
    const hasAudio = /codec_type=audio/.test(probe)
    const isAac = /codec_name=aac/.test(probe)
    check('导出 mp4 有音轨', hasAudio, path.basename(out))
    check('音轨编码=aac（混音成功）', isAac, (probe.match(/codec_name=\w+/) || [''])[0])
  } else {
    check('导出 mp4 有音轨', false, '未找到导出产物（导出可能未完成/失败）')
  }
} catch (e) {
  console.log('WALK ERROR:', e.stack || e.message)
} finally {
  console.log('\n=== 结果 ===')
  console.log(`${results.filter((r) => r.ok).length}/${results.length} 通过`)
  await app.close().catch(() => {})
}
