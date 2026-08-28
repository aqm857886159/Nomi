// R13 真机走查：ComfyUI「工作流设置」整页（2026-08-12 用户拍板样张）。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 治的是 2026-08-11 那次反馈的体验根源：以前配一条工作流，是在 320px 窄栏里对着
// 「#110 CLIPTextEncode」猜哪个是提示词。这条走查就是要**用眼睛确认**现在不用猜了。
//
// 场景（一条真实用户任务，不是功能探索）：
//   ① 设置 → 模型 tab → 本地 ComfyUI → 导入一条 LTX 工作流
//   ② 点工作流那一行 → 进整页：左栏后端/工作流列表/画布预览，右侧节点图
//   ③ 在图上**认出**提示词节点（角色胶囊 + 颜色，不用读 class_type 猜）
//   ④ 点另一个文本节点 #109 → 指定成提示词
//   ⑤ 左栏「画布节点预览 · 实时」跟着变：提示词槽改标 #109
//   ⑥ 把一个常量节点的输入暴露成画布字段 → 预览多一个控件 → 保存
// 截图人眼判断（R13：不是 expect 断言，是自己 Read 那几张 png 亲眼看）。
// 用法：pnpm build && node scripts/comfyui-workflow-page-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-workflow-page-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// LTX 常量节点形态（同 comfyuiWorkflowGraphView.test.ts / comfyui-workflow-params-walkthrough.mjs
// 的固件，取自真实模板展开后的形状——不自己编节点名，这仓库栽过）。
// #110 会被自动识别成提示词，#109 是第二个文本节点（场景④要改绑到它）。
const LTX_GRAPH = JSON.stringify({
  108: { class_type: 'LTXVImgToVideo', inputs: { width: ['292', 0], height: ['293', 0], length: ['287', 0], positive: ['110', 0], image: ['200', 0] } },
  110: { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: 'default prompt', clip: ['111', 0] } },
  109: { class_type: 'CLIPTextEncode', _meta: { title: '反向提示词' }, inputs: { text: 'a second text encode', clip: ['111', 0] } },
  111: { class_type: 'CLIPLoader', inputs: { clip_name: 't5xxl_fp16.safetensors' } },
  200: { class_type: 'LoadImage', inputs: { image: 'start.png' } },
  285: { class_type: 'PrimitiveFloat', _meta: { title: 'FPS' }, inputs: { value: 24 } },
  287: { class_type: 'SimpleCalculatorKJ', inputs: { a: ['291', 0], b: ['285', 0], operation: 'multiply' } },
  291: { class_type: 'INTConstant', _meta: { title: 'LENGTH (in seconds)' }, inputs: { value: 5 } },
  292: { class_type: 'INTConstant', _meta: { title: 'WIDTH' }, inputs: { value: 960 } },
  293: { class_type: 'INTConstant', _meta: { title: 'HEIGHT' }, inputs: { value: 544 } },
  300: { class_type: 'SaveVideo', inputs: { video: ['108', 0], filename_prefix: 'ltx' } },
})

// 本机「已装」能力：全齐（缺件状态那一路已有 comfyui-reconcile-walkthrough 专门走查，这里不重复）。
const OBJECT_INFO = {
  LTXVImgToVideo: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  CLIPLoader: { input: { required: { clip_name: [['t5xxl_fp16.safetensors']] } } },
  LoadImage: { input: { required: { image: [['start.png']] } } },
  PrimitiveFloat: { input: { required: {} } },
  SimpleCalculatorKJ: { input: { required: {} } },
  INTConstant: { input: { required: {} } },
  SaveVideo: { input: { required: {} } },
}

/** 试跑收到的 /prompt 提交（场景⑨要检查它真到了 ComfyUI，且带上了用户填的值）。 */
const submitted = []

const mock = http.createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/features')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ supports_preview_metadata: true }))
    return
  }
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
  if (req.method === 'POST' && url.startsWith('/prompt')) {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try { submitted.push(JSON.parse(raw || '{}')) } catch { /* 形状不对也记一笔失败，下面断言会报 */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prompt_id: 'wf-test-1', number: 1 }))
    })
    return
  }
  if (url.startsWith('/history/wf-test-1')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 'wf-test-1': { status: { status_str: 'success', completed: true }, outputs: { 300: { gifs: [{ filename: 'ltx.mp4', subfolder: '', type: 'output' }] } } } }))
    return
  }
  if (url.startsWith('/view')) {
    res.writeHead(200, { 'Content-Type': 'video/mp4' })
    res.end(Buffer.from('00000018667479706d70343200000000', 'hex'))
    return
  }
  console.log(`  ⚠️ mock 未实现的请求：${req.method} ${url}`)
  res.writeHead(404); res.end()
})
await new Promise((r) => mock.listen(8188, '127.0.0.1', r))

