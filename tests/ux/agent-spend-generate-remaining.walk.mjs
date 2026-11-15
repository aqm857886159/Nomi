#!/usr/bin/env node
// 真实用户任务（R13，D2 第③步，SpendCardQ1 板，设计卡 ★1 任务 C）：卡上摆着三段视频，我先去节点上点 ↑ 生成了第 1 段，
// 再回到卡上点「生成剩下 2 段」。
//
//   · 节点上点 ↑：画布接走这一镜（和卡上交出去走的是同一条画布单节点提交）。卡上那一镜的指向元素跟着节点说「生成中」、
//     不再算在主按钮里，主按钮换成「生成剩下 2 段」（板 card.generate）；
//   · 卡上「不生成 ×」去掉一段 → 「生成剩下 1 段」；再点「恢复」→ 回到 2（去掉的不算在 N 里，board:SpendCardQ1/card.pointer.exclude）；
//   · 「生成剩下 2 段」：只交那两段（第 1 段不再发一次），供应商一共收到三笔、各一次；卡收起来，出价按「已交给画布」关，
//     回执照实说：两段是卡上交出去的、第 1 段是画布上接走的；对话流那一行指着三段（画布接走的也是这一次生成的）。
//   · 中英各一遍；每一遍都核「卡上摘要 = 节点参数 = 假上游收到的请求体」；
//   · 节点 ↑ 那一段和卡上交出去的两段，批准收据都是人点的手势、`humanActor` 逐字相同（同一个窗口、同一个 frame 铸的，
//     设计卡 §四 第 3 条要在真 App 里对照）。
//
// 「正在发出 k/N」与中途「先不发了」在 agent-spend-stop-midway.walk.mjs；卡本身每一态的长相在 design-lab-spend-card.walk.mjs。
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。不灌 store、不直调桥。
import path from 'node:path'

import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CARD_TITLE, EXCLUDE, RECEIPT_POINTERS, RESTORE,
  armCanvasBridges, canvasRunsOf, cardFacts, createPresenter, generateOnNode, nodeParams, offerFacts, pointerAway,
  pointerOf, pressPrimary, primaryLabel, rowOf, say, shotGestureReceipts, shotNodes, wireParams,
} from './_spendCardWalk.mjs'
import { CANVAS_PANEL, createRuntimeWalk, openCanvas, recorded } from './agent-runtime-walk-support.mjs'

const VIDEO = { providerId: 'apimart', modelId: 'doubao-seedance-2.0' }
const A = { generate: 'board:SpendAskSplit/ask.actions', exclude: 'board:SpendAskSplit/chat.rows.exclude' }

const present = createPresenter('S_REMAIN')

/** 供应商收到的每一笔（按提示词认回是哪一镜）。 */
function requestsByShot(walk, from, shots) {
  return walk.fixture.videos.slice(from).map((record) => {
    const facts = wireParams(record.body)
    const shot = shots.find((candidate) => candidate.node?.prompt && facts.prompt.includes(candidate.node.prompt))
    return { shotId: shot?.shotId ?? null, ...facts }
  })
}

/** 对话里那一镜那一行行尾的「不生成 ×」/「恢复」（「不生成 ×」悬停那一行才露出来，人就是这么点的；「恢复」常驻）。 */
async function toggleExclusion(card, nodeId, kind, label) {
  const cell = rowOf(card, nodeId)
  // 先进那一行（左上角，缩略图那一块）触发行 hover，行尾的小钮才露出来。
  await cell.hover({ position: { x: 4, y: 4 } })
  await clickOrFail(cell.locator(kind === 'exclude' ? EXCLUDE : RESTORE), label)
}

/** 整窗一张 + 卡的近景一张（整窗图里卡太小，字看不清）。拍之前把鼠标挪开：刚点过的按钮还停在悬停态。 */
async function snapCard(walk, win, card, label) {
  await pointerAway(win)
  const file = await walk.snap(label)
  await card.screenshot({ path: file.replace(/\.png$/, '-card.png') })
}

