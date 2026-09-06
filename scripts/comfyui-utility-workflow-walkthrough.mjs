// R13 真机走查：**处理类工作流**（不吃提示词的那类）从导入到点生成走通。
// 这条路此前是死的——提交咽喉无条件抛英文 'prompt is required'，用户连好图点生成就卡死。
//
// 用真 ComfyUI（127.0.0.1:8188）。工作流选「EmptyImage → ImageInvert → SaveImage」这种
// 零模型依赖的纯处理图（空 models 目录也能真跑完），语义上等价于去背景/超分那类。
//   ① 导入面板：分析出「图片产出」且**提示词栏没有可选项**（图里根本没有文本源）
//   ② 导入成功，落进目录
//   ③ 画布上选中它 → 出现「这条工作流不吃提示词」的诚实说明
//   ④ 一个字都不打，直接点生成 → **不再弹 prompt is required**，真跑出图
// 用法：pnpm build && node scripts/comfyui-utility-workflow-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-utility-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = mkdtempSync(path.join(os.tmpdir(), 'comfyui-utility-'))
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const COMFY = 'http://127.0.0.1:8188'
const stats = await fetch(`${COMFY}/system_stats`).then((r) => r.json()).catch(() => null)
if (!stats) { console.error('❌ 真 ComfyUI 没在 127.0.0.1:8188 跑，先起它'); process.exit(1) }
console.log(`  真 ComfyUI ${stats.system?.comfyui_version} ✓`)

// 纯处理图：造一张纯色图 → 反色 → 保存。零模型依赖，空 models 目录也真跑得完。
// 关键：图里**没有任何文本/提示词源**，正是「去背景/超分」这类工具的形状。
const UTILITY_GRAPH = JSON.stringify({
  1: { class_type: 'EmptyImage', inputs: { width: 128, height: 128, batch_size: 1, color: 8388736 } },
  2: { class_type: 'ImageInvert', inputs: { image: ['1', 0] } },
  3: { class_type: 'SaveImage', inputs: { filename_prefix: 'utility', images: ['2', 0] } },
})

writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{ key: 'comfyui-local', name: '本机 ComfyUI', enabled: true, baseUrlHint: COMFY, authType: 'none', authHeader: null, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' }],
  models: [], mappings: [], apiKeysByVendor: {},
}))

const projectsDir = mkdtempSync(path.join(os.tmpdir(), 'comfyui-utility-proj-'))
const { app, win } = await launchNomiApp({
  name: 'comfyui-utility-workflow',
  settingsDir,
  projectsDir,
  env: { NOMI_LOOP_SPEND_OK: '1', NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 2000,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1500, height: 1060 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('dialog', (d) => void d.dismiss().catch(() => {}))
  // 首启开屏会盖住库页（记忆里的坑）——先跳过
  const skip = win.getByRole('button', { name: '跳过', exact: false }).first()
  if (await skip.isVisible().catch(() => false)) { await skip.click(); await win.waitForTimeout(800) }

  // ── ① 导入处理类工作流 ──
  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(2500)
  // 已接入区的 ComfyUI 卡默认折叠 —— 先展开才有导入入口（走查真实操作序列，不是直接找按钮）
  await win.getByText('本机 ComfyUI', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await shot(win, '00-card-expanded.png')
  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(UTILITY_GRAPH)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(3000)
  await shot(win, '01-analyzed-no-prompt.png')

  await win.getByPlaceholder('给它起个名', { exact: false }).fill('反色处理')
  await win.getByRole('button', { name: '导入', exact: true }).click()
  await win.waitForTimeout(2000)
  await shot(win, '02-imported.png')

  const cat = JSON.parse(readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
  const model = (cat.models || []).find((m) => m.labelZh === '反色处理')
  const mapping = (cat.mappings || []).find((m) => m.name === '反色处理')
  const bound = model?.meta?.comfyWorkflowImport?.binding || {}
  console.log(`  落库: model=${Boolean(model)} mapping=${mapping?.taskKind} 提示词绑定=${bound.promptNodeId ?? '(无 ← 正是重点)'}`)
  if (!model || bound.promptNodeId) throw new Error('这张图不该有提示词绑定')

  // ── ③④ 回画布：选中它 → 一个字都不打，直接生成 ──
  await win.keyboard.press('Escape')
  await win.waitForTimeout(1000)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1500)
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(1500)

  // 底栏模型芯片 → 选「反色处理」
  const modelChip = win.locator('[aria-label="选择模型"], [aria-label="模型"]').first()
  if (await modelChip.isVisible().catch(() => false)) await modelChip.click()
  else await win.getByText('选择模型', { exact: false }).first().click()
  await win.waitForTimeout(1200)
  await win.getByText('反色处理', { exact: false }).first().click()
  await win.waitForTimeout(2000)
  await shot(win, '04-model-selected-no-prompt-note.png')

  const afterSelect = await win.evaluate(() => document.body.innerText)
  const hasNote = afterSelect.includes('不吃提示词')
  console.log(`  ③ 诚实说明「这条工作流不吃提示词」: ${hasNote ? '✓' : '✗'}`)

  // **一个字都不打**，直接点节点上的生成钮（aria-label「生成素材」——顶栏那个「生成」是工作区页签，
  // 早先误点它 → 断言"没报错"照样绿，但 ComfyUI 一个任务都没收到。假绿。）
  await win.locator('[aria-label="生成素材"]').first().click()
  await win.waitForTimeout(1500)
  // 本地 ComfyUI 跑在用户自己的显卡上 → **不该**弹「会消耗模型额度」的付费卡（既是假话又白挡一下）
  const cardText = await win.evaluate(() => document.body.innerText)
  const paidCard = cardText.includes('会消耗模型额度')
  console.log(`  ④a 本地跑不再弹付费确认卡: ${paidCard ? '✗ 还在弹' : '✓'}`)
  if (paidCard) { await shot(win, 'ERROR-paid-card.png'); throw new Error('本地 ComfyUI 仍弹付费确认卡') }
  await win.waitForTimeout(15000)
  await shot(win, '05-generated-without-typing.png')
  const afterRun = await win.evaluate(() => document.body.innerText)
  const stillThrows = /prompt is required/i.test(afterRun)
  console.log(`  ④ 不打字点生成不再报 'prompt is required': ${stillThrows ? '✗ 还在报' : '✓'}`)

  // 眼见为实：ComfyUI 那头**真收到并跑完了**（只看 UI 不报错 = 可能压根没发出去）
  const hist = await fetch(`${COMFY}/history`).then((r) => r.json()).catch(() => ({}))
  const runs = Object.values(hist)
  const done = runs.filter((r) => r?.status?.status_str === 'success')
  console.log(`  ⑤ ComfyUI 真收到任务: ${runs.length} 个，成功 ${done.length} 个`)
  if (stillThrows) throw new Error("处理类工作流仍被 'prompt is required' 堵死")
  if (!hasNote) throw new Error('没显示「不吃提示词」的诚实说明')
  if (done.length === 0) throw new Error('ComfyUI 没收到/没跑完任务——生成根本没发出去')

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 5).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
}
