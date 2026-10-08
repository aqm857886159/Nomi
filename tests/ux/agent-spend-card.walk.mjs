#!/usr/bin/env node
// 真实用户任务（R13/R16）：**「帮我生成一张六棱柱」之后，钱这一步长什么样。**
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 走查像真人一样点：在面板里打字、看卡、在卡上改参数、按那颗印着价的按钮——
// 不灌 store、不直调桥、不伪造待决状态。
//
// T7 双宿主邻接：真实 Agent draft→generate 出卡；真实键盘/参数输入；关闭不删节点或历史；
// 同一 operation 再 generate 恢复隔离草稿；ZH/EN 截图。远端仅零额度 loopback。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import { checkSpendScopeJourney } from './_agentSpendScopeJourney.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { readLaneSpend } from './_laneSpendProbe.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, INTERVENTION_CONFIRM_REJECT, INTERVENTION_REJECT,
  PERMISSION_POPOVER, permissionTier,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const ASK = 'S_SPEND_ASK：帮我生成一张六棱柱的图。'
const PLAN_CALL = 's-spend-plan-1'
const GENERATE_CALL = `${PLAN_CALL}-generate`
const PRICE_TOTAL = '[data-v4-price="total"]'
/** 账本里那一份草稿的提示词。× 收回出价之后它一个字不丢，重新出价时原样回到卡上。 */
const DRAFTED_PROMPT = '一个悬浮的六棱柱，柔和的演播室灯光'

