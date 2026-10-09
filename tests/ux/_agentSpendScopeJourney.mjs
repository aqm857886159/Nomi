// Extend the original spend walk: real Agent tools and original single-slot UI.
// This supplier has no durable execution adapter. No confirmation or media claim here.
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { readLaneSpend } from './_laneSpendProbe.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import { APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_PERMISSION, INTERVENTION_REJECT,
  createRuntimeWalk, hasToolResult, openCanvas, permissionTier, readProject, recorded, sendCanvas,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

/** @param {Awaited<ReturnType<typeof createRuntimeWalk>>} walk */
export async function checkSpendScopeJourney(walk, win) {
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await clickOrFail(win.getByRole('button', { name: '返回项目库', exact: true }), '回原项目库建立独立 CJ1 项目')
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  const panel = win.locator(CANVAS_PANEL)
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), '退出前段全自动档')
  await clickOrFail(panel.locator(permissionTier('safe-auto')), '原权限菜单选择确认付费')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'safe-auto')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-spend-policy', 'confirm')
  const card = panel.locator(`${APPROVAL_CARD}[data-kind="spend"]`)
  const input = card.locator('[data-composer-host="panel"] [contenteditable="true"]')
  const size = card.locator('[data-parameter-chip="size"]')
  const pager = card.locator('[data-v4-block="pager"]')
  const graph = async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes, edges: canvas.edges, groups: canvas.groups ?? [] }
  }
  const runs = () => win.evaluate(id => window.nomiDesktop.productionRuns.list(id), projectId)
  const readRun = operationId => win.evaluate(({ projectId, operationId }) => window.nomiDesktop.productionRuns.read(projectId, operationId), { projectId, operationId })
  const pending = async () => {
    // 宿主那一份待决出价，读的是推给面板的对话投影（唯一来路）。
    const read = await readLaneSpend(win)
    expect(read?.surface).toBe('ready')
    return read.rows
  }
  let turn = 0
  // 一步的工作量随镜头数涨（33 镜草稿要落 33 个节点，本机实测 125–140 秒），安全上限按镜头数给，不用固定 60 秒。
  const toolTurn = async (name, args, bound = stationTimeout({ turns: 1, operations: 1 })) => {
    const id = `CJ1_TOOL_${++turn}`, done = `${id}_DONE`
    const request = walk.fixture.expectText({ label: id, match: body => flattenRequestText(body).includes(id),
      reply: { type: 'tool', id, name, args } })
    const result = walk.fixture.expectText({ label: done, match: body => hasToolResult(body, id), reply: { type: 'text', text: done } })
    await sendCanvas(win, `${id}：执行这一条分镜操作，保留其他草稿。`)
    await recorded(request.received, id, bound)
    await recorded(result.received, done, bound)
    await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(done, { exact: true }), doneTimeout: bound })
  }
  const draft = async shots => {
    const before = new Set((await runs()).map(run => run.runId))
    await toolTurn('draft_shots', { shots }, stationTimeout({ turns: 1, operations: shots.length }))
    await expect.poll(async () => (await runs()).filter(run => !before.has(run.runId)).length).toBe(1)
    // IDs come from the real host; create schema intentionally forbids caller shotId.
    return (await runs()).find(run => !before.has(run.runId)).runId
  }
  // 2026-09-22 裁决 A：`generate` **等**用户答完那张卡才返回（等待住在审批闸里，不计工具超时）。
  // 所以出卡这一步只等到「请求发出去、卡出现」；那一轮的结果要到卡被答掉之后才有——`settled()` 到那时再等。
  const present = async (operationId, shotIds) => {
    const id = `CJ1_TOOL_${++turn}`, done = `${id}_DONE`
    const request = walk.fixture.expectText({ label: id, match: body => flattenRequestText(body).includes(id),
      reply: { type: 'tool', id, name: 'generate', args: { operationId, shotIds } } })
    const result = walk.fixture.expectText({ label: done, match: body => hasToolResult(body, id), reply: { type: 'text', text: done } })
    await sendCanvas(win, `${id}：执行这一条分镜操作，保留其他草稿。`)
    await recorded(request.received, id)
    await expect.poll(async () => (await pending()).find(row => row.operationId === operationId)?.shots.map(shot => shot.shotId)).toEqual(shotIds)
    await expect(card).toBeVisible()
    return { settled: async () => flattenRequestText((await recorded(result.received, done)).body) }
  }
  const pageTo = async index => {
    const current = /([1-3])\/3/.exec(await pager.innerText())
    expect(current, 'Pagination belongs to the three requested shots, not the 33-item plan').toBeTruthy()
    for (let step = 0; step < (index + 3 - Number(current[1])) % 3; step++) await clickOrFail(pager.locator('[data-v4-control="pager-next"]'), '原三卡翻页')
    await expect(pager).toContainText(`${index}/3`)
  }
  const makeShot = (index, role = 'shot') => ({ role, title: `CJ1 ${role} ${index}`, prompt: `CJ1_${role}_${index} 原始画面`,
    ...(role === 'anchor' ? { storyboard: { kind: 'character', carrier: 'visual' } } : {}),
    taskKind: 'text_to_image', candidate: { providerId: FIXTURE_VENDOR, modelId: FIXTURE_IMAGE_MODEL }, parameters: { size: '1024x1024' } })
  const baselineGraph = await graph()
  const operationId = await draft(Array.from({ length: 33 }, (_, index) => makeShot(index + 1, index < 3 ? 'anchor' : 'shot')))
  const originalShots = (await readRun(operationId)).generationPlan.shots
  expect(originalShots).toHaveLength(33)
  expect(originalShots.filter(shot => shot.role === 'anchor')).toHaveLength(3)
  const requestedIds = originalShots.slice(0, 3).map(shot => shot.shotId)
  // draft_shots on the canvas creates 33 media nodes and the existing shot table.
  // generate only presents the three requested confirmations; it must reuse them.
  await expect.poll(async () => (await graph()).nodes.length).toBe(baselineGraph.nodes.length + 34)
  const draftedGraph = await graph()
  const baselineIds = new Set(baselineGraph.nodes.map(node => node.id))
  const createdNodes = draftedGraph.nodes.filter(node => !baselineIds.has(node.id))
  expect(createdNodes.filter(node => node.kind === 'shot_table')).toHaveLength(1)
  expect(createdNodes.filter(node => node.kind === 'image').map(node => node.prompt).sort())
    .toEqual(originalShots.map(shot => shot.candidate.prompt).sort())
  const firstTurn = await present(operationId, requestedIds)
  expect(await graph()).toEqual(draftedGraph)
  const initialGraph = await graph()
  // 付费卡逐镜（2026-09-30）：点名摆上卡只开一次出价，不改这一批——33 镜原样留着（以前会把没点名的 30 镜移出这一批）。
  const presentedShots = originalShots
  // 点名的几镜会被写入 included:true 并刷新 updatedAt（按镜决定）；没点名的镜一字不动、整批没缩。
  const expectPlanKept = async label => {
    const plan = (await readRun(operationId)).generationPlan.shots
    expect(plan.map(shot => shot.shotId), `${label}：整批没缩`).toEqual(presentedShots.map(shot => shot.shotId))
    const untouched = shot => !requestedIds.includes(shot.shotId)
    expect(plan.filter(untouched), `${label}：没被点名的镜一字不动`).toEqual(presentedShots.filter(untouched))
    const withoutPresentation = ({ included, updatedAt, ...rest }) => rest
    expect(plan.map(withoutPresentation), `${label}：点名只动 included 与 updatedAt`).toEqual(presentedShots.map(withoutPresentation))
    expect(plan.filter(shot => requestedIds.includes(shot.shotId)).every(shot => shot.included === true), `${label}：被点名的镜是 included`).toBe(true)
  }
  await expectPlanKept('摆上卡之后')
  // 合同 contract-moneycopy（#1099）：卡上不出 Nomi 按价目表算的金额（原断言 0.90 已随合同删除）。
  await expect(card.locator('[data-v4-price="total"]'), '确认控件不出金额').not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  // 只有一层改动：每一页改的只落在那一镜上（「逐镜 / 全部」切换和「全部」那一层已删）。
  await pageTo(2)
  await expect(input).toHaveText('CJ1_anchor_2 原始画面')
  const editedPrompt = 'CJ1 第二卡独立草稿，不串其他镜头'
  await input.fill(editedPrompt)
  await clickOrFail(size.locator('button').first(), '第二镜尺寸控件')
  await clickOrFail(win.getByRole('option', { name: '1536x1024', exact: true }).first(), '只改第二镜的尺寸')
  await expect(size).toHaveAttribute('data-parameter-chip-value', '1536x1024')
  await pageTo(3)
  await expect(input).toHaveText('CJ1_anchor_3 原始画面')
  await expect(size, '第三镜的尺寸没被第二镜带走').toHaveAttribute('data-parameter-chip-value', '1024x1024')
  await pageTo(2)
  await expect(input).toHaveText(editedPrompt)
  await expect(size).toHaveAttribute('data-parameter-chip-value', '1536x1024')
  expect(await graph()).toEqual(initialGraph)
  await expectPlanKept('逐镜编辑之后')
  expect(walk.fixture.images).toHaveLength(0)
  await walk.snap('cj1-three-of-33-pager-and-per-shot-edits')

  // ── 「两笔同时待决」这一段 2026-09-22 起不再存在，而且不该存在 ──
  //
  // 这里原来趁第一张卡还挂着，再起草、再出第二笔，钉「介入槽依序显示两笔」。裁决 A/E 之后这条路走不到：
  // 第一笔的回合正挂在那张卡上等用户——在同一条对话里再打一句话，就是对那张卡的回答（出价收回）；
  // 开一条新对话，则是原来那条 lane 关了（出价同样收回，卡不留成没人等的孤儿）。我两种都实跑过。
  // Agent 出的付费卡现在**天然是串行的**：答完这一张，才会有下一张。所以下面改成先答第一笔、再出第二笔，
  // 守的仍是原来那几件事——× 只撤卡上那三镜的占位、第二笔有它自己的草稿（不串第一笔的手改）、× 过的不复活。
  const beforeDeclineGraph = await graph()
  // ── × = **收回这一次出价**，不是对这份计划说「不」（2026-09-22 下午用户拍板改窄裁决 D）──
  //
  // 用户原话：「第二种，× 只关这次请求，节点和草稿都留着」。所以这一段钉三件事：
  //   ① 计划**仍然是 draft**（只是不再摆在他面前），镜头、参数、分镜表一个字不丢；
  //   ② 对**同一个** operationId 再 generate = 重新出价，卡真的再出来；
  //   ③ 画布节点**一个不多也一个不少**——× 不删占位（当天上午那一版删了，33 镜的计划上只删卡上那 3 个，
  //      另外 30 个成了挂在已终结计划上的孤儿），落地也不重建。
  // × 是**一下**。2026-09-22 之前，卡上有没提交的手改时 × 先摊开一句「你在卡上改的内容会一起丢掉」
  // 再要第二下确认；那句话已经不为真（裁决 D：× 只收回这一次出价；草稿锚 operationId 之后没提交的
  // 手改也留着），文案与它那一支渐进披露同刀删了。
  //
  // 连带修掉的那个实测症状：上一版里第一张卡 × 掉之后，**第二张卡一出来就已经停在「取消 / 确认不要」
  // 那一态**——「正在确认丢弃」这个状态挂在介入槽上、没跟着卡走，真人会看到一张自己没点过 × 的卡
  // 在问他「确认不要」。付费卡不再有任何进入那一态的理由，所以这里钉死它：一下就撤，没有第二问。
  const decline = async (label) => {
    const confirm = card.locator('[data-v4-control="confirm-reject"]')
    await expect(confirm, `${label}：卡一出来不许停在确认态`).toHaveCount(0)
    await clickOrFail(card.locator(INTERVENTION_REJECT), label)
    await expect(confirm, `${label}：× 没有第二下`).toHaveCount(0)
    return 'clicked-reject'
  }
  const firstProof = await proveProbe(card, 'the first priced card is really on screen before it is closed')
  await decline('关闭第一笔')
  await expectAbsent(card, { provenBy: firstProof, message: '第一笔关掉之后槽里不再留着它' })
  // × 把结论递回正在等的那个回合：成功形状的「用户没同意」，不是错误。
  expect(await firstTurn.settled(), '第一笔的回合读到的是「他关了这张卡」').toContain('the user closed the card (×) before deciding them')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(/CJ1_TOOL_\d+_DONE/).last() })
  expect(await pending(), '第一笔关掉之后没有任何待决').toEqual([])
  expect((await readRun(operationId)).generationPlan, '× 收回的是出价，不是计划').toMatchObject({ state: 'draft' })
  expect((await readRun(operationId)).generationPlan.presentations.at(-1)?.closed?.by, '这一次出价记的是「用户关了卡」').toBe('user_closed')
  expect((await readRun(operationId)).generationPlan.shots, '33 镜一个不少').toHaveLength(33)
  // × 一个占位都不删：卡上摆出来的那三镜、没摆出来的 30 镜、分镜表，全都留在画布上。
  const bothGraph = beforeDeclineGraph
  const requestedNodeIds = new Set(bothGraph.nodes.filter(node => node.meta?.productionRunId === operationId && requestedIds.includes(node.meta?.productionShotId)).map(node => node.id))
  expect(requestedNodeIds.size, '探针：卡上那三镜各有一个占位节点').toBe(3)
  expect((await graph()).nodes.map(node => node.id).sort(), '× 之后画布一个节点都没动')
    .toEqual(bothGraph.nodes.map(node => node.id).sort())
  // 第二笔：答完第一笔之后才起草、才出卡。它有自己的草稿——第一笔卡上那句手改、那个改过的尺寸一个都不串过来。
  const otherOperationId = await draft([makeShot(99)])
  const otherShots = (await readRun(otherOperationId)).generationPlan.shots
  const secondTurn = await present(otherOperationId, otherShots.map(shot => shot.shotId))
  await expect.poll(async () => (await pending()).map(row => row.operationId)).toEqual([otherOperationId])
  await expect(input).toHaveText('CJ1_shot_99 原始画面')
  await expect(size).toHaveAttribute('data-parameter-chip-value', '1024x1024')
  const afterFirstDecline = (await graph()).nodes.map(node => node.id).sort()
  await walk.snap('cj1-second-operation-has-own-draft')
  const proof = await proveProbe(card, 'Second pending really appears before dismissal')
  await decline('关闭第二笔')
  await expectAbsent(card, { provenBy: proof, message: 'Both declined operations leave the slot' })
  expect(await secondTurn.settled(), '第二笔的回合同样读到「他关了这张卡」').toContain('the user closed the card (×) before deciding them')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(/CJ1_TOOL_\d+_DONE/).last() })
  for (const id of [operationId, otherOperationId]) {
    const plan = (await readRun(id)).generationPlan
    expect(plan.state).toBe('draft')
    expect(plan.presentations.at(-1)?.closed?.by).toBe('user_closed')
  }
  // 两笔都 × 掉之后：对**旧的那个 operationId** 再 generate = 重新出价，卡真的再出来（不用重新起草）。
  const afterBothDeclined = (await graph()).nodes.map(node => node.id).sort()
  expect(afterBothDeclined, '第二次 × 同样一个节点都没动').toEqual(afterFirstDecline)
  const requotedTurn = await present(operationId, requestedIds)
  expect((await pending()).map(row => row.operationId), '同一份草稿重新出价').toEqual([operationId])
  expect((await pending())[0].shots.map(shot => shot.shotId), '还是原来那三镜').toEqual(requestedIds)
  await expectPlanKept('重新出价之后（镜头、参数、锚点一个字不丢）')
  // 他在这张卡上**没提交**的手改一个字不丢——账本锚的是这一次生成（`spendDraftKey` 只含
  // projectId/runId/operationId），重新出价换的只是报价指纹。改动只落在第二镜上。
  await pageTo(2)
  await expect(input, '重新出价带回他在第二镜上没提交的那句话').toHaveText(editedPrompt)
  await expect(size, '第二镜那个尺寸也跟着回来').toHaveAttribute('data-parameter-chip-value', '1536x1024')
  await pageTo(3)
  await expect(input, '改动仍然只落在第二镜上').toHaveText('CJ1_anchor_3 原始画面')
  await expect(size, '第三镜还是原来的尺寸').toHaveAttribute('data-parameter-chip-value', '1024x1024')
  // 「× 之后画布不多也不少」不靠墙钟等：上面这一整个模型回合（两次账本变更 + 一次读 + 回合落定）期间，
  // 落地对这两份计划各被触发过不止一次（账本每变一次它就重算一遍）。
  expect((await graph()).nodes.map(node => node.id).sort(), '× 之后经过一整个回合，画布节点一个不多也一个不少').toEqual(afterBothDeclined)
  expect((await readRun(operationId)).jobs).toHaveLength(0)
  expect((await readRun(otherOperationId)).jobs).toHaveLength(0)
  expect(walk.fixture.images).toHaveLength(0)
  await walk.snap('cj1-withdrawn-quote-can-be-requoted')
  // 收尾：把重新出的这张卡也 × 掉，别把一个还在等人的回合留给下一段（和退出路）。
  await decline('关闭重新出的那张卡')
  expect(await requotedTurn.settled(), '重新出价的那一轮同样以成功形状收尾').toContain('the user closed the card (×) before deciding them')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(/CJ1_TOOL_\d+_DONE/).last() })
  expect(await pending(), '收尾之后介入槽是空的').toEqual([])
  walk.report.spendScopeJourney = { projectId, projectRoot, operationId, otherOperationId, requestedIds, planItems: 33,
    pendingOrder: 'serial — one lane-issued card at a time (2026-09-22 ruling A/E)', graphCounts: { nodes: bothGraph.nodes.length, edges: bothGraph.edges.length, groups: bothGraph.groups.length },
    verified: ['three-of-33', 'shot-pagination', 'per-shot-edits', 'serial-cards-second-has-own-draft', 'close-isolation', 'decline-withdraws-only-the-quote-and-the-same-draft-requotes',
      'requote-restores-unsubmitted-per-shot-edits'],
    mediaSubmissions: 0, boundary: 'Real Electron UI/Agent tools/storage with text loopback. No confirmation execution, generated-history, next-execution-batch or arbitrary pending navigation claim.' }
}
