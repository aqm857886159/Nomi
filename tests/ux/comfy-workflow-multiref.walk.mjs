// Real production UI: import three media inputs, connect three canvas assets, restart, submit.
// Local HTTP emulates ComfyUI upload/history only; this is NOT a GPU inference test.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, clickOrFail, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const withVideo = process.argv.includes('--with-video')
const projectName = withVideo ? 'ComfyUI 三图与视频闭环' : 'ComfyUI 三图真实闭环'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-comfy-multiref-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const shotsDir = path.join(root, 'shots')
const projectId = 'comfy-three-reference-walk'
const projectRoot = path.join(projectsDir, projectId)
const assetsDir = path.join(projectRoot, 'assets/generated')
for (const dir of [settingsDir, shotsDir, assetsDir]) fs.mkdirSync(dir, { recursive: true })
console.log(`Evidence: ${root}`)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const references = ['red', 'green', 'blue'].map((color, index) => {
  const file = path.join(assetsDir, `${color}.png`)
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', file])
  if (result.status !== 0) throw new Error(`Image fixture failed: ${result.error ?? result.stderr}`)
  return { id: `source-${index + 1}`, title: `画布参考 ${index + 1}`, label: `参考图 ${index + 1}`, bytes: fs.readFileSync(file), url: `nomi-local://asset/${projectId}/assets/generated/${color}.png` }
})
const videoPath = path.join(root, 'fixture.mp4')
const videoResult = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath])
if (videoResult.status !== 0) throw new Error(`Video fixture failed: ${videoResult.error ?? videoResult.stderr}`)
const videoBytes = fs.readFileSync(videoPath)
const workflowName = withVideo ? '三图与视频独立输入验收' : '三图独立输入验收'
if (withVideo) {
  fs.copyFileSync(videoPath, path.join(assetsDir, 'source.mp4'))
  references.push({ id: 'source-4', title: '画布参考视频', label: '参考视频', bytes: videoBytes, url: `nomi-local://asset/${projectId}/assets/generated/source.mp4` })
}
const expectedKeys = ['comfy_image_1', 'comfy_image_2', 'comfy_image_3', ...(withVideo ? ['source_video_url'] : [])]
const graph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'red.png' }, _meta: { title: references[0].label } },
  '2': { class_type: 'LoadImage', inputs: { image: 'green.png' }, _meta: { title: references[1].label } },
  '3': { class_type: 'LoadImage', inputs: { image: 'blue.png' }, _meta: { title: references[2].label } },
  '4': { class_type: 'CreateVideo', inputs: { images: [withVideo ? '10' : '7', 0], fps: 24 } },
  '5': { class_type: 'SaveVideo', inputs: { video: ['4', 0], filename_prefix: 'three-refs', codec: 'auto', format: 'auto' } },
  '6': { class_type: 'ImageBatch', inputs: { image1: ['1', 0], image2: ['2', 0] } },
  '7': { class_type: 'ImageBatch', inputs: { image1: ['6', 0], image2: ['3', 0] } },
  ...(withVideo ? {
    '8': { class_type: 'LoadVideo', inputs: { file: 'source.mp4' }, _meta: { title: '参考视频' } },
    '9': { class_type: 'GetVideoComponents', inputs: { video: ['8', 0] } },
    '10': { class_type: 'ImageBatch', inputs: { image1: ['7', 0], image2: ['9', 0] } },
  } : {}),
}
const uploads = []
const certificationUploads = []
let submitted
let downloaded = 0
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local.test')
    res.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/system_stats') return res.end(JSON.stringify({ system: { python_version: '3.12', comfyui_version: '0.33.0' }, devices: [] }))
    if (url.pathname === '/object_info') return res.end(JSON.stringify(Object.fromEntries(Object.values(graph).map((node) => [node.class_type, { input: { required: {} } }]))))
    if (req.method === 'POST' && ['/upload/image', '/prompt'].includes(url.pathname)) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      if (url.pathname === '/upload/image') {
        const data = await new Response(body, { headers: { 'Content-Type': req.headers['content-type'] } }).formData()
        const file = data.get('image')
        if (!(file instanceof Blob)) throw new Error('Expected multipart image file')
        const bytes = Buffer.from(await file.arrayBuffer())
        const referenceIndex = references.findIndex((reference) => reference.bytes.equals(bytes))
        if (referenceIndex < 0) {
          // The certification run deliberately uses Nomi-owned deterministic
          // fixtures, while the later canvas run must use the declared project
          // assets byte-for-byte. Keep those two assertions separate.
          const isPng = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
          const isMp4 = bytes.subarray(4, 8).toString('ascii') === 'ftyp'
          if (!isPng && !isMp4) throw new Error('Uploaded file is not a declared source or certification asset')
          const name = `certification-reference-${certificationUploads.length + 1}.${isMp4 ? 'mp4' : 'png'}`
          certificationUploads.push({ name, bytes: bytes.length, isMp4 })
          return res.end(JSON.stringify({ name, subfolder: '', type: 'input' }))
        }
        const name = `uploaded-reference-${referenceIndex + 1}.${referenceIndex === 3 ? 'mp4' : 'png'}`
        uploads.push({ referenceIndex, name, bytes: bytes.length })
        return res.end(JSON.stringify({ name, subfolder: '', type: 'input' }))
      }
      submitted = JSON.parse(body.toString())
      console.log('Fixture /prompt', JSON.stringify(submitted).slice(0, 1200))
      return res.end(JSON.stringify({ prompt_id: submitted.prompt_id || 'three-refs-prompt' }))
    }
    if (url.pathname.startsWith('/history/')) { console.log('Fixture /history', url.pathname); return res.end(JSON.stringify({ [url.pathname.split('/').at(-1)]: { status: { status_str: 'success', completed: true }, outputs: { '5': { videos: [{ filename: 'fixture.mp4', subfolder: '', type: 'output' }] } } } })) }
    if (url.pathname === '/view') { downloaded += 1; console.log('Fixture /view', url.search); res.setHeader('Content-Type', 'video/mp4'); return res.end(videoBytes) }
    res.statusCode = 404
    res.end('{}')
  } catch (error) {
    console.error('HTTP fixture:', error)
    res.statusCode = 500
    res.end(JSON.stringify({ error: String(error) }))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 10, apiKeysByVendor: {}, models: [], mappings: [],
  vendors: [{ key: 'comfyui-local', name: '本地 ComfyUI', enabled: true, authType: 'none', baseUrlHint: `http://127.0.0.1:${server.address().port}` }],
}))
const projectFile = path.join(projectRoot, 'project.json')
fs.writeFileSync(projectFile, JSON.stringify({
  id: projectId, name: projectName, version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: projectName, updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null, storyboardPlan: null, storyboardPlanCommitted: false,
    generationCanvas: { edges: [], groups: [], selectedNodeIds: ['target'], nodes: [
      ...references.map((reference, index) => ({
        id: reference.id, kind: index === 3 ? 'video' : 'image', title: reference.title, position: { x: 0, y: index * 360 }, size: { width: 300, height: 300 }, prompt: '', categoryId: 'shots', status: 'success',
        result: { id: `${reference.id}-result`, type: index === 3 ? 'video' : 'image', url: reference.url, createdAt: 1 }, meta: { imageWidth: 64, imageHeight: 64 },
      })),
      { id: 'target', kind: 'video', title: '三图目标视频', position: { x: 640, y: 380 }, size: { width: 380, height: 214 }, prompt: '', categoryId: 'shots', status: 'idle', meta: {} },
    ] },
  },
}))