const { app, win } = await launchNomiApp({
  name: 'comfyui-workflow-page',
  settingsDir: mkdtempSync(path.join(os.tmpdir(), 'comfyui-wf-page-set-')),
  projectsDir: mkdtempSync(path.join(os.tmpdir(), 'comfyui-wf-page-proj-')),
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const errors = []
const zhOrEn = (zh, en) => new RegExp(`${zh}|${en}`, 'i')
/** 整页里的实时预览文本——场景⑤靠它证明「改图 → 预览跟着变」。 */
const previewText = () => win.evaluate(() => {
  const el = document.querySelector('[data-workflow-preview]')
  return el ? el.innerText : ''
})
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  // ── ① 设置 → 模型 tab → 启用 ComfyUI → 导入一条工作流 ──
  await win.getByRole('button', { name: /^(?:设置|Settings)$/i, exact: true }).first().click()
  await win.waitForTimeout(900)
  await win.getByRole('button', { name: /^(?:模型|Models)$/i, exact: true }).first().click()
  await win.waitForTimeout(900)
  await win.locator('[data-model-home-available^="comfyui"]').first().click()
  await win.waitForTimeout(500)
  await win.locator('[data-model-settings-page="connection"][data-model-settings-vendor^="comfyui"]').first().waitFor()
  await win.waitForTimeout(400)
  await win.getByRole('button', { name: zhOrEn('启用 ComfyUI', 'Enable ComfyUI'), exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.locator('[data-model-settings-page="connection"][data-model-settings-vendor^="comfyui"]').first().waitFor()
  await win.waitForTimeout(600)
  const enhancedModeVisible = await win.getByText(zhOrEn('增强模式', 'Enhanced mode'), { exact: false }).count()
  if (enhancedModeVisible === 0) throw new Error('探测到 /features 后连接卡没有显示增强模式')
  await shot(win, '00-card-enhanced-mode.png') // 验：已连接 + 增强模式 + Python/显卡摘要，文本不重叠
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 900, height: 720 })).catch(() => {})
  await win.waitForTimeout(500)
  const viewport = await win.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  if (viewport.scrollWidth > viewport.width + 1) throw new Error(`窄窗口出现水平滚动：${JSON.stringify(viewport)}`)
  await shot(win, '00b-card-enhanced-mode-narrow.png')
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  await win.waitForTimeout(500)

  await win.getByRole('button', { name: zhOrEn('导入自定义工作流', 'Import custom workflow'), exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: zhOrEn('ComfyUI 工作流 JSON', 'ComfyUI workflow JSON') }).fill(LTX_GRAPH)
  await win.getByRole('button', { name: zhOrEn('分析工作流', 'Analyze workflow'), exact: true }).click()
  await win.waitForTimeout(900)
  await win.getByPlaceholder(zhOrEn('给它起个名', 'Name this workflow'), { exact: false }).fill('LTX 图生视频')
  await win.getByRole('button', { name: zhOrEn('导入', 'Import'), exact: true }).click()
  await win.waitForTimeout(1400)
  await shot(win, '01-card-workflow-row.png') // 验：卡里出现工作流行，整行可点（右侧有 › ）

  // ── ② 点工作流那一行 → 进整页 ──
  // 导入后卡会重挂、默认收起 → 先确保工作流行可见。
  if (!(await win.getByText('LTX 图生视频', { exact: false }).first().isVisible().catch(() => false))) {
    await win.locator('[data-model-home-available^="comfyui"]').first().click()
    await win.waitForTimeout(600)
  }
  await win.waitForTimeout(3200) // 等成功 toast 消退（toast 文本含模型名，会抢走定位）
  await win.getByRole('button', { name: zhOrEn('打开「LTX 图生视频」的工作流设置', 'Open workflow settings for'), exact: false }).first().click()
  await win.waitForTimeout(1500)
  await shot(win, '02-workflow-page.png') // 验：占满屏；左栏 后端/工作流/画布预览；右侧节点图 + 连线

  const pageOpen = await win.locator('[data-comfyui-workflow-page]').count()
  if (pageOpen === 0) throw new Error('整页没打开——工作流行没能进到工作流设置')

  // ── ③ 图上认得出提示词节点（不用读 class_type 猜）──
  const graphText = await win.evaluate(() => {
    const el = document.querySelector('[data-workflow-graph]')
    return el ? el.innerText : ''
  })
  for (const alternatives of [['提示词', 'Prompt'], ['成品', 'Output'], ['#110'], ['#300']]) {
    if (!alternatives.some((needle) => graphText.includes(needle))) {
      throw new Error(`节点图里没有「${alternatives.join('/')}` + '」——图上认不出角色')
    }
  }
  console.log('  图上直接标出了角色（提示词/成品）: ✓')

  const before = await previewText()
  if (!before.includes('#110')) throw new Error(`左栏预览没标出提示词来自 #110：\n${before}`)

  // ── ④ 点另一个文本节点 #109 → 指定成提示词 ──
  await win.locator('[data-node-id="109"]').first().click()
  await win.waitForTimeout(500)
  await shot(win, '03-node-menu.png') // 验：菜单两段——「在画布上当」+「变成画布上的可调字段」
  await win.getByRole('menuitemradio', { name: zhOrEn('提示词', 'Prompt'), exact: false }).first().click()
  await win.waitForTimeout(600)
  await shot(win, '04-role-reassigned.png') // 验：#109 变成提示词色，#110 的角色胶囊消失

  // ── ⑤ 左栏实时预览跟着变（这条页面存在的理由）──
  const after = await previewText()
  if (!after.includes('#109')) throw new Error(`改绑后左栏预览没跟着变（还停在旧节点上）：\n${after}`)
  if (after.includes('#110')) throw new Error(`改绑后左栏预览仍指向旧的提示词节点 #110：\n${after}`)
  console.log('  改图上的角色 → 左栏画布预览当场跟着变: ✓')

  // ── ⑥ 暴露一个可调字段 → 预览多一个控件 → 保存 ──
  await win.locator('[data-node-id="292"]').first().click()
  await win.waitForTimeout(500)
  await win.getByRole('menuitemcheckbox', { name: 'value', exact: false }).first().click()
  await win.waitForTimeout(600)
  const withField = await previewText()
  if (!withField.includes('WIDTH')) throw new Error(`暴露的字段没出现在画布预览里：\n${withField}`)
  console.log('  把节点输入暴露成画布字段 → 预览多出这个控件: ✓')
  await shot(win, '05-field-exposed.png') // 验：#292 右下角「1 已用」角标；左栏多一个 WIDTH 输入框

  await win.locator('[data-workflow-save]').first().click()
  await win.waitForTimeout(1200)
  await shot(win, '06-saved.png') // 验：保存成功 toast；标题栏「未保存的改动」消失

  const headerText = await win.evaluate(() => {
    const el = document.querySelector('[data-comfyui-workflow-page]')
    return el ? el.innerText : ''
  })
  if (headerText.includes('有未保存的改动')) throw new Error('保存后仍显示「有未保存的改动」')
  console.log('  保存落库、脏标记清掉: ✓')

  // ── ⑦ 兜底：图放不下时的完整节点列表，同样能点、能指定角色 ──
  await win.getByRole('button', { name: zhOrEn('显示完整节点列表', 'Show full node list'), exact: false }).first().click()
  await win.waitForTimeout(700)
  await shot(win, '07-node-list-fallback.png') // 验：列表形态，每行带 #id / 标题 / 角色胶囊

  // ── ⑧ 真落库了没：退出整页 → 重新进 → 改动还在吗 ──
  // 「界面上不再显示未保存」只证明脏标记被清了，证不了写进目录。必须重进一次才算数（P3 全绿≠完成）。
  await win.getByRole('button', { name: zhOrEn('返回设置', 'Back to settings'), exact: false }).first().click()
  await win.waitForTimeout(900)
  if ((await win.locator('[data-comfyui-workflow-page]').count()) !== 0) throw new Error('点「返回设置」没退出整页')
  await win.getByRole('button', { name: zhOrEn('打开「LTX 图生视频」的工作流设置', 'Open workflow settings for'), exact: false }).first().click()
  await win.waitForTimeout(1600)
  const reopened = await previewText()
  if (!reopened.includes('#109')) throw new Error(`重进后提示词绑定没留住（回到了旧节点）：\n${reopened}`)
  if (!reopened.includes('WIDTH')) throw new Error(`重进后暴露的画布字段没留住：\n${reopened}`)
  await shot(win, '08-reopened-persisted.png') // 验：提示词仍来自 #109、WIDTH 字段仍在、无「未保存」
  console.log('  改动真写进目录（退出重进仍在）: ✓')

  // ── ⑨ 绑了首帧的工作流：「运行测试」必须**禁用并说清为什么**（§1.6 C1/C4）──
  // 试跑不带素材，image_to_video 没图发不出去。让用户点了才撞上一句看不懂的失败 = 沟通死路。
  const runButton = win.locator('[data-workflow-test-run]').first()
  if (await runButton.isEnabled()) throw new Error('绑了首帧却仍可点「运行测试」——点下去必然报缺少参考图')
  const blockedReason = await runButton.locator('xpath=..').getAttribute('title')
  if (!blockedReason || !blockedReason.includes('首帧')) {
    throw new Error(`「运行测试」被禁用却没说清为什么（title=${JSON.stringify(blockedReason)}）`)
  }
  await shot(win, '09-run-blocked-explains-why.png') // 验：按钮灰掉；hover 有一句人话解释
  console.log('  绑了首帧时试跑禁用且说清原因: ✓')

  // ── ⑩ 解绑首帧 → 变成纯文生视频 → 试跑真提交，且值填进正确的节点 ──
  await win.locator('[data-node-id="200"]').first().click()
  await win.waitForTimeout(500)
  await win.getByRole('menuitemradio', { name: zhOrEn('首帧', 'First frame'), exact: false }).first().click() // 再点一次 = 取消
  await win.waitForTimeout(600)
  await win.locator('[data-workflow-preview] textarea').first().fill('走查用的提示词')
  await win.locator('[data-workflow-preview] input').last().fill('768')
  await win.waitForTimeout(300)
  if (!(await runButton.isEnabled())) throw new Error('解绑首帧后「运行测试」仍不可点')
  await runButton.click()
  await win.waitForTimeout(3000)
  await shot(win, '10-test-run.png') // 验：提交成功 toast「已提交给 ComfyUI…」
  if (submitted.length === 0) throw new Error('点了「运行测试」但 ComfyUI 没收到任何 /prompt 提交')
  const graphSent = submitted[0]?.prompt ?? {}
  console.log('  提交给 ComfyUI 的图（节选）：', JSON.stringify({ 109: graphSent['109'], 292: graphSent['292'], 287: graphSent['287'] }))
  const promptText = graphSent['109']?.inputs?.text
  const widthValue = graphSent['292']?.inputs?.value
  if (promptText !== '走查用的提示词') {
    throw new Error(`试跑没把提示词填进**用户改绑的那个节点** #109（实收 ${JSON.stringify(promptText)}）`)
  }
  if (String(widthValue) !== '768') {
    throw new Error(`试跑没把画布字段的值填进 #292（实收 ${JSON.stringify(widthValue)}）`)
  }
  console.log('  试跑把提示词/字段值填进了正确的节点: ✓')

  // 试跑内部会先保存 → 触发目录重查。**用户刚填的值不许被这次重查冲掉**
  // （栽过：点完运行测试，提示词框和参数值当场清空，看起来像输入丢了）。
  // ⚠️ 必须读控件的 value：innerText 拿不到 input/textarea 的内容，用它断言会永远「看起来是空的」。
  const promptLeft = await win.locator('[data-workflow-preview] textarea').first().inputValue()
  const widthLeft = await win.locator('[data-workflow-preview] input').last().inputValue()
  if (promptLeft !== '走查用的提示词' || widthLeft !== '768') {
    throw new Error(`试跑后用户填的值被清空了（保存触发的重查把编辑器重置了）：提示词=${JSON.stringify(promptLeft)} 宽=${JSON.stringify(widthLeft)}`)
  }
  console.log('  试跑后用户填的值还在（重查没冲掉编辑器）: ✓')

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
