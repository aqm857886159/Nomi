// 3D-BOX 3b · 门槛 ① 真实 Agent 回合（Electron 真机，真实模型，真实工具调用）：
//   一句话 → stage_shot 建预演 → 离屏渲染挂到视频镜头 → 按名字改一镜 → 「用它出片」→ 报价 / 确认卡出现即停。
//
// 用法（主进程 dist-electron，渲染端本仓 vite dev；要先 `pnpm run build:electron`、起 `npx vite --port <P>`）：
//   set -a; . ~/.nomi-secrets.env; set +a
//   NOMI_WALK_RENDERER_URL=http://127.0.0.1:<P>/ node tests/ux/director-3dbox-3b-agent.walk.mjs
//
// 纪律：
//   · 隔离资料目录（.tmp/director-3dbox-3b-agent），**不读用户真实资料目录**；Agent 模型 = DeepSeek 官方（密钥只经
//     进程环境 → safeStorage 密文写进隔离 catalog，不打印、不落日志 / 截图 / 报告）。
//   · 视频供应商只放一把**占位密钥**（`nomi-e2e-placeholder`）：它让镜头有可选的视频模型、报价卡能摆出来，
//     但发不出任何能扣费的请求。报价卡一出现就截图、关 App，**从不点确认**。
//   · 证据只认落盘与真页面：项目 project.json 里的节点 meta（修订号、预演状态、参考视频）、面板文字、截图。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) throw new Error('需要 DEEPSEEK_API_KEY（真实 Agent 模型，不许 mock）：set -a; . ~/.nomi-secrets.env; set +a')
const rendererUrl = process.env.NOMI_WALK_RENDERER_URL
if (!rendererUrl) throw new Error('需要 NOMI_WALK_RENDERER_URL（本仓 vite dev 地址），见文件头用法')
const VENDOR = 'deepseek-official'
const MODEL = process.env.NOMI_WALK_AGENT_MODEL || 'deepseek-chat'
const root = path.join(repoRoot, '.tmp', 'director-3dbox-3b-agent')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/director-3dbox-3b-agent')
fs.rmSync(root, { recursive: true, force: true })
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const dirs = { userDataDir: path.join(root, 'user-data'), settingsDir: path.join(root, 'settings'), projectsDir: path.join(root, 'projects'), capabilityDir: path.join(root, 'capability') }
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
const redact = (text) => String(text).split(API_KEY).join('[REDACTED]')
const env = { VITE_DEV_SERVER_URL: rendererUrl, NOMI_DIRECTOR_3DBOX: 'true', NOMI_DISABLE_AUTO_UPDATE: '1' }
const initialLocalStorage = {
  'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'dark',
  'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1',
  'nomi.assistantModel': JSON.stringify({ vendorKey: VENDOR, modelKey: MODEL }),
}
const report = { model: `${VENDOR}/${MODEL}`, turns: [], checks: [], startedAt: new Date().toISOString() }
const check = (name, ok, detail = '') => { report.checks.push({ name, ok: Boolean(ok), detail: redact(detail) }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${redact(detail)}` : ''}`) }

