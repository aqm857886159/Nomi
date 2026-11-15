#!/usr/bin/env node
// 剧本 PB02 · 「连着参考图生成」
//
// 已知问题（0.22.1）：参考图明明连着，付费卡确认后发出去的请求里没有它，花了钱出的是错图。
// 真实创作者会做的两件事，一条剧本里都做一遍（两条路走的是两台发动机，正好对照）：
//   A. 画布上：把一张参考图连到自己的卡上，点 ↑ 生成（画布直生成那条路）；
//   B. Agent：让 Agent 画一张「照着这张参考图」的图，卡还在等的时候，用户在画布上把参考图连到 Agent 起草的那张占位卡上，
//      再在付费卡上按「生成」（0.22.1 时这颗按钮叫「仍要生成」）。D2 起（2026-10-24）卡上点「生成」就是把这一镜照节点此刻的
//      样子交给画布、走画布单节点提交那一条路——和 A 是同一台发动机了，连着的参考图跟着节点发出去。
//   C. 同一招再来一张，这一次用户改主意不要那张参考：点卡上的指向元素到节点上，在画布上把那条线断开，再按「生成」：
//      供应商收到 0 张参考图（卡上没有参考图、也没有可改的东西，改只在节点上改）。
// 乱用：B 里先连线、后确认——用户就是这么做的（看到占位卡，顺手把参考图拖过去）。
//
// 零花费：A 用本机回环的「Fixture 图片」模型（画布直生成只认目录里的地址，回环那家就在本机）；
// B 的供应商是只认回环的制作夹具。任何打向真实供应商的请求都会被出网闸拦下并记成违反。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from '../../agent-runtime-fixture.mjs'
import { APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM, expandResidentPanel, sendCanvas } from '../../agent-runtime-walk-support.mjs'
import { clickBlank, clickNodeGenerate, connectNodes, disconnectEdge, fitCanvasView } from '../actions.mjs'
import { operationIdOf, scriptTurn } from '../brain.mjs'
import { readPlaybookEnvironment, startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const base = { categoryId: 'shots', references: [], runs: [] }
// 种子里的卡名和提示词是「用户自己写的」：英文那一场按英文用户写（中文的卡名在英文界面里会被判成漏译，那不是这一条要测的）。
const SEED_EN = readPlaybookEnvironment().locale === 'en'
const pb = await startPlaybook({
  id: 'pb02-reference-image',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  seed: ({ imageResult, imageMeta }) => ({
    nodes: [
      { ...base, id: 'ref-photo', kind: 'image', title: SEED_EN ? 'Reference: lead' : '参考：主角', prompt: '', position: { x: 80, y: 120 }, status: 'success',
        result: imageResult('ref-photo-r1', 2, 1), history: [imageResult('ref-photo-r1', 2, 1)], meta: imageMeta() },
      { ...base, id: 'my-card', kind: 'image', title: SEED_EN ? 'Beach' : '海边', prompt: SEED_EN ? 'He stands on the beach at dusk, backlit' : '他站在海边，黄昏，逆光', position: { x: 560, y: 120 }, status: 'idle', history: [],
        meta: { modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR, imageModel: FIXTURE_IMAGE_MODEL, imageModelVendor: FIXTURE_VENDOR } },
    ],
    groups: [],
    edges: [],
  }),
})
const { smoke, fixture, monitor } = pb
const EN = pb.locale === 'en'
const win = () => smoke.win
const edges = async () => (await monitor.readProject())?.payload?.generationCanvas?.edges ?? []
const nodes = async () => (await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []
const card = () => win().locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })

  // ── A：画布直生成 ─────────────────────────────────────────────────────────────────
  await monitor.step('A · 把参考图连到自己的卡上', () => connectNodes(win(), 'ref-photo', 'my-card', edges), { surfaces: ['canvasGesture'] })
  await monitor.step('A · 点这张卡的 ↑ 生成', async () => {
    await monitor.consentNodeGenerate('my-card', { label: '画布卡的 ↑' })
    await clickNodeGenerate(win(), 'my-card')
  }, { surfaces: ['modal', 'canvasGesture'] })
  await monitor.step('A · 等这张卡出图', async () => {
    // 对照组必须真出图：它失败了，「A 路带着参考发出去了」这条对照就只剩半句（第一版在这里收过 error，把夹具的假失败放过去了）。
    await expect.poll(async () => (await nodes()).find((node) => node.id === 'my-card')?.status,
      { message: '画布卡落成 success', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
  }, { user: false, surfaces: [] })

  // ── B：Agent 起草 → 画布上连参考 → 付费卡确认 ─────────────────────────────────────────
  await monitor.step('展开 Agent 面板', async () => { await clickBlank(win()); await expandResidentPanel(win()) }, { surfaces: ['agentPanel', 'rightPanel'] })
  const prompt = EN ? 'The same man standing on a beach at dusk, backlit' : '同一个人站在黄昏的海边，逆光'
  const turn = scriptTurn(fixture, {
    label: 'pb02-draft',
    marker: 'PB02',
    steps: [
      { name: 'draft_shots', args: { shots: [{ prompt, taskKind: 'text_to_image', model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`, parameters: { aspect_ratio: '1:1' } }] } },
      { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
      { text: EN ? 'Started.' : '好的，开始生成。' },
    ],
  })
  await monitor.step('用户：照着左边那张参考图画一张', () => sendCanvas(win(), EN
    ? 'PB02: use the reference photo on the left and draw him on a beach at dusk.'
    : 'PB02：照着左边那张参考图，画一张他在黄昏海边的图。'), { surfaces: [] })
  let placeholderId = null
  await monitor.step('等 Agent 起草、摆出付费卡', async () => {
    await expect(card(), 'Agent 起草完要摆一张付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
    await expect.poll(() => {
      const run = monitor.readRuns().at(-1)
      return run?.generationPlan?.nodeId ?? run?.generationPlan?.shots?.[0]?.nodeId ?? null
    }, { message: '起草的那一镜落成了画布占位卡', timeout: DEFAULT_TIMEOUT_MS }).toBeTruthy()
    const run = monitor.readRuns().at(-1)
    placeholderId = run.generationPlan.nodeId ?? run.generationPlan.shots[0].nodeId
  }, { user: false, surfaces: [] })

  await monitor.step('用户在画布上把参考图连到 Agent 起草的那张占位卡上', async () => {
    if (!placeholderId) throw new Error('没有占位卡可连')
    await connectNodes(win(), 'ref-photo', placeholderId, edges)
  }, { surfaces: ['canvasGesture'] })

  await monitor.step('在付费卡上点「生成」', async () => {
    await monitor.screenshot('B-card-with-canvas-reference')
    await monitor.consentSpendCard(card(), { label: '单镜卡的主按钮（画布上已连参考）' })
    await clickOrFail(card().locator(INTERVENTION_CONFIRM), '付费卡主按钮', { noWaitAfter: true })
  })
  await monitor.step('等出图、等这一轮说完', async () => {
    await expect.poll(() => fixture.images.filter((record) => record.path === '/v1/images/generations' && record.taskId).length,
      { message: '制作夹具收到这一镜', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThan(0)
    await turn.done
    await expect.poll(async () => (await nodes()).find((node) => node.id === placeholderId)?.status,
      { message: '占位卡落成 success', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
  }, { user: false, surfaces: [] })

  // ── C：改主意不要那张参考了——点卡上的指向元素到节点上，在画布上把那条线断开，再按「生成」────────────────────
  const promptC = EN ? 'The same man walking down a rainy street at night' : '同一个人走在雨夜的街头'
  const turnC = scriptTurn(fixture, {
    label: 'pb02-draft-c',
    // 记号不能含「PB02」：B 那一轮用完之后留着一个认「PB02」的重试应答，含它就会被 B 抢答。
    marker: 'PB2C',
    steps: [
      { name: 'draft_shots', args: { shots: [{ prompt: promptC, taskKind: 'text_to_image', model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`, parameters: { aspect_ratio: '1:1' } }] } },
      { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
      { text: EN ? 'Started.' : '好的，开始生成。' },
    ],
  })
  const runsBeforeC = monitor.readRuns().length
  await monitor.step('用户：再画一张雨夜街头的', () => sendCanvas(win(), EN
    ? 'PB2C: now draw him walking down a rainy street at night.'
    : 'PB2C：再画一张他走在雨夜街头的图。'), { surfaces: [] })
  let placeholderC = null
  await monitor.step('等 Agent 起草第二张、摆出付费卡', async () => {
    await expect.poll(() => {
      const run = monitor.readRuns().length > runsBeforeC ? monitor.readRuns().at(-1) : null
      return run?.generationPlan?.nodeId ?? run?.generationPlan?.shots?.[0]?.nodeId ?? null
    }, { message: '第二张落成了画布占位卡', timeout: stationTimeout({ turns: 1 }) }).toBeTruthy()
    await expect(card(), 'Agent 起草完要摆一张付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
    const run = monitor.readRuns().at(-1)
    placeholderC = run.generationPlan.nodeId ?? run.generationPlan.shots[0].nodeId
  }, { user: false, surfaces: [] })
  await monitor.step('用户在画布上把参考图连到第二张占位卡上', async () => {
    if (!placeholderC) throw new Error('没有第二张占位卡可连')
    // 第二张落在视野外：画布只渲染视野里的卡，像人一样先「适应视图」把两张都放进来再连。
    await fitCanvasView(win())
    await connectNodes(win(), 'ref-photo', placeholderC, edges)
  }, { surfaces: ['canvasGesture'] })
  const linesTo = async (nodeId) => (await edges()).filter((edge) => edge.target === nodeId)
  // D2 起（2026-10-24）卡上没有参考图、也没有可改的东西（付费卡① 第 8 行「卡上拿掉只改卡」随旧卡删了）：卡指着节点，
  // 参考住在节点上，想改就点指向元素到节点那里改。供应商收到的就是节点此刻的样子。
  await monitor.step('改主意：点卡上的指向元素到节点上，在画布上把那条参考线断开', async () => {
    const pointer = card().locator(`[data-node-pointer-id="${placeholderC}"]`)
    await monitor.screenshot('C-card-pointing-at-node')
    await clickOrFail(pointer, '付费卡上指着第二张的指向元素')
    await expect(pointer.locator('[data-node-pointer-located]'), '点了指向元素 = 定位到画布上那个节点（卡上记「已定位」）').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const [line] = await linesTo(placeholderC)
    if (!line) throw new Error('画布上没有连到第二张占位卡的线')
    await disconnectEdge(win(), line.id, edges)
    await expect(card(), '在节点上改了，卡还在、还指着它').toBeVisible()
    await monitor.screenshot('C-after-disconnecting-on-canvas')
  }, { surfaces: ['canvasGesture', 'agentPanel'] })
  const imagesBeforeC = fixture.images.filter((record) => record.path === '/v1/images/generations' && record.taskId).length
  await monitor.step('在付费卡上点「生成」（节点上已经没有那张参考图）', async () => {
    await monitor.consentSpendCard(card(), { label: '单镜卡的主按钮（参考线在节点上断开之后）' })
    await clickOrFail(card().locator(INTERVENTION_CONFIRM), '付费卡主按钮', { noWaitAfter: true })
  })
  await monitor.step('等第二张出图、等这一轮说完', async () => {
    await expect.poll(() => fixture.images.filter((record) => record.path === '/v1/images/generations' && record.taskId).length - imagesBeforeC,
      { message: '制作夹具收到第二张', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThan(0)
    await turnC.done
    await expect.poll(async () => (await nodes()).find((node) => node.id === placeholderC)?.status,
      { message: '第二张占位卡落成 success', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
  }, { user: false, surfaces: [] })
  await monitor.step('看一眼画布：第二张出图了，没有参考线', async () => {
    await fitCanvasView(win())
    await monitor.screenshot('C-canvas-after-generate')
  }, { surfaces: ['canvasGesture'] })

  await monitor.settle('三条路都生成完')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb02 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
