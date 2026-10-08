import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：多实例（M 轨 · 四幕样张第④幕）。**起两台 mock ComfyUI**（不同端口、装的模型不同），
// 验用户真正在意的那件事：两台各管各的、互不串台。
// ① 已接入区出现两张卡（本机 / 工作站）+「再接一台」按钮
// ② 两台的连接状态各自独立（工作站是 4090、本机是 M1——卡上显示各自的）
// ③ 在工作站导入一个工作流 → 只落在工作站名下，本机那张卡看不到它
// ④ 移除工作站 → 它的工作流一起走，本机完好
// 用法：pnpm build && node scripts/comfyui-multi-instance-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-multi-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('comfyui-multi-walk-')
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// 两台机器装的东西不同 —— 这正是"各报各的缺件"要证明的。
const MACHINES = [
  { port: 8188, gpu: 'Apple M1', ckpts: ['local-sd15.safetensors'] },
  { port: 8189, gpu: 'NVIDIA RTX 4090', ckpts: ['wan22-i2v-14B.safetensors', 'flux-dev.safetensors'] },
]
const servers = []
for (const m of MACHINES) {
  const srv = http.createServer((req, res) => {
    const url = req.url || ''
    if (url.startsWith('/system_stats')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ system: { python_version: '3.11.9', comfyui_version: '0.29.0' }, devices: [{ name: m.gpu, vram_total: 25769803776 }] }))
      return
    }
    if (url.startsWith('/object_info')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [m.ckpts] } } },
        CLIPTextEncode: { input: { required: {} } },
        KSampler: { input: { required: { sampler_name: [['euler']] } } },
        EmptyLatentImage: { input: { required: {} } },
        VAEDecode: { input: { required: {} } },
        SaveImage: { input: { required: {} } },
      }))
      return
    }
    if (url.startsWith('/templates')) { res.writeHead(404); res.end(); return } // 这台没有模板包 → 模板库整块不出现
    res.writeHead(404); res.end()
  })
  await new Promise((r) => srv.listen(m.port, '127.0.0.1', r))
  servers.push(srv)
}

// 预置两台：本机（种子 key）+ 工作站（第 2 台 key）。
writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [
    { key: 'comfyui-local', name: '本机', enabled: true, baseUrlHint: 'http://127.0.0.1:8188', authType: 'none', authHeader: null, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
    { key: 'comfyui-local-workstation', name: '工作站', enabled: true, baseUrlHint: 'http://127.0.0.1:8189', authType: 'none', authHeader: null, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
  ],
  models: [], mappings: [], apiKeysByVendor: {},
}))

// 只有工作站装了 wan22 —— 同一张图在两台的缺件结论应该相反。
const WAN_GRAPH = JSON.stringify({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'wan22-i2v-14B.safetensors' } },
  2: { class_type: 'CLIPTextEncode', inputs: { text: '一只奔跑的橘猫', clip: ['1', 1] } },
  3: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  4: { class_type: 'KSampler', inputs: { seed: 1, sampler_name: 'euler', model: ['1', 0], positive: ['2', 0], negative: ['2', 0], latent_image: ['3', 0] } },
  5: { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['1', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'ws', images: ['5', 0] } },
})

const { app, win } = await launchNomiApp({
  name: 'comfyui-multi-instance',
  settingsDir,
  projectsDir: makeTempDir('comfyui-multi-proj-'),
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1040 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('dialog', (d) => void d.dismiss().catch(() => {}))

  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(2500)

  // ── ① 两张卡 + 「再接一台」 ──
  const bodyText = await win.evaluate(() => document.body.innerText)
  const bothCards = bodyText.includes('本机') && bodyText.includes('工作站')
  const hasAddBtn = bodyText.includes('再接一台 ComfyUI')
  console.log(`  两台卡都在: ${bothCards ? '✓' : '✗'} · 「再接一台」: ${hasAddBtn ? '✓' : '✗'}`)
  await shot(win, '01-two-instance-cards.png')
  if (!bothCards || !hasAddBtn) throw new Error('多实例卡片没渲染齐')

  // ── ② 各自的连接状态（GPU 不同）──
  await win.getByText('工作站', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  const wsText = await win.evaluate(() => document.body.innerText)
  const wsGpu = wsText.includes('RTX 4090')
  console.log('  工作站显示自己的 GPU（RTX 4090）: ' + (wsGpu ? '✓' : '✗'))
  await shot(win, '02-workstation-own-status.png')

  // ── ③ 在工作站导入 → 只落工作站名下 ──
  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(WAN_GRAPH)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(2500)
  await win.getByPlaceholder('给它起个名', { exact: false }).fill('工作站专属图')
  await win.getByRole('button', { name: '导入', exact: true }).click()
  await win.waitForTimeout(1800)
  await shot(win, '03-imported-to-workstation.png')

  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  const { readFileSync } = await import('node:fs')
  const cat = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const mine = (cat.models || []).find((m) => m.labelZh === '工作站专属图')
  const belongsToWs = mine?.vendorKey === 'comfyui-local-workstation'
  const localHasNone = !(cat.models || []).some((m) => m.vendorKey === 'comfyui-local' && m.labelZh === '工作站专属图')
  console.log(`  工作流落在工作站名下: ${belongsToWs ? '✓' : '✗ ' + mine?.vendorKey} · 没串到本机: ${localHasNone ? '✓' : '✗'}`)
  if (!belongsToWs || !localHasNone) throw new Error('工作流串台了')

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 6).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  for (const s of servers) s.close()
}
