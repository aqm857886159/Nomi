// 模型框整理的真实旅程（2026-09-11 用户拍板的三件事，一次走完）：
//   设置里把一个模型往上挪 → 藏掉一个 → 回画布打开模型框（顺序对、藏的不在、脚注说清藏了几个）
//   → 点另一家供应商的标签 → 切走再切回 → 真实生成一次，证明请求确实发到了**手点过的那一家**。
//
// 为什么最后要真生成：chip 高亮只证明「屏幕上写着 Kie」，证明不了「真的走了 Kie」。
// 两家供应商各起一个 loopback 服务器，落在哪一个上是**不可辩驳**的判据。
// 外部供应商只由隔离 loopback 代替；Electron、IPC、设置持久化、选择器、付费确认、生成走生产路径。
//
// 产出的截图直接落在方案的证据目录里（docs/plan/2026-09-11-model-box-tidy-evidence/after-*.png，
//   含 after-settings-two-lists.png：两张表同屏，对应样张 Main.dc.html 的取景），
// 与拍板样张 Main.dc.html / PickerAfter.dc.html 摆一起逐项对账。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'docs/plan/2026-09-11-model-box-tidy-evidence')
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-model-box-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-09-11T00:00:00.000Z'
const VENDORS = [{ key: 'apimart', name: 'APIMart' }, { key: 'kie', name: 'Kie' }]
// 三个模型：两家都有的两个（能点标签换家），一家独有的一个（拿它做隐藏）。
const MODELS = [
  { modelKey: 'model-box-alpha', label: '模型框 Alpha', vendors: ['apimart', 'kie'] },
  { modelKey: 'model-box-beta', label: '模型框 Beta', vendors: ['apimart', 'kie'] },
  { modelKey: 'model-box-gamma', label: '模型框 Gamma', vendors: ['apimart'] },
]
const imageBytes = fs.readFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-4.jpg'))
const imageDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`
const wireCalls = []

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve({}) } })
  })
}
// 一家一个服务器：请求落在哪个端口上，就是它真的走了哪一家——这一条没有第二种解释。
function vendorServer(vendorKey) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/images/generations') {
      res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'route not found' } })); return
    }
    const body = await readJsonBody(req)
    wireCalls.push({ vendorKey, model: String(body.model || '') })
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ url: imageDataUrl }] }))
  })
}
const servers = Object.fromEntries(VENDORS.map(({ key }) => [key, vendorServer(key)]))
const ports = {}
for (const { key } of VENDORS) {
  await new Promise((resolve) => servers[key].listen(0, '127.0.0.1', resolve))
  ports[key] = servers[key].address().port
}

function imageMapping(vendorKey, modelKey) {
  return {
    id: `${vendorKey}-${modelKey}-text_to_image`, vendorKey, modelKey, taskKind: 'text_to_image', name: `${vendorKey} ${modelKey}`, enabled: true,
    create: {
      method: 'POST', path: '/v1/images/generations', headers: { 'Content-Type': 'application/json' },
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}' },
      response_mapping: { image_url: 'data.0.url' }, defaultParams: { size: '1024x1024' },
    }, createdAt: NOW, updatedAt: NOW,
  }
}
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 12,
  vendors: VENDORS.map(({ key, name }) => ({ key, name, enabled: true, baseUrlHint: `http://127.0.0.1:${ports[key]}`, authType: 'none', providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW })),
  models: MODELS.flatMap((model) => model.vendors.map((vendorKey) => ({
    modelKey: model.modelKey, vendorKey, labelZh: model.label, kind: 'image', enabled: true, published: true,
    publishedModes: ['text_to_image'], meta: { archetypeId: 'agnes-image', canonicalModelId: model.modelKey }, createdAt: NOW, updatedAt: NOW,
  }))),
  mappings: MODELS.flatMap((model) => model.vendors.map((vendorKey) => imageMapping(vendorKey, model.modelKey))),
  apiKeysByVendor: Object.fromEntries(VENDORS.map(({ key }) => [key, { vendorKey: key, apiKey: `model-box-${key}`, enc: 'plain', enabled: true, createdAt: NOW, updatedAt: NOW }])),
}, null, 2))

