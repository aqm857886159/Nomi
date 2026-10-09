// 3D-BOX 3c · 真实测试 ④「真 Agent 在环改一镜」（Electron 真机，真实 Agent 模型，真实工具调用；**由协调会话亲自跑**，子 agent 不碰真凭据）。
//
//   一句话建一份独立预演（不挂镜头、不出图不出视频）→ 走查替用户在精修之外手调两镜机位（写节点工程，等同编辑器关着时的落盘）→
//   进导演台、点第 2 张镜头卡（输入框上出「正在改：镜头 2」）→ 只说「这一镜改成特写」（不点名第几镜）→
//   Agent 用 director.shot 上下文改对那一镜：第 2 镜的手调被重算、第 1 镜的手调保留、Agent 复述被覆盖的手调 →
//   说「撤销」→ 回到改之前（第 2 镜的手调回来）。
//
// 用法（Windows / macOS 同一条；主进程 dist-electron，渲染端本仓 vite dev）：
//   1) pnpm run build:electron
//   2) 另开一个终端起 vite：pnpm exec vite --host 127.0.0.1 --port <P> --strictPort
//   3) **先关掉自己的 Nomi**（开着就拒跑：它随时在写目录，拷到的是半新半旧的一份，跑后指纹也分不清是谁写的）
//   4) NOMI_WALK_RENDERER_URL=http://127.0.0.1:<P>/ \
//      NOMI_WALK_AGENT_VENDOR=<真实目录里 DeepSeek 那一行的 vendorKey> NOMI_WALK_AGENT_MODEL=<modelKey，缺省 deepseek-chat> \
//      node tests/ux/director-3dbox-3c-agent.walk.mjs
//
// 纪律（为什么这么跑）：
//   · 窗口在屏幕外、不抢焦点（_offscreenWindows.cjs），不打扰正在用电脑的人。
//   · 真实资料目录**只读**：只把点名的那一个文本模型（连同它的供应商行、凭据密文、Windows 的 Local State）拷进隔离副本；
//     跑前跑后比对原库凭据文件指纹，必须一字不差；跑完删掉副本里的凭据。项目、MCP 目录都在隔离目录（.tmp/director-3dbox-3c-agent）。
//   · 只花文本额度：隔离副本里没有任何图片 / 视频供应商的 key；全程不建视频镜头、不调 generate；
//     任何确认 / 报价卡出现即判红并停（从不点）；跑完核对项目里没有生成任务目录。
//   · 证据只认落盘与真页面：节点 meta（计划、修订号、工程里两镜机位的 fov）、输入框标签文字、Agent 回复文字、截图。
//
// 判据（report.json 的 checks，全绿才算过）：
//   C1 一句话建出 3D-BOX 节点（计划 + 修订号），至少 2 镜，没有挂视频镜头；
//   C2 进导演台点第 2 张卡后，输入框上出现「正在改：镜头 2」；
//   C3 只说「这一镜改成特写」：计划里第 2 镜的景别变成特写，其余镜不变（Agent 用对了焦点上下文，没改错镜）；
//   C4 第 2 镜机位的手调被重算（不再是手调的 fov），第 1 镜机位的手调原样保留；
//   C5 面板上确定性地出现「这次改动覆盖了你在镜头 2 的手调，可撤销」（宿主给的，不靠模型复述；模型说没说只记录）；
//   C6 说「撤销」后计划回到改之前的修订号，第 2 镜手调回来，那句覆盖提示随之消失；
//   C7 全程没有确认 / 报价卡、没有生成任务目录、0 个 pageerror；
//   C8 原库凭据文件指纹跑前跑后一字不差，副本里的凭据已删。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { realNomiIsRunning, realNomiProfile, realProfileFingerprint, removeRealCredentials, seedRealModels } from './_realProfile.mjs'
import { stationTimeout } from './_station-budget.mjs'

const rendererUrl = process.env.NOMI_WALK_RENDERER_URL
if (!rendererUrl) throw new Error('需要 NOMI_WALK_RENDERER_URL（本仓 vite dev 地址），见文件头用法')
const VENDOR = process.env.NOMI_WALK_AGENT_VENDOR
if (!VENDOR) throw new Error('需要 NOMI_WALK_AGENT_VENDOR（真实目录里 DeepSeek 那一行的 vendorKey），见文件头用法')
const MODEL = process.env.NOMI_WALK_AGENT_MODEL || 'deepseek-chat'
if (realNomiIsRunning()) throw new Error('你自己的 Nomi 正开着：先关掉再跑（见文件头第 3 步）')

