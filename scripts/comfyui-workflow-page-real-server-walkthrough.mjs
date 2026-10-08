import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查（**真 ComfyUI，不是 mock**）：从接入到出图，把工作流设置整页的全流程走通一遍。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 与 comfyui-workflow-page-walkthrough.mjs（mock 版，CI 零依赖）的分工：
//   mock 版证「界面逻辑对」，本脚本证「接到真机器上真能出图」。两者都要，缺一边都会漏东西——
//   mock 版永远不会告诉你「ComfyUI 其实嫌你的采样器名不合法」。
//
// 全流程（一条真实用户任务，不是功能探索）：
//   ① 真 /object_info 拿这台**实际装了什么**（checkpoint / 采样器 / 调度器全部现取，不 hardcode）
//   ② 用这些真值拼一张标准 SD1.5 文生图 API 图，先让真 ComfyUI 自己校验一遍（POST /prompt 干跑）
//   ③ Nomi 里：设置 → 模型 → 启用 ComfyUI（真探测）→ 贴图导入（真分析 + 真缺件对账）
//   ④ 进工作流设置整页 → 图上认角色 → 把提示词绑到**正向**那个节点 → 暴露 steps 成画布字段 → 保存
//   ⑤ 点「运行测试」→ 真提交 → 真 MPS 出图
//   ⑥ 回真 ComfyUI 对账：/history 成功 + output 目录真落了一张 PNG + 尺寸/步数与我们填的一致
//
// 前置：真 ComfyUI 跑在 127.0.0.1:8188，且 models/checkpoints 下至少一个 SD1.5 类 checkpoint。
// 用法：pnpm build && node scripts/comfyui-workflow-page-real-server-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'

const BASE = process.env.COMFY_BASE || 'http://127.0.0.1:8188'
const COMFY_HOME = process.env.COMFY_HOME || path.join(os.homedir(), 'ComfyUI')
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-workflow-page-real-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// 走查要填的值——后面要在真出的图上/真 history 里逐项对回来，所以集中在这儿。
const TEST_PROMPT = 'a red apple on a wooden table, studio light'
const TEST_STEPS = '6' // 真跑，步数压低只为省时间；对账时要能在 history 里看到就是 6

// ── ① 真服务器现状（全部现取，不 hardcode）──
console.log('\n① 问真 ComfyUI：这台装了什么')
const stats = await fetch(`${BASE}/system_stats`).then((r) => r.json()).catch(() => null)
if (!stats) {
  console.error(`\n❌ ${BASE} 连不上。先起真 ComfyUI：\n   cd ${COMFY_HOME} && ./.venv/bin/python main.py --port 8188\n`)
  process.exit(1)
}
console.log(`  ComfyUI ${stats.system?.comfyui_version} on ${stats.system?.os}`)

const objectInfo = await fetch(`${BASE}/object_info`).then((r) => r.json())
const enumOf = (cls, key) => objectInfo?.[cls]?.input?.required?.[key]?.[0] ?? []
const checkpoints = enumOf('CheckpointLoaderSimple', 'ckpt_name')
if (checkpoints.length === 0) {
  console.error(`\n❌ 这台 ComfyUI 的 models/checkpoints 是空的，没法真出图。\n   放一个 SD1.5 类 checkpoint 进 ${COMFY_HOME}/models/checkpoints/ 再跑。\n`)
  process.exit(1)
}
const CKPT = checkpoints[0]
const SAMPLER = enumOf('KSampler', 'sampler_name').includes('euler') ? 'euler' : enumOf('KSampler', 'sampler_name')[0]
const SCHEDULER = enumOf('KSampler', 'scheduler').includes('normal') ? 'normal' : enumOf('KSampler', 'scheduler')[0]
console.log(`  checkpoint=${CKPT} sampler=${SAMPLER} scheduler=${SCHEDULER}`)