// ① 首启拿 safeStorage 密文（同一 Electron 身份才能解）→ 关 → 写隔离 catalog → 再起
const first = await launchNomiApp({ name: 'director-3dbox-3b-agent', tempRoot: root, ...dirs, settleMs: 0, env, initialLocalStorage })
const encrypt = (value) => first.app.evaluate(({ safeStorage }, plain) => safeStorage.encryptString(plain).toString('base64'), value)
const cipher = await encrypt(API_KEY)
const placeholder = await encrypt('nomi-e2e-placeholder')
await first.app.close()
const catalogFile = path.join(dirs.settingsDir, 'model-catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
const now = new Date().toISOString()
catalog.vendors.push({ key: VENDOR, name: 'DeepSeek Official', enabled: true, baseUrlHint: 'https://api.deepseek.com', providerKind: 'openai-compatible', authType: 'bearer', createdAt: now, updatedAt: now })
catalog.models.push({ vendorKey: VENDOR, modelKey: MODEL, labelZh: MODEL, kind: 'text', enabled: true, published: true, createdAt: now, updatedAt: now })
catalog.apiKeysByVendor = {
  ...(catalog.apiKeysByVendor || {}),
  [VENDOR]: { vendorKey: VENDOR, apiKey: cipher, enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now },
  apimart: { vendorKey: 'apimart', apiKey: placeholder, enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now },
}
fs.writeFileSync(catalogFile, JSON.stringify(catalog), { mode: 0o600 })

const { app, win } = await launchNomiApp({ name: 'director-3dbox-3b-agent', tempRoot: root, ...dirs, settleMs: 0, env })
const pageErrors = []
win.on('pageerror', (error) => pageErrors.push(redact(String(error))))
const shot = async (name) => { const file = path.join(shotsDir, `${name}.png`); await win.screenshot({ path: file }); return file }

function projectDir() {
  const names = fs.readdirSync(dirs.projectsDir).filter((name) => fs.existsSync(path.join(dirs.projectsDir, name, '.nomi', 'project.json')))
  return names.length === 1 ? path.join(dirs.projectsDir, names[0]) : null
}
async function canvasNodes() {
  return win.evaluate(() => window.__nomiCanvasStore?.getState().nodes.map((node) => ({ id: node.id, kind: node.kind, title: node.title, prompt: node.prompt, meta: node.meta })) ?? [])
}
const transcript = () => win.locator('[data-v4-block="assistant"], [data-v4-block="tool"], [data-v4-block="intervention"]').allInnerTexts().catch(() => [])
const running = async () => (await win.locator('[data-v4-control="send"][data-v4-send-intent="stop"]').count().catch(() => 0)) > 0
const confirmVisible = async () => (await win.locator('[data-v4-control="confirm"]').count().catch(() => 0)) > 0
const spendCardVisible = async () => {
  if ((await win.locator('[data-spend-confirm-dialog]').count().catch(() => 0)) > 0) return true
  const cards = await win.locator('[data-v4-block="intervention"]').allInnerTexts().catch(() => [])
  return cards.some((text) => /生成|报价|¥|费用|额度/.test(text)) && (await confirmVisible())
}

/**
 * 发一句话，等到 until() 成立且这一回合收尾。中途出现可撤销写入的确认卡（画布草稿 / 预演）就点确认——
 * 那是免费、可撤销的写入；**报价卡从不点**（出现就停等，交给调用方截图后关 App）。
 */
async function sendAndWait(message, { until, timeoutMs, stopOnSpendCard = false }) {
  const before = (await transcript()).length
  await win.locator('textarea[data-v4-control="input"]').first().fill(message)
  await win.locator('[data-v4-control="send"]').first().click()
  const started = Date.now()
  const deadline = started + timeoutMs
  let approvals = 0
  await win.waitForTimeout(3000)
  while (Date.now() < deadline) {
    // 任何一张待确认的卡（报价卡、确认卡）出现都**只截图、不点**：第 3 次真机跑（2026-10-04）这里曾自动点了确认，
    // 报价卡的文字没被识别成报价卡，于是发出了一次生成提交——被占位密钥当场拒（invalid API key），没有扣费，
    // 但这一步本就不该点。现在出卡即停：出片回合把它当终点，其余回合把它当异常。
    if (await confirmVisible() || await spendCardVisible()) {
      if (stopOnSpendCard) break
      throw new Error('确认 / 报价卡在不该出现的回合出现了（未点）')
    }
    const done = await until()
    if (done && !(await running())) break
    if (!done && !(await running()) && Date.now() - started > 20_000) break
    await win.waitForTimeout(2000)
  }
  const all = await transcript()
  report.turns.push({ message, seconds: Math.round((Date.now() - started) / 1000), approvalsClicked: approvals, transcript: all.slice(before).map((text) => redact(text).slice(0, 1500)) })
}

const directorNode = (nodes) => nodes.filter((node) => node.kind === 'director' && node.meta?.directorPlan).at(-1)
const previewOf = (node) => node?.meta?.directorPreview

try {
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: stationTimeout({ operations: 4 }) })
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  await win.getByText('新建画面', { exact: false }).first().click({ timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  const input = win.locator('textarea[data-v4-control="input"]').first()
  if (!(await input.count())) await win.evaluate(() => document.querySelector('[data-agent-ball]')?.click())
  await input.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  // 面板里的「帮 Nomi 变好」征询卡：选不分享（隐私优先）
  const panelConsent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await panelConsent.isVisible().catch(() => false)) await panelConsent.click()
  await shot('00-ready')

  // ② 一句话：建视频镜头 + 3D 预演（不生成）
  await sendAndWait('先在画布上建一个 6 秒的视频镜头（文生视频，模型用 doubao-seedance-2.0），先不要生成。然后给这个镜头做一个 3D 预演：面馆门口两个人说话，正反打，最后慢慢推近其中一个人。', {
    timeoutMs: stationTimeout({ turns: 2 }),
    until: async () => Boolean(directorNode(await canvasNodes())),
  })
  let nodes = await canvasNodes()
  let director = directorNode(nodes)
  check('stage_shot 建出 3D-BOX 节点（计划 + 修订号）', director?.meta?.directorPlan?.revision, director?.meta?.directorPlan?.revision ?? 'none')
  const target = previewOf(director)?.targetNodeId
  check('预演指向一个视频镜头', target && nodes.some((node) => node.id === target && node.kind === 'video'), `target=${target}`)
  await shot('01-after-first-turn')

  // ③ 等离屏渲染挂到镜头（真 WebGL，真拼 mp4）
  const renderDeadline = Date.now() + stationTimeout({ operations: 12 })
  while (Date.now() < renderDeadline) {
    director = directorNode(await canvasNodes())
    if (previewOf(director)?.status !== 'rendering') break
    await win.waitForTimeout(3000)
  }
  nodes = await canvasNodes()
  director = directorNode(nodes)
  const targetNode = nodes.find((node) => node.id === target)
  check('预演渲染完成（ready）', previewOf(director)?.status === 'ready', JSON.stringify({ status: previewOf(director)?.status, reason: previewOf(director)?.reason, attach: previewOf(director)?.attach }))
  check('预演挂到视频镜头（参考视频 / 或明说只写进提示词）', previewOf(director)?.attach === 'video_ref'
    ? (targetNode?.meta?.referenceVideoUrls ?? []).includes(previewOf(director)?.videoUrl)
    : previewOf(director)?.attach === 'prompt_only' && /3D-BOX 预演运镜/.test(targetNode?.prompt ?? ''), `attach=${previewOf(director)?.attach}`)
  await shot('02-preview-attached')
  const firstRevision = director?.meta?.directorPlan?.revision

  // ④ 按名字改一镜
  await sendAndWait('预演里把最后一镜改成特写，别的不动。', {
    timeoutMs: stationTimeout({ turns: 1 }),
    until: async () => directorNode(await canvasNodes())?.meta?.directorPlan?.revision !== firstRevision,
  })
  director = directorNode(await canvasNodes())
  check('补丁产生新修订号', director?.meta?.directorPlan?.revision && director.meta.directorPlan.revision !== firstRevision, `${firstRevision} → ${director?.meta?.directorPlan?.revision}`)
  const renderDeadline2 = Date.now() + stationTimeout({ operations: 12 })
  while (Date.now() < renderDeadline2) {
    director = directorNode(await canvasNodes())
    if (previewOf(director)?.status !== 'rendering') break
    await win.waitForTimeout(3000)
  }
  check('改后预演重新挂好', previewOf(directorNode(await canvasNodes()))?.status === 'ready')
  await shot('03-after-patch')

  // ⑤ 出片：报价 / 确认卡出现即停（绝不点确认）
  await sendAndWait('预演可以了，就用它出这一镜，模式换成能吃参考视频的那个。', {
    timeoutMs: stationTimeout({ turns: 1 }),
    stopOnSpendCard: true,
    until: async () => (await confirmVisible()) || (await spendCardVisible()),
  })
  // 模型这一回合可能先问一句（时长、模式）而不出片：用户再说一句「就这样出」——仍是出卡即停、从不点。
  if (!((await confirmVisible()) || (await spendCardVisible()))) {
    await sendAndWait('时长就按现在的，别的都不用改，直接出这一镜。', {
      timeoutMs: stationTimeout({ turns: 1 }),
      stopOnSpendCard: true,
      until: async () => (await confirmVisible()) || (await spendCardVisible()),
    })
  }
  const cardShown = (await confirmVisible()) || (await spendCardVisible())
  report.spendCardText = redact((await win.locator('[data-v4-block="intervention"], [data-spend-confirm-dialog]').allInnerTexts().catch(() => [])).join('\n---\n')).slice(0, 2000)
  await shot('04-spend-card')
  check('报价 / 确认卡出现（未点确认）', cardShown)
} catch (error) {
  check('走查未抛错', false, redact(error?.stack ?? String(error)))
  await shot('99-error').catch(() => {})
} finally {
  report.pageErrors = pageErrors.slice(0, 20)
  report.finishedAt = new Date().toISOString()
  const dir = projectDir()
  if (dir) {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, '.nomi', 'project.json'), 'utf8'))
    const findNodes = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 6) return null
      if (Array.isArray(value.nodes) && value.nodes.some((node) => node?.kind)) return value.nodes
      for (const child of Object.values(value)) { const found = findNodes(child, depth + 1); if (found) return found }
      return null
    }
    const nodes = findNodes(payload) ?? []
    report.persistedDirector = nodes.filter((node) => node.kind === 'director').map((node) => ({ id: node.id, revision: node.meta?.directorPlan?.revision, preview: node.meta?.directorPreview && { ...node.meta.directorPreview, notes: node.meta.directorPreview.notes } }))
  }
  fs.writeFileSync(path.join(shotsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await app.close().catch(() => undefined)
}
