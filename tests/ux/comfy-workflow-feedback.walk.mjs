import { require as tsxRequire } from 'tsx/cjs/api'
// Real production Electron UI, isolated catalog/project. Zero GPU / no paid service.
// Task: reopen a misclassified video workflow, select a long UNet filename, retain it after reopening.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, clickOrFail, screenshotSettled } from './_assert.mjs'
import { zoomWorkflowFixtures, walkWorkflowZoom, verifySavedWorkflowZoom } from './_comfyWorkflowZoom.mjs'
import { walkWorkflowMacGestures, verifySavedMacGestures } from './_comfyWorkflowMacGestures.mjs'

const require = createRequire(import.meta.url)
const { buildImportedWorkflow, buildComfyImportModelMapping } = tsxRequire('../../electron/catalog/comfyuiWorkflowImport.ts', import.meta.url)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-comfy-feedback-'))
const shotsDir = path.join(root, 'shots')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
for (const dir of [shotsDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })
console.log(`Evidence: ${root}`)
const videoPath = path.join(root, 'fixture.mp4')
const ffmpeg = spawnSync(require('@ffmpeg-installer/ffmpeg').path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath])
if (ffmpeg.status !== 0) throw new Error(`Video fixture failed: ${ffmpeg.error ?? ffmpeg.stderr}`)
const videoBytes = fs.readFileSync(videoPath)

const modelKey = 'comfy-feedback-video'
const names = [
  'MiniMax/H3/minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  'LTX/ltx-2.3/ltx-2.3-22b-dev_transformer_only_fp8_scaled.safetensors',
  'MiniMax/H3/minimax_h3_ref2va_pruned_fp16.safetensors',
  ...Array.from({ length: 180 }, (_, n) => `models/本地模型_${n}_long_model_filename.safetensors`),
]
const graph = {
  '1': { class_type: 'PrimitiveStringMultiline', inputs: { value: '一只猫在跑步' } },
  '2': { class_type: 'UNETLoader', inputs: { unet_name: names[0], weight_dtype: 'default' } },
  '3': { class_type: 'EmptyImage', inputs: { width: 64, height: 64, batch_size: 2 } },
  '4': { class_type: 'CreateVideo', inputs: { images: ['3', 0], fps: 24 } },
  '5': { class_type: 'SaveVideo', inputs: { video: ['4', 0], filename_prefix: 'test', codec: 'auto', format: 'auto' } },
}
const binding = {
  promptNodeId: '1', promptInputKey: 'value', outputNodeId: '5', outputKind: 'video', images: [],
  params: [
    { nodeId: '2', inputKey: 'unet_name', paramKey: 'comfy_unet', label: 'UNet加载器', type: 'text', default: names[0] },
    { nodeId: '2', inputKey: 'weight_dtype', paramKey: 'comfy_dtype', label: '精度', type: 'text', default: 'default' },
    { nodeId: '5', inputKey: 'filename_prefix', paramKey: 'comfy_prefix', label: '文件前缀', type: 'text', default: 'test' },
  ],
}
const enumOptions = [
  { classType: 'UNETLoader', inputKey: 'unet_name', options: names },
  { classType: 'UNETLoader', inputKey: 'weight_dtype', options: ['default', 'fp8'] },
]
const { model, mapping } = buildComfyImportModelMapping(buildImportedWorkflow(graph, binding, enumOptions), {
  modelKey, labelZh: '视频工作流 · 参数验收', draft: { text: JSON.stringify(graph), binding },
})
const zoomFixtures = zoomWorkflowFixtures(graph, binding, buildImportedWorkflow, buildComfyImportModelMapping)
// Old on-disk defect, not a freshly correct model: the app must migrate this itself.
model.kind = 'image'
model.meta.comfyWorkflowImport.binding.outputKind = 'image'
mapping.taskKind = 'text_to_image'
mapping.enabled = true
mapping.query.response_mapping = { image_url: 'image_url', error_message: 'error' }
let submitted
let historyHits = 0
let viewHits = 0
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local.test')
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/system_stats') return res.end(JSON.stringify({ system: { python_version: '3.12', comfyui_version: '0.33.0' }, devices: [] }))
  if (req.url === '/object_info') return res.end(JSON.stringify({
    ...Object.fromEntries(Object.values(graph).map((node) => [node.class_type, { input: { required: node.class_type === 'UNETLoader' ? { unet_name: [names], weight_dtype: [['default', 'fp8']] } : {} } }])),
    ImageScale: { input: { required: { image: ['IMAGE'], width: ['INT'], height: ['INT'], upscale_method: [['nearest-exact']], crop: [['disabled']] } } },
    WorkflowZoomParameters: { input: { required: {} } },
  }))
  if (req.method === 'POST' && url.pathname === '/prompt') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { submitted = JSON.parse(body); res.end(JSON.stringify({ prompt_id: submitted.prompt_id || 'feedback-prompt' })) })
    return
  }
  if (url.pathname.startsWith('/history/')) {
    historyHits += 1
    return res.end(JSON.stringify({ [url.pathname.split('/').at(-1)]: { status: { status_str: 'success', completed: true }, outputs: { '5': { videos: [{ filename: 'fixture.mp4', subfolder: '', type: 'output' }] } } } }))
  }
  if (url.pathname === '/view') { viewHits += 1; res.setHeader('Content-Type', 'video/mp4'); return res.end(videoBytes) }
  res.statusCode = 404
  res.end('{}')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 9, apiKeysByVendor: {}, models: [model, ...zoomFixtures.map((fixture) => fixture.model)], mappings: [mapping, ...zoomFixtures.map((fixture) => fixture.mapping)],
  vendors: [{ key: 'comfyui-local', name: '本地 ComfyUI', enabled: true, authType: 'none', baseUrlHint: baseUrl }],
}))
const projectId = 'comfy-feedback-walk'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(projectRoot)
const project = {
  id: projectId, name: 'ComfyUI 用户反馈验收', version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: 'ComfyUI 用户反馈验收', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null, storyboardPlan: null, storyboardPlanCommitted: false,
    generationCanvas: { edges: [], groups: [], selectedNodeIds: ['feedback-node'], nodes: [{
      id: 'feedback-node', kind: 'video', title: '视频参数验收', position: { x: 360, y: 160 },
      categoryId: 'shots', shotIndex: 1, status: 'idle', prompt: '一只猫在跑步',
      meta: { modelKey, modelVendor: 'comfyui-local', vendor: 'comfyui-local', videoModel: modelKey, videoModelVendor: 'comfyui-local' },
    }] },
  },
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project))

