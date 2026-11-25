#!/usr/bin/env node
// 真实用户任务（R13/R16，D2 第③步，SpendCardQ1 板）：**「帮我生成一张六棱柱」→ 我点卡上那一镜、去节点的生成框里
// 把清晰度改成 2K、提示词补半句 → 回到卡上按「生成」。然后呢？** —— 这一条把按下去那一刻**走完**：
// 真的发出去、真的出图、产物落回草稿那一刻建的那个节点、卡收起来。
//
// 卡上没有可改的东西（设计系统 §1.0：改参数的家只有节点；depcruise chat-card-no-import-node-editor 守）。
// 卡上那一镜的摘要从节点现算，所以节点上改了，卡上跟着变；按「生成」= 把这一镜交给画布，走的是节点 ↑ 那一条画布单节点提交，
// 发出去的就是节点上此刻那一份——「你批准的是 A、我们发出去的是 B」在结构上做不出来。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 走查像真人一样点：打字、看卡、点指向元素、在节点的生成框里换清晰度、接着打字、按「生成」——不灌 store、不直调桥。
//
// 这台机器上的模型**没有价目**：跑「干净装机」那一档（内置生成模型一条价都没有），卡上不说任何价格的话。
// 有价那一档由 `agent-spend-priced-card.walk.mjs` 走完。
//
// 2026-09-21 那条真 bug 的阳性对照留着：合同编译曾把候选里每个不在 `module.parameterSchema` 的参数整包丢掉，
// 线缆上跑的是档案默认值（卡上选 2K、供应商收到 1k）。现在参数从节点经画布那一台发出，断言照样钉「不能还是 1k」。
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  MONEY, NODE_COMPOSER, armCanvasBridges, canvasRunsOf, cardFacts, createPresenter, editNodeParameter, offerFacts,
  pointerAway, pointerFace, pressPrimary, primaryLabel, readRun, shotNodes,
} from './_spendCardWalk.mjs'
import { createRuntimeWalk, openCanvas, recorded } from './agent-runtime-walk-support.mjs'

// 目录里没有价目 = 干净装机的真实处境。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'

/** 在节点的生成框里接着打的那半句。挑一个原提示词里没有的词，线缆上找得到才算数。 */
const EDITED_PROMPT_TAIL = '，背景加一层薄雾'
const EDITED_RESOLUTION = '2K'
const LOCALE = 'zh-CN'