async function remainingRound(walk, win, { projectId, projectRoot }, locale) {
  const tag = locale === 'en' ? 'en' : 'zh'
  const round = await present(walk, win, {
    locale, kind: 'video',
    shots: (prefix) => [1, 2, 3].map((index) => ({
      title: `${prefix} 纸船 ${index}`, prompt: `${prefix} 纸船第 ${index} 镜：雨后清晨，纸船顺着水流漂`, taskKind: 'text_to_video', candidate: VIDEO,
    })),
  })
  const { card } = round
  const cardProof = await proveProbe(card, `${tag}：三段视频的付费卡摆出来了`)
  const nodes = await shotNodes(win, projectId, round.operationId)
  expect(nodes.every((shot) => shot.nodeId), `${tag}：三镜都落到了画布上`).toBe(true)
  await pointerAway(win)
  let facts = await cardFacts(win)
  expect(facts.confirm?.text, `${tag}：先是「全部生成（3）」`).toBe(primaryLabel(locale, { count: 3, kind: 'video' }))
  const videosBefore = walk.fixture.videos.length

  // 去节点上点 ↑：点第 1 个指向元素 → 生成框为它打开 → 生成。
  await generateOnNode(win, card, nodes[0].nodeId, `${tag}：在节点上生成第 1 镜`)
  await expect.poll(() => walk.fixture.videos.length - videosBefore, { message: `${tag}：节点上点 ↑ 发出一笔`, timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  await expect(card.locator('[data-v4-control="confirm"]'), `${A.generate}：画布接走第 1 镜之后，主按钮是「生成剩下 2 段」`)
    .toHaveText(new RegExp(escape(primaryLabel(locale, { count: 2, kind: 'video', remaining: true }))), { timeout: stationTimeout({ operations: 4 }) })
  await expect(card.locator(CARD_TITLE), `${tag}：确认条不画标题问话（按钮已经说了剩下几段）`).toHaveCount(0)
  facts = await cardFacts(win)
  expect(facts.pointers.map((pointer) => pointer.id), `${tag}：三个指向元素都还在（第 1 镜跟着节点说它在生成）`).toEqual(nodes.map((shot) => shot.nodeId))
  expect(facts.toggles.filter((toggle) => toggle.row === nodes[0].nodeId), `${tag}：画布接走的那一镜没有「不生成 ×」`).toEqual([])

  // 去掉第 3 段 → 「生成剩下 1 段」；恢复 → 回到 2。
  await toggleExclusion(card, nodes[2].nodeId, 'exclude', `${tag}：第 3 段「不生成 ×」`)
  await expect(card.locator('[data-v4-control="confirm"]'), `${A.exclude}：去掉的不算在 N 里`)
    .toHaveText(new RegExp(escape(primaryLabel(locale, { count: 1, kind: 'video', remaining: true }))), { timeout: stationTimeout({ operations: 4 }) })
  await snapCard(walk, win, card, `${tag}-remaining-one-excluded`)
  await toggleExclusion(card, nodes[2].nodeId, 'restore', `${tag}：第 3 段「恢复」`)
  await expect(card.locator('[data-v4-control="confirm"]'), `${A.exclude}：恢复之后回到 2`)
    .toHaveText(new RegExp(escape(primaryLabel(locale, { count: 2, kind: 'video', remaining: true }))), { timeout: stationTimeout({ operations: 4 }) })
  await snapCard(walk, win, card, `${tag}-remaining-two`)
  expect(walk.fixture.videos.length - videosBefore, `${tag}：去掉 / 恢复都不发请求`).toBe(1)

  // 「生成剩下 2 段」：只交那两段。
  await pressPrimary(card, `${tag}：「生成剩下 2 段」`)
  await expect.poll(() => walk.fixture.videos.length - videosBefore, { message: `${tag}：一共三笔——第 1 段不再发一次`, timeout: stationTimeout({ operations: 6 }) }).toBe(3)
  await expectAbsent(card, { provenBy: cardProof, message: `${tag}：每一段都定了，卡收起来` }, stationTimeout({ operations: 6 }))
  const receipt = flattenRequestText((await recorded(round.turnDone.received, `${tag}: generate returns once every shot is decided`, stationTimeout({ operations: 6 }))).body)
  expect(receipt, `${tag}：回执说卡上交出去的那两段在生成`).toContain('Generating now, because the user clicked generate for each of them')
  expect(receipt, `${tag}：回执说第 1 段是画布上接走的`).toContain('were taken over on the canvas while the card was open')
  const after = await shotNodes(win, projectId, round.operationId)
  const requests = requestsByShot(walk, videosBefore, after)
  expect(requests.map((request) => request.shotId).sort(), `${tag}：供应商收到的正好是这三段、各一次`).toEqual(after.map((shot) => shot.shotId).sort())
  for (const shot of after) {
    const request = requests.find((candidate) => candidate.shotId === shot.shotId)
    const expected = nodeParams(shot.node.meta)
    if (expected.aspect) expect(request.aspect, `${tag}：${shot.title} 发出去的比例 = 节点上的`).toBe(expected.aspect)
    if (expected.duration) expect(request.duration, `${tag}：${shot.title} 发出去的时长 = 节点上的`).toBe(expected.duration)
  }
  const offer = await offerFacts(win, projectId, round.operationId)
  expect(offer.closedBy, `${tag}：出价按「已交给画布」关`).toBe('handed_to_canvas')
  expect(offer.handOvers.map((entry) => entry.shotId).sort(), `${tag}：卡上交出去的只有第 2、3 段`).toEqual([after[1].shotId, after[2].shotId].sort())
  expect(offer.productionJobs, `${tag}：制作 Run 自己一笔作业都没派`).toBe(0)
  expect((await canvasRunsOf(win, projectId, round.operationId)).every((run) => run.jobs.length === 1), `${tag}：交出去的每一段一个画布单镜 Run、一笔作业`).toBe(true)
  // 设计卡 §四 第 3 条（真 App 对照，不靠读码）：节点上点 ↑ 的第 1 段和卡上交出去的第 2、3 段，收据是同一个窗口、同一个 frame 铸的。
  const gestures = await shotGestureReceipts(win, { projectId, projectRoot, capabilityDir: path.join(walk.report.tempRoot, 'capability'), operationId: round.operationId })
  expect(gestures.map((entry) => entry.via), `${tag}：第 1 段是节点上点的，第 2、3 段是卡上交出去的`).toEqual(['node', 'handover', 'handover'])
  expect(gestures.map((entry) => entry.receipts.length), `${tag}：三段各一张收据`).toEqual([1, 1, 1])
  expect(gestures.flatMap((entry) => entry.receipts.map((receipt) => receipt.decidedBy)), `${tag}：三张都是人点的手势`).toEqual(['human:gesture', 'human:gesture', 'human:gesture'])
  const actors = [...new Set(gestures.flatMap((entry) => entry.receipts.map((receipt) => receipt.humanActor)))]
  expect(actors, `${tag}：节点 ↑ 和卡上「生成」铸的收据，humanActor 逐字相同`).toHaveLength(1)
  expect(actors[0], `${tag}：humanActor 是这个窗口里的手势`).toMatch(/^web_contents:\d+:\d+:/)
  const receiptRow = win.locator(`${CANVAS_PANEL} ${RECEIPT_POINTERS}`).last()
  await expect(receiptRow, `${tag}：对话流那一行指着这一次生成的三段（画布接走的也算）`).toContainText(say(locale, 'agentPanelV4.spendCard.receiptSentVideo', { count: 3 }), { timeout: stationTimeout() })
  walk.fixture.releaseVideos()
  // 读画布 store（不读 DOM）：第二轮画布上已经有六个节点，React Flow 不渲染视口外的节点，DOM 里找不到它们。
  await expect.poll(async () => (await shotNodes(win, projectId, round.operationId)).map((shot) => `${shot.title}=${shot.node?.status ?? 'missing'}`), {
    message: `${tag}：三段都出了结果`, timeout: stationTimeout({ operations: 8 }),
  }).toEqual(after.map((shot) => `${shot.title}=success`))
  await expect(receiptRow, `${tag}：三段都出了结果，那一行说「已生成」`).toContainText(say(locale, 'agentPanelV4.spendCard.receiptGeneratedVideo', { count: 3 }), { timeout: stationTimeout() })
  return {
    requests: requests.map(({ shotId, aspect, duration, resolution }) => ({ shotId, aspect, duration, resolution })), handOvers: offer.handOvers,
    gestureReceipts: gestures.map((entry) => ({ shotId: entry.shotId, via: entry.via, receipts: entry.receipts })),
  }
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const walk = await createRuntimeWalk('spend-generate-remaining', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  await armCanvasBridges(win)
  const project = await walk.newProject()
  await openCanvas(win)
  walk.report.zh = await remainingRound(walk, win, project, 'zh-CN')

  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-control="input"]`), '换成英文之后回到画布、Agent 面板的输入框在').toBeVisible({ timeout: stationTimeout({ operations: 8 }) })
  walk.report.en = await remainingRound(walk, win, project, 'en')

  expect(walk.fixture.videos.length, '整个过程两轮各三笔：节点上点 ↑ 一笔 + 「生成剩下 2 段」两笔').toBe(6)
  walk.report.verified = [
    'node-up-takes-the-shot-card-says-generate-remaining', 'excluded-shot-not-counted-restore-brings-it-back',
    'generate-remaining-sends-only-the-rest-each-once', 'card-summary-node-wire-equal', 'offer-closes-handed-to-canvas',
    'receipt-says-taken-on-canvas-and-generating', 'receipt-row-points-at-all-three',
    'node-up-and-card-generate-mint-the-same-human-actor',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
