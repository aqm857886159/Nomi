import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：识别缺口三根因的**用户可见效果**（259 张真实语料逼出来的修复）。
// 贴一张「云端 API 节点」形态的工作流（prompt 直接写在节点上，没有独立 CLIPTextEncode）——
// 这类图占语料失败的 73%，修前面板会显示「未识别到提示词节点」，修后应自动绑上。
// 同图还含 LoadVideo（视频输入）与 PreviewImage（输出），一次覆盖三根因。
// 用法：pnpm build && node scripts/comfyui-inline-prompt-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-inline-prompt-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('comfyui-inline-walk-')
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// 云端 API 节点形态（真实语料里 112 张同款）：prompt 是节点自己的 widget。
const CLOUD_NODE_GRAPH = JSON.stringify({
  1: { class_type: 'ByteDanceImageNode', inputs: { model: 'seedream-4-0', prompt: '雨夜霓虹街头，一只橘猫抬头看镜头，电影感浅景深', size: '2K', watermark: false } },
  2: { class_type: 'LoadVideo', inputs: { image: 'reference.mp4' } },
  3: { class_type: 'PreviewImage', inputs: { images: ['1', 0] } },
})

const mock = http.createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/system_stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ system: { python_version: '3.11.9', comfyui_version: '0.29.0' }, devices: [{ name: 'cuda:0', vram_total: 1 }] }))
    return
  }
  if (url.startsWith('/object_info')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ByteDanceImageNode: { input: { required: { model: [['seedream-4-0']], prompt: ['STRING', {}], size: [['2K', '4K']] } } },
      LoadVideo: { input: { required: { image: [['reference.mp4']] } } },
      PreviewImage: { input: { required: {} } },
    }))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => mock.listen(8188, '127.0.0.1', r))

const { app, win } = await launchNomiApp({
  name: 'comfyui-inline-prompt',
  settingsDir,
  projectsDir: makeTempDir('comfyui-inline-proj-'),
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

  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(CLOUD_NODE_GRAPH)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(1500)
  await win.getByText('提示词接哪个节点', { exact: false }).first().scrollIntoViewIfNeeded()
  await shot(win, '01-inline-prompt-recognized.png') // 验：提示词下拉自动绑到 #1 ByteDanceImageNode（修前这里是空的）

  // DOM 断言（截图之外再要一层机器可核的证据）
  const promptBound = await win.evaluate(() => document.body.innerText.includes('ByteDanceImageNode'))
  console.log('  提示词绑到云端节点: ' + (promptBound ? '✓' : '✗'))
  if (!promptBound) throw new Error('云端节点 prompt 没被识别')

  const noOutputWarn = await win.evaluate(() => document.body.innerText.includes('未识别到输出'))
  console.log('  PreviewImage 被当输出（无「未识别到输出」告警）: ' + (noOutputWarn ? '✗' : '✓'))

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 6).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