const profile = realNomiProfile()
const fingerprintBefore = realProfileFingerprint(profile)
const root = path.join(repoRoot, '.tmp', 'director-3dbox-3c-agent')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/director-3dbox-3c-agent')
fs.rmSync(root, { recursive: true, force: true })
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const dirs = { userDataDir: path.join(root, 'user-data'), settingsDir: path.join(root, 'settings'), projectsDir: path.join(root, 'projects'), capabilityDir: path.join(root, 'capability') }
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
const offscreen = path.join(repoRoot, 'tests/ux/_offscreenWindows.cjs')
const env = { VITE_DEV_SERVER_URL: rendererUrl, NOMI_DIRECTOR_3DBOX: 'true', NOMI_DISABLE_AUTO_UPDATE: '1' }
const initialLocalStorage = {
  'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'dark',
  'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1',
  'nomi.assistantModel': JSON.stringify({ vendorKey: VENDOR, modelKey: MODEL }),
}
const report = { model: `${VENDOR}/${MODEL}`, turns: [], checks: [], startedAt: new Date().toISOString() }
const failures = []
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: Boolean(ok), detail })
  if (!ok) failures.push(name)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ① 首启生成隔离目录 → 关 → 只装点名的那一个文本模型（凭据密文 + Windows 的 Local State 原样拷，不解密不打印）→ 再起
const first = await launchNomiApp({ name: 'director-3dbox-3c-agent', tempRoot: root, ...dirs, settleMs: 0, env, initialLocalStorage, mainRequire: [offscreen] })
await first.app.close()
const seeded = seedRealModels({ settingsDir: dirs.settingsDir, userDataDir: dirs.userDataDir, models: [{ vendorKey: VENDOR, modelKey: MODEL }] })
check('只装了一个文本模型（不出图不出视频）', seeded.length === 1 && seeded[0].kind === 'text', JSON.stringify(seeded))

const { app, win } = await launchNomiApp({ name: 'director-3dbox-3c-agent', tempRoot: root, ...dirs, settleMs: 0, env, mainRequire: [offscreen] })
const pageErrors = []
win.on('pageerror', (error) => pageErrors.push(String(error)))
const shot = async (name) => { const file = path.join(shotsDir, `${name}.png`); await win.screenshot({ path: file }); return file }

async function canvasNodes() {
  return win.evaluate(() => window.__nomiCanvasStore?.getState().nodes.map((node) => ({ id: node.id, kind: node.kind, title: node.title, meta: node.meta })) ?? [])
}
const directorNode = (nodes) => nodes.filter((node) => node.kind === 'director' && node.meta?.directorPlan).at(-1)
const planOf = (node) => node?.meta?.directorPlan?.plan
const cameraOf = (node, shotId) => node?.meta?.directorProject?.scenes?.find((scene) => scene.id === 'scene:director')?.cameras?.find((camera) => camera.id === `shot:${shotId}/camera`)
const handTuned = (camera) => Boolean(camera?.motionTrajectory?.length) && camera.motionTrajectory.every((point) => point.fov === 18)
const transcript = () => win.locator('[data-v4-block="assistant"], [data-v4-block="tool"], [data-v4-block="intervention"]').allInnerTexts().catch(() => [])
const running = async () => (await win.locator('[data-v4-control="send"][data-v4-send-intent="stop"]').count().catch(() => 0)) > 0
const notices = async () => (await win.locator('[data-v4-notice="director-patch"]').allInnerTexts().catch(() => [])).join(' | ')
const cardVisible = async () => (await win.locator('[data-v4-control="confirm"], [data-spend-confirm-dialog]').count().catch(() => 0)) > 0
let cardSeen = false

