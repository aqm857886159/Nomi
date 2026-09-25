// R13 走查：ComfyUI 导入面板的「没见过的 combo 外壳」诊断（2026-09-11，owner 拍板）。
// owner 追问「会不会还有新格式，之后还要搞？」——本次修复给出的答案：真机撞到没见过的 combo
// 外壳时不再默默跳过，卡上一键「反馈给 Nomi」，把 node class / input key / 原始 spec JSON
// 拼进预填好的 GitHub issue。这条走查证的是**真实链路**：真实 UI 点出 ComfyUI 卡 → 粘贴工作流 →
// 分析 → 对一台本地假 ComfyUI 服务器对账 → 诊断条 + 反馈按钮真的出现在卡上，不是纯函数断言。
// 它也是 comfy-combo-wire-type.walk.mjs（issue #861：已知外壳不再误报）的反例。
//
// ⚠️ 走查跑的是 dist-electron/dist 编译产物，不是源码——改完 electron/*.ts 或 src/**/*.tsx
// 必须先 `pnpm run build` 再跑这条，否则会打到旧构建，诊断条永远不出现却看不出是为什么。
//
// 用法: pnpm run build && node tests/ux/comfy-unknown-combo-feedback.walk.mjs
// 产出: docs/plan/2026-09-11-triage-board-evidence/combo-unknown-shape.png
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { openComfyImportPanel, pasteAndAnalyze, startFakeComfy } from './_comfyImportPanel.mjs'

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/plan/2026-09-11-triage-board-evidence')
fs.mkdirSync(evidenceDir, { recursive: true })

// 一台最小文生视频工作流：CLIPTextEncode 提示词 → KSampler → CreateVideo → SaveVideo。
// FutureUpscaler 是这份假 /object_info 里故意放的「没见过的外壳」载体：它的输入字段本身
// 值是什么不重要（对账不需要图里引用了这个字段），重要的是本机 /object_info 里
// FutureUpscaler.mode 用了一个 Nomi 完全不认识的外壳（"SUPER_COMBO_V9"）——既不是老格式数组，
// 也不是已知的 ["COMBO", {...}] / COMFY_DYNAMICCOMBO_V3。
const graph = {
  '1': { class_type: 'CLIPTextEncode', inputs: { text: '日出时分，海浪拍打礁石', clip: ['2', 0] } },
  '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
  '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 12, positive: ['1', 0], model: ['2', 0] } },
  '4': { class_type: 'CreateVideo', inputs: { images: ['3', 0], fps: 24 } },
  '5': { class_type: 'SaveVideo', inputs: { video: ['4', 0], filename_prefix: 'unknown-combo-walk' } },
}
const fake = await startFakeComfy({
  objectInfo: {
    ...Object.fromEntries(Object.values(graph).map((node) => [node.class_type, { input: { required: {} } }])),
    FutureUpscaler: { input: { required: { mode: ['SUPER_COMBO_V9', { options: ['fast', 'quality'] }] } } },
  },
})

let app
let failed = null
try {
  const panel = await openComfyImportPanel({ name: 'comfy-unknown-combo-feedback', baseUrl: fake.baseUrl })
  app = panel.app
  const { win } = panel
  await pasteAndAnalyze(panel, graph)

  const feedbackButton = win.locator('button', { hasText: panel.text.report }).first()
  await expect(feedbackButton, '「反馈给 Nomi」按钮没有出现——未知 combo 外壳诊断没有到达卡片').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })

  const diagnosticText = await win.locator('text=FutureUpscaler.mode').first().textContent().catch(() => null)
  console.log(`  · 诊断文案包含字段名: ${diagnosticText ? '✅ ' + diagnosticText.trim() : '❌ 没找到'}`)

  // 顺手验一下反馈链接内容是对的（不真的弹浏览器窗口）：拦掉 window.open，读它传的 URL。
  await win.evaluate(() => { window.__capturedOpen = []; window.open = (url) => { window.__capturedOpen.push(url); return null } })
  await feedbackButton.click({ timeout: DEFAULT_TIMEOUT_MS })
  const capturedUrl = await win.evaluate(() => window.__capturedOpen?.[0] ?? null)
  if (!capturedUrl) throw new Error('没捕获到「反馈给 Nomi」按钮打开的 issue 深链')
  const url = new URL(capturedUrl)
  console.log(`  · issue 深链 host: ${url.host}, template: ${url.searchParams.get('template')}`)
  const whatHappened = url.searchParams.get('what_happened') || ''
  const extra = url.searchParams.get('extra') || ''
  console.log(`  · what_happened 含 FutureUpscaler: ${whatHappened.includes('FutureUpscaler') ? '✅' : '❌'}`)
  console.log(`  · extra 含原始 spec JSON(SUPER_COMBO_V9): ${extra.includes('SUPER_COMBO_V9') ? '✅' : '❌'}`)
  if (!whatHappened.includes('FutureUpscaler') || !extra.includes('SUPER_COMBO_V9')) {
    throw new Error(`反馈链接内容不对：what_happened=${whatHappened} extra=${extra}`)
  }

  await screenshotSettled(win, { path: path.join(evidenceDir, 'combo-unknown-shape.png') })
  console.log(`✅ 截图已存: ${path.join(evidenceDir, 'combo-unknown-shape.png')}`)
  console.log('✅ ComfyUI 未知 combo 外壳诊断 + 反馈给 Nomi 链路走查通过')
} catch (error) {
  failed = error
} finally {
  await app?.close().catch(() => {})
  fake.close()
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
