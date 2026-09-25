// R13 走查：issue #861——全布尔老格式 combo（ComfyUI-Easy-Use `easy hiresFix`.rescale_after_model，
// /object_info spec [[false, true], {"default": true}]）不再被当成「没见过的格式」，且 combo 选项按
// wire 原类型一路落库（布尔 → 开关参数；CreateVideo.bit_depth 的 8/10 仍是数字）、原样发给 ComfyUI。
// 同屏正对照：再放一个外壳真正陌生的节点，提示条照常出现并只点名它（完整的反馈链路见
// tests/ux/comfy-unknown-combo-feedback.walk.mjs）。
//
// ⚠️ 走查跑的是 dist-electron/dist 编译产物：改完源码先 `pnpm run build`。
// 用法: pnpm run build && node tests/ux/comfy-combo-wire-type.walk.mjs
// 产出: docs/plan/2026-09-24-comfyui-combo-wire-type-evidence/{zh-CN,en}-{notice-area,analyzed,imported}.png
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { openComfyImportPanel, pasteAndAnalyze, startFakeComfy } from './_comfyImportPanel.mjs'

const evidenceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/plan/2026-09-24-comfyui-combo-wire-type-evidence')
fs.mkdirSync(evidenceDir, { recursive: true })

const graph = {
  '1': { class_type: 'CLIPTextEncode', inputs: { text: '雨夜街头，霓虹倒影', clip: ['2', 0] } },
  '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
  '3': { class_type: 'KSampler', inputs: { seed: 1, positive: ['1', 0], model: ['2', 0] } },
  '7': { class_type: 'easy hiresFix', inputs: { rescale_after_model: true, image: ['3', 0] } },
  '4': { class_type: 'CreateVideo', inputs: { images: ['7', 0], bit_depth: 'auto' } },
  '5': { class_type: 'SaveVideo', inputs: { video: ['4', 0], filename_prefix: 'wire-type-walk' } },
}
// 与 ComfyUI execution.py validate_inputs 同口径的 combo 列表（`val not in combo_options`，类型敏感）。
const COMBOS = {
  // 逐字取自 issue #861 正文（用户机器的 /object_info）。
  'easy hiresFix': { rescale_after_model: [[false, true], { default: true }] },
  // 逐字取自 electron/__fixtures__/comfyui-object-info-real-sample.json（真机 ComfyUI 0.35.0）。
  CreateVideo: { bit_depth: ['COMBO', { default: 'auto', multiselect: false, options: ['auto', 8, 10] }] },
}
const objectInfo = {
  ...Object.fromEntries(Object.values(graph).map((node) => [node.class_type, { input: { required: {} } }])),
  'easy hiresFix': { input: { required: COMBOS['easy hiresFix'] } },
  CreateVideo: { input: { optional: COMBOS.CreateVideo } },
  // 正对照：同一台机器上再装一个外壳真正陌生的节点。提示条必须出现、并且只点它——
  // 证明「提示条里点名某个字段」这个探针是活的，下面断言它**不**点名 rescale_after_model 才有意义。
  FutureUpscaler: { input: { required: { mode: ['SUPER_COMBO_V9', { options: ['fast', 'quality'] }] } } },
}
const allowed = { 'easy hiresFix': { rescale_after_model: [false, true] }, CreateVideo: { bit_depth: ['auto', 8, 10] } }
const violations = (prompt) => Object.values(prompt).flatMap((node) => Object.entries(allowed[node?.class_type] ?? {})
  .filter(([key, options]) => node.inputs?.[key] !== undefined && !options.includes(node.inputs[key]))
  .map(([key]) => `${node.class_type}.${key}=${JSON.stringify(node.inputs[key])}`))

const TEXT = {
  'zh-CN': { addParam: '添加参数', paramNode: '参数绑定节点', paramLabel: '参数显示名', import: '导入', selfCheck: '开始自检', rescale: '放大后重缩放', bitDepth: '视频位深' },
  en: { addParam: 'Add parameter', paramNode: 'Parameter binding node', paramLabel: 'Parameter display name', import: 'Import', selfCheck: 'Start self-check', rescale: 'Rescale after model', bitDepth: 'Bit depth' },
}

/** 像真人一样：点「添加参数」→ 新行（追加在末尾）改绑到目标节点 → 起一个能看懂的名字。 */
async function addParam(win, text, optionLabel, label) {
  await clickOrFail(win.locator('button', { hasText: text.addParam }).first(), text.addParam, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator(`button[aria-label="${text.paramNode}"]`).last(), `新参数行的节点下拉（→ ${optionLabel}）`, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.getByRole('option').filter({ hasText: optionLabel }).first(), `下拉项 ${optionLabel}`, { timeout: DEFAULT_TIMEOUT_MS })
  await win.locator(`input[aria-label="${text.paramLabel}"]`).last().fill(label)
}