const present = createPresenter('S_SPEND_EXEC')
const walk = await createRuntimeWalk('spend-confirm-executes', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  await armCanvasBridges(win)
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // ① Agent 只起草——付费能力不在模型工具面里（paidBoundary），钱那一下只能由人按。卡摆在介入槽里等着。
  const { card, operationId, turnDone } = await present(walk, win, {
    locale: LOCALE, kind: 'image',
    shots: (tag) => [{
      title: `${tag} 六棱柱`, prompt: `${tag} 一个悬浮的六棱柱，柔和的演播室灯光`, taskKind: 'text_to_image',
      model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`, parameters: { aspect_ratio: '16:9' },
    }],
  })
  const cardProbe = await proveProbe(card, '付费卡摆在 Agent 面板的介入槽里')
  const [drafted] = await shotNodes(win, projectId, operationId)
  expect(drafted?.nodeId, '起草那一刻这一镜就落在画布上').toBeTruthy()
  await pointerAway(win)
  const before = await cardFacts(win)
  expect(before.title, '确认条不画标题问话（按钮说了「生成」）').toBeNull()
  expect(before.pointers.map((pointer) => pointer.id), '对话里那一组就是这一镜').toEqual([drafted.nodeId])
  expect(before.pointersOnBar, '确认条上一个指向元素都没有').toBe(0)
  expect(before.confirm?.text, '单张的主按钮是「生成」').toBe(primaryLabel(LOCALE, { count: 1, kind: 'image', single: true }))
  expect(before.editors, '卡上没有任何可改的东西（改参数的家只有节点）').toBe(0)
  expect(before.cardText, '这台机器算不出价：卡上不说任何价格的话').not.toMatch(MONEY)
  expect(walk.fixture.images, '卡还没按之前，一次供应商生成都没发生').toHaveLength(0)

  // ② 点卡上那一镜 → 节点的生成框为它打开 → 在那里把清晰度换成 2K（真的点开参数面板再选一项）。
  await clickOrFail(pointerFace(card, drafted.nodeId), '点对话里那一镜那一行')
  const composer = win.locator(NODE_COMPOSER)
  await expect(composer, '这一镜的生成框打开了').toBeVisible({ timeout: stationTimeout() })
  const resolution = await editNodeParameter(win, drafted.nodeId, 'resolution', { pick: EDITED_RESOLUTION })
  expect(resolution.after, '节点上的清晰度就是选完的那个').toBe(EDITED_RESOLUTION)

  // ②b 在同一个生成框里接着打半句提示词。
  const promptBox = composer.locator('[contenteditable="true"], textarea').first()
  await expect(promptBox, '生成框里的提示词框').toBeVisible()
  await promptBox.click()
  // 到整段提示词的末尾（不是这一个折行的行尾：单按 End 会把半句插进折行处）。
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await win.keyboard.type(EDITED_PROMPT_TAIL)
  await expect.poll(async () => (await shotNodes(win, projectId, operationId))[0]?.node?.prompt ?? '',
    { message: '打的字真的接在节点提示词的末尾', timeout: stationTimeout() }).toMatch(new RegExp(`${EDITED_PROMPT_TAIL}\\s*$`))
  await win.keyboard.press('Escape')
  await pointerAway(win)
  // 确认条那一行共同参数从节点现算：节点上改了，条上跟着说 2K（单镜时它的参数就是共同参数）。
  await expect.poll(async () => (await cardFacts(win))?.params ?? '', { message: '确认条那一行参数跟着节点说 2K', timeout: stationTimeout() }).toContain(EDITED_RESOLUTION)
  await walk.snap('spend-card-after-node-edit')

  // ③ 按「生成」。先等「有结论」再判对错：只等供应商的话，一次被拒会以超时的形状报出来，看不见卡上说的原因。
  await pressPrimary(card, '卡上的主按钮「生成」')
  await expect.poll(async () => {
    if (walk.fixture.images.length > 0) return 'sent'
    const facts = await cardFacts(win)
    const said = [...(facts?.notices ?? []).map((notice) => notice.text), ...(facts?.rowFailures ?? [])]
    return said.length ? `refused: ${said.join(' | ')}` : 'waiting'
  }, { message: '按下「生成」之后必须有结论（发出去了，或者卡上说了为什么不行）', timeout: stationTimeout({ operations: 6 }) }).toBe('sent')
  expect(flattenRequestText((await recorded(turnDone.received, 'generate returns once the user approved the card', stationTimeout({ operations: 6 }))).body),
    '模型读到「用户点了生成、已经开始生成」').toContain('All 1 shot(s) on the card are generating')

  // ③-b 发出去的就是节点上那一份：补的那半句、改后的清晰度都在线缆上。
  expect(walk.fixture.images, '供应商只收到这一笔').toHaveLength(1)
  const outbound = walk.fixture.images[0].body
  expect(String(outbound?.prompt ?? ''), '发出去的就是卡上那一镜').toContain('六棱柱')
  expect(String(outbound?.prompt ?? ''), '节点上补的那半句提示词随请求发到了供应商').toContain(`柔和的演播室灯光${EDITED_PROMPT_TAIL}`)
  // 线缆上的写法是小写档位串（apimart 那条 mapping 的 paramMap 对 resolution 做 toLowerCase）：按大小写归一之后比。
  expect(String(outbound?.resolution ?? '').toLowerCase(), '节点上选的清晰度真的出现在发给供应商的报文里').toBe(EDITED_RESOLUTION.toLowerCase())
  expect(String(outbound?.resolution ?? '').toLowerCase(), '不能还是档案默认的那一档——那正是「你批准的是 A、我们发出去的是 B」').not.toBe('1k')

  // 宿主账本：这一次出价按「已交给画布」关，这一镜是用户按「生成」交出去的；画布那一镜的单镜 Run 封进合同的请求带着 2K。
  await expect.poll(async () => (await offerFacts(win, projectId, operationId)).handOvers.map((entry) => `${entry.by}:${entry.outcome}`),
    { message: '这一镜的交接落定为「交到了」', timeout: stationTimeout({ operations: 6 }) }).toEqual(['gesture:accepted'])
  const offer = await offerFacts(win, projectId, operationId)
  expect(offer.closedBy, '出价按「已交给画布」关').toBe('handed_to_canvas')
  expect(offer.productionJobs, '制作 Run 自己一笔作业都没派（一台发动机：作业住在画布那一镜的单镜 Run 里）').toBe(0)
  const [canvasRun] = await canvasRunsOf(win, projectId, operationId)
  const sealed = (await readRun(win, projectId, canvasRun.runId))?.generationPlan?.candidate
  expect(JSON.stringify(sealed?.parameters?.request ?? null), '画布那一镜封进合同的请求带着节点上改后的清晰度').toMatch(/"resolution":"2k"/i)

  // ④ 产物真的落回草稿那一刻建的那个节点；卡答完就收起来；全程只有这一个节点。
  await expect.poll(async () => (await canvasRunsOf(win, projectId, operationId))[0]?.artifacts.length ?? 0,
    { message: '产物真的落盘——这就是用户说的「出图」', timeout: stationTimeout({ operations: 6 }) }).toBeGreaterThan(0)
  await expect.poll(async () => (await shotNodes(win, projectId, operationId))[0]?.node?.status,
    { message: '还是草稿那一刻建的那个节点，变成 success', timeout: stationTimeout({ operations: 6 }) }).toBe('success')
  await expectAbsent(card, { provenBy: cardProbe, message: '答完的卡要收起来（问题答完了就不该还在等人答）' }, stationTimeout({ operations: 6 }))
  const nodes = await win.evaluate(() => (window.__nomiCanvasStore?.getState().nodes ?? []).map((node) => node.id))
  expect(nodes, '全程只有一个节点（起草 / 改参数 / 出图共用同一个节点）').toEqual([drafted.nodeId])
  await walk.snap('spend-confirm-really-generated')

  walk.report.verified = [
    'card-waits-in-intervention-slot-with-no-editors', 'param-edited-on-the-node-card-summary-follows',
    'prompt-edited-on-the-node-reaches-the-wire', 'the-edit-really-reaches-the-provider-on-the-wire',
    'sealed-canvas-contract-carries-the-edit', 'the-node-really-gets-its-artifact-and-the-card-folds-away',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
