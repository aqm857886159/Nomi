// 真机验收：本机 ComfyUI 在 127.0.0.1:8188 跑着，像真人一样只走界面，把
// 「导入工作流 → 认证晋级 → 实例已启用 → 画布选得到 → 真出一张图」整条跑通。
//
// 为什么住在 scripts/ 而不是 tests/ux/：它要一台真的 ComfyUI（模型 2GB、出图 20s+），
// CI 上没有。同目录的 comfyui-real-server-verify.mjs 是同一类，沿用既有约定。
//
// 跑法（先 pnpm run build）：
//   node scripts/comfyui-certification-acceptance.mjs
//   COMFY_BASE_URL=http://127.0.0.1:8188 node scripts/comfyui-certification-acceptance.mjs
//
// 断言（任一条红就整趟红，退出码 1）：
//   A. 导入并确认后，会话不再是 certification_unavailable
//   B. ComfyUI 实例在界面上变成「已启用」，且 catalog 里这条工作流 enabled
//   C. ComfyUI 的 /history 里出现了 Nomi 发的那条 /prompt（基线之外的新条目）
//   D. 画布的模型选择器里选得到这条 ComfyUI 工作流
//   E. 点生成后画布上真出来一张图（产物文件落盘）
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { screenshotSettled } from '../tests/ux/_assert.mjs'

const BASE_URL = process.env.COMFY_BASE_URL || 'http://127.0.0.1:8188'
const EVID = path.join(repoRoot, 'docs/plan/2026-09-11-comfyui-cert-evidence')
const WORKFLOW = path.join(EVID, 'sd15-txt2img-api.json')
const NAME = '验收 文生图'
const PROMPT = 'a red apple on a wooden table'

fs.mkdirSync(EVID, { recursive: true })

const failures = []
const record = (label, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

/** ComfyUI 侧收到的正向提示词（每条 history 的第一个 CLIPTextEncode）。 */
async function comfyPromptTexts() {
  const res = await fetch(`${BASE_URL}/history`)
  if (!res.ok) throw new Error(`ComfyUI /history ${res.status}`)
  const history = await res.json()
  return Object.values(history).flatMap((entry) => {
    const graph = entry?.prompt?.[2] ?? {}
    return Object.values(graph)
      .filter((node) => node?.class_type === 'CLIPTextEncode')
      .map((node) => String(node?.inputs?.text ?? ''))
  })
}
async function comfyHistoryIds() {
  const res = await fetch(`${BASE_URL}/history`)
  if (!res.ok) throw new Error(`ComfyUI /history ${res.status}`)
  return Object.keys(await res.json())
}

const baselinePromptIds = await comfyHistoryIds()
console.log(`ComfyUI ${BASE_URL} · /history 基线 ${baselinePromptIds.length} 条`)

const tempRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'comfy-cert-accept-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
console.log(`PROFILE=${tempRoot}`)

const { app, win } = await launchNomiApp({
  name: 'comfy-cert-accept',
  tempRoot,
  settingsDir,
  projectsDir,
  settleMs: 2000,
})
win.setDefaultTimeout(30_000)
win.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) console.log(`  RENDERER-${m.type()}: ${m.text().slice(0, 300)}`)
})
win.on('pageerror', (e) => console.log(`  PAGEERROR: ${String(e).slice(0, 300)}`))

// 证据一律 after-* 前缀：同目录里修复前那批（已删）和修复后这批不许混在一起。
const snap = async (n) => {
  await screenshotSettled(win, { path: path.join(EVID, `after-${n}.png`) })
  console.log(`  shot: after-${n}.png`)
}
const bodyText = () => win.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'))

function readSessions() {
  // 会话落在 capability 目录（<tempRoot>/capability），不是 settings 下。
  const file = path.join(tempRoot, 'capability', 'integration-sessions.json')
  if (!fs.existsSync(file)) return []
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).sessions ?? []
  } catch {
    return []
  }
}
/**
 * 点开节点参数条上的模型片。锚点取「生成素材」(↑) 按钮那一行，模型片是那行最左的按钮——
 * 这个顺序是参数条的固定形状，和当前选中的是哪个模型无关。
 */
