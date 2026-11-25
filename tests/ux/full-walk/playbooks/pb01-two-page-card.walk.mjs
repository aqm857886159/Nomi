#!/usr/bin/env node
// 剧本 PB01 · 「让 Agent 画两张图，我只要第 1 张：第 2 张点『不生成 ×』，再按生成」
//
// 已知问题（0.22.1，用户报告 U01 / U02）：两页的付费卡只在第 1 页点了「仍要生成」就整份开跑，第二张还没确认；Agent 说「已经开始跑」。
// 剧本 id 沿用那次报告。D2 起（2026-10-24）没有翻页了；2026-11-15 拆开后两段在对话里一行一个、输入框上方一条确认（共同参数 + 主按钮），
// 「只要第 1 张」就是悬停第 2 行、点行尾的「不生成 ×」再按主按钮。被测的还是同一件事：按钮许诺几镜就只发几镜，去掉的那一镜不跟着发出去，
// 没点的不悄悄没了，回执不说「都开始了」。
//
// 乱用：先把第 2 段去掉、恢复、再去掉一次才按；点完再点一下出好的那张图看看（节点角标），再在节点上按 ↑ 出一版。
// 变体由跑器指派：base（中文）/ en（英文界面，同一条路）。
//
// 零花费：大脑与供应商都是本机夹具；目录里不种价（= 今天每一台干净装机），卡上不说价格。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from '../../_assert.mjs'
import { findNodeHitPoint } from '../../_canvasHit.mjs'
import { OFFER_ROWS, ROW, SPEND_CARD, primaryLabel } from '../../_spendCardWalk.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from '../../agent-runtime-fixture.mjs'
import { CANVAS_PANEL, INTERVENTION_CONFIRM, expandResidentPanel, sendCanvas } from '../../agent-runtime-walk-support.mjs'
import { clickNodeGenerate } from '../actions.mjs'
import { operationIdOf, scriptTurn } from '../brain.mjs'
import { startPlaybook } from '../launch.mjs'

// 这条剧本的前提就是「目录里没有价目」（夹具读这个开关决定种不种价）。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const pb = await startPlaybook({
  id: 'pb01-two-page-card',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  seed: () => ({ nodes: [], groups: [], edges: [] }),
})
const { smoke, fixture, monitor } = pb
const EN = pb.locale === 'en'
const LOCALE = EN ? 'en' : 'zh-CN'
const ASK = EN
  ? 'PB01: draw two images for me — shot 1, a white cat on the windowsill of a morning cafe; shot 2, the barista doing latte art.'
  : 'PB01：帮我画两张图——镜1，清晨咖啡馆窗台上趴着一只白猫；镜2，同一家店里咖啡师在拉花。'
const SHOTS = EN
  ? ['A white cat lying on the windowsill of a morning cafe, soft light', 'The same cafe, a barista pouring latte art behind the counter']
  : ['清晨咖啡馆的窗台上趴着一只白猫，柔和的晨光', '同一家咖啡馆，吧台后的咖啡师在拉花']
const card = () => smoke.win.locator(SPEND_CARD)
/** 对话里那一组的每一行（含行尾小动作那一槽）。 */
const cells = () => smoke.win.locator(`${OFFER_ROWS} ${ROW}`)
// 主按钮还带着「⏎」：只认里面那一句（toContainText），不全等。
const primary = () => card().locator(INTERVENTION_CONFIRM)

