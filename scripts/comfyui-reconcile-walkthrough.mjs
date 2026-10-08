import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：ComfyUI 导入缺件对账（缺节点/缺模型在导入面板就说清，治「一跑就炸不知道为啥」）。
// 场景：① 贴「缺自定义节点 + 引用了本机没有的 checkpoint」的图 → 分析 → 两条红警示；
//       ② 贴全齐的图 → 分析 → 零警示；
//       ③ 把地址改到没服务的端口 → 分析 → 「未连接已跳过检查」一行说明（不阻断导入）。
// 截图人眼判断。用法：pnpm build && node scripts/comfyui-reconcile-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-reconcile-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('comfyui-reconcile-walk-')
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// 本机「已装」能力（mock /object_info）：SD 基础节点齐、checkpoint 只有 local-sd15。
const OBJECT_INFO = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['local-sd15.safetensors']] } } },
  KSampler: { input: { required: { sampler_name: [['euler', 'ddim']], seed: ['INT', {}] } } },
  CLIPTextEncode: { input: { required: {} } },
  EmptyLatentImage: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
}

const baseGraph = (ckpt) => ({
  3: { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['8', 0] } },
})
// 场景①：作者机器的 checkpoint（本机没有）+ 两个本机没装的自定义节点类。
const MISSING_GRAPH = JSON.stringify({
  ...baseGraph('wan-author-only.safetensors'),
  20: { class_type: 'WanVideoWrapperSampler', inputs: { model: ['4', 0] } },
  21: { class_type: 'VHS_VideoCombine', inputs: { images: ['8', 0], frame_rate: 24 } },
})
// 场景②：全齐。
const CLEAN_GRAPH = JSON.stringify(baseGraph('local-sd15.safetensors'))

const mock = http.createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/system_stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ system: { os: 'posix', python_version: '3.11.9', comfyui_version: '0.3.30' }, devices: [{ name: 'cuda:0', type: 'cuda', vram_total: 1 }] }))
    return
  }
  if (url.startsWith('/object_info')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(OBJECT_INFO))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => mock.listen(8188, '127.0.0.1', r))

const { app, win } = await launchNomiApp({
  name: 'comfyui-reconcile',
  settingsDir,
  projectsDir: makeTempDir('comfyui-reconcile-proj-'),
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(1000)
  await win.getByText('有本地 ComfyUI', { exact: false }).first().click()
  await win.waitForTimeout(500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('button', { name: '启用 ComfyUI', exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(600)

  // ── 场景①：缺节点 + 缺模型 → 两条红警示 ──
  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(MISSING_GRAPH)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(1500) // 等异步 reconcile 回来
  await win.getByText('本机 ComfyUI 缺', { exact: false }).first().scrollIntoViewIfNeeded()
  await shot(win, '01-missing-nodes-and-files.png') // 验：缺 2 个节点（WanVideoWrapperSampler/VHS_VideoCombine）红框
  await win.getByText('引用了本机没有的', { exact: false }).first().scrollIntoViewIfNeeded()
  await win.waitForTimeout(200)
  await shot(win, '01b-missing-files-box.png') // 验：缺文件红框（CheckpointLoaderSimple.ckpt_name="wan-author-only…"）

  // ── 场景②：全齐 → 零警示 ──
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(CLEAN_GRAPH)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(1500)
  await shot(win, '02-clean-no-warnings.png') // 验：绑定区正常、无红框无「未连接」行

  // ── 场景③：地址指到没服务的端口 → 「未连接已跳过检查」 ──
  await win.getByRole('button', { name: '改', exact: true }).first().click()
  await win.waitForTimeout(300)
  const addrInput = win.locator('input.font-mono').first()
  await addrInput.fill('http://127.0.0.1:65500')
  await win.getByRole('button', { name: '保存地址', exact: true }).click()
  await win.waitForTimeout(800)
  // 尾随空格：与场景②内容不同才会触发 onChange 重置分析态（同值 fill 不触发 React onChange）
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(CLEAN_GRAPH + ' ')
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(1500)
  await win.getByText('已跳过缺节点', { exact: false }).first().scrollIntoViewIfNeeded()
  await shot(win, '03-offline-skipped-note.png') // 验：一行灰字说明，导入按钮仍可用

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