const walk = await createRuntimeWalk('spend-card')
let failure
try {
  let { win } = await walk.start({ first: true })
  const { projectId, name } = await walk.newProject()
  await openCanvas(win)
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="composer"]`)).toHaveAttribute('data-spend-policy', 'confirm')

  // ① agent 建草稿。付费能力按设计不在模型工具面里（paidBoundary），所以它能做的只有建草稿——
  // 「这笔钱花不花」必须由面板上那张卡来问，这正是本走查要证明的东西。
  const planner = walk.fixture.expectText({
    label: 'the agent drafts a generation instead of spending on its own',
    match: (body) => flattenRequestText(body).includes('S_SPEND_ASK'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      // 20 动词：draft_shots 建草稿（落画布、不出卡），generate 才把报价卡摆到用户面前。
      shots: [{ prompt: DRAFTED_PROMPT, taskKind: 'text_to_image', candidate: { providerId: FIXTURE_VENDOR, modelId: FIXTURE_IMAGE_MODEL }, parameters: { size: '1024x1024' } }],
    } },
  })
  let operationId
  const plannerDoneDraft = walk.fixture.expectText({
    label: 'the draft result comes back with the host-generated operationId',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'hold' },
  })
  const plannerDone = walk.fixture.expectText({
    label: 'the drafting turn completes through the same SDK turn',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_SPEND_DONE：草稿已就绪，等你确认。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'generation draft request')
  await recorded(plannerDoneDraft.received, 'generation draft result')
  plannerDoneDraft.release({ type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } })
  // 2026-09-22 裁决 A：`generate` **等**用户答完那张卡才返回（等待住在审批闸里，不计工具超时）。
  // 所以这里不再等它的结果——结果要到下面 × 之后才有；那时回合在同一轮里读到「用户没同意」。

  // 草稿落画布（一本账）：节点先出现，用户看得见 agent 到底要生成什么。
  await expect.poll(async () => {
    return (await readProject(win, projectId)).payload.generationCanvas.nodes.length
  }, { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const node = (await readProject(win, projectId)).payload.generationCanvas.nodes[0]
  expect(node.meta.modelKey, '落地的节点必须带 agent 定的模型身份').toBe(FIXTURE_IMAGE_MODEL)

  // 面板出卡。它是**介入槽**里的一张卡，不是居中弹窗——单轨化的可见证据。
  let card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProof = await proveProbe(card, 'The paid confirmation lives in the agent panel intervention slot')
  // 价格是宿主按目录 pricing 算出来的数字，不是标签。
  await expect(card.locator(PRICE_TOTAL)).toContainText('0.30')
  // 卡体就是画布节点那张生成框整件：提示词在卡上，不是留在画布上（v1 被打回的那个窟窿）。
  await expect(card).toContainText('六棱柱')
  await expect(card.locator('[data-parameter-summary]'), '付款卡沿用原参数 chips，不并存画布摘要 pill').toHaveCount(0)
  await walk.snap('spend-card-in-intervention-slot')
  await expect(win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }),
    'agent 代发的付费确认不许再弹居中卡').toHaveCount(0)

  // Existing pending spend keeps its explicit confirmation boundary when permission changes.
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
  await expect(win.locator(`${CANVAS_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('project')}`), '切到「全自动」')
  const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard).toBeVisible()
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到全自动')
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="auto-mode"]`), '全自动档要有常驻提醒').toBeVisible()
  await expect(card, '付费卡在切档之后仍然等着人答——钱不因档位放行').toBeVisible()
  await expect(card.locator(PRICE_TOTAL), '让位回来之后价格一个字都没变——它没有倒计时，等多久都行').toContainText('0.30')
  expect(walk.fixture.images, '切档不提交待确认生成').toHaveLength(0)
  await walk.snap('spend-card-still-waiting-under-full-auto')


  const canvasParameters = win.locator('[data-composer-host="canvas"] [data-parameter-summary]')
  await expect(canvasParameters).toBeVisible()
  await expect.poll(() => canvasParameters.evaluate(button => {
    const rect=button.getBoundingClientRect()
    const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)
    return Boolean(hit && button.contains(hit))
  }),{message:'The canvas parameter control must receive clicks above the bottom workspace docks'}).toBe(true)
  await clickOrFail(canvasParameters,'底部停靠区上方的画布参数控件')
  const canvasParameterPanel = win.locator('[data-agent-parameter-panel="true"]')
  await expect(canvasParameterPanel).toBeVisible()
  await clickOrFail(canvasParameterPanel.locator('[role="radio"][aria-checked="true"]:not([disabled])').first(),'保持原值并验证参数选项实际可点')
  await win.keyboard.press('Escape')

  // 用户自己从左缘工具条建一个节点：它身上没有物化章，× 那一刻必须一个字都不动。
  await addCanvasNodeFromRail(win, 'image')
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
  const before = structuredClone((await readProject(win, projectId)).payload.generationCanvas.nodes)
  const userNodeId = before.map(entry => entry.id).find(id => id !== node.id)
  expect(Boolean(userNodeId), '用户自建节点要真的落在画布上').toBe(true)
  let input = card.locator('[data-composer-host="panel"] [contenteditable="true"]')
  await expect(input).toBeVisible()
  await expect.poll(() => input.evaluate(element => {
    const rect=element.getBoundingClientRect(), style=getComputedStyle(element)
    const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)
    return rect.width>0 && rect.height>0 && style.visibility==='visible' && Boolean(hit && element.contains(hit))
  })).toBe(true)
  await input.click()
  await win.keyboard.press('ControlOrMeta+A')
  const draftPrompt = 'T7 isolated payment draft / 未批准草稿'
  await win.keyboard.insertText(draftPrompt)
  await expect(input).toHaveText(draftPrompt)
  let sizeChip = card.locator('[data-parameter-chip] button[aria-label="尺寸"]').first()
  await clickOrFail(sizeChip, '付款卡真实尺寸参数')
  await clickOrFail(win.getByRole('option', { name: '1536x1024', exact:true }).first(), '修改未批准尺寸')
  await expect(sizeChip).toContainText('1536x1024')
  expect((await readProject(win, projectId)).payload.generationCanvas.nodes, '未批准输入不得更改画布内容/历史').toEqual(before)
  expect(walk.fixture.images, '编辑未批准卡不发媒体请求').toHaveLength(0)
  await walk.snap('spend-card-zh-edited-isolated')

  // ── × = **收回这一次出价**，草稿和画布都留着（2026-09-22 下午用户拍板，改窄裁决 D）──────────
  // 用户原话：「第二种，× 只关这次请求，节点和草稿都留着」。所以这里钉的是：
  //   ① 卡走了、这一笔不再待决；
  //   ② 画布**一个节点都不动**——这次操作落的占位、用户自己建的那个，全都原样在（09-21 Q3 的
  //      「× 永远不删用户自己建的节点」是这条的一个子集）；
  //   ③ 计划本身留着，后面那一段证明同一个 operationId 还能重新出价。
  // 这两刀之间那一版（× 撤掉卡上摆出来的那几镜的占位）在 33 镜的计划上说不通：卡上摆 3 镜，
  // 撤 3 个、留 30 个孤儿，而且撤掉的那几个会被落地轮询重建（「点了 ×，画布上多出一个节点」那条红）。
  const cardShotNodeIds = (await readProject(win, projectId)).payload.generationCanvas.nodes.map(entry => entry.id).sort()
  // × 是**一下**：2026-09-22 之前这里先摊开一句「你在卡上改的内容会一起丢掉」再要第二下确认，
  // 而那句话已经不为真（裁决 D + 草稿锚 operationId：× 什么都不丢），文案与它那一支渐进披露同刀删。
  // 死锚点两头骗人（docs/lessons/dead-selector-lies-both-ways.md），所以这里钉它**确实不在**，
  // 不留一个 `isVisible().catch(false)` 的软分支替它遮。
  const rejectNote = card.locator('[data-v4-control="reject-confirm-note"]')
  await clickOrFail(card.locator(INTERVENTION_REJECT), '收回这次出价（一下就撤，没有第二问）')
  await expect(rejectNote, '× 不再问「改的内容会一起丢掉」——它不会丢').toHaveCount(0)
  await expect(card.locator(INTERVENTION_CONFIRM_REJECT), '付费卡的 × 没有第二下').toHaveCount(0)
  await expectAbsent(card, {provenBy:cardProof,message:'关闭后付款卡退出介入槽'})
  // × 把结论递回正在等的那个回合：`generate` 以**成功形状**返回「用户没同意这次」，模型照着收尾。
  const declinedTurn = flattenRequestText((await recorded(plannerDone.received, 'generate returns once the user closed the card')).body)
  // 付费卡逐镜（2026-09-30）：回执渲染宿主的逐镜结局——没决定的这一镜「没生成、没花钱」，原因是他关了卡。
  expect(declinedTurn, '模型读到的是「他关了这张卡」，不是一个错误').toContain('the user closed the card (×) before deciding them')
  expect(declinedTurn, '而且要读到「草稿和占位都还在」——否则它会替他重新起草一份')
    .toContain('The draft keeps them with their placeholders')
  // 「× 之后画布不多也不少」：落地轮询在这段时间里对这份计划又跑过好几趟。
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.map(entry => entry.id).sort(),
    { timeout: DEFAULT_TIMEOUT_MS, message: '× 一个节点都不删：这次操作落的占位和用户自建的那个都在' })
    .toEqual(cardShotNodeIds)
  expect(cardShotNodeIds, '探针：画布上确实有这次操作的占位 + 用户自建那个两个节点')
    .toEqual(before.map(entry => entry.id).sort())
  expect(walk.fixture.images, '关闭不提交媒体').toHaveLength(0)
  const requestsBeforeCold = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  expect(walk.report.launches[1].pid).not.toBe(walk.report.launches[0].pid)
  const projectCard = win.locator('[data-project-card="true"]').filter({hasText:name})
  await expect(projectCard).toBeVisible()
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button',{name:/继续创作/}), '冷启动重开关闭确认卡的项目')
  await win.waitForFunction(id => location.href.includes(`projectId=${encodeURIComponent(id)}`),projectId)
  await openCanvas(win)
  card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  input = card.locator('[data-composer-host="panel"] [contenteditable="true"]')
  sizeChip = card.locator('[data-parameter-chip] button[aria-label="尺寸"]').first()
  await expectAbsent(card,{provenBy:cardProof,message:'冷启动不会复活已关闭的旧确认卡'})
  // Existing projectV51ToV60Migration fills this derived renderer hint on reopen.
  // Keep the full-node comparison for the agent's own shot: no other field may change
  // across dismissal / undo / restart. 用户自建那个只比身份（它的派生提示走别的迁移）。
  const restoredShot = { ...before.find(entry => entry.id === node.id), renderKind: 'shot-frame' }
  const nodesAfterRestart = () => readProject(win, projectId).then(record => record.payload.generationCanvas.nodes)
  expect((await nodesAfterRestart()).map(entry => entry.id).sort()).toEqual(before.map(entry => entry.id).sort())
  expect((await nodesAfterRestart()).find(entry => entry.id === node.id)).toEqual(restoredShot)
  expect(walk.fixture.images,'冷启动不提交媒体').toHaveLength(0)
  expect(walk.fixture.requests,'冷启动不重新请求模型').toHaveLength(requestsBeforeCold)
  await walk.snap('spend-card-cold-closed-no-resurrection')
  // ── × 收回的是**这一次出价**：同一个 operationId 再 generate = 重新出价 ────────────────────
  //
  // 2026-09-22 下午用户拍板改窄裁决 D：「× 只关这次请求，节点和草稿都留着」。所以这一段钉回它本来
  // 钉的那件事——模型对**同一个** operationId 叫一次 generate，那张卡就回来了，草稿一个字不用重写。
  // （当天上午那一版在这里钉的是相反的：旧 id 被拒、模型必须 draft_shots 重新起草出一个新 id。
  //  它让 33 镜的计划在 × 之后变成孤儿，已被推翻。）
  const REOPEN_GENERATE = 'spend-reopen'
  const reopen = walk.fixture.expectText({label:'the model re-quotes the same withdrawn draft',
    match:body=>flattenRequestText(body).includes('S_SPEND_REOPEN'),
    reply:{type:'tool',id:REOPEN_GENERATE,name:'generate',args:{operationId}}})
  const reopenDone = walk.fixture.expectText({label:'the re-quoted request reaches its card',
    match:body=>(body.messages??[]).some(message=>message.role==='tool' && message.tool_call_id===REOPEN_GENERATE),
    reply:{type:'text',text:'S_SPEND_REOPEN_DONE：还是这份草稿，等你确认。'}})
  await sendCanvas(win, 'S_SPEND_REOPEN：还是生成吧。')
  await recorded(reopen.received, 'generate on the same operation')
  await expect(card, '同一个 operationId 再 generate，卡就回来了（不用重新起草）').toBeVisible()
  // 草稿一个字不丢，**没提交的手改也一个字不丢**（T-QA-30，2026-09-22 修）：
  // 卡上回来的是「账本里那份候选 ⊕ 他自己改的那一层」——他正在打的那句话、刚点的那个尺寸都在。
  // 账本锚的是这一次生成（`spendDraftKey` 只含 projectId/runId/operationId），重新出价换的
  // 只是报价指纹，换不掉他的地址。
  await expect(input, '重新出价回来的是他没提交的那句话，不是原候选').toHaveText(draftPrompt)
  await expect(sizeChip, '他改过的尺寸也跟着回来').toContainText('1536x1024')
  // 而宿主那份候选**没被偷偷改过**：手改只活在卡上，直到他按「生成」。
  const pendingRows = await readLaneSpend(win)
  expect(pendingRows?.surface, '探针：待决投影（推给面板的那一份）这一刻真的读得到').toBe('ready')
  expect(pendingRows.rows[0]?.operationId, '重新出价的是同一次生成').toBe(operationId)
  expect(pendingRows.rows[0]?.shots[0]?.prompt, '没提交的手改没有落进宿主候选').toBe(DRAFTED_PROMPT)
  expect((await nodesAfterRestart()).find(entry => entry.id === node.id), '重新出价不动画布').toEqual(restoredShot)
  expect(walk.fixture.images, '重新出价不提交').toHaveLength(0)
  await walk.snap('spend-card-zh-requoted-same-draft')
  // （这里原来有一段「切 EN → win.reload() → 卡还在」。2026-09-22 裁决 A 之后它不再成立，而且不该成立：
  //  等这张卡的那个回合住在这扇窗的 lane 里，渲染层重挂 = 那条 lane 关了 = 出价收回（卡不留成没人等的孤儿）。
  //  EN 轨的长相由 priced-card / unknown-price 两条走查钉；「窗没了 → 出价收回、计划留着」由
  //  `agent-spend-waiting-owner.walk.mjs` 钉。）
  // 这张卡也用 × 收掉（像人一样点），让后面的范围旅程从一块干净的介入槽开始。
  await clickOrFail(card.locator(INTERVENTION_REJECT), 'withdraw the re-quoted request')
  await expect(card.locator(INTERVENTION_CONFIRM_REJECT), 'the re-quoted card withdraws in one click too').toHaveCount(0)
  await expectAbsent(card, { provenBy: cardProof, message: 'the re-quoted card leaves the slot once withdrawn' })
  await recorded(reopenDone.received, 'the second generate returns once its card was closed too')
  expect((await nodesAfterRestart()).map(entry => entry.id).sort(), '两次 × 之后画布节点一个不多也一个不少')
    .toEqual(before.map(entry => entry.id).sort())
  expect(walk.fixture.images, '整场零媒体提交').toHaveLength(0)
  walk.report.verified = ['card-still-waits-under-full-auto', 'agent-draft-generate-real-card','real-keyboard-and-parameter-draft-only',
    'decline-withdraws-only-the-quote','canvas-untouched-by-decline','user-built-node-survives-decline',
    'cold-process-reopen-no-old-card','same-operation-requotes-the-same-draft',
    'requote-restores-unsubmitted-card-edits','withdraw-asks-nothing-because-nothing-is-lost']
  await checkSpendScopeJourney(walk, win)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
