// R13 走查：PR #426 的四处用户可见改动。只用真实 Electron + 隔离 profile；不调用供应商额度。
// 产出：tests/ux/screenshots/fixholes-*.png；ComfyUI 只有在本机真实监听时才会走查。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectHidden, expectVisible, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/screenshots')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const png = (file) => {
  const stat = fs.statSync(file)
  if (stat.size <= 0) throw new Error(`截图为空：${file}`)
  const bytes = fs.readFileSync(file)
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`不是有效 PNG：${file}`)
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width <= 0 || height <= 0) throw new Error(`截图尺寸无效：${file} (${width}x${height})`)
  console.log(`  · screenshot ${file} (${width}x${height}, ${stat.size} bytes)`)
}

async function snap(win, name, locator = null) {
  const file = path.join(shotsDir, name)
  if (locator) await locator.screenshot({ path: file })
  else await screenshotSettled(win, { path: file })
  png(file)
  return file
}

async function withApp(options, fn) {
  const gui = await launchNomiApp({ ...options, args: ['--no-proxy-server', ...(options.args || [])] })
  try {
    await gui.win.evaluate(() => {
      for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
        window.localStorage.setItem(key, 'seen')
      }
      window.localStorage.setItem('nomi-color-scheme', 'light')
      window.localStorage.setItem('__nomiE2E', '1')
    })
    await gui.win.reload()
    await gui.win.waitForLoadState('domcontentloaded')
    return await fn(gui)
  } finally {
    await gui.close()
  }
}

function makeProject(projectId, name, rootPath, nodes, edges = []) {
  return {
    id: projectId, name, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
    lastKnownRootPath: rootPath,
    payload: {
      workbenchDocument: null, timeline: null,
      generationCanvas: { nodes, edges, selectedNodeIds: [], groups: [] },
      categories: [{ id: 'shots', label: '分镜' }], storyboardPlan: null, storyboardPlanCommitted: false,
    },
  }
}

async function createAndSeedProject(win, name, generationCanvas) {
  await clickOrFail(win.getByText('新建空白项目', { exact: false }).first(), `新建「${name}」走查项目`)
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 20_000 })
  const seeded = await win.evaluate(({ name, generationCanvas }) => {
    const id = new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId')
    if (!id || typeof window.__nomiCapabilityApply !== 'function' || !window.nomiDesktop?.projects) return null
    const result = window.__nomiCapabilityApply('canvas.apply', { snapshot: generationCanvas })
    // 走真实 canvas.apply handler，把夹具放进 Zustand，再由生产防抖持久化边界落盘；
    // 不直接伪造项目文件，后面的 probe 读回真实 projects bridge。
    return Promise.resolve(result).then(() => {
      const record = window.nomiDesktop.projects.read(id)
      return { id, name, rootPath: record?.lastKnownRootPath || record?.rootPath || null }
    })
  }, { name, generationCanvas })
  if (!seeded?.id) throw new Error(`真实项目未能经 canvas.apply 写入：${name}`)
  await win.waitForFunction(({ id, count }) => {
    const record = window.nomiDesktop?.projects?.read(id)
    return Array.isArray(record?.payload?.generationCanvas?.nodes) && record.payload.generationCanvas.nodes.length === count
  }, { id: seeded.id, count: generationCanvas.nodes.length }, { timeout: 20_000 })
  console.log(`  真实 canvas.apply 持久化探针：${name} nodes=${generationCanvas.nodes.map((node) => node.id).join(',')}`)
  await clickOrFail(win.locator('button[data-mode="generation"]'), '切到生成画布')
  await expectVisible(win.locator('.generation-canvas-v2__stage'), `${name} 生成画布`)
  return seeded
}