async function clickNodeModelChip() {
  const submit = await win.getByRole('button', { name: /生成素材|重新生成/ }).first().boundingBox()
  if (!submit) throw new Error('节点参数条没渲染出来：找不到「生成素材」按钮')
  const chip = await win.locator('button').evaluateAll((els, row) => {
    const hits = els
      .map((el) => {
        const b = el.getBoundingClientRect()
        return { x: b.x, y: b.y, cx: b.x + b.width / 2, cy: b.y + b.height / 2, text: (el.innerText || '').trim() }
      })
      .filter((v) => Math.abs(v.y - row.y) < 12 && v.x < row.x && v.text)
    hits.sort((a, b) => a.x - b.x)
    return hits[0] ?? null
  }, submit)
  if (!chip) throw new Error('节点参数条里找不到模型片')
  console.log(`  节点模型片：「${chip.text.replace(/\n/g, ' ')}」`)
  await win.mouse.click(chip.cx, chip.cy)
}
/** 设置 → 模型页。确认弹层、实例详情都是这个对话框里的层，Escape 关掉整个对话框再重开最稳。 */
async function openModelsPage() {
  await win.keyboard.press('Escape')
  await win.waitForTimeout(1200)
  const entry = win.getByRole('button', { name: '连接模型' }).first()
  if (await entry.isVisible().catch(() => false)) await entry.click()
  else await win.locator('[aria-label="设置"]').first().click()
  await win.waitForTimeout(3000)
}

/**
 * 打开**拥有这条工作流**的那条 ComfyUI 连接的详情。
 * 为什么要翻：认证晋级会把工作流落在一条 candidate vendor 上，模型页因此会同时列出两条
 * 「本地 ComfyUI」，第一条不是它——按 first() 点开等于在错的那屏上做断言。
 */
async function openComfyInstanceDetailOwning(name) {
  for (let index = 0; index < 4; index += 1) {
    await openModelsPage()
    const rows = win.getByText('本地 ComfyUI', { exact: true })
    if (index >= (await rows.count())) break
    await rows.nth(index).click()
    await win.waitForTimeout(2500)
    const text = await bodyText()
    if (text.includes(name)) return { found: true, text }
  }
  return { found: false, text: await bodyText() }
}