// 真生成那一步要等「提交 → 调度 → 供应商回图 → 落盘 → 节点转 success」这一串，比单个界面动作长一档。
// 走同一份预算函数按操作数要额度（`_station-budget.mjs`），不自己拍一个墙钟：
// 它是**安全上限不是完成条件**（完成条件是下面 waitForFunction 里的 data-status），
// 并行满载时整份预算一起放大，这一档不会单独变成最先炸的那个。
const GENERATION_TIMEOUT_MS = stationTimeout({ operations: 4 })
const check = (condition, message) => { if (!condition) throw new Error(`WALK FAIL: ${message}`); console.log(`  ✓ ${message}`) }
const snap = async (win, name, target = win) => { await screenshotSettled(target, { path: path.join(shotsDir, name) }); console.log(`  · ${name}`) }
// 浮层（Mantine portal + fixed 定位）按 locator 截图会卡在「element is not visible」——
// keepMounted 的那份隐藏副本也匹配同一个选择器。改成量出可见那份的矩形再整屏 clip。
const snapClip = async (win, selector, name) => {
  const box = await win.evaluate((sel) => {
    const visible = [...document.querySelectorAll(sel)].filter((node) => node.getBoundingClientRect().width > 20)
    const rect = visible[visible.length - 1]?.getBoundingClientRect()
    return rect ? { x: Math.max(0, rect.x - 8), y: Math.max(0, rect.y - 8), width: rect.width + 16, height: rect.height + 16 } : null
  }, selector)
  if (!box) throw new Error(`WALK FAIL: 截 ${name} 时没找到可见的 ${selector}`)
  await screenshotSettled(win, { path: path.join(shotsDir, name), clip: box })
  console.log(`  · ${name}`)
}
const dismissFirstRun = async (win) => {
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload(); await win.waitForTimeout(1200)
}
const openSettings = async (win) => {
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'ai' } })))
  await win.locator('[data-settings-page="ai"], [data-settings-section="ai-models"]').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const section = win.locator('[data-model-box-order]')
  await section.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await section.scrollIntoViewIfNeeded()
  return section
}
const closeSettings = async (win) => {
  await win.locator('[data-settings-close]').first().click().catch(() => win.keyboard.press('Escape'))
  await win.waitForTimeout(500)
}
// 等的是 `role="option"`：keepMounted 留着一份隐藏副本，按 `[data-nomi-select-dropdown]` 等
// 会等到那份隐藏的（可见性永远为假），而隐藏子树里的选项根本不进可访问性树。
//
// 不要在这里先按 Escape 关浮层：Escape 会连节点的选中态一起撤掉，参数条随之收起，
// 于是下一次找「模型」那颗触发钮会干等到超时（实测踩过）。浮层的关法只有两种：
// 选中某一行（选完自动关），或者再点一次触发钮（closeModelPicker）。
const openModelPicker = async (win) => {
  const node = win.locator('[data-kind="image"][data-node-id]').last()
  await node.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await node.locator('button[aria-label="模型"]').first().click({ timeout: DEFAULT_TIMEOUT_MS })
  await win.getByRole('option').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  return node
}
const closeModelPicker = async (win) => {
  await win.locator('[data-kind="image"][data-node-id]').last().locator('button[aria-label="模型"]').first().click({ timeout: DEFAULT_TIMEOUT_MS })
  await win.waitForTimeout(300)
}
const optionLabels = async (win) => {
  const rows = win.getByRole('option')
  await rows.first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  return (await rows.allInnerTexts()).map((text) => text.trim())
}
const activeChipOf = async (win, label) => {
  const row = win.getByRole('option').filter({ hasText: label }).first()
  await row.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  return row.locator('button[aria-pressed="true"]').first().innerText()
}
const spendDialog = async (win) => {
  const dialog = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成/ }).last()
  await dialog.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  return dialog
}