// 标准 SD1.5 文生图（节点形状与 ComfyUI 默认图一致；枚举值取自上面的真 /object_info）。
// #6 正向、#7 负向——**两个都是 CLIPTextEncode**，正是「自动识别可能挑错、用户要能改」的真实场景。
const graph = {
  3: { class_type: 'KSampler', inputs: { seed: 12345, steps: 20, cfg: 7, sampler_name: SAMPLER, scheduler: SCHEDULER, denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: 'a photo of a cat', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', _meta: { title: '负向提示词' }, inputs: { text: 'text, watermark', clip: ['4', 1] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'nomi_real_walk', images: ['8', 0] } },
}

// ── ② 让真 ComfyUI 自己先校验这张图（别把一张它不认的图喂给 Nomi，再来猜是谁的错）──
// ComfyUI 没有 dry-run 口，POST 必然入队；故热身这一发压到 1 步 / 64×64，几秒跑完只为拿它的
// 校验结论。产物用不同的 filename_prefix，下面靠**前缀**区分「谁出的图」，不靠数个数。
console.log('\n② 真 ComfyUI 校验这张图（1 步热身，只为拿校验结论）')
const NOMI_PREFIX = 'nomi_real_walk'
const validateGraph = JSON.parse(JSON.stringify(graph))
validateGraph['3'].inputs.steps = 1
validateGraph['5'].inputs = { width: 64, height: 64, batch_size: 1 }
validateGraph['9'].inputs.filename_prefix = 'nomi_walk_validate'
const validate = await fetch(`${BASE}/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: validateGraph, client_id: 'nomi-walk-validate', extra_data: {} }),
})
const validatedBody = await validate.json()
if (!validate.ok || Object.keys(validatedBody.node_errors ?? {}).length > 0) {
  console.error('  ❌ 图本身就不合法（不是 Nomi 的问题）：', JSON.stringify(validatedBody).slice(0, 800))
  process.exit(1)
}
console.log(`  ✓ 图合法，ComfyUI 收下了（prompt_id=${validatedBody.prompt_id}）`)

const outputRoot = path.join(COMFY_HOME, 'output')
const pngsBefore = new Set(readdirSync(outputRoot).filter((f) => f.endsWith('.png')))

// ── ③④⑤ Nomi 界面全流程 ──
const { app, win } = await launchNomiApp({
  name: 'comfyui-workflow-page-real',
  settingsDir: makeTempDir('comfyui-real-set-'),
  projectsDir: makeTempDir('comfyui-real-proj-'),
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  console.log('\n③ Nomi：设置 → 模型 → 启用真 ComfyUI → 导入这张图')
  await win.getByRole('button', { name: '设置', exact: true }).first().click()
  await win.waitForTimeout(900)
  await win.getByRole('button', { name: '模型', exact: true }).first().click()
  await win.waitForTimeout(900)
  await win.getByText('有本地 ComfyUI', { exact: false }).first().click()
  await win.waitForTimeout(500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('button', { name: '启用 ComfyUI', exact: false }).first().click()
  await win.waitForTimeout(2600)
  await shot(win, '01-enabled-real-server.png') // 验：真探测到「已连上」+ 真版本号
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(600)

  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(JSON.stringify(graph))
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(2500) // 真分析 + 真缺件对账（打真 /object_info）
  await shot(win, '02-analyzed-against-real-server.png') // 验：无缺件红警（这台真装了这些节点和模型）
  await win.getByPlaceholder('给它起个名', { exact: false }).fill('SD1.5 文生图 · 真机')
  await win.getByRole('button', { name: '导入', exact: true }).click()
  await win.waitForTimeout(1600)

  console.log('\n④ 进整页：认角色 → 把提示词绑到正向节点 → 暴露 steps → 保存')
  if (!(await win.getByText('SD1.5 文生图 · 真机', { exact: false }).first().isVisible().catch(() => false))) {
    await win.getByText('本地 ComfyUI', { exact: true }).first().click()
    await win.waitForTimeout(600)
  }
  await win.waitForTimeout(3200) // 等导入成功 toast 消退
  await win.getByRole('button', { name: '打开「SD1.5 文生图 · 真机」的工作流设置', exact: false }).first().click()
  await win.waitForTimeout(1800)
  await shot(win, '03-page-real-workflow.png') // 验：真图的节点图；左栏工作流状态「齐全」（真对账）

  const listText = await win.evaluate(() => document.querySelector('[data-workflow-list]')?.innerText ?? '')
  if (!listText.includes('齐全')) throw new Error(`真服务器上这条工作流应该零缺件，实际：\n${listText}`)
  console.log('  真缺件对账：齐全 ✓')

  // 提示词必须绑在**正向** #6 上。自动识别挑了谁不一定，这一步就是用户「改绑」的真实动作。
  const previewText = () => win.evaluate(() => document.querySelector('[data-workflow-preview]')?.innerText ?? '')
  if (!(await previewText()).includes('#6')) {
    await win.locator('[data-node-id="6"]').first().click()
    await win.waitForTimeout(500)
    await win.getByRole('menuitemradio', { name: '提示词', exact: false }).first().click()
    await win.waitForTimeout(600)
  }
  const boundPreview = await previewText()
  if (!boundPreview.includes('#6')) throw new Error(`提示词没能绑到正向节点 #6：\n${boundPreview}`)
  console.log('  提示词绑在正向节点 #6 ✓')

  // 自动识别本来就把常见数值（seed/steps/cfg/denoise/width/height/batch_size）暴露成画布字段了
  // （electron 侧 NUMERIC_PRIORITY，paramKey 一律 comfy_*）。先确认「采样步数」在，等下要靠它压步数。
  const previewLabels = await previewText()
  if (!previewLabels.includes('采样步数')) throw new Error(`自动识别应该暴露了采样步数，实际：\n${previewLabels}`)
  console.log('  自动暴露的画布字段里有采样步数 ✓')

  // 再手动暴露一个**没被自动挑中**的：sampler_name。它是 combo，缺件对账会带回这台机器上的
  // 真实可选值 → 预览里必须渲染成**下拉**（NomiSelect），而不是让用户自己手打采样器名。
  await win.locator('[data-node-id="3"]').first().click()
  await win.waitForTimeout(500)
  await win.getByRole('menuitemcheckbox', { name: 'sampler_name', exact: false }).first().click()
  await win.waitForTimeout(700)
  const samplerSelect = win.getByRole('button', { name: 'sampler_name #3', exact: false }).first()
  if ((await samplerSelect.count()) === 0) {
    throw new Error('sampler_name 暴露后没渲染成下拉——真服务器的 combo 可选值没流到预览里')
  }
  console.log('  combo 参数按真服务器的可选值渲染成下拉 ✓')
  await shot(win, '04-field-exposed-real.png') // 验：#3 变「5 已用」；左栏 sampler_name 是下拉不是输入框

  // 左栏是导航栏：字段一多，工作流列表**不许**被挤没（真机走查栽过——8 个字段时它被压成 0 高，
  // 只剩一行标题，用户从此换不了工作流）。量真实高度，不看 innerText。
  const listBox = await win.locator('[data-workflow-list]').first().boundingBox()
  const firstRow = await win.locator('[data-workflow-key]').first().boundingBox()
  if (!firstRow || listBox.height < 60) {
    throw new Error(`工作流列表被挤没了（高 ${listBox?.height}px，行可见=${Boolean(firstRow)}）——左栏换不了工作流`)
  }
  console.log(`  字段多起来后工作流列表仍在（${Math.round(listBox.height)}px，行可点）✓`)

  await win.locator('[data-workflow-save]').first().click()
  await win.waitForTimeout(1500)

  console.log('\n⑤ 点「运行测试」→ 真 MPS 出图')
  await win.locator('[data-workflow-preview] textarea').first().fill(TEST_PROMPT)
  // 按 aria-label 精确定位——预览里现在有七八个输入框，用 .last() 会填到「批量」上去。
  await win.locator('[data-workflow-preview] input[aria-label="采样步数"]').fill(TEST_STEPS)
  await win.waitForTimeout(300)
  const runButton = win.locator('[data-workflow-test-run]').first()
  if (!(await runButton.isEnabled())) {
    const why = await runButton.locator('xpath=..').getAttribute('title')
    throw new Error(`「运行测试」不可点：${why}`)
  }
  await runButton.click()
  await win.waitForTimeout(2500)
  await shot(win, '05-test-run-submitted.png') // 验：已提交 toast

  // ── ⑥ 回真 ComfyUI 对账：真出了图吗、参数是我们填的那些吗 ──
  console.log('\n⑥ 回真 ComfyUI 对账')
  const deadline = Date.now() + 240_000
  let produced = null
  while (Date.now() < deadline) {
    // 只认 Nomi 这一发的前缀——热身那张叫 nomi_walk_validate，不会被误当成战果。
    const fresh = readdirSync(outputRoot)
      .filter((f) => f.endsWith('.png') && f.startsWith(NOMI_PREFIX) && !pngsBefore.has(f))
    if (fresh.length > 0) { produced = fresh.sort()[fresh.length - 1]; break }
    await new Promise((r) => setTimeout(r, 3000))
  }
  if (!produced) throw new Error(`等了 4 分钟，${outputRoot} 里没等到 Nomi 这一发的新图（前缀 ${NOMI_PREFIX}）`)
  const producedPath = path.join(outputRoot, produced)
  const bytes = statSync(producedPath).size
  console.log(`  真出图：${produced}（${Math.round(bytes / 1024)} KB）`)
  if (bytes < 20_000) throw new Error(`出的图只有 ${bytes} 字节，八成是空图/坏图`)

  // history 里逐项对账：提示词进了 #6，steps 是我们填的 6，checkpoint 是这台真有的那个。
  const history = await fetch(`${BASE}/history`).then((r) => r.json())
  const runs = Object.values(history).filter((h) => {
    const nodes = h?.prompt?.[2] ?? {}
    return nodes?.['6']?.inputs?.text === TEST_PROMPT
  })
  if (runs.length === 0) throw new Error('真 ComfyUI 的 history 里找不到带我们提示词的那一发——提示词没进 #6')
  const run = runs[runs.length - 1]
  const nodes = run.prompt[2]
  if (String(nodes['3'].inputs.steps) !== TEST_STEPS) {
    throw new Error(`steps 没按画布字段发（期望 ${TEST_STEPS}，实收 ${nodes['3'].inputs.steps}）`)
  }
  if (nodes['4'].inputs.ckpt_name !== CKPT) throw new Error(`checkpoint 对不上（实收 ${nodes['4'].inputs.ckpt_name}）`)
  const statusStr = run.status?.status_str
  if (statusStr !== 'success') throw new Error(`真 ComfyUI 报这一发不是 success，而是 ${statusStr}`)
  console.log(`  history 对账：提示词→#6 ✓ / steps=${TEST_STEPS} ✓ / ckpt=${CKPT} ✓ / status=success ✓`)

  await shot(win, '06-after-real-generation.png') // 验：整页仍在、填的值还在
  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
  console.log(`\n✅ 全流程走通：接入 → 导入 → 配置 → 真跑 → 真出图（${producedPath}）`)
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
}