let app
let win
async function closeApp() {
  const closing = app
  if (!closing) return
  const child = closing.process()
  app = undefined
  let timer
  try {
    await Promise.race([
      closing.close().catch(() => undefined),
      new Promise((resolve) => { timer = setTimeout(resolve, 8000) }),
    ])
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}
async function launch() {
  const launched = await launchNomiApp({ name: 'comfy-feedback', tempRoot: root, settingsDir, projectsDir,
    env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}` }, settleMs: 0 })
  app = launched.app; win = launched.win
  win.setDefaultTimeout(15_000)
  const bw = await app.browserWindow(win)
  await bw.evaluate((windowRef) => windowRef.setBounds({ x: 0, y: 0, width: 1440, height: 1000 }))
}
const snap = async (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
async function openProject() {
  const card = win.getByText('ComfyUI 用户反馈验收', { exact: false }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作/ }).first(), '打开验收项目')
  await win.waitForFunction(() => /projectId=/.test(location.href))
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="generation"]'), '进入生成画布')
  await expect(win.locator('nav.nomi-stepper [data-mode="generation"]')).toHaveAttribute('aria-current', 'page')
  const node = win.locator('[data-node-id="feedback-node"]')
  await clickOrFail(node.first(), '选中视频节点')
}

try {
  await launch()
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await closeApp()
  await launch()
  const stored = JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
  expect(stored.models.find((m) => m.modelKey === modelKey).kind).toBe('video')
  expect(stored.mappings.find((m) => m.modelKey === modelKey).taskKind).toBe('text_to_video')
  await openProject()
  await clickOrFail(win.getByRole('button', { name: '打开模型设置', exact: true }), '打开设置核对视频分类')
  const settings = win.getByRole('dialog', { name: '设置', exact: true })
  await clickOrFail(settings.getByRole('button').filter({ hasText: '本地 ComfyUI' }).first(), '打开已接入的 ComfyUI')
  const oldRow = settings.getByRole('button', { name: '打开「视频工作流 · 参数验收」的工作流设置', exact: true })
  await expect(oldRow).toContainText('视频 · ComfyUI 工作流')
  await walkWorkflowZoom(win, snap, () => JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8')))
  await walkWorkflowMacGestures(win, snap, () => JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8')))
  await clickOrFail(settings.getByRole('button', { name: '自定义', exact: true }), '从实际入口导入视频工作流')
  await settings.getByRole('textbox', { name: 'ComfyUI 工作流 JSON', exact: true }).fill(JSON.stringify(graph))
  await clickOrFail(settings.getByRole('button', { name: '分析', exact: true }), '分析输出节点')
  await settings.getByPlaceholder('给它起个名（如：本地 WAN 图生视频）', { exact: true }).fill('新导入视频验收')
  await clickOrFail(settings.getByRole('button', { name: '导入', exact: true }), '保存实际导入结果')
  await expect(settings.getByRole('button', { name: '打开「新导入视频验收」的工作流设置', exact: true })).toContainText('视频 · ComfyUI 工作流')
  await snap('00-video-settings')
  await clickOrFail(settings.getByRole('button', { name: '关闭', exact: true }), '回到画布')
  await expect(settings).toBeHidden()
  await clickOrFail(win.getByRole('button', { name: '生成参数', exact: true }), '打开工作流参数')
  const panel = win.getByRole('group', { name: '生成参数面板', exact: true })
  await expect(panel).toBeVisible()
  await snap('01-parameters-dark')
  const unet = panel.getByRole('button', { name: 'UNet加载器', exact: true })
  // RED before fix: no select trigger; hundreds of overlapping segmented buttons instead.
  await expect(unet).toBeVisible()
  await clickOrFail(unet, '展开 UNet 文件列表')
  const search = win.getByRole('textbox', { name: '搜索选项', exact: true })
  await expect(search).toBeFocused()
  const searchDropdown = search.locator('xpath=ancestor::div[@data-nomi-select-dropdown="true"]')
  const prefix = panel.getByRole('textbox', { name: '文件前缀', exact: true })
  // 真实用户先用 Esc 收起覆盖在后续参数上的长列表，再编辑另一项；等待浮层实际离场，
  // 不用 sleep/force click 掩盖 pointer interception。
  await search.press('Escape')
  await expect(searchDropdown).toBeHidden()
  await clickOrFail(prefix, '收起长列表后编辑另一项')
  await expect(prefix).toBeFocused()
  await prefix.pressSequentially('-edited')
  await expect(prefix).toHaveValue('test-edited')
  await clickOrFail(unet, '返回搜索模型文件')
  await search.fill('ltx-2.3')
  const choice = win.getByRole('option', { name: names[1], exact: true })
  await expect(choice).toBeVisible()
  expect(await choice.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await snap('02-search-long-file-dark')
  await clickOrFail(choice, '选中完整模型文件名')
  await expect(panel).toBeVisible()
  await expect(unet).toHaveAttribute('title', names[1])
  await clickOrFail(unet, '再次展开并验证键盘选择')
  await expect(search).toHaveValue('')
  await search.fill('不存在的文件名')
  await expect(win.getByText('没有匹配的选项', { exact: true })).toBeVisible()
  await search.fill('模型_179_')
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(unet).toHaveAttribute('title', names.at(-1))
  await clickOrFail(unet, '展开后 Escape 只关闭文件列表')
  await search.press('Escape')
  await expect(panel).toBeVisible()
  await expect(unet).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await clickOrFail(win.getByRole('button', { name: '生成参数', exact: true }), '重新打开参数')
  await expect(unet).toHaveAttribute('title', names.at(-1))
  const shortOptions = panel.getByRole('radiogroup', { name: '精度', exact: true })
  await expect(shortOptions).toBeVisible()
  await clickOrFail(shortOptions.getByRole('radio', { name: 'fp8', exact: true }), '短枚举仍可直接选择')
  await expect(shortOptions.getByRole('radio', { name: 'fp8', exact: true })).toHaveAttribute('aria-checked', 'true')
  await snap('03-selected-values-dark')
  await win.mouse.click(100, 100)
  await expect(panel).toBeHidden()
  await win.evaluate(() => localStorage.setItem('nomi-color-scheme', 'light'))
  await closeApp()
  await launch()
  await openProject()
  await verifySavedMacGestures(win, snap)
  await verifySavedWorkflowZoom(win, snap)
  await clickOrFail(win.getByRole('button', { name: '生成参数', exact: true }), '冷启动后查看保存结果')
  const reopenedUnet = win.getByRole('group', { name: '生成参数面板', exact: true }).getByRole('button', { name: 'UNet加载器', exact: true })
  await expect(reopenedUnet).toHaveAttribute('title', names.at(-1))
  await clickOrFail(reopenedUnet, '浅色模式查看长文件列表')
  await win.getByRole('textbox', { name: '搜索选项', exact: true }).fill('minimax')
  await snap('04-search-long-file-light')
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
  await clickOrFail(win.getByRole('button', { name: '生成素材', exact: true }), '真实 UI 发起请求到隔离 HTTP 服务')
  await expect.poll(() => submitted, { timeout: 15_000 }).toBeTruthy()
  expect(submitted.prompt['2'].inputs).toMatchObject({ unet_name: names.at(-1), weight_dtype: 'fp8' })
  expect(submitted.prompt['5'].inputs.filename_prefix).toBe('test-edited')
  expect(submitted.partial_execution_targets).toEqual(['5'])
  await expect.poll(() => historyHits, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect.poll(() => viewHits, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect.poll(async () => win.locator('[data-node-id="feedback-node"] video').evaluateAll((videos) => videos.some((video) => video.readyState >= 2 && video.videoWidth === 64)), { timeout: 15_000 }).toBe(true)
  const player = win.locator('[data-node-id="feedback-node"] video').first()
  expect(await player.evaluate((video) => video.currentSrc)).toMatch(/^nomi-local:\/\//)
  await player.evaluate(async (video) => { video.muted = true; await video.play() })
  await expect.poll(() => player.evaluate((video) => video.currentTime)).toBeGreaterThan(0.2)
  await player.evaluate((video) => video.pause())
  await snap('05-generated-video')
  console.log('PASS: real import/settings video classification; legacy migration; enum search/click/keyboard/focus; nested Escape; short choices; cold restart; dark/light; UI→POST/prompt exact values→history→download→decoded video. HTTP service is simulated, not GPU inference.')
} catch (error) {
  console.error('Focused element:', await win.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') })).catch(() => 'unavailable'))
  await snap('failure').catch(() => undefined)
  throw error
} finally {
  await closeApp()
  await new Promise((resolve) => server.close(resolve))
}