let app
let win
// Opening the legacy fixture migrates the live manifest to the canonical workspace location.
const readProject = () => JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi/project.json'), 'utf8')).payload.generationCanvas
const readCatalog = () => JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
const snap = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
async function closeApp() {
  if (!app) return
  const closing = app
  const child = closing.process()
  app = undefined
  let timer
  try { await Promise.race([closing.close().catch(() => undefined), new Promise((resolve) => { timer = setTimeout(resolve, 8000) })]) }
  finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
}
async function launch() {
  const launched = await launchNomiApp({ name: 'comfy-multiref', tempRoot: root, settingsDir, projectsDir, settleMs: 0, env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}` } })
  app = launched.app; win = launched.win
  win.on('pageerror', (error) => console.error('Renderer error:', error.message))
  win.on('console', (message) => { if (message.type() === 'error') console.error('Renderer console:', message.text()) })
  win.setDefaultTimeout(15_000)
  await (await app.browserWindow(win)).evaluate((browserWindow) => browserWindow.setBounds({ x: 0, y: 0, width: 1440, height: 1000 }))
}
async function openProject() {
  const card = win.getByText(projectName, { exact: false }).first()
  await expect(card).toBeVisible()
  await card.hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作/ }).first(), '打开隔离三图项目')
  await win.waitForFunction(() => /projectId=/.test(location.href))
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="generation"]'), '进入真实生成画布')
  await clickOrFail(win.getByRole('button', { name: '适应视图', exact: true }), '让三张图和目标都可见')
  await clickOrFail(win.locator('[data-node-id="target"]').first(), '选中目标视频节点')
}

try {
  await launch()
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await openProject()
  await clickOrFail(win.getByRole('button', { name: '打开模型设置', exact: true }), '导入三图工作流')
  const settings = win.getByRole('dialog', { name: '设置', exact: true })
  await clickOrFail(settings.getByRole('button').filter({ hasText: '本地 ComfyUI' }).first(), '打开 ComfyUI 接入')
  await clickOrFail(settings.getByRole('button', { name: '导入自定义工作流（文生视频 / 图生视频…）', exact: true }), '打开 JSON 导入入口')
  await settings.getByRole('textbox', { name: 'ComfyUI 工作流 JSON', exact: true }).fill(JSON.stringify(graph))
  await clickOrFail(settings.getByRole('button', { name: '分析工作流', exact: true }), '分析三输入图')
  const mediaRows = settings.getByRole('checkbox', { name: 'LoadImage.image', exact: true })
  await expect(mediaRows).toHaveCount(3)
  for (let i = 0; i < 3; i += 1) await expect(mediaRows.nth(i)).toBeChecked()
  if (withVideo) await expect(settings.getByRole('checkbox', { name: 'LoadVideo.file', exact: true })).toBeChecked()
  await settings.getByPlaceholder('给它起个名（如：本地 WAN 图生视频）', { exact: true }).fill(workflowName)
  await snap('01-three-input-import-dark')
  await clickOrFail(settings.getByRole('button', { name: '导入', exact: true }), '保存全部三路输入')
  // Import is staging only. The durable integration handoff must be confirmed
  // before the candidate can be promoted into the selectable catalog.
  await expect(settings.getByRole('heading', { name: '确认接入并开始验证', exact: true })).toBeVisible()
  await clickOrFail(settings.getByRole('button', { name: '确认并开始验证', exact: true }), '确认 ComfyUI 真实验证')
  const imported = readCatalog().models.find((model) => model.labelZh === workflowName)
  await expect.poll(() => {
    const current = readCatalog().models.find((model) => model.labelZh === workflowName)
    const mapping = current && readCatalog().mappings.find((candidate) => candidate.modelKey === current.modelKey)
    return Boolean(current?.enabled && mapping?.enabled && current.meta?.adapter?.state === 'verified')
  }, { timeout: 30_000 }).toBe(true)
  const promoted = readCatalog().models.find((model) => model.labelZh === workflowName)
  expect(promoted?.enabled).toBe(true)
  expect(readCatalog().mappings.find((mapping) => mapping.modelKey === promoted?.modelKey)?.enabled).toBe(true)
  expect(imported.meta.comfyWorkflowImport.binding.images).toHaveLength(references.length)
  expect(new Set(imported.meta.comfyWorkflowImport.binding.images.map((input) => input.paramKey)).size).toBe(references.length)
  await clickOrFail(settings.getByRole('button', { name: '关闭', exact: true }), '返回画布连接三张图')
  const composer = win.locator('.generation-canvas-v2-node__composer')
  // The imported graph declares an image-to-video mode. Select that explicit
  // mode before opening the model list so the selector queries the same
  // published mode rather than the default text-to-video bucket.
  await clickOrFail(composer.getByRole('button', { name: '图生视频', exact: true }), '切换到图生视频模式')
  await clickOrFail(composer.getByRole('button', { name: '模型', exact: true }), '选取刚导入的工作流')
  await clickOrFail(win.getByRole('option').filter({ hasText: workflowName }), '使用三输入视频工作流')
  const pick = async (slotIndex, sourceIndex) => {
    const slot = references[slotIndex]
    const reference = references[sourceIndex]
    await clickOrFail(composer.getByRole('button', { name: `添加${slot.label}`, exact: true }), `为${slot.label}选画布来源`)
    await clickOrFail(win.getByTestId('asset-picker').getByRole('button', { name: reference.title, exact: true }), `连入${reference.title}`)
    await expect(composer.getByRole('button', { name: `移除${slot.label}`, exact: true })).toBeVisible()
  }
  for (let index = 0; index < references.length; index += 1) {
    await pick(index, index)
    // Prove one selection only fills its own slot, rather than broadcasting the first edge.
    if (index < references.length - 1) await expect(composer.getByRole('button', { name: `添加${references[index + 1].label}`, exact: true })).toBeVisible()
  }
  const boundEdges = () => readProject().edges.filter((edge) => edge.target === 'target')
  await expect.poll(() => boundEdges().length).toBe(references.length)
  expect(boundEdges().map((edge) => edge.targetParamKey).sort()).toEqual([...expectedKeys].sort())
  const untouched = boundEdges().filter((edge) => edge.targetParamKey !== 'comfy_image_2')
  await clickOrFail(composer.getByRole('button', { name: '移除参考图 2', exact: true }), '删除中间槽不影响两侧')
  await expect.poll(() => boundEdges()).toEqual(untouched)
  await pick(1, 2)
  await expect.poll(() => boundEdges().filter((edge) => edge.source === 'source-3').length).toBe(2)
  expect(boundEdges().filter((edge) => edge.targetParamKey !== 'comfy_image_2')).toEqual(untouched)
  await clickOrFail(composer.getByRole('button', { name: '移除参考图 2', exact: true }), '移除同图双槽中的一个')
  await expect.poll(() => boundEdges()).toEqual(untouched)
  await pick(1, 1)
  await expect.poll(() => boundEdges().length).toBe(references.length)
  await clickOrFail(composer.getByRole('button', { name: '移除参考图 1', exact: true }), '空出第一槽改用直接拖线')
  await expect.poll(() => boundEdges().length).toBe(references.length - 1)
  await win.locator('[data-node-id="target"]').first().hover()
  const beforeDrag = readProject().nodes.find((node) => node.id === 'target')
  const handle = await win.locator('[data-node-id="target"] .generation-canvas-v2-node__handle--input').boundingBox()
  const source = await win.locator('[data-node-id="source-1"]').first().boundingBox()
  expect(handle).toBeTruthy()
  expect(source).toBeTruthy()
  await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await win.mouse.down()
  await win.mouse.move(source.x + source.width / 2, source.y + source.height / 2, { steps: 16 })
  await win.mouse.up()
  await expect.poll(() => boundEdges().find((edge) => edge.targetParamKey === 'comfy_image_1')?.source).toBe('source-1')
  const afterDrag = readProject().nodes.find((node) => node.id === 'target')
  expect({ position: afterDrag.position, size: afterDrag.size }).toEqual({ position: beforeDrag.position, size: beforeDrag.size })
  const edges = boundEdges()
  expect(new Set(edges.map((edge) => edge.targetParamKey)).size).toBe(references.length)
  expect(edges.map((edge) => edge.source).sort()).toEqual(references.map((reference) => reference.id).sort())
  const thumbs = composer.locator('.generation-canvas-v2-node__ref-section img')
  await expect(thumbs).toHaveCount(3)
  expect(await thumbs.evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth === 64))).toBe(true)
  if (withVideo) {
    // Reference tiles use the shared filmstrip cover, not an inline video player.
    const videoTile = composer.getByRole('button', { name: '移除参考视频', exact: true }).locator('..')
    const cover = videoTile.locator('[style*="background-image"]')
    await expect(cover).toHaveCount(1)
    await expect(cover).toHaveCSS('background-repeat', 'no-repeat')
  }
  await snap('02-three-connected-dark')
  await win.evaluate(() => localStorage.setItem('nomi-color-scheme', 'light'))
  await closeApp()
  await launch()
  await openProject()
  const restoredComposer = win.locator('.generation-canvas-v2-node__composer')
  for (const reference of references) await expect(restoredComposer.getByRole('button', { name: `移除${reference.label}`, exact: true })).toBeVisible()
  expect(readProject().edges.filter((edge) => edge.target === 'target')).toEqual(edges)
  await snap('03-three-restored-light')
  // The certification request populated `submitted` earlier in this same walk.
  // Clear that old response so the production assertion cannot pass before the
  // post-restart upload sequence and its new /prompt request complete.
  submitted = undefined
  await clickOrFail(win.getByRole('button', { name: '生成素材', exact: true }), '冷启动后三图真实发送')
  await expect.poll(() => submitted, { timeout: 20_000 }).toBeTruthy()
  expect(uploads.map((upload) => upload.referenceIndex).sort()).toEqual(withVideo ? [0, 1, 2, 3] : [0, 1, 2])
  for (let i = 1; i <= 3; i += 1) expect(submitted.prompt[String(i)].inputs.image).toBe(`uploaded-reference-${i}.png`)
  if (withVideo) expect(submitted.prompt['8'].inputs.file).toBe('uploaded-reference-4.mp4')
  expect(submitted.partial_execution_targets).toEqual(['5'])
  await expect.poll(() => downloaded).toBeGreaterThan(0)
  const resultPlayer = win.locator('[data-node-id="target"] [data-node-preview-video="true"]')
  await expect(resultPlayer).toHaveCount(1)
  await expect.poll(() => resultPlayer.evaluate((video) => video.readyState >= 2 && video.videoWidth === 64), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => readProject().nodes.find((node) => node.id === 'target')?.result?.url).toMatch(/^nomi-local:\/\//)
  const resultUrl = readProject().nodes.find((node) => node.id === 'target').result.url
  expect(references.map((reference) => reference.url)).not.toContain(resultUrl)
  expect(await resultPlayer.evaluate((video) => video.currentSrc.split('#')[0])).toBe(resultUrl.split('#')[0])
  await resultPlayer.evaluate(async (video) => { video.muted = true; await video.play() })
  await expect.poll(() => resultPlayer.evaluate((video) => video.currentTime)).toBeGreaterThan(0.2)
  await resultPlayer.evaluate((video) => video.pause())
  await snap('04-three-input-video-result-light')
  console.log(`PASS: actual JSON import exposes ${references.length} media slots; real picker and drag create independent slot edges; middle-slot removal/replacement and same-source double-slot preserve neighbors; dark/light and cold restart preserve all inputs; exact source byte uploads map one-to-one to LoadImage #1/#2/#3${withVideo ? ' and LoadVideo #8' : ''} in POST /prompt; saved video downloads and decodes. Simulated HTTP, no GPU inference.`)
} catch (error) {
  await snap('failure').catch(() => undefined)
  throw error
} finally {
  await closeApp()
  await new Promise((resolve) => server.close(resolve))
}