let app
let win
try {
  ({ app, win } = await launchNomiApp({ name: 'model-box-tidy', userDataDir, settingsDir, projectsDir, syntheticCredentialStorage: true, args: ['--no-proxy-server'], settleMs: 1200 }))
  await dismissFirstRun(win)
  // 目录（含两家的 key）由 settingsDir 里那份 model-catalog.json 预埋，**不**走渲染层写 key 的路径：
  // 那条路要求供应商能真的被预检验证（authType:'none' 的 loopback 家过不去，见
  // validateCandidateCredential），而这条旅程要考的不是接入流程，是接入之后模型框怎么排。
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: DEFAULT_TIMEOUT_MS }); await win.waitForTimeout(2200)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: DEFAULT_TIMEOUT_MS }); await win.waitForTimeout(1000)

  // ── ① 设置里排序 + 隐藏 ──
  let section = await openSettings(win)
  // 拍板样张 Main.dc.html 的取景就是这一屏：两张表上下相邻。先把这一屏拍下来，
  // 否则「上面那张表」在证据里只以文字形式存在——对账对不上图。
  const vendorSection = win.locator('[data-vendor-preference-order]')
  await vendorSection.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await vendorSection.scrollIntoViewIfNeeded()
  const twoListTitles = await win.locator('[data-vendor-preference-order] h3, [data-model-box-order] h3').allInnerTexts()
  check(twoListTitles[0]?.trim() === '同一个模型多家都有，默认走哪家' && twoListTitles[1]?.trim() === '模型框里显示哪些、排在哪',
    `两张表的标题与拍板样张逐字一致（${twoListTitles.map((text) => text.trim()).join(' / ')}）`)
  await snap(win, 'after-settings-two-lists.png', win.locator('[data-settings-dialog]'))
  await section.scrollIntoViewIfNeeded()
  const rowIds = async () => section.locator('[data-model-box-row]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-model-box-row')))
  const before = await rowIds()
  // 隔离 profile 上本来就有内置种子模型（即梦会员等免鉴权的家），所以断言只钉**我们这三个**的
  // 相对位置，不钉整张表——把别人的行也钉死只会让这条走查在目录一变就红，而那不是回归。
  const betaIndex = before.indexOf('model-box-beta')
  check(betaIndex > 0 && before[betaIndex - 1] === 'model-box-alpha',
    `三个 fixture 模型都在列表里，且 Beta 紧跟在 Alpha 后面（共 ${before.length} 行）`)
  check(before.includes('model-box-gamma'), '一家独有的那个模型也在列表里')
  check(await section.locator('[data-model-box-hidden-group]').count() === 0, '还没藏过东西时不出现「已隐藏」那一组')

  // 把 Beta 往上挪一位——「排序即时生效、肉眼可验」是这个控件唯一的反馈。
  await section.locator('[data-model-box-row]').nth(betaIndex).getByRole('button', { name: /上移|Move up/ }).click()
  await win.waitForTimeout(400)
  const afterMove = await rowIds()
  check(afterMove[betaIndex - 1] === 'model-box-beta' && afterMove[betaIndex] === 'model-box-alpha',
    `上移生效：Alpha , Beta → ${afterMove.slice(betaIndex - 1, betaIndex + 1).join(' , ')}`)

  await section.locator('[data-model-box-row="model-box-gamma"]').getByRole('button', { name: /^隐藏$|^Hide$/ }).click()
  await win.waitForTimeout(400)
  check(await section.locator('[data-model-box-row="model-box-gamma"]').count() === 0, '隐藏后这一行离开主列表')
  const hiddenGroup = section.locator('[data-model-box-hidden-group]')
  check(await hiddenGroup.locator('[data-model-box-hidden-row="model-box-gamma"]').count() === 1, '隐藏的模型进了「已隐藏」组，能找回来（不是删除）')
  // 截**整个设置弹窗**而不是这一块 section：section 比弹窗内容区高，按元素截会把弹窗外面的画布
  // 一起截进来，拍出一张「设置面板下面怎么是画布」的怪图（第一版就是那样）。
  await snap(win, 'after-settings-model-box.png', win.locator('[data-settings-dialog]'))
  await hiddenGroup.scrollIntoViewIfNeeded()
  await snap(win, 'after-settings-hidden-group.png', win.locator('[data-settings-dialog]'))
  const orderedIds = await rowIds()
  await closeSettings(win)

  // ── ② 回画布：模型框按设置来 ──
  await win.locator('[aria-label="添加图片节点"]').first().click({ timeout: DEFAULT_TIMEOUT_MS }); await win.waitForTimeout(800)
  const node = await openModelPicker(win)
  const nodeId = await node.getAttribute('data-node-id')
  const labels = await optionLabels(win)
  // 同样只比**我们这三个**的相对次序：它必须和刚才在设置里排出来的一模一样。
  const fixtureLabels = new Set(MODELS.map((model) => model.label))
  const expectedLabels = orderedIds
    .map((id) => MODELS.find((model) => model.modelKey === id)?.label)
    .filter((label) => Boolean(label))
  const actualLabels = labels.filter((label) => [...fixtureLabels].some((name) => label.includes(name)))
    .map((label) => [...fixtureLabels].find((name) => label.includes(name)))
  check(actualLabels.join(' | ') === expectedLabels.join(' | '),
    `模型框顺序 = 设置里排的顺序（${actualLabels.join(' | ')}）`)
  // 阳性对照先立住：这个下拉本来就列得出模型行，「找不到 Gamma」才是数据而不是空探针。
  const allOptions = win.getByRole('option')
  const optionProof = await proveProbe(allOptions, '模型框里本来就列得出模型行')
  await expectAbsent(allOptions.filter({ hasText: '模型框 Gamma' }), {
    provenBy: optionProof,
    message: '藏起来的模型在模型框里一行都不出现',
  })
  console.log('  ✓ 藏起来的模型在模型框里一行都不出现')
  const note = await win.locator('[data-nomi-select-hidden-note]').last().innerText()
  check(/已隐藏\s*1\s*个/.test(note), `模型框底部说清藏了几个：「${note.trim()}」`)
  // 滚到这次真正在考的那两行再截：不滚的话截到的是列表顶上那几个内置模型，
  // 「Beta 排在 Alpha 前面」这件事在图里根本看不见。
  await win.getByRole('option').filter({ hasText: '模型框 Alpha' }).first().scrollIntoViewIfNeeded()
  await snapClip(win, '[data-nomi-select-dropdown]', 'after-picker-model-box.png')

  // ── ③ 手点另一家 → 切走再切回 → 还听我的 ──
  const alphaRow = win.getByRole('option').filter({ hasText: '模型框 Alpha' }).first()
  check(await activeChipOf(win, '模型框 Alpha') === 'APIMart', '手点之前，Alpha 走的是全局顺序里的第一家 APIMart')
  // 点标签换家：浮层**留在原地**（换完还能接着看），所以下一步直接在同一张浮层里选别的模型。
  await alphaRow.getByRole('button', { name: 'Kie' }).click()
  await win.waitForTimeout(500)
  // 切走：选另一个模型，让 (value, vendor) 真的离开 Alpha —— 不离开的话「记住」根本没被考问。
  await win.getByRole('option').filter({ hasText: '模型框 Beta' }).first().click()
  await win.waitForTimeout(600)
  // 切回：这一次由 pickHealthiestProvider 决定走哪家，记忆就是在这里起作用的。
  await openModelPicker(win)
  await win.getByRole('option').filter({ hasText: '模型框 Alpha' }).first().click()
  await win.waitForTimeout(600)
  await openModelPicker(win)
  check(await activeChipOf(win, '模型框 Alpha') === 'Kie', '切走再切回，Alpha 仍停在手点过的 Kie')
  // 阴性对照：从没手点过的 Beta 仍遵循全局顺序（证明记忆只作用在被点过的那个模型上）。
  check(await activeChipOf(win, '模型框 Beta') === 'APIMart', '从没手点过的模型仍按全局顺序走 APIMart（记忆没有波及别人）')
  await win.getByRole('option').filter({ hasText: '模型框 Alpha' }).first().scrollIntoViewIfNeeded()
  await snapClip(win, '[data-nomi-select-dropdown]', 'after-picker-remembered.png')
  await closeModelPicker(win)

  // ── ④ 真生成一次：请求落在哪一家，是「记住」唯一不可辩驳的证据 ──
  const currentNode = win.locator('[data-kind="image"][data-node-id]').last()
  const promptEditor = currentNode.locator('div[contenteditable="true"]').last()
  await promptEditor.click(); await promptEditor.fill('模型框整理真实生成验收图')
  await currentNode.locator('button[aria-label="生成素材"]').first().click({ timeout: DEFAULT_TIMEOUT_MS })
  const dialog = await spendDialog(win)
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await win.waitForFunction((id) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-status') === 'success', nodeId, { timeout: GENERATION_TIMEOUT_MS })
  check(wireCalls.length === 1 && wireCalls[0].vendorKey === 'kie' && wireCalls[0].model === 'model-box-alpha',
    `真实生成请求发到了手点过的那一家（${JSON.stringify(wireCalls)}）`)

  // ── ⑤ 找回：藏起来不是删除 ──
  section = await openSettings(win)
  await section.locator('[data-model-box-hidden-row="model-box-gamma"]').getByRole('button', { name: /^显示$|^Show$/ }).click()
  await win.waitForTimeout(400)
  check(await section.locator('[data-model-box-row="model-box-gamma"]').count() === 1, '在设置里一步就能把藏起来的模型找回来')
  await closeSettings(win)
  await openModelPicker(win)
  check((await optionLabels(win)).some((label) => label.includes('模型框 Gamma')), '找回之后它又回到了模型框里')
  check(await win.locator('[data-nomi-select-hidden-note]').count() === 0, '一个都没藏时，模型框底部不再多出那行脚注')

  console.log('model box tidy journey passed')
} finally {
  await app?.close().catch(() => {})
  for (const { key } of VENDORS) await new Promise((resolve) => servers[key].close(resolve))
}
