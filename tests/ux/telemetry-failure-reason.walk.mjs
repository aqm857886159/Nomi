// R13 真 App 走查：故意让一次生成失败，抓**出站**的用量事件，证明
//   ① 失败事件带「类别码」errorType（来自 classifyGenerationError 的 kind），
//   ② 走查启动的进程打了 systemProps.automated 标记（来自启动器钉死的 NOMI_E2E=1），
//   ③ 出站字节里没有提示词、路径、供应商返回体。
// 失败的来源是真实链路：画布节点 → 渲染层 runWorkbenchTaskByVendor → 主进程任务执行 → 连不上的本机 ComfyUI。
// 零额度：目标端口没有任何服务在听。
//
// 用法：先 pnpm run build，再 node tests/ux/telemetry-failure-reason.walk.mjs
//       EVIDENCE_DIR=<目录> 指定截图与抓包落点（默认 tests/ux/shots/telemetry-failure-reason）
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expect, clickOrFail, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { newProjectEntry } from './_shell.mjs'

const repoRoot = process.cwd()
const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'tests/ux/shots/telemetry-failure-reason')
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-telemetry-failure-reason')
for (const dir of [tempRoot, evidenceDir]) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }) }
const settingsDir = path.join(tempRoot, 'settings')
fs.mkdirSync(settingsDir, { recursive: true })

const SECRET_PROMPT = '独特提示词-蓝鲸穿过霓虹雨夜-绝不能出门'
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const deadPort = await freePort()
const vitePort = await freePort()
const baseUrl = `http://127.0.0.1:${vitePort}`

// ---- 假接收端：只记录 POST /v1/events 的原始字节 ----
const captured = []
const TOKEN = 'walk-token-not-a-secret'
const intake = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    if (req.url === '/v1/events' && req.headers.authorization === `Bearer ${TOKEN}`) captured.push(body)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, ref: 'walk', accepted: 1 }))
  })
})
await new Promise((resolve) => intake.listen(0, '127.0.0.1', resolve))
const intakeUrl = `http://127.0.0.1:${intake.address().port}`

const now = '2026-10-01T00:00:00.000Z'
const MODEL_KEY = 'comfy-fail-walk-001'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 5,
  vendors: [{ key: 'comfyui-local', name: '本地 ComfyUI', enabled: true, authType: 'none', authHeader: null, baseUrlHint: `http://127.0.0.1:${deadPort}`, createdAt: now, updatedAt: now }],
  models: [{
    modelKey: MODEL_KEY, vendorKey: 'comfyui-local', labelZh: '走查文生视频', kind: 'video', enabled: true, createdAt: now, updatedAt: now,
    meta: {
      parameters: [{ key: 'steps', label: '采样步数', type: 'number', default: 20 }],
      comfyWorkflowImport: { text: '{}', binding: { promptNodeId: '6', promptInputKey: 'text', outputKind: 'video', images: [], params: [] } },
    },
  }],
  mappings: [{
    vendorKey: 'comfyui-local', taskKind: 'text_to_video', modelKey: MODEL_KEY, name: '走查文生视频', enabled: true,
    create: { method: 'POST', path: '/prompt', headers: { 'Content-Type': 'application/json' }, body: { prompt: {}, client_id: 'nomi' }, response_mapping: { task_id: 'prompt_id' }, request_transform: 'comfyui-prompt', defaultParams: { steps: 20 } },
    query: { method: 'GET', path: '/history/{{providerMeta.task_id}}', response_transform: 'comfyui-history', response_mapping: { video_url: 'video_url', error_message: 'error' } },
  }],
  apiKeysByVendor: {},
}, null, 2))

const waitForUrl = (url, timeoutMs = 60_000) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs
  const poll = () => {
    const r = http.get(url, (resp) => { resp.destroy(); resolve(true) })
    r.on('error', () => (Date.now() > deadline ? reject(new Error('Vite 未就绪')) : setTimeout(poll, 300)))
    r.setTimeout(1200, () => r.destroy())
  }
  poll()
})
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort)], { cwd: repoRoot, env: { ...process.env }, stdio: 'ignore' })

