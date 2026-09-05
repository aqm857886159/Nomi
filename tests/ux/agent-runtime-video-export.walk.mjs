// 独立真实视频闭环：loopback provider 返回可播放 MP4，真实 UI 生成→时间轴→预览→导出→冷重启。
// loopback 只替代外部 HTTP 传输；所有项目写入、媒体探针、时间轴、导出和持久化均走生产路径。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/agent-runtime-video-export')
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-video-export-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const fixtureVideo = path.join(tempRoot, 'loopback-result.mp4')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

// Deterministic, valid H.264 MP4 returned by the loopback endpoint. It is not a fake URL:
// ffprobe and Chromium must both decode these bytes.
execFileSync('/opt/homebrew/bin/ffmpeg', [
  '-y', '-f', 'lavfi', '-i', 'color=c=0x274060:s=640x360:r=24', '-t', '2',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixtureVideo,
], { stdio: 'ignore' })
const videoBytes = fs.readFileSync(fixtureVideo)
const videoDataUrl = `data:video/mp4;base64,${videoBytes.toString('base64')}`
const NOW = '2026-09-05T00:00:00.000Z'
const VENDOR = 'video-export-loopback'
const MODEL = 'loopback-video-model'
const wireCalls = []

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve({}) }
    })
  })
}

const vendorServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/videos/generations') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `No route ${req.method} ${req.url}` } }))
    return
  }
  const body = await readJsonBody(req)
  wireCalls.push({ model: String(body.model || ''), prompt: String(body.prompt || ''), body })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ data: [{ url: videoDataUrl }] }))
})
await new Promise((resolve) => vendorServer.listen(0, '127.0.0.1', resolve))
const port = vendorServer.address().port

const mapping = {
  id: `${MODEL}-text_to_video`, vendorKey: VENDOR, taskKind: 'text_to_video', modelKey: MODEL,
  name: 'Loopback video', enabled: true,
  create: {
    method: 'POST', path: '/v1/videos/generations', headers: { 'Content-Type': 'application/json' },
    body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}' },
    response_mapping: { video_url: 'data.0.url' },
  },
  createdAt: NOW, updatedAt: NOW,
}
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 12,
  vendors: [{ key: VENDOR, name: 'Video Export Loopback', enabled: true, baseUrlHint: `http://127.0.0.1:${port}`, authType: 'none', providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW }],
  models: [{ modelKey: MODEL, vendorKey: VENDOR, labelZh: '真实视频片段 fixture', kind: 'video', enabled: true, published: true, createdAt: NOW, updatedAt: NOW }],
  mappings: [mapping], apiKeysByVendor: {},
}, null, 2))

let shot = 0
async function snap(win, name) {
  shot += 1
  const file = path.join(shotsDir, `${String(shot).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  screenshot: ${file}`)
  return file
}
function check(ok, message, detail = '') {
  if (!ok) throw new Error(`${message}${detail ? `: ${detail}` : ''}`)
  console.log(`  ✓ ${message}${detail ? ` — ${detail}` : ''}`)
}
function findProjectJson(root) {
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === 'project.json' && full.includes(`${path.sep}.nomi${path.sep}`)) return full
    }
  }
  return null
}
async function dismissFirstRun(win) {
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) window.localStorage.setItem(key, 'seen')
  })
  await win.reload(); await win.waitForTimeout(1200)
  for (let i = 0; i < 6; i += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(180)
  }
}
async function spendDialog(win) {
  const dialog = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成/ }).last()
  await dialog.waitFor({ timeout: 8000 })
  return dialog
}

