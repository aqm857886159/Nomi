import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：ComfyUI 预置模板（WAN2.2）缺件**提示**（2026-08-11 起不再是死门）。
// 场景：① 点开模板 → 缺 6 个模型（红 chip + 逐文件 ✗/目录/复制/下载链），按钮是「仍要启用」**不是置灰**；
//       ② 点「仍要启用」→ 摊开风险 + 按钮变「确认启用」（二次确认，此时还没启用）；
//       ③ 点「重新检测」→ 确认态作废，回到「仍要启用」（重新给了判断依据就得重新问）；
//       ④ 仍要启用 → 确认启用 → **6 个文件全缺也真启用了**（读落库 catalog 实证），这就是用户要的「不替我做决定」；
//       ⑤ mock 端「装好」全部文件 → 重新检测 → 绿「全部就绪」chip。
// 场景⑥：导入自定义图（含 checkpoint 参数）→ combo 真实选项烤进参数控件（读落库 catalog 实证 select+options）。
// 用法：pnpm build && node scripts/comfyui-preset-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-preset-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('comfyui-preset-walk-')
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const WAN_FILES = [
  'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
  'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
  'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
  'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  'wan_2.1_vae.safetensors',
]
let installed = false // false = 缺全部 wan 文件；true = 全装好（经 /__walk/enrich 翻转）
const objectInfo = () => {
  const files = installed ? WAN_FILES : ['placeholder.safetensors']
  const enums = (key) => ({ input: { required: { [key]: [files] } } })
  return {
    LoadImage: { input: { required: {} } },
    CLIPTextEncode: { input: { required: {} } },
    ModelSamplingSD3: { input: { required: {} } },
    WanImageToVideo: { input: { required: {} } },
    VAEDecode: { input: { required: {} } },
    CreateVideo: { input: { required: {} } },
    SaveVideo: { input: { required: {} } },
    SaveImage: { input: { required: {} } },
    EmptyLatentImage: { input: { required: {} } },
    KSampler: { input: { required: { sampler_name: [['euler', 'ddim']], scheduler: [['simple', 'normal']] } } },
    KSamplerAdvanced: { input: { required: { sampler_name: [['euler']], scheduler: [['simple']], add_noise: [['enable', 'disable']], return_with_leftover_noise: [['enable', 'disable']] } } },
    CLIPLoader: enums('clip_name'),
    VAELoader: enums('vae_name'),
    UNETLoader: enums('unet_name'),
    LoraLoaderModelOnly: enums('lora_name'),
    CheckpointLoaderSimple: enums('ckpt_name'),
  }
}

// 场景④用：含 checkpoint 的 SD 图（节点 1 = CheckpointLoaderSimple，其 ckpt_name 是首个可绑 widget →「添加参数」自动选中）。
const COMBO_GRAPH = JSON.stringify({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors' } },
  3: { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['1', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'combo', images: ['8', 0] } },
})

const mock = http.createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/system_stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ system: { python_version: '3.11.9', comfyui_version: '0.3.30' }, devices: [{ name: 'cuda:0', vram_total: 1 }] }))
    return
  }
  if (url.startsWith('/__walk/enrich')) { installed = true; res.writeHead(200); res.end('ok'); return }
  if (url.startsWith('/object_info')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(objectInfo()))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => mock.listen(8188, '127.0.0.1', r))