/** 自检开始时把候选（enabled:false）写进 catalog；假服务器 /history 不出图，自检随后撤回候选——在它还在时读。 */
async function readStagedCandidate(win, settingsDir) {
  for (let i = 0; i < 50; i += 1) {
    for (const file of ['model-catalog.json', 'model-catalog.bak.json']) {
      try {
        const catalog = JSON.parse(fs.readFileSync(path.join(settingsDir, file), 'utf8'))
        const model = catalog.models.find((m) => m?.meta?.comfyWorkflowImport)
        if (model) return model
      } catch { /* 写入中，下一轮再读 */ }
    }
    await win.waitForTimeout(200)
  }
  return null
}

async function walk(locale) {
  const text = TEXT[locale]
  const submitted = []
  const fake = await startFakeComfy({
    objectInfo,
    onPrompt: (prompt) => {
      submitted.push(prompt)
      return violations(prompt).length ? { status: 400, body: { error: { type: 'prompt_outputs_failed_validation' } } } : undefined
    },
  })
  let app
  try {
    const panel = await openComfyImportPanel({ name: `comfy-combo-wire-type-${locale}`, baseUrl: fake.baseUrl, locale })
    app = panel.app
    const { win, settingsDir } = panel
    await pasteAndAnalyze(panel, graph)

    // 对账是异步的：先等提示条点名真正陌生的外壳（正对照，证明探针测得到东西），
    // 再断言它没有点名 easy hiresFix.rescale_after_model——改前两者会一起被列出来。
    const proof = await proveProbe(win.locator('text=FutureUpscaler.mode'), `[${locale}] 提示条点名了真正陌生的外壳 FutureUpscaler.mode`)
    await expectAbsent(win.locator('text=easy hiresFix.rescale_after_model'), {
      provenBy: proof,
      message: `[${locale}] 提示条不再把全布尔老格式 easy hiresFix.rescale_after_model 当成没见过的格式`,
    })
    console.log(`  · [${locale}] 提示条只点名 FutureUpscaler.mode，没有点名 easy hiresFix.rescale_after_model`)
    // 改动区：提示条在识别结果那一行和「提示词节点」之间——滚进画面再拍。
    await panel.textarea.scrollIntoViewIfNeeded()
    await win.mouse.wheel(0, 140)
    await screenshotSettled(win, { path: path.join(evidenceDir, `${locale}-notice-area.png`) })

    await addParam(win, text, '#7 easy hiresFix', text.rescale)
    await addParam(win, text, '#4 CreateVideo', text.bitDepth)
    await win.locator('input').filter({ hasNot: win.locator('[aria-label]') }).last().fill(`issue 861 ${locale}`).catch(() => {})
    await screenshotSettled(win, { path: path.join(evidenceDir, `${locale}-analyzed.png`) })

    // 导入先进接入认证会话（带数字选项的 enumOptions 走 integrationSession.sanitizeWorkflowEnumOptions）；
    // 「开始自检」时写入候选并真的向 ComfyUI 提交一次 /prompt。
    await clickOrFail(win.locator('button', { hasText: new RegExp(`^\\s*${text.import}\\s*$`) }).last(), '导入 按钮', { timeout: DEFAULT_TIMEOUT_MS })
    await clickOrFail(win.locator('button', { hasText: text.selfCheck }).last(), text.selfCheck, { timeout: DEFAULT_TIMEOUT_MS })
    const staged = await readStagedCandidate(win, settingsDir)
    await win.waitForTimeout(2500)
    await screenshotSettled(win, { path: path.join(evidenceDir, `${locale}-imported.png`) })

    if (!staged) throw new Error(`[${locale}] 自检期间 catalog 里一直没出现这条工作流的候选`)
    const params = staged.meta.parameters
    console.log(`  · [${locale}] 落库参数: ${JSON.stringify(params)}`)
    const rescale = params.find((p) => p.label === text.rescale)
    const bitDepth = params.find((p) => p.label === text.bitDepth)
    if (rescale?.type !== 'boolean' || rescale.default !== true) throw new Error(`[${locale}] rescale_after_model 不是默认 true 的开关：${JSON.stringify(rescale)}`)
    if (bitDepth?.type !== 'select' || JSON.stringify(bitDepth.options) !== JSON.stringify(['auto', 8, 10])) {
      throw new Error(`[${locale}] bit_depth 下拉选项不是 ["auto", 8, 10]：${JSON.stringify(bitDepth)}`)
    }
    if (!submitted.length) throw new Error(`[${locale}] 自检没有向 ComfyUI 提交 /prompt`)
    for (const prompt of submitted) {
      const bad = violations(prompt)
      console.log(`  · [${locale}] /prompt: rescale_after_model=${JSON.stringify(prompt['7']?.inputs?.rescale_after_model)} bit_depth=${JSON.stringify(prompt['4']?.inputs?.bit_depth)} ${bad.length ? `❌ ${bad.join(', ')}` : '✅ 过类型敏感校验'}`)
      if (bad.length) throw new Error(`[${locale}] /prompt 里的 combo 值过不了 ComfyUI 的校验：${bad.join(', ')}`)
    }
    console.log(`✅ [${locale}] 通过`)
  } finally {
    await app?.close().catch(() => {})
    fake.close()
  }
}

let failed = false
for (const locale of ['zh-CN', 'en']) {
  await walk(locale).catch((error) => { failed = true; console.error(`❌ ${error.message}`) })
}
if (failed) process.exit(1)