/** 第 n 段（0 起）那一行行尾的小钮：「不生成 ×」平时藏着，悬停这一行才露出来、才点得到；「恢复」常驻。 */
async function toggleShot(index, kind, label) {
  const cell = cells().nth(index)
  if (kind === 'exclude') await cell.hover()
  await clickOrFail(cell.locator(`[data-spend-exclusion="${kind}"]`), label)
}

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })
  await monitor.step('展开 Agent 面板', () => expandResidentPanel(smoke.win), { surfaces: ['agentPanel', 'rightPanel'] })

  const turn = scriptTurn(fixture, {
    label: 'pb01-draft',
    marker: 'PB01',
    steps: [
      { name: 'draft_shots', args: { shots: SHOTS.map((prompt) => ({ prompt, taskKind: 'text_to_image', model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`, parameters: { aspect_ratio: '16:9' } })) } },
      { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
      // 大脑照宿主给它的那句回执说话（真实模型也会这么复述）。被测的是那句回执本身，监视器从夹具请求里读。
      { text: EN ? 'Done — generation has started.' : '好的，已经开始生成了。' },
    ],
  })
  // 这一轮起草的制作 Run（卡指着的两镜的计划在它身上）。D2 起每一镜交给画布后各有自己的单镜 Run（canvas- 开头），
  // 建得比它晚，所以不能拿「最后一个 Run」当它——按起草结果里的 operationId 找。
  const draftRun = async () => {
    const operationId = operationIdOf((await turn.arrivals[1]).previous)
    return monitor.readRuns().find((run) => run.runId === operationId || run.generationPlan?.operationId === operationId) ?? null
  }

  await monitor.step('用户：让 Agent 画两张图', () => sendCanvas(smoke.win, ASK), { surfaces: [] })
  await monitor.step('等 Agent 起草两镜、摆出付费卡', async () => {
    await expect(card(), 'Agent 起草完要在面板里摆一张付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
    await expect(cells(), '对话里那一组是两行').toHaveCount(2, { timeout: DEFAULT_TIMEOUT_MS })
    await expect(card().locator(INTERVENTION_CONFIRM), '主按钮说两段一起生成').toContainText(primaryLabel(LOCALE, { count: 2, kind: 'image' }))
  }, { user: false, surfaces: [] })

  await monitor.step('乱用：第 2 段点「不生成 ×」、恢复、再去掉一次', async () => {
    await toggleShot(1, 'exclude', '第 2 段的「不生成 ×」')
    await expect(cells().nth(1).locator('[data-spend-exclusion="restore"]'), '去掉的那一段常驻「恢复」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await toggleShot(1, 'restore', '第 2 段的「恢复」')
    await expect(primary(), '恢复之后主按钮又数两段').toContainText(primaryLabel(LOCALE, { count: 2, kind: 'image' }), { timeout: DEFAULT_TIMEOUT_MS })
    await toggleShot(1, 'exclude', '第 2 段的「不生成 ×」（再一次）')
    await expect(primary(), '主按钮只数还要生成的第 1 段').toContainText(primaryLabel(LOCALE, { count: 1, kind: 'image' }), { timeout: DEFAULT_TIMEOUT_MS })
  })

  await monitor.step('按主按钮（只交第 1 段）', async () => {
    await monitor.consentSpendCard(card(), { label: '第 2 段去掉之后的主按钮' })
    await clickOrFail(card().locator(INTERVENTION_CONFIRM), '付费卡主按钮', { noWaitAfter: true })
  })

  // 每一段都定了（第 1 段交给画布、第 2 段用户去掉了）：卡自己关掉，对话流里留一行回执。
  await monitor.step('卡关掉了；等出图、等这一轮 Agent 说完', async () => {
    await expect(card(), '每一段都定了，卡自己关掉').toHaveCount(0, { timeout: stationTimeout({ operations: 2 }) })
    await expect.poll(() => fixture.images.length, { message: '供应商至少收到一笔', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThan(0)
    await turn.done
    await expect(smoke.win.locator(`${CANVAS_PANEL} [data-v4-block="composer"][data-mode="running"]`), '这一轮落地').toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
    await expect.poll(async () => {
      const run = await draftRun()
      const nodeIds = (run?.generationPlan?.shots ?? []).map((shot) => shot.nodeId).filter(Boolean)
      const nodes = (await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []
      return nodes.filter((node) => nodeIds.includes(node.id) && node.status === 'success').length
    }, { message: '第 1 段落成 success', timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThan(0)
  }, { user: false, surfaces: [] })

  await monitor.settle('第 1 段生成完')

  let landedId = ''
  await monitor.step('乱用：点一下出好的那张图', async () => {
    const run = await draftRun()
    const nodes = (await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []
    const landed = (run?.generationPlan?.shots ?? []).map((shot) => nodes.find((node) => node.id === shot.nodeId)).find((node) => node?.status === 'success')
    if (!landed) throw new Error('找不到落地的那一镜')
    landedId = landed.id
    const point = await findNodeHitPoint(smoke.win, { nodeSelector: `[data-node-id="${landed.id}"]` })
    if (!point) throw new Error(`节点 ${landed.id} 在舞台上没有点得到的地方`)
    await smoke.win.mouse.click(point.x, point.y)
    await expect(smoke.win.locator(`[data-node-id="${landed.id}"]`).first()).toHaveAttribute('data-selected', 'true')
  }, { surfaces: [] })

  await monitor.step('停一会儿，看节点上挂着什么', async () => {
    await smoke.win.waitForTimeout(monitor.limits.terminalSpinnerGraceMs.value + 1000)
  }, { user: false, surfaces: [] })

  // 乱用：对这一张不满意，想再来一张。10-06 起浮条里不再有「重拍这镜」（用户拍板删：它和「再出一版」分不清）——
  // 再出一版就在这张节点上按 ↑（一次一版，铺开的版本卡片会多一张）。上一步已经点选了这张图。
  await monitor.step('乱用：对这一张不满意，在节点上按 ↑ 再出一版', async () => {
    await monitor.consentNodeGenerate(landedId, { label: '再出一版的 ↑' })
    await clickNodeGenerate(smoke.win, landedId)
  }, { surfaces: ['modal', 'canvasGesture'] })
  await monitor.step('等再出的这一版有个结果', async () => {
    await smoke.win.waitForTimeout(monitor.limits.schedulerPollCapMs.value)
  }, { user: false, surfaces: [] })

  await monitor.settle('收尾')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb01 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