const { app, win } = await launchNomiApp({
  name: 'comfyui-preset',
  settingsDir,
  projectsDir: makeTempDir('comfyui-preset-proj-'),
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

  // ── ① 缺件态：照说缺什么，但按钮点得动 ──
  await win.getByText('WAN2.2 图生视频 · 14B', { exact: false }).first().click()
  await win.waitForTimeout(1500) // 等 reconcile
  await win.getByText('缺', { exact: false }).first().scrollIntoViewIfNeeded()
  await shot(win, '01-preset-missing-6.png') // 验：红 chip「缺 6 项」+ 逐文件 ✗ + 目录 + 复制/下载钮 + 按钮「仍要启用」
  const armBtn = win.getByRole('button', { name: '仍要启用', exact: true })
  if (await armBtn.isDisabled()) throw new Error('缺件时按钮仍被置灰——非阻断口径没生效')

  // ── ② 二次确认：摊开风险，此时还没启用 ──
  await armBtn.click()
  await win.waitForTimeout(400)
  await shot(win, '02-preset-armed-risk.png') // 验：红框风险话术 + 按钮变「确认启用」
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  const enabledNow = () => {
    try { return ((JSON.parse(readFileSync(catalogPath, 'utf8')).models) || []).some((m) => m.labelZh === 'WAN2.2 图生视频 · 14B') }
    catch { return false }
  }
  if (enabledNow()) throw new Error('只点了一次「仍要启用」就落库了——二次确认形同虚设')

  // ── ③ 重新检测 → 确认态作废（重新给判断依据就得重新问一次）──
  await win.getByRole('button', { name: '重新检测', exact: true }).first().click()
  await win.waitForTimeout(1500)
  await shot(win, '03-preset-rearmed-after-recheck.png') // 验：按钮退回「仍要启用」
  await win.getByRole('button', { name: '仍要启用', exact: true }).click()
  await win.waitForTimeout(300)

  // ── ④ 确认启用：6 个文件全缺，照样让他启用（用户要的就是这个）──
  await win.getByRole('button', { name: '确认启用', exact: true }).click()
  await win.waitForTimeout(1500)
  if (!enabledNow()) throw new Error('确认后仍未落库——缺件还是把人拦住了')
  console.log('  缺 6 个文件仍成功启用: ✓')
  await win.getByText('WAN2.2 图生视频 · 14B', { exact: false }).first().scrollIntoViewIfNeeded()
  await shot(win, '04-preset-enabled-despite-missing.png') // 验：workflow 行出现 + 模板行 chip 变「已启用」

  // ── ⑤ mock 装好 → 重新检测 → 绿「全部就绪」 ──
  await fetch('http://127.0.0.1:8188/__walk/enrich')
  await win.getByRole('button', { name: '重新检测', exact: true }).first().click()
  await win.waitForTimeout(1500)
  await shot(win, '05-preset-all-ready.png') // 验：绿 chip「全部就绪」+ 逐文件 ✓

  // ── ⑥ 导入含 checkpoint 的自定义图 → combo 真实选项烤进参数控件 ──
  await win.waitForTimeout(3500) // 等启用 toast 消退，别抢 getByText
  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(COMBO_GRAPH)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(1500) // 等 reconcile 带回 enumOptions
  await win.getByRole('button', { name: '添加参数', exact: true }).click() // 自动选中首个候选 = #1 ckpt_name
  await win.waitForTimeout(400)
  await win.getByText('生成时可调参数', { exact: true }).scrollIntoViewIfNeeded()
  await shot(win, '06-combo-param-row.png') // 验：参数行绑到 #1 CheckpointLoaderSimple.ckpt_name
  await win.getByPlaceholder('给它起个名', { exact: false }).fill('Combo 下拉走查')
  await win.getByRole('button', { name: '导入', exact: true }).click()
  await win.waitForTimeout(1500)
  // 落库实证：meta.parameters[0] 必须是 select + 本机全部 6 个文件选项（画布下拉即读此声明）。
  const catalogJson = JSON.parse(readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
  const comboModel = (catalogJson.models || []).find((m) => m.labelZh === 'Combo 下拉走查')
  const allParams = comboModel?.meta?.parameters || []
  // 建议数值参数(seed/steps/…)在前；「添加参数」加的 ckpt 是唯一命中 combo 的 → 应被烤成 select。
  const comboParam = allParams.find((p) => p.type === 'select')
  const comboOk = Boolean(comboParam) && Array.isArray(comboParam.options) && comboParam.options.length >= 6
    && comboParam.options.includes('wan_2.1_vae.safetensors')
    && comboParam.default === 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'
  console.log('  combo 烤入 select: ' + (comboOk ? `✓ ${comboParam.key} options=${comboParam.options.length}` : '✗ ' + JSON.stringify(allParams)))
  if (!comboOk) throw new Error('combo 参数没有烤成 select')
  await shot(win, '07-combo-imported.png')

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