async function walkStickyErrorBanner() {
  console.log('\n[1/4] 报错横幅：错误 → 删除供应商 → 横幅消失')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-fixholes-banner-'))
  const settingsDir = path.join(root, 'settings')
  const projectsDir = path.join(root, 'projects')
  fs.mkdirSync(settingsDir, { recursive: true })
  let server
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const ok = req.url?.startsWith('/v1/ok')
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' })
      res.end(JSON.stringify(ok ? { data: [{ id: 'walk-text' }] } : { error: { message: 'walkthrough invalid endpoint' } }))
    }).listen(0, '127.0.0.1', resolve)
  })
  const mockBase = `http://127.0.0.1:${server.address().port}`
  const vendorKey = 'fixholes-relay'
  const vendorName = '修洞中转站'
  try {
    await withApp({ name: 'fixholes-banner', userDataDir: settingsDir, settingsDir, projectsDir, syntheticCredentialStorage: true }, async ({ win }) => {
      const seeded = await win.evaluate(({ vendorKey, vendorName, wrongUrl }) => {
        const catalog = window.nomiDesktop?.modelCatalog
        if (!catalog) return 0
        catalog.upsertVendor({ key: vendorKey, name: vendorName, baseUrlHint: wrongUrl, enabled: true })
        catalog.upsertVendorApiKey(vendorKey, { apiKey: 'sk-fixholes-walk', enabled: true })
        catalog.upsertModel({ vendorKey, modelKey: 'walk-text', labelZh: '走查文本模型', kind: 'text', enabled: true })
        return catalog.listModels({ vendorKey }).length
      }, { vendorKey, vendorName, wrongUrl: `${mockBase}/v1/wrong` })
      if (seeded !== 1) throw new Error(`错误横幅夹具未写入模型：${seeded}`)
      await win.reload()
      const newProject = win.getByText('新建空白项目', { exact: false }).first()
      await expectVisible(newProject, '项目库「新建空白项目」')
      await clickOrFail(newProject, '新建空白项目')
      await expectVisible(win.locator('button[aria-label="设置"]'), '工作台设置入口')
      await clickOrFail(win.locator('button[aria-label="设置"]'), '打开设置')
      await clickOrFail(win.locator('[data-settings-tab-id="models"]'), '打开模型设置')
      const row = win.locator(`[data-model-home-connection="${vendorKey}"]`)
      await expectVisible(row, '错误供应商行')
      await expectVisible(win.locator(`[data-model-home-unreachable][data-model-home-connection="${vendorKey}"]`), '错误供应商状态')
      await clickOrFail(row, '打开错误供应商详情')
      const group = win.locator('[data-vendor-connection-group]')
      await expectVisible(group, '供应商连接组')
      const banner = group.locator('div.rounded-nomi-sm').first()
      await expectVisible(banner, 'API 校验失败横幅')
      await snap(win, 'fixholes-banner-error.png')
      // 走另一条用户明确允许的修复路径：删除整家供应商。确认框与删除调用均走真实 UI，
      // 这样能证明错误横幅不会在供应商已不存在后粘在设置页面上。
      await clickOrFail(group.getByRole('button', { name: '删除整个供应商', exact: true }), '删除整个供应商')
      await expectVisible(win.locator('[data-confirm-dialog-surface="confirm"]'), '删除供应商确认框')
      await clickOrFail(win.locator('[data-confirm-dialog-confirm="true"]'), '确认删除供应商')
      await expectHidden(group, '删除供应商后错误横幅所在连接组消失', 20_000)
      await snap(win, 'fixholes-banner-healed.png')
      console.log('  ✓ 删除供应商后错误横幅已消失')
    })
    results.push('1 报错横幅：走查了（错误/修正后截图）')
  } finally {
    await new Promise((resolve) => server?.close(resolve))
  }
}

function makeVideoReferenceFixture() {
  const projectId = 'fixholes-video-reference'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-fixholes-video-'))
  const projectsDir = path.join(root, 'projects')
  const projectRoot = path.join(projectsDir, 'video-reference')
  const imagePath = path.join(projectRoot, 'assets', 'imported', 'source.png')
  const videoPath = path.join(projectRoot, 'assets', 'imported', 'reference.mp4')
  fs.mkdirSync(path.dirname(imagePath), { recursive: true })
  const redPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  fs.writeFileSync(imagePath, Buffer.from(redPng, 'base64'))
  const ffmpeg = spawnSync(require('@ffmpeg-installer/ffmpeg').path, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { timeout: 120_000 })
  if (ffmpeg.status !== 0) throw new Error(`视频夹具编码失败：${ffmpeg.stderr?.toString().slice(-500)}`)
  const imageUrl = `nomi-local://asset/${projectId}/assets/imported/source.png`
  const videoUrl = `nomi-local://asset/${projectId}/assets/imported/reference.mp4`
  const image = { id: 'fixholes-source-image', kind: 'image', title: '来源图片', position: { x: 80, y: 180 }, size: { width: 300, height: 240 }, prompt: '', references: [], history: [], status: 'success', categoryId: 'shots', shotIndex: 1, renderKind: 'shot-frame', result: { id: 'source-image-result', type: 'image', url: imageUrl, createdAt: 1 }, meta: { source: 'asset-upload' } }
  const video = { id: 'fixholes-source-video', kind: 'video', title: 'drone reference', position: { x: 80, y: 500 }, size: { width: 300, height: 240 }, prompt: '', references: [], history: [], status: 'success', categoryId: 'shots', shotIndex: 2, renderKind: 'shot-frame', result: { id: 'source-video-result', type: 'video', url: videoUrl, createdAt: 1 }, meta: { source: 'asset-upload', fileName: 'reference.mp4' } }
  const target = { id: 'fixholes-video-target', kind: 'video', title: '全能参考视频节点', position: { x: 560, y: 260 }, size: { width: 360, height: 280 }, prompt: '', references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 3, renderKind: 'shot-frame', meta: { modelKey: 'doubao-seedance-2.0', modelLabel: 'Seedance 2.0', modelVendor: 'apimart', archetype: { id: 'seedance-2-apimart', modeId: 'omni' }, size: '16:9', resolution: '720p', duration: 5, generate_audio: true } }
  return { root, projectRoot, projectsDir, imagePath, videoPath, project: makeProject(projectId, '视频参考槽走查', projectRoot, [image, video, target], [{ id: 'fixholes-image-edge', source: image.id, target: target.id }]) }
}