async function sendAndWait(message, { until, timeoutMs }) {
  const before = (await transcript()).length
  await win.locator('textarea[data-v4-control="input"]').first().fill(message)
  await win.locator('[data-v4-control="send"]').first().click()
  const started = Date.now()
  await win.waitForTimeout(3000)
  while (Date.now() < started + timeoutMs) {
    // 这一趟从头到尾不该有任何要人点的卡（不花钱、写入可撤销）：出现即记红并停，从不点
    if (await cardVisible()) { cardSeen = true; break }
    const done = await until()
    if (done && !(await running())) break
    if (!done && !(await running()) && Date.now() - started > 20_000) break
    await win.waitForTimeout(2000)
  }
  const all = await transcript()
  const turn = { message, seconds: Math.round((Date.now() - started) / 1000), transcript: all.slice(before).map((text) => text.slice(0, 1500)) }
  report.turns.push(turn)
  return turn
}

/** 替用户手调：两镜机位的 fov 拉窄到 18（整条轨迹），写回节点工程——和编辑器关着时落盘是同一个边界。 */
async function handTune(nodeId, shotIds) {
  await win.evaluate(({ nodeId, shotIds }) => {
    const store = window.__nomiCanvasStore.getState()
    const node = store.nodes.find((item) => item.id === nodeId)
    const project = JSON.parse(JSON.stringify(node.meta.directorProject))
    const scene = project.scenes.find((item) => item.id === 'scene:director')
    for (const camera of scene.cameras) {
      if (!shotIds.some((id) => camera.id === `shot:${id}/camera`)) continue
      camera.fov = 18
      camera.motionTrajectory = (camera.motionTrajectory ?? []).map((point) => ({ ...point, fov: 18 }))
    }
    store.updateNode(nodeId, { meta: { ...node.meta, directorProject: project } })
  }, { nodeId, shotIds })
}

