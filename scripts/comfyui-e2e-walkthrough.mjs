// 全套 R13-A：真机走查本地 ComfyUI「导入自定义工作流」UI + 假 ComfyUI 让接入卡真「已连上」。
// 起假 ComfyUI(node http, :8188) → 起 Nomi(comfyui-local 已启用) → 接入卡显示已连上 → 展开 →
// 导入面板 → 贴 WAN i2v workflow → 分析 → 看绑定编辑器 → 导入 → 模型出现在卡里。截图人眼判断。
import http from 'node:http'
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'; import os from 'node:os'
const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.feedback-walk'); mkdirSync(outDir, { recursive: true })
const settingsDir = mkdtempSync(path.join(os.tmpdir(), 'nomi-comfy-e2e-'))
const now = '2026-07-15T00:00:00.000Z'
writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({ version: 5, vendors: [{ key: 'comfyui-local', name: '本地 ComfyUI', enabled: true, authType: 'none', baseUrlHint: 'http://127.0.0.1:8188', createdAt: now, updatedAt: now }], models: [{ modelKey: 'comfyui-txt2img', vendorKey: 'comfyui-local', labelZh: '本地 · 文生图', kind: 'image', enabled: true, createdAt: now, updatedAt: now }], mappings: [], apiKeysByVendor: {} }))
const WAN_I2V = JSON.stringify({ "1": { class_type: "LoadImage", inputs: { image: "start.png" } }, "2": { class_type: "CLIPTextEncode", inputs: { text: "a dragon flying over misty mountains", clip: ["3", 0] } }, "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "wan2.2.safetensors" } }, "4": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 6, positive: ["2", 0], model: ["3", 0] } }, "5": { class_type: "VHS_VideoCombine", inputs: { images: ["4", 0], frame_rate: 24 } } }, null, 2)
// 假 ComfyUI
const rx = { stats: 0, uploads: 0, prompts: [], views: 0 }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/system_stats') { rx.stats++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ system: { os: 'posix', python_version: '3.11.9 (main)', comfyui_version: '0.3.46', ram_total: 34359738368 }, devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 4090', type: 'cuda', vram_total: 25757220864 }] })) }
  if (req.method === 'POST' && u.pathname === '/upload/image') { rx.uploads++; req.on('data', () => {}); return req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: 'nomi_input.png', subfolder: '', type: 'input' })) }) }
  if (req.method === 'POST' && u.pathname === '/prompt') { let raw = ''; req.on('data', (c) => (raw += c)); return req.on('end', () => { try { rx.prompts.push(JSON.parse(raw || '{}')) } catch {} ; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ prompt_id: 'wf-1', number: 1 })) }) }
  if (u.pathname === '/history/wf-1') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ 'wf-1': { status: { status_str: 'success', completed: true }, outputs: { '5': { gifs: [{ filename: 'nomi_vid.mp4', subfolder: '', type: 'output' }] } } } })) }
  if (u.pathname === '/view') { rx.views++; res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(Buffer.from('00000018667479706d70343200000000', 'hex')) }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(8188, '127.0.0.1', r))
console.log('  mock ComfyUI on :8188')
const clickByText = (win, t) => win.evaluate((tx) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent && x.textContent.includes(tx)); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); return true } return false }, t)
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repoRoot, env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1', NOMI_SETTINGS_DIR: settingsDir } })
const errors = []
try {
  const win = await app.firstWindow(); win.setDefaultTimeout(12000); const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2000)
  await win.getByText('模型接入', { exact: false }).first().click(); await win.waitForTimeout(1500)
  await win.getByText('本地 ComfyUI', { exact: false }).first().click(); await win.waitForTimeout(1500) // 展开；卡内探测 /system_stats
  console.log('  /system_stats hits:', rx.stats)
  await win.screenshot({ path: path.join(outDir, '40-card-connected.png') }); console.log('  📸 40-card-connected.png (应显示已连上 + 显卡)')
  console.log('  import panel:', await clickByText(win, '导入自定义工作流')); await win.waitForTimeout(800)
  const ta = win.getByLabel('workflow_api.json 粘贴框'); await ta.fill(WAN_I2V); await win.waitForTimeout(400)
  console.log('  analyze:', await clickByText(win, '分析工作流')); await win.waitForTimeout(1200)
  const recognized = (await win.getByText('已识别为', { exact: false }).count()) > 0
  console.log(recognized ? '  ✓ 自动识别成功' : '  ✗ 无识别结果')
  await win.screenshot({ path: path.join(outDir, '41-binding-editor.png') }); console.log('  📸 41-binding-editor.png (绑定编辑器：视频/首帧/输出下拉)')
  // 命名 + 导入
  const nameInput = win.getByPlaceholder('给它起个名', { exact: false }); await nameInput.fill('本地 WAN 图生视频').catch(() => {})
  console.log('  import:', await clickByText(win, '导入')); await win.waitForTimeout(1500)
  const appeared = (await win.getByText('本地 WAN 图生视频', { exact: false }).count()) > 0
  console.log(appeared ? '  ✓ 导入后模型出现在卡里' : '  ⚠️ 没在卡里看到新模型（查列表刷新）')
  await win.screenshot({ path: path.join(outDir, '42-imported-model.png') }); console.log('  📸 42-imported-model.png')
  console.log('\n  页面错误:', errors.length); for (const e of errors.slice(0, 5)) console.log('   ✗ ' + e.slice(0, 160))
} catch (e) { console.log('  ✗ ' + String(e).slice(0, 200)) } finally { await app.close().catch(() => {}); server.close() }