let app
let win
try {
  ({ app, win } = await launchNomiApp({
    name: 'agent-runtime-video-export', userDataDir, settingsDir, projectsDir, settleMs: 1200,
    env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}`, NODE_ENV: 'production' },
  }))
  await dismissFirstRun(win)
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 5000 })
  await win.waitForTimeout(2200)
  const projectId = decodeURIComponent((/projectId=([^&]+)/.exec(win.url()) || [])[1] || '')
  check(Boolean(projectId), '通过项目库创建真实项目')
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 5000 })
  await win.waitForTimeout(1200)

  // Add one video node through the visible canvas toolbar and fill its prompt.
  await win.locator('[aria-label="添加视频节点"]').first().click({ timeout: 5000 })
  await win.waitForTimeout(800)
  const node = win.locator('[data-kind="video"][data-node-id]').last()
  await node.waitFor({ timeout: 5000 })
  const nodeId = await node.getAttribute('data-node-id')
  await node.locator('div[contenteditable="true"]').last().fill('一个蓝色方块在深色背景上平稳移动的两秒视频')
  await win.waitForTimeout(500)
  const modelSelect = node.locator('button[aria-label="模型"]').first()
  await modelSelect.waitFor({ state: 'visible', timeout: 10_000 })
  await modelSelect.click()
  const modelOption = win.getByRole('option').filter({ hasText: '真实视频片段 fixture' }).first()
  await modelOption.waitFor({ state: 'visible', timeout: 10_000 })
  await modelOption.click()
  await win.waitForTimeout(600)

  // The selected node composer is the production single-shot entry. It still uses
  // the same generation controller, spend gate, catalog mapping and persistence path.
  const generateAsset = node.locator('button[aria-label="生成素材"]').first()
  await generateAsset.waitFor({ state: 'visible', timeout: 10_000 })
  await generateAsset.click()
  const dialog = await spendDialog(win)
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  try {
    await win.waitForFunction((id) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-status') === 'success', nodeId, { timeout: 45_000 })
  } catch (error) {
    const diagnostic = await win.evaluate((id) => {
      const el = document.querySelector(`[data-node-id="${id}"]`)
      return { status: el?.getAttribute('data-status'), text: el?.textContent?.slice(-500), html: el?.outerHTML.slice(-1200) }
    }, nodeId).catch(() => ({}))
    throw new Error(`${error.message}; wireCalls=${JSON.stringify(wireCalls)} node=${JSON.stringify(diagnostic)}`)
  }
  check(wireCalls.length === 1 && wireCalls[0].model === MODEL, '视频请求通过真实 catalog mapping 发出', JSON.stringify({ model: wireCalls[0]?.model, prompt: wireCalls[0]?.prompt }))
  const projectFileAfterGeneration = findProjectJson(projectsDir)
  check(Boolean(projectFileAfterGeneration), '生成结果写入项目 .nomi/project.json')
  const generatedPayload = JSON.parse(fs.readFileSync(projectFileAfterGeneration, 'utf8')).payload
  const generatedNode = generatedPayload.generationCanvas.nodes.find((candidate) => candidate.id === nodeId)
  check(generatedNode?.result?.type === 'video' && typeof generatedNode?.result?.url === 'string', '项目 payload 保存视频 result URL')
  check(generatedNode.result.url.startsWith('nomi-local://'), '远端视频已落成本地 nomi-local 资产')
  await snap(win, 'generated-video-node')

  // The generated-node affordance appends the real node result to the video track and probes duration.
  const timelineHandle = node.locator('[aria-label*="加入时间轴"]').first()
  await timelineHandle.waitFor({ state: 'visible', timeout: 10_000 })
  await timelineHandle.click()
  const videoClip = win.locator('[data-track-type="video"] .workbench-timeline-clip').first()
  // Adding a video probes its real duration asynchronously; wait for the clip
  // itself instead of sleeping, so the evidence follows the production state.
  await videoClip.waitFor({ state: 'visible', timeout: 10_000 })
  const clipMeta = await videoClip.evaluate((el) => ({ text: el.textContent?.trim() || '', width: el.getBoundingClientRect().width }))
  check(clipMeta.width > 0, '生成视频通过可见入口进入视频时间轴', JSON.stringify(clipMeta))
  await snap(win, 'video-clip-on-timeline')

  await win.locator('[aria-label="工作区切换"]').getByText('预览', { exact: true }).click({ timeout: 5000 })
  await win.waitForTimeout(1200)
  const previewVideo = win.locator('.workbench-preview-player__video').first()
  await previewVideo.waitFor({ state: 'visible', timeout: 10_000 })
  await win.locator('[aria-label="播放"]:visible').first().click({ timeout: 3000 })
  await win.waitForTimeout(900)
  const playback = await previewVideo.evaluate((el) => ({ duration: el.duration, currentTime: el.currentTime, readyState: el.readyState, src: el.currentSrc }))
  check(playback.duration > 0 && playback.currentTime > 0 && playback.readyState >= 2, '预览 video 真实加载并播放推进', JSON.stringify(playback))
  await snap(win, 'preview-video-playing')

  await win.locator('[aria-label="导出 MP4"]').first().click({ timeout: 5000 })
  let exportPath = null
  for (let i = 0; i < 40 && !exportPath; i += 1) {
    await win.waitForTimeout(1000)
    const candidates = []
    const scan = (dir, depth = 0) => {
      if (depth > 5) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) scan(full, depth + 1)
        else if (entry.name.endsWith('.mp4') && full.includes(`${path.sep}exports${path.sep}`)) candidates.push(full)
      }
    }
    scan(projectsDir)
    exportPath = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null
  }
  check(Boolean(exportPath), '导出入口产生真实 MP4 文件')
  const exportProbe = execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_streams', '-show_entries', 'format=duration', '-of', 'json', exportPath], { encoding: 'utf8' })
  const exportJson = JSON.parse(exportProbe)
  check(exportJson.streams?.some((stream) => stream.codec_type === 'video'), '导出 MP4 含视频流', exportPath)
  check(Number(exportJson.format?.duration) > 0 && fs.statSync(exportPath).size > 0, '导出 MP4 有正时长和非零字节', JSON.stringify({ bytes: fs.statSync(exportPath).size, duration: exportJson.format?.duration }))
  await snap(win, 'export-complete')

  const beforeRestart = await win.evaluate((id) => window.nomiDesktop?.projects?.readAsync(id), projectId)
  const beforePayload = beforeRestart?.payload || beforeRestart
  check(Boolean(beforePayload), '通过 public project bridge 读取导出前持久化 payload')
  const beforeRevision = beforePayload?.revision || beforePayload?.meta?.revision || beforePayload?.project?.revision
  await app.close()
  ;({ app, win } = await launchNomiApp({ name: 'agent-runtime-video-export-restart', userDataDir, settingsDir, projectsDir, settleMs: 1200, env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}`, NODE_ENV: 'production' } }))
  await win.waitForTimeout(1200)
  const afterRestart = await win.evaluate((id) => window.nomiDesktop?.projects?.readAsync(id), projectId)
  const afterPayload = afterRestart?.payload || afterRestart
  check(Boolean(afterPayload), '关闭并重启后仍可读回项目 payload')
  const restoredNode = afterPayload?.generationCanvas?.nodes?.find((candidate) => candidate.id === nodeId)
  const restoredClips = afterPayload?.timeline?.tracks?.flatMap((track) => track.clips || []).filter((clip) => clip.type === 'video') || []
  check(restoredNode?.result?.type === 'video' && restoredNode.result.url.startsWith('nomi-local://'), '重启恢复生成视频本地资产')
  check(restoredClips.length > 0, '重启恢复视频时间轴 clip', `count=${restoredClips.length}`)
  const afterRevision = afterPayload?.revision || afterPayload?.meta?.revision || afterPayload?.project?.revision
  check(beforeRevision === undefined || afterRevision === beforeRevision, '重启前后 revision 保持一致', JSON.stringify({ beforeRevision, afterRevision }))
  await snap(win, 'restart-restored-video')
  console.log(JSON.stringify({ result: 'passed', evidenceState: 'loopback', paidCalls: 0, projectId, nodeId, wireCalls, exportPath, screenshots: shotsDir }, null, 2))
} catch (error) {
  console.error(`VIDEO EXPORT WALK FAILED: ${error.stack || error.message}`)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  await new Promise((resolve) => vendorServer.close(resolve))
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