try {
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: stationTimeout({ operations: 4 }) })
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  // 2026-10-08：空画布的「+ 新建画面」换成一排任务卡（拍板 ③），建图片卡点「图片」那张。
  await win.locator('[data-empty-canvas-tasks] [data-add-intent="image"]').first().click({ timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  const input = win.locator('textarea[data-v4-control="input"]').first()
  if (!(await input.count())) await win.evaluate(() => document.querySelector('[data-agent-ball]')?.click())
  await input.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  const panelConsent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await panelConsent.isVisible().catch(() => false)) await panelConsent.click()
  await shot('00-ready')

  // ② 一句话建独立预演（不挂镜头）
  await sendAndWait('先不要建任何视频镜头，也不要生成。直接给我做一个独立的 3D 预演：图书馆里管理员把书递给学生，三镜——全景交代两人、越过学生肩膀拍管理员、学生特写慢慢推近。', {
    timeoutMs: stationTimeout({ turns: 2 }),
    until: async () => Boolean(directorNode(await canvasNodes())),
  })
  let director = directorNode(await canvasNodes())
  const shots = planOf(director)?.shots ?? []
  check('C1 建出 3D-BOX 节点（计划 + 修订号、≥2 镜、没挂视频镜头）', director?.meta?.directorPlan?.revision && shots.length >= 2 && !director?.meta?.directorPreview?.targetNodeId,
    JSON.stringify({ revision: director?.meta?.directorPlan?.revision, shots: shots.map((item) => `${item.id}:${item.size}`), target: director?.meta?.directorPreview?.targetNodeId ?? null }))
  await shot('01-created')
  if (!director || shots.length < 2) throw new Error('没有可改的两镜预演，后面的判据无从谈起')
  const [first, second] = [shots[0].id, shots[1].id]
  const secondSizeBefore = shots[1].size

  // ③ 手调两镜机位
  await handTune(director.id, [first, second])
  director = directorNode(await canvasNodes())
  const revisionBefore = director.meta.directorPlan.revision
  check('手调落到了节点工程（两镜机位 fov = 18）', handTuned(cameraOf(director, first)) && handTuned(cameraOf(director, second)))

  // ④ 进导演台、点第 2 张卡 → 输入框上出「正在改：镜头 2」
  // 画布只挂视口里的节点（onlyRenderVisibleElements）：Agent 把预演建在别的分区 / 视口外时，「打开」按钮根本不在 DOM 里。
  // 像真用户一样点画布上的「新节点在…里 →」提示过去；没有提示（已在视口里）就直接点。
  const openButton = win.locator(`[data-testid="director-node-open"]`).first()
  if (!(await openButton.isVisible().catch(() => false))) {
    const arrival = win.locator('[data-canvas-arrival-hint]').first()
    if (await arrival.isVisible().catch(() => false)) await arrival.click()
  }
  await openButton.click({ timeout: stationTimeout({ operations: 2 }) })
  await win.locator('[data-testid="director-shot-2"]').first().click({ timeout: stationTimeout({ operations: 4 }) })
  const tag = win.locator('[data-v4-focus-tag]').first()
  await tag.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
  const tagText = (await tag.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('C2 输入框上出现「正在改：镜头 2」', /正在改：镜头 2/.test(tagText), tagText)
  await shot('02-focus-tag')

  // ⑤ 只说「这一镜」
  const patchTurn = await sendAndWait('这一镜改成特写，别的不动。', {
    timeoutMs: stationTimeout({ turns: 1 }),
    until: async () => directorNode(await canvasNodes())?.meta?.directorPlan?.revision !== revisionBefore,
  })
  director = directorNode(await canvasNodes())
  const after = planOf(director)?.shots ?? []
  const changed = after.filter((item, index) => JSON.stringify(item) !== JSON.stringify(shots[index])).map((item) => item.id)
  check('C3 只改了第 2 镜、改成特写', after.find((item) => item.id === second)?.size === '特写' && changed.length === 1 && changed[0] === second,
    JSON.stringify({ before: secondSizeBefore, after: after.find((item) => item.id === second)?.size, changed }))
  check('C4 第 2 镜手调被重算、第 1 镜手调保留', !handTuned(cameraOf(director, second)) && handTuned(cameraOf(director, first)))
  const reply = patchTurn.transcript.join('\n')
  // 那句话由宿主确定性给出（真实测试 ④：DeepSeek 一句没提）；模型自己有没有复述只记录、不判
  const noticeText = await notices()
  check('C5 面板确定性说出覆盖了镜头 2 的手调、可撤销', /镜头 2/.test(noticeText) && /手调/.test(noticeText) && /可撤销/.test(noticeText), noticeText)
  report.modelMentionedOverride = { mentioned: /手调|手动|撤销/.test(reply), replyTail: reply.slice(-400) }
  await shot('03-after-patch')

  // ⑥ 撤销
  await sendAndWait('撤销刚才那一下。', {
    timeoutMs: stationTimeout({ turns: 1 }),
    until: async () => directorNode(await canvasNodes())?.meta?.directorPlan?.revision === revisionBefore,
  })
  director = directorNode(await canvasNodes())
  const noticeAfterUndo = await notices()
  check('C6 撤销回到改之前（修订号回去、第 2 镜手调回来、覆盖提示消失）', director?.meta?.directorPlan?.revision === revisionBefore && handTuned(cameraOf(director, second)) && !noticeAfterUndo,
    `${director?.meta?.directorPlan?.revision} vs ${revisionBefore}; notice=${noticeAfterUndo}`)
  await shot('04-after-undo')
} catch (error) {
  check('走查未抛错', false, error?.stack ?? String(error))
  await shot('99-error').catch(() => {})
} finally {
  report.pageErrors = pageErrors.slice(0, 20)
  const projectsWithRuns = fs.readdirSync(dirs.projectsDir).filter((name) => fs.existsSync(path.join(dirs.projectsDir, name, '.nomi', 'runs')))
  check('C7 没有确认 / 报价卡、没有生成任务目录、0 个 pageerror', !cardSeen && projectsWithRuns.length === 0 && pageErrors.length === 0,
    JSON.stringify({ cardSeen, projectsWithRuns, pageErrors: pageErrors.length }))
  await app.close().catch(() => undefined)
  const removed = removeRealCredentials({ settingsDir: dirs.settingsDir, userDataDir: dirs.userDataDir, profile })
  const fingerprintAfter = realProfileFingerprint(profile)
  check('C8 原库凭据文件一字不差、副本凭据已删', removed && JSON.stringify(fingerprintAfter) === JSON.stringify(fingerprintBefore))
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(shotsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(failures.length ? `✗ ${failures.length} 条判据没过：${failures.join('、')}` : '✓ 全部判据通过')
  process.exitCode = failures.length ? 1 : 0
}