let app
let failed = null
const launchOpts = {
  userDataDir: path.join(tempRoot, 'user-data'),
  settingsDir,
  projectsDir: path.join(tempRoot, 'projects'),
  env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: baseUrl, NOMI_INTAKE_ENDPOINT: intakeUrl, NOMI_INTAKE_TOKEN: TOKEN },
}
try {
  await waitForUrl(baseUrl)
  let win
  ;({ app, win } = await launchNomiApp({ name: 'telemetry-failure-reason', ...launchOpts, settleMs: 0 }))
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.close().catch(() => {})
  await app.close().catch(() => {})
  ;({ app, win } = await launchNomiApp({ name: 'telemetry-failure-reason-2', ...launchOpts, settleMs: 1800 }))
  const snap = (name) => screenshotSettled(win, { path: path.join(evidenceDir, `${name}.png`) })

  // 用户同意「帮 Nomi 变好」：走设置页真实开关，不绕。
  await win.getByRole('button', { name: '设置', exact: true }).click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  const section = win.locator('[data-settings-section="telemetry"]')
  await section.scrollIntoViewIfNeeded()
  await section.getByRole('checkbox', { name: '帮助改进 Nomi', exact: true }).check()
  await expect(section).toHaveAttribute('data-telemetry-state', 'configured', { timeout: DEFAULT_TIMEOUT_MS })
  await snap('01-consent-on-configured')

  for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(160) }
  await clickOrFail(newProjectEntry(win), '新建空白项目', { noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForTimeout(1200)

  await win.evaluate(async ({ modelKey, prompt }) => {
    const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const store = m.useGenerationCanvasStore.getState()
    const node = store.addNode({ kind: 'video', title: '镜头 1', position: { x: 600, y: 200 } })
    store.updateNode(node.id, { prompt, meta: { modelKey, modelVendor: 'comfyui-local', vendor: 'comfyui-local', videoModel: modelKey, videoModelVendor: 'comfyui-local' } })
    store.selectNode(node.id)
  }, { modelKey: MODEL_KEY, prompt: SECRET_PROMPT })
  await win.waitForTimeout(1200)
  await clickOrFail(win.getByRole('button', { name: /生成素材|重新生成/ }).first(), '生成按钮')

  const errorCard = win.locator('[role="alert"][aria-label^="生成失败"]').first()
  await expect(errorCard, '失败卡没出来——这次生成没有真的失败').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
  await snap('02-generation-failed-card')

  // 出站事件：等到抓到一条 generation.completed
  const deadline = Date.now() + 60_000
  let events = []
  while (Date.now() < deadline) {
    events = captured.flatMap((b) => JSON.parse(b).events ?? [])
    if (events.some((e) => e.eventName === 'generation.completed')) break
    await win.waitForTimeout(500)
  }
  fs.writeFileSync(path.join(evidenceDir, 'outbound-events.json'), JSON.stringify(JSON.parse(captured[0] ?? '{}'), null, 2))
  fs.writeFileSync(path.join(evidenceDir, 'outbound-raw-bytes.txt'), captured.join('\n---\n'))
  const gen = events.find((e) => e.eventName === 'generation.completed')
  expect(gen, '没抓到出站的 generation.completed').toBeTruthy()
  expect(gen.props.result).toBe('failure')
  expect(gen.props.errorType, '失败事件没有带 errorType').toMatch(/^[a-z][a-z0-9-]{0,39}$/)
  expect(gen.systemProps.automated, '走查进程没打自动化标记').toBe(true)
  const raw = captured.join('\n')
  for (const leak of [SECRET_PROMPT, tempRoot, 'nomi-telemetry-failure-reason', String(deadPort), '127.0.0.1', 'ECONNREFUSED', 'Users']) {
    if (raw.includes(leak)) throw new Error(`出站字节里出现了不该出门的内容：${leak}`)
  }
  console.log(`✅ 出站失败事件：errorType=${gen.props.errorType}，automated=${gen.systemProps.automated}，无提示词 / 路径 / 端口 / 供应商返回体`)
} catch (error) {
  failed = error
} finally {
  await app?.close().catch(() => {})
  vite.kill('SIGTERM')
  intake.close()
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
