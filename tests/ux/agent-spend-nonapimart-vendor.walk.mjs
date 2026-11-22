#!/usr/bin/env node
// 真实用户任务（R13 · BL-1 的验收面）：**我在设置里接好的不是 APIMart 那一家**，我让 Agent
// 生成一张图，按下付款卡——它得真的跑起来，而且发出去的报文要跟我在画布上按生成时一模一样。
//
// ── 这条走查在证什么 ────────────────────────────────────────────────────────────
// BL-1 之前：`generationProviderBootstrap` 只为 `vendor.key === 'apimart'` 造 provider，
// 用户接好的 kie / 火山 / Higgsfield / 本地 ComfyUI / 自建中转在画布上按生成能跑，
// 同一个模型交给 Agent 付款卡就停在「供应商就绪」那一步，错误码 `configured_provider`
// ——一个**明明已经配好**的供应商，被告知「没配」。
//
// 选 Higgsfield 是因为它**处处与 APIMart 不同**，执行器留着任何一处写死的形状都过不去：
//   · 鉴权方案词是 `Key`（`Authorization: Key <id>:<secret>`），不是 Bearer；
//   · create 路径是模型 slug 本身（`/higgsfield-ai/soul/v2/standard`），不是 `/v1/images/generations`；
//   · 受理回的是 `request_id`，不是 `data[0].task_id`；
//   · 轮询是 `GET /requests/<id>/status`，不是 `/v1/tasks/<id>`；产物键是 `images[0].url`。
//
// 三条（全部是真人视角看得见的事）：
//   ① 卡在介入槽里等着——说明宿主**为这家造出了可提交的执行器**（此前这一步就没有卡，
//      因为草稿在供应商就绪那一关就被拒了）；
//   ② 按下去：供应商真的收到一次请求，**路径是这家自己的**、**鉴权方案词是 `Key`**、
//      提示词是卡上那一镜；
//   ③ 产物真的落回草稿那一刻建的那个节点。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_NON_APIMART_MODEL, FIXTURE_NON_APIMART_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import { cardFacts, offerFacts } from './_spendCardWalk.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const ASK = 'S_NONAPIMART：帮我生成一张雪山日出的图。'
const PLAN_CALL = 's-nonapimart-1'
const GENERATE_CALL = `${PLAN_CALL}-generate`

// 卡上「生成」交给画布那一台：它从本机夹具取回产物，按精确 origin 放行（只在未打包构建里读）。
const walk = await createRuntimeWalk('spend-nonapimart-vendor', { generationProvider: 'higgsfield', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  const planner = walk.fixture.expectText({
    label: 'the agent drafts a generation on a NON-APIMart provider the user configured',
    match: (body) => flattenRequestText(body).includes('S_NONAPIMART'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      shots: [{ prompt: '雪山日出，金色的光打在山脊上', taskKind: 'text_to_image',
        model: `${FIXTURE_NON_APIMART_MODEL}@${FIXTURE_NON_APIMART_VENDOR}`, parameters: {} }],
    } },
  })
  let operationId
  const draftResult = walk.fixture.expectText({
    label: 'the draft result carries the host-generated operationId',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'hold' },
  })
  const turnDone = walk.fixture.expectText({
    label: 'the drafting turn completes through the same SDK turn',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_NONAPIMART_DONE：草稿已就绪，等你确认。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'generation draft request')
  await recorded(draftResult.received, 'generation draft result')
  draftResult.release({ type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } })
  // 2026-09-22 裁决 A：`generate` **等**用户答完那张卡才返回——结果要到卡被答掉之后才有（见下）。

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)

  // ── ① 卡真的出现了 = 宿主为这家造出了可提交的执行器 ──
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProbe = await proveProbe(card, '非 APIMart 供应商的付费确认卡也进得了介入槽')
  expect(walk.fixture.images, '卡还没按之前，一次供应商生成都没发生').toHaveLength(0)
  await walk.snap('nonapimart-card-zh')

  // ── ② 按下去：真的发出去，而且发的是**这家自己的**那份报文 ──
  const nodeId = (await readProject(win, projectId)).payload.generationCanvas.nodes[0].id
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '卡上的主按钮「生成」', { noWaitAfter: true })
  // 先等「有结论」再判对错：被拒会写在那一镜那一行第二行里（不是超时的形状）。
  await expect.poll(async () => {
    if (walk.fixture.images.length > 0) return 'sent'
    const facts = await cardFacts(win)
    const said = [...(facts?.notices ?? []).map((notice) => notice.text), ...(facts?.rowFailures ?? [])]
    return said.length ? `refused: ${said.join(' | ')}` : 'waiting'
  }, { message: '按下「生成」之后，这家供应商必须真的收到一次生成请求（或者卡上说了为什么不行）', timeout: DEFAULT_TIMEOUT_MS }).toBe('sent')
  await recorded(turnDone.received, 'generate returns once the user pressed generate')
  // 一台发动机：这一镜是用户在卡上按「生成」交给画布的，作业住在画布那一镜的单镜 Run 里。
  await expect.poll(async () => (await offerFacts(win, projectId, operationId)).handOvers.map((entry) => `${entry.by}:${entry.outcome}`),
    { message: '这一镜交到了', timeout: DEFAULT_TIMEOUT_MS }).toEqual(['gesture:accepted'])
  expect((await offerFacts(win, projectId, operationId)).productionJobs, '制作 Run 自己一笔作业都没派').toBe(0)

  const call = walk.fixture.images[0]
  // ②-a 路径来自**这条 mapping 的声明**，不是某条写死的 APIMart 串
  expect(call.path, '发出去的路径是这家自己的模型 slug').toBe(`/${FIXTURE_NON_APIMART_MODEL}`)
  // ②-b 鉴权方案词来自**用户保存的那条连接**（Higgsfield 是 `Key`，不是 Bearer）。
  //     这一条就是群里那句「key 是对的啊，画布上能跑，怎么 Agent 上就 401」的机读判据。
  const authorization = String(call.headers?.authorization ?? call.headers?.Authorization ?? '')
  expect(authorization.startsWith('Key '), `鉴权方案词必须是 Key（实际：${authorization.slice(0, 12)}…）`).toBe(true)
  expect(authorization.includes('Bearer'), '绝不能退回写死的 Bearer').toBe(false)
  // ②-c 送出去的就是卡上那一镜
  expect(JSON.stringify(call.body), '发给供应商的就是卡上那一镜的提示词').toContain('雪山日出')

  // ── ③ 产物真的落回那个节点 ──
  await expect(win.locator(`[data-node-id="${nodeId}"][data-status="success"]`),
    '草稿那一刻建的那个节点在屏上变成 success').toBeVisible({ timeout: stationTimeout({ operations: 6 }) })
  await expectAbsent(card, { provenBy: cardProbe, message: '答完的卡要收起来' })
  await walk.snap('nonapimart-after-confirm-zh')

  walk.report.verified = ['non-apimart-provider-gets-an-executor-at-all',
    'outbound-path-comes-from-that-mapping-not-a-hardcoded-apimart-string',
    'auth-scheme-word-comes-from-the-saved-connection-Key-not-Bearer',
    'artifact-lands-on-the-node-the-draft-created']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