function readCatalog() {
  const file = path.join(settingsDir, 'model-catalog.json')
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

try {
  // ── 1. 设置 → 连接模型 → 本地 ComfyUI，填地址 ───────────────────────────
  await win.getByRole('button', { name: '连接模型' }).first().click()
  await win.waitForTimeout(2500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(1500)
  await snap('01-comfy-card')

  const addr = win.locator('input[type="text"]').filter({ hasNot: win.locator('[readonly]') }).first()
  if (await addr.isVisible().catch(() => false)) {
    await addr.fill(BASE_URL)
    await win.waitForTimeout(500)
  }
  await win.getByRole('button', { name: /启用 ComfyUI/ }).first().click()
  await win.waitForTimeout(6000)
  await snap('02-after-enable')

  // ── 2. 自定义 → 粘工作流 → 分析 → 命名 → 导入 ──────────────────────────
  await win.getByRole('button', { name: '自定义' }).first().click()
  await win.waitForTimeout(1200)
  await win.locator('textarea').first().fill(fs.readFileSync(WORKFLOW, 'utf8'))
  await win.getByRole('button', { name: /^分析$/ }).first().click()
  await win.waitForTimeout(9000)
  await snap('03-analyzed')
  await win.getByPlaceholder(/给它起个名/).first().fill(NAME)
  await win.getByRole('button', { name: /^导入$/ }).first().click()
  await win.waitForTimeout(6000)
  await snap('04-confirm-gate')

  // ── 3. 确认验证：这一跳以前必炸且静默 ─────────────────────────────────
  const confirm = win.getByRole('button', { name: /^确认验证$/ }).first()
  record('确认验证按钮出现', await confirm.isVisible().catch(() => false))
  await confirm.click()

  // 认证要真跑一次 SD1.5（本机 20s 上下）。等「盘上会话到达终态」这个真信号，
  // 不是干等墙钟：每 2s 看一次落盘的 stage，最多 240s。
  let session = null
  for (let waited = 0; waited < 240_000; waited += 2000) {
    await win.waitForTimeout(2000)
    session = readSessions().at(-1) ?? null
    if (session && ['completed', 'failed', 'partial', 'cancelled'].includes(session.stage)) break
  }
  await snap('05-after-confirm')
  const reason = session?.blockingReason?.code ?? null
  console.log(`  session stage=${session?.stage} blockingReason=${reason}`)
  record('A. 会话不再 certification_unavailable', reason !== 'certification_unavailable', `stage=${session?.stage} reason=${reason}`)
  record('A2. 认证走到 completed', session?.stage === 'completed', `stage=${session?.stage}`)

  // ── 4. ComfyUI 侧的铁证：Nomi 真发过一条 /prompt ─────────────────────
  const afterIds = await comfyHistoryIds()
  const fresh = afterIds.filter((id) => !baselinePromptIds.includes(id))
  fs.writeFileSync(path.join(EVID, 'comfy-history-new-prompts.json'), JSON.stringify({ baseline: baselinePromptIds, after: afterIds, fresh }, null, 2))
  record('C. ComfyUI /history 收到 Nomi 发的 /prompt', fresh.length > 0, `新增 ${fresh.length} 条：${fresh.join(', ')}`)

  // ── 5. 实例已启用 ───────────────────────────────────────────────────
  // 这一格以前是假绿：点「关闭」连整个设置一起关掉了，于是「卡片上不再写未启用」是在一个
  // 根本没有卡片的项目库首页上判的——恒真。现在必须真的把**拥有这条工作流**的那条 ComfyUI
  // 连接的详情打开，在那一屏上断言（expectAbsent 的老坑：先证明你在你以为的现场）。
  const detail = await openComfyInstanceDetailOwning(NAME)
  await snap('06-instance-enabled')
  record('B3. 打开的是拥有这条工作流的那条连接', detail.found, detail.found ? '' : '翻遍 ComfyUI 连接都没找到它')
  const cardText = detail.text
  const catalog = readCatalog()
  const comfyVendor = catalog?.vendors?.find((v) => String(v.baseUrlHint || '').replace(/\/+$/, '') === BASE_URL)
  const comfyModel = catalog?.models?.find((m) => m.vendorKey === comfyVendor?.key && m.labelZh === NAME)
  record('B. catalog 里 ComfyUI vendor 已启用', Boolean(comfyVendor?.enabled), `vendor=${comfyVendor?.key} enabled=${comfyVendor?.enabled}`)
  record('B2. 这条工作流落盘且启用', Boolean(comfyModel?.enabled), `model=${comfyModel?.modelKey} enabled=${comfyModel?.enabled}`)
  record('B4. 实例详情里不再写「未启用」', !/未启用/.test(cardText))
  record('B5. 连接被标成「已验证」', /已验证/.test(cardText), cardText.match(/已验证|待验证|未验证/)?.[0] ?? '三种标记一个都没有')

  // ── 6. 画布：选得到这条 ComfyUI 工作流，并真出一张图 ──────────────────
  // 设置是多层对话框（模型页 → 实例详情），一次 Escape 只退一层；退不干净时首页按钮
  // 还被遮着，click 会「元素找到了但点不动」地超时 30s——所以按「点得动为止」来退。
  let entered = false
  for (let attempt = 0; attempt < 5 && !entered; attempt += 1) {
    try {
      await win.getByRole('button', { name: /新建空白项目/ }).first().click({ timeout: 4000 })
      entered = true
    } catch {
      await win.keyboard.press('Escape')
      await win.waitForTimeout(1200)
    }
  }
  if (!entered) throw new Error('设置对话框关不掉，进不了画布')
  await snap('06b-settings-closed')
  await win.waitForTimeout(8000)
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(6000)
  await snap('07-canvas')

  await win.getByRole('button', { name: /新建画面/ }).first().click().catch(() => win.mouse.click(99, 382))
  await win.waitForTimeout(5000)
  await snap('08-node-created')

  // 节点参数条的模型片 = 和「生成素材」(↑) 同一行、最左边的那个按钮。
  // 不按文案找：那颗片显示的是**当前**模型名（默认「即梦图片（会员）」，选完变成工作流名），
  // 按文案写死等于把默认模型钉进走查；也不按 `自动选` 找——那是右侧 Agent 面板的模型钮，
  // 第一版就是这么点错了地方，界面上明明有这条工作流却报「picker 里没有」（死选择器假红）。
  await clickNodeModelChip()
  await win.waitForTimeout(3500)
  await snap('09-node-model-picker')
  const pickerText = await bodyText()
  record('D. 节点模型选择器里有这条 ComfyUI 工作流', pickerText.includes(NAME), `picker 里${pickerText.includes(NAME) ? '有' : '没有'}「${NAME}」`)

  if (pickerText.includes(NAME)) {
    await win.getByText(NAME, { exact: false }).first().click()
    await win.waitForTimeout(2500)
    await snap('10-model-selected')

    // 节点自己的提示词框。三件事都栽过：
    //   ① 它不是 <textarea> 而是 contenteditable div，「描述这一帧的画面...」是画上去的占位
    //      不是 placeholder 属性——getByPlaceholder 找不到它；
    //   ② `locator('textarea').first()` 会命中右侧 Agent 面板那个真 textarea（x≈886），
    //      于是提示词填进了聊天框、节点仍是空的；
    //   ③ 空提示词照样能出图（SD1.5 对空串也画），所以不回读就永远发现不了前两条。
    const promptBox = win.locator('[contenteditable="true"]:visible').first()
    const promptBox2 = await promptBox.boundingBox()
    if (!promptBox2 || promptBox2.x > 870) throw new Error(`找到的提示词框不在节点上（x=${promptBox2?.x}）`)
    await promptBox.click()
    // 只能用 fill()：逐字敲（keyboard.type / pressSequentially，delay 35ms 与 150ms 都试过）
    // 在这个框里会丢字，只剩第一个或最后一个字母——这是节点提示词框自己的毛病，已单独登记，
    // 不在本条范围内。空提示词照样出图，所以下面那句回读是这一步唯一的真信号。
    await promptBox.fill(PROMPT)
    await win.waitForTimeout(1200)
    const typed = (await promptBox.innerText()).trim()
    if (typed !== PROMPT) throw new Error(`节点提示词没填进去：读回「${typed}」`)
    const generate = win.getByRole('button', { name: /生成素材|重新生成/ }).first()
    if (await generate.isVisible().catch(() => false)) {
      await generate.click()
      await win.waitForTimeout(2500)
      // 付费确认弹层（本机免费也走同一条闸）
      const ok = win.getByRole('button', { name: /确认生成|确认并生成|^确认$/ }).first()
      if (await ok.isVisible().catch(() => false)) {
        await ok.click()
        await win.waitForTimeout(1500)
      }
      await snap('11-generating')
      // 等产物真落盘（项目 assets 目录出现图片），每 3s 看一次，最多 300s
      let produced = []
      for (let waited = 0; waited < 300_000; waited += 3000) {
        await win.waitForTimeout(3000)
        produced = fs.existsSync(projectsDir)
          ? fs.readdirSync(projectsDir, { recursive: true }).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(String(f)))
          : []
        if (produced.length) break
      }
      await snap('12-generated')
      fs.writeFileSync(path.join(EVID, 'generated-assets.json'), JSON.stringify(produced.map(String), null, 2))
      record('E. 画布上真出来一张图', produced.length > 0, `产物 ${produced.length} 个：${produced.slice(0, 3).join(', ')}`)
      // 出图还不够：得是**用户写的那句**出的图。去 ComfyUI 侧核对正向提示词。
      const prompts = await comfyPromptTexts()
      record('E2. ComfyUI 收到的正向提示词就是用户写的那句', prompts.includes(PROMPT), `ComfyUI 侧收到：${JSON.stringify(prompts.slice(-3))}`)
    } else {
      record('E. 画布上真出来一张图', false, '没找到生成按钮')
    }
  } else {
    record('E. 画布上真出来一张图', false, '模型选择器里没有这条工作流，到不了生成')
  }
} catch (error) {
  console.error('WALKTHROUGH THREW', error)
  await snap('99-error').catch(() => {})
  failures.push(`未捕获异常：${String(error).slice(0, 300)}`)
}

const mainLog = path.join(tempRoot, 'user-data', 'logs')
if (fs.existsSync(mainLog)) {
  for (const file of fs.readdirSync(mainLog)) {
    fs.copyFileSync(path.join(mainLog, file), path.join(EVID, `main-${file}`))
  }
}
const finalHistory = await comfyHistoryIds().catch(() => [])
fs.writeFileSync(
  path.join(EVID, 'acceptance-result.json'),
  JSON.stringify({ baseUrl: BASE_URL, baselinePromptIds, finalHistory, failures }, null, 2),
)
await app.close().catch(() => {})

if (failures.length) {
  console.error(`\n❌ 验收未通过，${failures.length} 条：\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\n✅ 验收全通过：导入 → 晋级启用 → 画布选到 → 真出图')