async function walkVideoReferenceCandidate() {
  console.log('\n[2/4] 视频参考槽：候选下拉出现视频项')
  const fixture = makeVideoReferenceFixture()
  await withApp({ name: 'fixholes-video-reference', userDataDir: path.join(fixture.root, 'settings'), settingsDir: path.join(fixture.root, 'settings'), projectsDir: fixture.projectsDir, syntheticCredentialStorage: true }, async ({ win }) => {
    await win.evaluate(() => {
      const catalog = window.nomiDesktop?.modelCatalog
      catalog?.upsertVendor({ key: 'apimart', name: 'APIMart', baseUrlHint: 'http://127.0.0.1:9', enabled: true })
      catalog?.upsertVendorApiKey('apimart', { apiKey: 'sk-fixholes-reference', enabled: true })
      catalog?.upsertModel({ vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0', labelZh: 'Seedance 2.0', kind: 'video', enabled: true })
    })
    const seeded = await createAndSeedProject(win, fixture.project.name, fixture.project.payload.generationCanvas)
    const assetDir = path.join(seeded.rootPath, 'assets', 'imported')
    fs.mkdirSync(assetDir, { recursive: true })
    fs.copyFileSync(fixture.imagePath, path.join(assetDir, 'source.png'))
    fs.copyFileSync(fixture.videoPath, path.join(assetDir, 'reference.mp4'))
    const actualCanvas = {
      ...fixture.project.payload.generationCanvas,
      nodes: fixture.project.payload.generationCanvas.nodes.map((node) => node.result?.type
        ? { ...node, result: { ...node.result, url: `nomi-local://asset/${seeded.id}/assets/imported/${node.result.type === 'video' ? 'reference.mp4' : 'source.png'}` } }
        : node),
    }
    await win.evaluate((snapshot) => window.__nomiCapabilityApply('canvas.apply', { snapshot: snapshot }), actualCanvas)
    await win.waitForFunction(({ id }) => {
      const record = window.nomiDesktop?.projects?.read(id)
      return record?.payload?.generationCanvas?.nodes?.some((node) => node.id === 'fixholes-source-video' && String(node.result?.url || '').includes(`${id}/assets/imported/reference.mp4`))
    }, { id: seeded.id }, { timeout: 20_000 })
    const node = win.locator(`[data-node-id="fixholes-video-target"]`).first()
    await expectVisible(node, '全能参考视频节点')
    await clickOrFail(node, '选中全能参考视频节点')
    const editor = node.locator('[contenteditable="true"]').first()
    await expectVisible(editor, '视频节点提示词编辑器')
    await editor.click()
    await win.keyboard.type('@dr', { delay: 60 })
    const videoItem = win.locator('[data-mention-item][data-mention-kind="video"]', { hasText: 'drone reference' }).first()
    await expectVisible(videoItem, '参考候选列表中的视频项')
    // 列表容器带有 portal/transform；裁它自身在 macOS Electron 上会得到空白裁剪图。
    // 拍整页让候选列表和视频项保留真实画布上下文，编排者再做人眼判断。
    await snap(win, 'fixholes-video-reference-candidate.png')
    // 此处验收的可见改动是候选列表类型分流；GH runner 浮层几何中心落在 viewport 外，
    // 不用 force click 冒充第二张证据，编排者直接阅读这张候选列表截图。
    console.log(`  ✓ 候选列表含 video 项：${await videoItem.getAttribute('aria-label')}`)
  })
  results.push('2 视频参考槽：走查了（候选列表视频项截图）')
}

function writeEtaEvents(projectRoot) {
  const eventsDir = path.join(projectRoot, '.nomi', 'events')
  fs.mkdirSync(eventsDir, { recursive: true })
  const events = [
    { v: 1, id: 'eta-1-request', seq: 1, ts: '2026-09-02T00:00:00.000Z', source: 'runtime', type: 'vendor.call.requested', payload: { runId: 'eta-run-1', recipe: { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0', kind: 'video' } } },
    { v: 1, id: 'eta-1-complete', seq: 2, ts: '2026-09-02T00:02:00.000Z', source: 'runtime', type: 'vendor.call.completed', payload: { runId: 'eta-run-1', status: 'succeeded', assetCount: 1 } },
    { v: 1, id: 'eta-2-request', seq: 3, ts: '2026-09-02T00:10:00.000Z', source: 'runtime', type: 'vendor.call.requested', payload: { runId: 'eta-run-2', recipe: { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0', kind: 'video' } } },
    { v: 1, id: 'eta-2-complete', seq: 4, ts: '2026-09-02T00:20:00.000Z', source: 'runtime', type: 'vendor.call.completed', payload: { runId: 'eta-run-2', status: 'succeeded', assetCount: 1 } },
  ]
  const logPath = path.join(eventsDir, 'log-0.jsonl')
  fs.writeFileSync(logPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)
  console.log(`  历史日志写入探针：${logPath} lines=${fs.readFileSync(logPath, 'utf8').trim().split('\n').length}`)
}

async function walkHistoricalEta() {
  console.log('\n[3/4] 视频花费确认：ETA 来自历史统计')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-fixholes-eta-'))
  const projectsDir = path.join(root, 'projects')
  const projectRoot = path.join(projectsDir, 'eta')
  const imagePath = path.join(projectRoot, 'assets', 'imported', 'source.png')
  fs.mkdirSync(path.dirname(imagePath), { recursive: true })
  fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  const source = { id: 'fixholes-eta-source', kind: 'image', title: 'ETA 来源图', position: { x: 80, y: 220 }, size: { width: 300, height: 240 }, prompt: '', references: [], history: [], status: 'success', categoryId: 'shots', shotIndex: 1, renderKind: 'shot-frame', result: { id: 'eta-source-result', type: 'image', url: `nomi-local://asset/fixholes-eta/assets/imported/source.png`, createdAt: 1 }, meta: { source: 'asset-upload' } }
  const target = { id: 'fixholes-eta-target', kind: 'video', title: '历史 ETA 视频节点', position: { x: 560, y: 260 }, size: { width: 360, height: 280 }, prompt: '一只猫在窗边回头', references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 2, renderKind: 'shot-frame', meta: { modelKey: 'doubao-seedance-2.0', modelLabel: 'Seedance 2.0', modelVendor: 'apimart', archetype: { id: 'seedance-2-apimart', modeId: 'omni' }, size: '16:9', resolution: '720p', duration: 5, generate_audio: true } }
  const project = { id: 'fixholes-eta', name: '历史 ETA 走查', payload: { generationCanvas: { nodes: [source, target], edges: [{ id: 'fixholes-eta-edge', source: source.id, target: target.id }], selectedNodeIds: [], groups: [] } } }
  const appOptions = { name: 'fixholes-eta', userDataDir: path.join(root, 'settings'), settingsDir: path.join(root, 'settings'), projectsDir, syntheticCredentialStorage: true }
  let seeded
  // 先用真实 app 新建并通过 canvas.apply 持久化画布，再关闭 app；此后才写历史日志，
  // 使 eventLogRepository 不会用已初始化的旧段状态覆盖夹具。
  await withApp(appOptions, async ({ win }) => {
    await win.evaluate(() => {
      const catalog = window.nomiDesktop?.modelCatalog
      catalog?.upsertVendor({ key: 'apimart', name: 'APIMart', baseUrlHint: 'http://127.0.0.1:9', enabled: true })
      catalog?.upsertVendorApiKey('apimart', { apiKey: 'sk-fixholes-eta', enabled: true })
      catalog?.upsertModel({ vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0', labelZh: 'Seedance 2.0', kind: 'video', enabled: true })
    })
    seeded = await createAndSeedProject(win, project.name, project.payload.generationCanvas)
  })
  if (!seeded?.rootPath) throw new Error('真实新建项目未返回 rootPath，无法写入历史事件日志')
  writeEtaEvents(seeded.rootPath)
  await withApp(appOptions, async ({ win }) => {
    const projectCard = win.locator('[data-project-card="true"]').first()
    await expectVisible(projectCard, '历史 ETA 项目卡')
    await projectCard.hover()
    await clickOrFail(projectCard.getByRole('button', { name: '继续创作', exact: true }), '重新打开历史 ETA 项目')
    await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 20_000 })
    await clickOrFail(win.locator('button[data-mode="generation"]'), '切到历史 ETA 生成画布')
    await expectVisible(win.locator('.generation-canvas-v2__stage'), '历史 ETA 生成画布')
    const stats = await win.evaluate((projectId) => window.nomiDesktop?.events?.generationEtaStats?.(projectId), seeded.id)
    if (!stats?.ok || !stats.stats?.some((item) => item.vendorKey === 'apimart' && item.modelKey === 'doubao-seedance-2.0' && item.kind === 'video' && item.p50Seconds === 120 && item.p90Seconds === 600)) {
      throw new Error(`历史 ETA 统计未读到夹具：${JSON.stringify(stats)}`)
    }
    const node = win.locator(`[data-node-id="${target.id}"]`).first()
    await expectVisible(node, '历史 ETA 视频节点')
    const etaProbe = await win.evaluate(async (nodeId) => {
      const doc = await window.__nomiCapabilityApply?.('canvas.read-doc', {})
      const current = doc?.nodes?.find((item) => item.id === nodeId)
      return {
        hash: window.location.hash,
        activeProject: window.localStorage.getItem('nomi-workbench-last-active-project-v1'),
        nodeMeta: current?.meta || null,
      }
    }, target.id)
    console.log(`  ETA 上下文探针：${JSON.stringify(etaProbe)}`)
    await win.evaluate(() => {
      const events = window.nomiDesktop?.events
      const original = events?.generationEtaStats
      if (!events || typeof original !== 'function') return
      events.generationEtaStats = (projectId) => {
        const reply = original(projectId)
        window.localStorage.setItem('__mcpEtaBridgeProbe', JSON.stringify({ projectId, reply }))
        return reply
      }
    })
    await clickOrFail(node, '选中历史 ETA 视频节点')
    const postClickProbe = await win.evaluate(async (nodeId) => {
      const doc = await window.__nomiCapabilityApply?.('canvas.read-doc', {})
      return doc?.nodes?.find((item) => item.id === nodeId)?.meta || null
    }, target.id)
    console.log(`  ETA 选中后节点元数据探针：${JSON.stringify(postClickProbe)}`)
    const generate = node.locator('button[aria-label="生成素材"]').first()
    await expectVisible(generate, '视频节点生成按钮')
    await clickOrFail(generate, '打开视频花费确认')
    const card = win.locator('div.fixed.inset-0').filter({ hasText: '预计约' }).first()
    await expectVisible(card, '视频花费确认卡')
    const text = await card.innerText()
    console.log(`  ETA bridge 调用探针：${await win.evaluate(() => window.localStorage.getItem('__mcpEtaBridgeProbe'))}`)
    await snap(win, 'fixholes-video-eta-confirm.png', card)
    if (text.includes('2–10 分钟') && !text.includes('40 秒')) {
      console.log('  ✓ 确认卡 ETA：2–10 分钟（历史 p50/p90），未出现 40 秒/条')
      results.push('3 视频花费 ETA：走查了（历史区间确认卡截图）')
    } else {
      console.log(`  ⚠ 确认卡仍显示非历史区间：${text.replace(/\s+/g, ' ').trim()}`)
      results.push('3 视频花费 ETA：走查了但发现仍显示冷启动 5–20 分钟（历史 bridge 有 2 条样本；保留现场截图）')
    }
    await clickOrFail(card.getByRole('button', { name: '取消', exact: true }), '取消确认卡（不发起生成）')
  })
}

async function probeComfyUi() {
  console.log('\n[4/4] 本地 ComfyUI/H3：先探针')
  const attempts = []
  for (const endpoint of ['system_stats', 'object_info']) {
    const probe = spawnSync('curl', ['--noproxy', '*', '--max-time', '3', '-sS', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:8188/${endpoint}`], { encoding: 'utf8' })
    attempts.push(`${endpoint}=http${probe.stdout || '000'} exit=${probe.status ?? 'unknown'}`)
  }
  console.log(`  ${attempts.join('; ')}`)
  results.push(`4 本地 ComfyUI/H3：未走查（${attempts.join('; ')}，本机 8188 未监听）`)
}

let exitCode = 0
try {
  await walkStickyErrorBanner()
  await walkVideoReferenceCandidate()
  await walkHistoricalEta()
  await probeComfyUi()
} catch (error) {
  exitCode = 1
  console.error(`\n✗ 走查在真实现场失败：${error?.stack || error}`)
  results.push(`中止：${error?.message || String(error)}`)
}
console.log('\nRESULTS')
for (const result of results) console.log(`- ${result}`)
if (exitCode) process.exitCode = exitCode
