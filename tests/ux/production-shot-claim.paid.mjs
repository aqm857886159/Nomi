#!/usr/bin/env node
// 真实用户任务 · **真花钱**：PR #921「镜头认领」（`decideShotClaim`，electron/shared/decideShotClaim.ts）的真额度验收——
// 同一个镜头不会被花两次钱。单测与 loopback 回环都绿了；这一条在**真供应商、真 App** 上拿真实的供应商任务数说话。
//
//   NOMI_SPEND_OK=1 [NOMI_SHOT_CLAIM_SCENARIOS=1,2,3] node tests/ux/production-shot-claim.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 三段，每段一个独立的隔离副本（各自一份收据，互不串账）；按点名的顺序跑（缺省只跑 1，见文件末尾的说明），任何一段红了就停，不往下花钱：
//
//   S1 逐镜确认在等时，画布发不出这一镜——Agent 起草两镜视频 → 卡上逐镜只确认第 1 镜 → 第 1 镜出片后让 Agent 再为第 2 镜
//      出卡：卡在等人的这一段，第 2 镜节点的 ↑ 按不下去（批量入口只剩组的「生成整组」，它与制作归属共用同一份可生成集合，由单测 canvasProductionScope.test 钉） → 确认第 2 镜 → 第 2 镜恰好一笔。
//      第 1 镜确认之后、第 2 镜再出卡之前那一段（第 2 镜被移出这一批），画布对它的归属如实记下（只读，绝不点）。
//   S2 删掉还没派出的镜头节点，制作流程不再派它——两镜整批放行后，趁第 2 镜「已授权、没提交」按 Delete 删掉它的节点
//      → 制作流程不再提交第 2 镜，整场只有第 1 镜那一笔。窗口是第 1 镜提交的那一两秒：盯落盘的 Run（10ms 一次），
//      计划一转 submitted、第 2 镜还是 authorized 就删；抓不到就如实记「没观察到」，不删、不伪造。
//   S3 急停 → 画布接手一镜 → 继续剩余——三镜整批放行，第 1 镜开始提交就按任务卡「暂停」停掉剩余 → 画布上手动生成第 2 镜
//      （画布接手）→ 第 2 镜节点不再挂「已停」→ 在第 3 镜上点「继续剩余」→ 制作只派第 3 镜，第 2 镜没有第二笔
//      （供应商任务号、任务面板两处都核）。
//
// ── 价格：一概不注入（不给任何模型种价目，也不设预算上限；这条走查的判据与价格无关）──
// 报不出合计的卡上没有「逐镜 | 全部」切换（agentPanelSpendCard.ts：报不出合计就不渲染范围切换），只能逐镜确认，所以：
// S1 的卡天然就是「逐镜」；S2、S3 要「一次放行整批」，唯一的真实入口是 Agent 面板的「全自动」档（档位本身就是那次授权，
// electron/capabilityCore/generationTransportAdapters.ts decideByPolicyAfterDraft）——切档时那张确认卡照常点头。
//
// 花钱之前逐字段核对要派发的每一镜（_agentVideoPaid.mjs：Seedance 2.0 Fast · 480p · 4 秒 · 无音频；「全自动」下这一核对在
// 说「生成」之前做，草稿就是宿主要封印的那一份）；凭据与原库保护、收据见 _paidRun.mjs / _realProfile.mjs。
//
// ── 2026-09-29 零额度彩排（loopback 夹具，同一套真 App）──
//   修复前 S2、S3 必红：删节点上报的命令号带「:」「,」过不了 IPC 校验、失败又被吞（缺陷 A）；派发准入闸排在提交意向落盘之后、
//   一次都拒不了，急停后同一轮剩下的镜照样提交（缺陷 B）。两处已在本分支修掉（electron/shared/productionRunCommandId.ts、
//   submissionOutbox.submitOnce），修复后的彩排：
//   S2：删节点（第 1 镜提交中 / 第 2 镜排队时各删一次）都落成 detached，整场只有第 1 镜一笔——可以花钱复验。
//   S3：急停后只剩第 1 镜那一笔、第 2、3 镜不预留不提交；画布接手第 2 镜、「已停」消失——都过。当时 Run 一直停在 pausing
//       （多镜调度器不做暂停收尾），第 3 镜「继续剩余」回「run status pausing is not resumable」。2026-09-30 暂停收尾挂到仓库
//       唯一写入口（productionRunLifecycle.settleRunLifecycle）、pausing 可以直接继续之后，付费复验跑通：第 1 镜收尾落到已暂停、
//       画布接手第 2 镜、继续剩余只派第 3 镜，每镜恰好一笔。注意：开拍确认在封信封 10 分钟后过期、派发时核它（PR「新发现 F1」，
//       待拍板），S3 要在 10 分钟内走完，否则第 3 镜会派不出去。
//   缺省只跑 S1（不替人决定花钱）；S2、S3 要显式点名（NOMI_SHOT_CLAIM_SCENARIOS=1,2 / 3）。
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { BRAIN, CHEAP_VIDEO_TERMS, VIDEO, cheapVideoProblems, probeLandedMedia } from './_agentVideoPaid.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { repoRoot } from './_launchApp.mjs'
import { openPaidWalk, readProductionRuns } from './_paidRun.mjs'
import { readLaneSpend } from './_laneSpendProbe.mjs'
import { stationTimeout } from './_station-budget.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, PERMISSION_POPOVER,
  chooseAssistantModel, closeSpendCard, openCanvas, permissionTier, readProject, sendCanvas,
} from './agent-runtime-walk-support.mjs'
import { canvasFitViewButton } from './_shell.mjs'

const { resolveArchetypeVariant } = tsxRequire('../../electron/shared/modelArchetypes/variantResolution.ts', import.meta.url)
const { SEEDANCE_2_APIMART_ARCHETYPE } = tsxRequire('../../electron/shared/videoCapabilities/seedanceApimart.ts', import.meta.url)

const SCRIPT = 'production-shot-claim.paid.mjs'
const MODEL_TURN_MS = stationTimeout({ turns: 1 })
const VIDEO_LANDS_MS = stationTimeout({ turns: 2 })
const GENERATE = '[data-bar-segment="generate"]'
const TASK_TRIGGER = '[data-task-center-trigger="true"]'
const TASK_PANEL = '[data-nomi-right-panel="tasks"]'
const SHOTS_DIR = path.join(repoRoot, 'tests/ux/shots/production-shot-claim')
/** 还没交给供应商、钱一分没花的 job 状态（与 electron/shared/productionShotJobs.ts isUnsubmittedJobStatus 同一组）。 */
const UNSUBMITTED = new Set(['planned', 'authorization_required', 'authorized'])

const TWO_SHOT_ASK = '画两个视频镜头，先别生成：镜1，清晨的渔港，几只小船轻轻晃；镜2，同一个渔港的码头上，一只猫在晒太阳。'
  + `两镜都用 ${CHEAP_VIDEO_TERMS}。就这两镜，不要参考卡或锚点；起草完就停，不用问我。`
const THREE_SHOT_ASK = '画三个视频镜头，先别生成：镜1，清晨的渔港，几只小船轻轻晃；镜2，同一个渔港的码头上，一只猫在晒太阳；镜3，海鸥掠过桅杆。'
  + `三镜都用 ${CHEAP_VIDEO_TERMS}。就这三镜，不要参考卡或锚点；起草完就停，不用问我。`
const GO_ALL = '好，就按这份草稿全部生成吧，不要改草稿。'
const SHOT2_AGAIN = '第 1 镜已经出来了。现在把刚才那份草稿里的第 2 镜（码头上晒太阳的猫）生成出来：对同一份草稿发起生成、只生成第 2 镜，'
  + '不要重新起草、不要改参数（480p、4 秒、不要音频），第 1 镜不要重新生成。'

// ── 读落盘事实（App 关了之后也读得到；判据全在这里，不在屏上猜）──────────────────────────────

function runOf(projectRoot, runId) {
  return readProductionRuns(projectRoot).find((run) => run.runId === runId) ?? null
}
/** 多镜 Run 里 job 归哪一镜只看 `metadata.shotId`（electron/shared/productionShotJobs.ts jobsForShot 同一判据）。 */
function jobsOf(run, shotId) {
  return (run?.jobs ?? []).filter((job) => job.stageId === 'generate' && job.metadata?.shotId === shotId)
}
/** 这一镜交给供应商的次数 = 拿到供应商任务号的 job 数。 */
function submissionsOf(run, shotId) {
  return jobsOf(run, shotId).filter((job) => job.providerTaskId)
}
function jobSummary(run) {
  return (run?.jobs ?? []).map((job) => ({
    shotId: job.metadata?.shotId ?? null, status: job.status, errorCode: job.errorCode ?? null, providerTaskId: job.providerTaskId ?? null,
  }))
}
/** 画布节点当前真正会跑的视频档（变体问唯一 owner resolveArchetypeVariant——与画布执行、付费卡同一函数同一组输入）。 */
function canvasNodeVideoProblems(meta) {
  const problems = []
  if (meta?.modelVendor !== VIDEO.vendorKey || ![VIDEO.modelKey, 'doubao-seedance-2.0-fast'].includes(meta?.modelKey)) problems.push(`模型是 ${meta?.modelVendor}/${meta?.modelKey}`)
  const stored = meta?.archetype?.id === SEEDANCE_2_APIMART_ARCHETYPE.id ? meta.archetype.variantId : undefined
  const variant = resolveArchetypeVariant(SEEDANCE_2_APIMART_ARCHETYPE, { variantId: stored, modelId: meta?.modelKey })?.id
  if (variant !== 'fast') problems.push(`实际会跑的变体是 ${variant}`)
  if (Number(meta?.duration) !== 4) problems.push(`duration 是 ${JSON.stringify(meta?.duration)}`)
  if (String(meta?.resolution ?? '').toLowerCase() !== '480p') problems.push(`resolution 是 ${JSON.stringify(meta?.resolution)}`)
  if (meta?.generate_audio !== false) problems.push(`generate_audio 是 ${JSON.stringify(meta?.generate_audio)}`)
  return problems
}
function readBuildStamp() {
  try { return JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'build-stamp.json'), 'utf8')) } catch { return null }
}
/** 草稿里要派发的每一镜都得是被授权的那一档；不是就一分钱不花地红。 */
function assertCheapShots(shots, label) {
  const problems = shots.flatMap((shot) => cheapVideoProblems(shot.candidate).map((problem) => `${shot.shotId}：${problem}`))
  if (problems.length) throw new Error(`${label}：要派发的不是被授权的 Seedance 2.0 Fast · 480p · 4s · 无音频（一分钱没花）——${problems.join('；')}`)
}

// ── 一段场景的外壳：隔离副本 → 锁花钱面 → 新项目 → 画布 + Agent 面板；收尾写收据、比原库指纹 ──────────

async function runScenario(id, body) {
  const paid = await openPaidWalk(SCRIPT, `production-shot-claim-${id}`, [BRAIN, VIDEO])
  const { walk } = paid
  let failure
  try {
    const { win } = await walk.start({ first: true })
    await paid.lockToAuthorizedModels(win)
    const { projectId, projectRoot } = await walk.newProject()
    await openCanvas(win)
    await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)
    const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
    if (await consent.isVisible().catch(() => false)) await consent.click()
    walk.report.scenario = { id, build: readBuildStamp(), keyShots: [], observations: {} }
    await body(createContext({ id, win, walk, projectId, projectRoot }))
  } catch (error) {
    failure = error
    process.exitCode = 1
  } finally {
    await paid.finish(failure)
  }
  return !failure
}

function createContext({ id, win, walk, projectId, projectRoot }) {
  const scenario = walk.report.scenario
  const nodes = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []
  const node = async (nodeId) => (await nodes()).find((candidate) => candidate.id === nodeId) ?? null
  const composer = win.locator(`${CANVAS_PANEL} ${COMPOSER}`).first()
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)

  /** 截图：walk 的输出目录一份，任务书要的 tests/ux/shots/production-shot-claim/ 一份。 */
  async function snap(label) {
    const file = await walk.snap(`${id}-${label}`)
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
    const copy = path.join(SHOTS_DIR, `${id}-${label}.png`)
    fs.copyFileSync(file, copy)
    scenario.keyShots.push(copy)
    return copy
  }

  /** 一轮普通对话：起飞 → 说完（或停下来反问人 = 红，这一轮一分钱没花）。 */
  async function agentTurn(text, label) {
    await sendCanvas(win, text)
    await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`).first(), `${label}：这一轮起飞了`).toBeVisible({ timeout: stationTimeout() })
    await waitTurnIdle(label)
  }
  /** 这一轮怎么落地的：说完了（idle），或者停在一张问题卡上等人答（awaiting-answer）。不判红，由调用方决定。 */
  async function turnOutcome(label) {
    let outcome = 'running'
    await expect.poll(async () => {
      const mode = await composer.getAttribute('data-mode')
      outcome = mode !== 'running' ? 'idle' : (await composer.getAttribute('data-awaiting-answer')) === 'true' ? 'awaiting-answer' : 'running'
      return outcome
    }, { message: `${label}：这一轮落地`, timeout: MODEL_TURN_MS }).not.toBe('running')
    return outcome
  }
  /** 起草这类「必须说完」的回合：停下来反问人 = 红（这一轮一分钱没花）。 */
  async function waitTurnIdle(label) {
    if (await turnOutcome(label) === 'awaiting-answer') {
      await snap(`agent-asked-${label}`)
      throw new Error(`${label}：Agent 停下来反问了用户（见截图与转录）`)
    }
  }

  /** 起草：返回这一轮新建的那个制作 Run（等画布落地把每一镜绑上节点）。 */
  async function draft(ask, count, label) {
    const before = new Set(readProductionRuns(projectRoot).map((run) => run.runId))
    await agentTurn(ask, label)
    const created = readProductionRuns(projectRoot).filter((run) => run.generationPlan && !before.has(run.runId))
    expect(created.length, `${label}：草稿起了一个制作 Run`).toBe(1)
    const runId = created[0].runId
    await expect.poll(() => (runOf(projectRoot, runId)?.generationPlan?.shots ?? []).filter((shot) => shot.nodeId).length,
      { message: `${label}：${count} 镜都落成了画布节点`, timeout: DEFAULT_TIMEOUT_MS }).toBe(count)
    const run = runOf(projectRoot, runId)
    expect(run.generationPlan.shots.map((shot) => `${shot.candidate?.providerId}/${shot.candidate?.modelId}`), `${label}：草稿是 ${count} 镜 Seedance 2.0`)
      .toEqual(run.generationPlan.shots.map(() => `${VIDEO.vendorKey}/${VIDEO.modelKey}`))
    assertCheapShots(run.generationPlan.shots, label)
    return run
  }

  /** 主进程此刻那张付费卡（宿主投影，卡上摆的正是它）。 */
  async function pendingSpend() {
    const read = await readLaneSpend(win)
    return read?.surface === 'ready' ? read.rows?.[0] ?? null : null
  }

  /** 真人切「全自动」：权限档 → 全自动 → 那张二次确认卡点头（档位本身就是之后付费的授权）。 */
  async function switchToFullAuto() {
    await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
    await expect(win.locator(`${CANVAS_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
    await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('project')}`), '切到「全自动」')
    const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
    await expect(switchCard, '切档仍然要问一次').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到全自动')
    await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="auto-mode"]`), '全自动档的常驻提醒出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }

  async function fitView() {
    await clickOrFail(canvasFitViewButton(win), '适应视图')
    await waitForVisualQuiescence(win)
  }
  /** 像用户一样：先点空白处取消选中，适应视图，再按住 Ctrl 滚轮锚在这张卡上放大到看得清（≥ 240px 宽）。 */
  async function zoomTo(nodeId) {
    const blank = await findCanvasBlankPoint(win)
    if (blank) await win.mouse.click(blank.x, blank.y)
    await waitForVisualQuiescence(win)
    await fitView()
    const target = win.locator(`[data-node-id="${nodeId}"]`).first()
    for (let step = 0; step < 8; step += 1) {
      const box = await target.boundingBox()
      if (!box || box.width >= 240) break
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await win.keyboard.down('Control')
      await win.mouse.wheel(0, -240)
      await win.keyboard.up('Control')
      await waitForVisualQuiescence(win)
    }
    expect((await target.boundingBox())?.width ?? 0, `${nodeId} 放大到看得清（≥ 240px 宽）`).toBeGreaterThanOrEqual(240)
  }
  /** 选中这张卡（点卡上真正点得到的一处），返回点的位置。 */
  async function select(nodeId) {
    const point = await findNodeHitPoint(win, { nodeSelector: `[data-node-id="${nodeId}"]` })
    expect(Boolean(point), `${nodeId} 在舞台上有点得到的地方`).toBe(true)
    await win.mouse.click(point.x, point.y)
    await expect(win.locator(`[data-node-id="${nodeId}"]`).first(), `${nodeId} 被选中`).toHaveAttribute('data-selected', 'true')
    return point
  }
  async function deselect() {
    const blank = await findCanvasBlankPoint(win)
    expect(Boolean(blank), '画布上找得到空白处').toBe(true)
    await win.mouse.click(blank.x, blank.y)
    await waitForVisualQuiescence(win)
  }
  /** 选中之后这一镜自己的 ↑：渲染了且能按 = 画布这一刻能发它（'enabled'）；置灰 / 不给 = 门关着。只读，不点。 */
  async function generateEntry(nodeId) {
    await select(nodeId)
    await waitForVisualQuiescence(win)
    const button = win.locator(`[data-node-id="${nodeId}"] ${GENERATE}`).first()
    return await button.count() ? (await button.isDisabled() ? 'disabled' : 'enabled') : 'not-rendered'
  }
  /** 用户自己在画布上放一个还没生成的视频节点（永远不点它）：画布上除了制作流程的两镜，还有一个用户自己的闲置节点。 */
  async function addIdleVideoNode() {
    const before = new Set((await nodes()).map((item) => item.id))
    await clickOrFail(win.locator('[aria-label="添加视频节点"]').first(), '画布「添加视频节点」')
    await expect.poll(async () => (await nodes()).filter((item) => !before.has(item.id)).length, { message: '闲置节点落盘', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
    const idleId = (await nodes()).find((item) => !before.has(item.id)).id
    const editor = win.locator(`[data-node-id="${idleId}"] div[contenteditable="true"]`).last()
    await clickOrFail(editor, '闲置节点提示词输入框')
    await editor.fill('海边日落的延时（这一张我自己之后再生成）')
    return idleId
  }
  /** 一镜的真视频落地（节点上的 nomi-local 结果），ffprobe 核对是授权的 4 秒、无音频。 */
  async function expectLandedVideo(nodeId, label) {
    await expect.poll(async () => (await node(nodeId))?.result?.url ?? '', { message: `${label}：真视频落地`, timeout: VIDEO_LANDS_MS }).toMatch(/^nomi-local:\/\//)
    const landed = await node(nodeId)
    const media = await probeLandedMedia(projectRoot, projectId, landed.result.url)
    expect(media.probe.kind, `${label}：一段能解码的真视频`).toBe('video')
    expect(Math.abs(media.probe.durationSeconds - 4) < 0.5, `${label}：片长就是授权的 4 秒（实测 ${media.probe.durationSeconds}s）`).toBe(true)
    expect(media.probe.hasAudio, `${label}：无音频那一档`).toBe(false)
    return { nodeId, taskId: landed.result.taskId ?? null, bytes: media.bytes, durationSeconds: media.probe.durationSeconds, width: media.probe.width, height: media.probe.height, hasAudio: media.probe.hasAudio }
  }
  /** 项目写入停稳：连续几次读到同一个 revision（续跑前等画布那一笔的落地写完）。 */
  async function waitProjectQuiet(label) {
    const quiet = { last: null, same: 0 }
    await expect.poll(async () => {
      const revision = (await readProject(win, projectId)).revision
      quiet.same = revision === quiet.last ? quiet.same + 1 : 0
      quiet.last = revision
      return quiet.same >= 3
    }, { message: `${label}：项目写入停稳`, timeout: stationTimeout({ operations: 2 }), intervals: [1000] }).toBe(true)
    return quiet.last
  }
  /** 每镜提交次数：制作 Run 里拿到供应商任务号的 job + 画布节点自己发出去的那几笔（节点运行记录里非制作投影的那些）。 */
  async function ledger(runId, shotIds) {
    const run = runOf(projectRoot, runId)
    const canvasNodes = await nodes()
    return Object.fromEntries(shotIds.map((shotId) => {
      const shot = run?.generationPlan?.shots?.find((candidate) => candidate.shotId === shotId)
      const production = submissionsOf(run, shotId).map((job) => job.providerTaskId)
      const nodeId = shot?.nodeId ?? jobsOf(run, shotId)[0]?.nodeId ?? null
      const canvasNode = nodeId ? canvasNodes.find((candidate) => candidate.id === nodeId) : null
      const canvas = (canvasNode?.runs ?? []).filter((record) => !String(record.id ?? '').startsWith('production-'))
        .map((record) => record.taskId ?? (record.resultId && record.resultId === canvasNode.result?.id ? canvasNode.result?.taskId : null) ?? `(${record.status})`)
      return [shotId, { nodeId, production, canvas }]
    }))
  }

  return {
    id, win, walk, projectId, projectRoot, scenario, card, composer,
    nodes, node, snap, agentTurn, turnOutcome, waitTurnIdle, draft, pendingSpend, switchToFullAuto, fitView, zoomTo, select, deselect,
    generateEntry, addIdleVideoNode, expectLandedVideo, waitProjectQuiet, ledger, run: (runId) => runOf(projectRoot, runId),
  }
}

// ═══ S1 · 逐镜确认在等时，画布发不出这一镜 ═══════════════════════════════════════════════════════

async function scenarioPerShotConfirm(ctx) {
  const { win, card, scenario } = ctx
  const drafted = await ctx.draft(TWO_SHOT_ASK, 2, 'S1 起草')
  const runId = drafted.runId
  const [shot1, shot2] = drafted.generationPlan.shots
  scenario.runId = runId
  scenario.shots = { shot1: { shotId: shot1.shotId, nodeId: shot1.nodeId }, shot2: { shotId: shot2.shotId, nodeId: shot2.nodeId } }
  scenario.idleNodeId = await ctx.addIdleVideoNode()

  // ── 卡摆出来：两镜，逐镜（报不出合计的卡只有逐镜这一档），停在第 1 页 ──
  await sendCanvas(win, '好，两镜都生成吧。')
  await expect(card, 'S1：付费卡摆在面板里等人').toBeVisible({ timeout: MODEL_TURN_MS })
  const quote = await ctx.pendingSpend()
  expect(quote?.operationId, 'S1：卡就是这份草稿').toBe(runId)
  expect(quote.shots.map((shot) => shot.shotId), 'S1：卡上两镜').toEqual([shot1.shotId, shot2.shotId])
  const scopeToggle = card.getByText('逐镜', { exact: true })
  scenario.observations.scopeToggleRendered = await scopeToggle.count() > 0
  if (scenario.observations.scopeToggleRendered) await clickOrFail(scopeToggle, 'S1：卡上的范围切到「逐镜」')
  await expect(card.locator('[data-v4-block="pager"]'), 'S1：翻页器停在第 1 页').toContainText('1/2')
  await ctx.zoomTo(shot2.nodeId)
  scenario.observations.cardWaitingBothShots = { shot2Generate: await ctx.generateEntry(shot2.nodeId) }
  expect(scenario.observations.cardWaitingBothShots.shot2Generate, 'S1：卡在等人时第 2 镜的 ↑ 不能按').not.toBe('enabled')
  await ctx.snap('01-zh-card-each-page1-shot2-locked')
  assertCheapShots(ctx.run(runId).generationPlan.shots, 'S1 按下去之前')

  // ── 逐镜确认第 1 镜：只有第 1 镜交给供应商 ──
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), 'S1：卡上的主按钮（逐镜 · 第 1 镜）', { noWaitAfter: true })
  await expect.poll(() => submissionsOf(ctx.run(runId), shot1.shotId).length, { message: 'S1：第 1 镜交给了供应商', timeout: stationTimeout({ operations: 8 }) }).toBe(1)
  const afterFirst = ctx.run(runId)
  scenario.observations.afterShot1Confirm = {
    planState: afterFirst.generationPlan.state,
    shot2Included: afterFirst.generationPlan.shots.find((shot) => shot.shotId === shot2.shotId)?.included ?? true,
    shot2Jobs: jobsOf(afterFirst, shot2.shotId).length,
  }
  expect(scenario.observations.afterShot1Confirm.shot2Jobs, 'S1：第 1 镜确认时第 2 镜没有任何 job（没授权、没派发）').toBe(0)
  // 第 2 镜被移出了这一批、Agent 还没为它再出卡：这一段画布对它的归属如实记下（只读，绝不点）。
  await ctx.zoomTo(shot2.nodeId)
  scenario.observations.shot2ReleasedWindow = { shot2Generate: await ctx.generateEntry(shot2.nodeId) }
  await ctx.snap('02-zh-after-shot1-confirm-shot2-state')

  // 这一轮收尾（Agent 说完第 1 镜开始生成，或者停下来问「第 2 镜要不要也生成」——那也不算错：下面那句话就是回答），
  // 再等第 1 镜真的出片。第 1 镜在飞时第 2 镜出不了卡（宿主要求上一批先收尾），所以第二句话一定在出片之后说。
  scenario.observations.firstConfirmTurn = await ctx.turnOutcome('S1 确认第 1 镜那一轮')
  scenario.media = [await ctx.expectLandedVideo(shot1.nodeId, 'S1 第 1 镜')]
  expect(submissionsOf(ctx.run(runId), shot2.shotId).length, 'S1：第 1 镜落地时第 2 镜仍一笔都没发').toBe(0)

  // ── 让 Agent 为第 2 镜再出卡：这一段第 2 镜才是真的「等确认」──
  // generate 挂在卡上等人时整轮一直是 running；Agent 要是没出卡就说完了，当场红（不干等满一轮的上限）。
  if (!(await card.isVisible().catch(() => false))) {
    await sendCanvas(win, SHOT2_AGAIN)
    const seen = { running: false }
    const second = await expect.poll(async () => {
      if (await card.isVisible().catch(() => false)) return 'card'
      const running = (await ctx.composer.getAttribute('data-mode')) === 'running'
      if (running) seen.running = true
      return seen.running && !running ? 'ended-without-card' : 'waiting'
    }, { message: 'S1：第 2 镜那一轮出卡或说完', timeout: MODEL_TURN_MS }).not.toBe('waiting').then(() => card.isVisible())
    if (!second) {
      await ctx.snap('agent-no-second-card')
      throw new Error('S1：让 Agent 为第 2 镜出卡，这一轮说完了却没有出卡（第 2 镜一笔没花；见截图与转录）')
    }
  }
  await expect(card, 'S1：第 2 镜的付费卡摆出来等人').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const quote2 = await ctx.pendingSpend()
  if (quote2?.operationId !== runId || !quote2.shots.some((shot) => shot.shotId === shot2.shotId)) {
    await closeSpendCard(card, 'S1：卡不是这份草稿的第 2 镜，关卡不花钱')
    throw new Error(`S1：第二张卡不是这份草稿的第 2 镜（一分钱没花）：${JSON.stringify(quote2?.shots?.map((shot) => shot.shotId))} · ${quote2?.operationId}`)
  }
  scenario.observations.secondCardShots = quote2.shots.map((shot) => shot.shotId)
  const shot2Page = quote2.shots.findIndex((shot) => shot.shotId === shot2.shotId)
  if (quote2.shots.length > 1) {
    if (await card.getByText('逐镜', { exact: true }).count()) await clickOrFail(card.getByText('逐镜', { exact: true }), 'S1：第二张卡的范围也是「逐镜」')
    for (let page = 0; page < shot2Page; page += 1) await clickOrFail(card.locator('[data-v4-control="pager-next"]'), 'S1：翻到第 2 镜那一页')
    await expect(card.locator('[data-v4-block="pager"]'), 'S1：停在第 2 镜那一页').toContainText(`${shot2Page + 1}/${quote2.shots.length}`)
  }
  const pendingShot2 = quote2.shots[shot2Page]
  const cardProblems = cheapVideoProblems({ providerId: pendingShot2.providerId, modelId: pendingShot2.modelId, variantId: pendingShot2.variantId, parameters: pendingShot2.parameters })
  if (cardProblems.length) {
    await closeSpendCard(card, 'S1：第 2 镜卡上不是被授权的那一档，关卡不花钱')
    throw new Error(`S1：第 2 镜卡上不是被授权的那一档（一分钱没花）：${cardProblems.join('；')}`)
  }
  assertCheapShots(ctx.run(runId).generationPlan.shots.filter((shot) => shot.shotId === shot2.shotId), 'S1 第 2 镜按下去之前')
  await ctx.zoomTo(shot2.nodeId)
  scenario.observations.shot2AwaitingConfirmation = { shot2Generate: await ctx.generateEntry(shot2.nodeId) }
  expect(scenario.observations.shot2AwaitingConfirmation.shot2Generate, 'S1：第 2 镜在卡上等确认时，它的 ↑ 按不下去').not.toBe('enabled')
  await ctx.snap('03-zh-shot2-awaiting-confirmation-generate-locked')

  // ── 确认第 2 镜：恰好一笔 ──
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), 'S1：卡上的主按钮（逐镜 · 第 2 镜）', { noWaitAfter: true })
  await expect.poll(() => submissionsOf(ctx.run(runId), shot2.shotId).length, { message: 'S1：第 2 镜交给了供应商', timeout: stationTimeout({ operations: 8 }) }).toBe(1)
  scenario.media.push(await ctx.expectLandedVideo(shot2.nodeId, 'S1 第 2 镜'))
  await ctx.fitView()
  await ctx.snap('05-zh-both-landed')

  scenario.perShot = await ctx.ledger(runId, [shot1.shotId, shot2.shotId])
  scenario.jobs = jobSummary(ctx.run(runId))
  expect(Object.values(scenario.perShot).map((entry) => entry.production.length), 'S1：每镜恰好一次制作提交').toEqual([1, 1])
  expect(Object.values(scenario.perShot).flatMap((entry) => entry.canvas), 'S1：画布一笔都没替它们发').toEqual([])
  expect(new Set(Object.values(scenario.perShot).flatMap((entry) => entry.production)).size, 'S1：整场恰好两笔供应商任务').toBe(2)
  scenario.verified = ['card-waiting-shot2-locked', 'each-scope-submits-only-shot1', 'shot2-awaiting-second-card-locked', 'shot2-submitted-exactly-once']
}

// ═══ S2 · 删掉还没派出的镜头节点，制作流程不再派它 ═════════════════════════════════════════════════

/** 落盘 Run 此刻处在删节点窗口的哪一边：open = 计划已 submitted、第 2 镜还是「已授权、没提交」。 */
function deleteWindowOf(run, shot2Id) {
  const job = jobsOf(run, shot2Id)[0]
  if (!job) return 'waiting'
  if (!UNSUBMITTED.has(job.status) || job.providerTaskId) return 'missed'
  return job.status === 'authorized' && run.generationPlan?.state === 'submitted' ? 'open' : 'waiting'
}

async function scenarioDeleteQueuedShot(ctx) {
  const { win, scenario } = ctx
  const drafted = await ctx.draft(TWO_SHOT_ASK, 2, 'S2 起草')
  const runId = drafted.runId
  const [shot1, shot2] = drafted.generationPlan.shots
  scenario.runId = runId
  scenario.shots = { shot1: { shotId: shot1.shotId, nodeId: shot1.nodeId }, shot2: { shotId: shot2.shotId, nodeId: shot2.nodeId } }

  // 删之前先把第 2 镜放大、选中：放行之后窗口只有第 1 镜提交的那一两秒，来不及再找它。
  await ctx.zoomTo(shot2.nodeId)
  const point = await ctx.select(shot2.nodeId)
  await ctx.switchToFullAuto()
  await expect(win.locator(`[data-node-id="${shot2.nodeId}"]`).first(), 'S2：切档之后第 2 镜仍选中').toHaveAttribute('data-selected', 'true')
  await ctx.snap('01-zh-full-auto-shot2-selected')
  assertCheapShots(ctx.run(runId).generationPlan.shots, 'S2 说「生成」之前')

  // ── 放行整批 → 盯落盘 Run：计划一转 submitted、第 2 镜还是 authorized，就按用户的方式删掉它 ──
  await sendCanvas(win, GO_ALL)
  let windowState = 'waiting'
  await expect.poll(() => (windowState = deleteWindowOf(ctx.run(runId), shot2.shotId)),
    { message: 'S2：放行之后第 2 镜走到了删节点窗口的某一边', timeout: MODEL_TURN_MS, intervals: [10] }).not.toBe('waiting')
  if (windowState === 'open') {
    await win.mouse.click(point.x, point.y)
    await win.keyboard.press('Delete')
    const atDelete = ctx.run(runId)
    scenario.deletion = { observed: true, jobsAtDelete: jobSummary(atDelete), planStateAtDelete: atDelete.generationPlan.state }
    await expect.poll(async () => Boolean(await ctx.node(shot2.nodeId)), { message: 'S2：第 2 镜的节点从画布上删掉了', timeout: DEFAULT_TIMEOUT_MS }).toBe(false)
    await ctx.snap('02-zh-shot2-node-deleted-while-queued')
    await expect.poll(() => {
      const job = jobsOf(ctx.run(runId), shot2.shotId)[0]
      return job?.providerTaskId ? `dispatched:${job.status}` : `${job?.status}:${job?.errorCode ?? ''}`
    }, { message: 'S2：删掉的第 2 镜在 Run 里被取消（没发出去的这一镜不再派）', timeout: stationTimeout({ operations: 2 }) }).toBe('detached:canvas_detached')
    scenario.deletion.shot2Plan = ctx.run(runId).generationPlan.shots.find((shot) => shot.shotId === shot2.shotId)
  } else {
    scenario.deletion = { observed: false, reason: '放行之后第一次读到落盘 Run 时，第 2 镜已经不是「已授权、没提交」（窗口没抓到）', jobs: jobSummary(ctx.run(runId)) }
  }
  scenario.observations.sealedShots = ctx.run(runId).generationPlan.shots.map((shot) => ({ shotId: shot.shotId, parameters: shot.contract?.parameters ?? null, transportModelId: shot.candidate?.transportModelId }))

  scenario.media = [await ctx.expectLandedVideo(shot1.nodeId, 'S2 第 1 镜')]
  // 第 1 镜落地之后调度器已经走到静止点；再过一段完整的观察窗，确认第 2 镜始终没被补派。
  const settled = { reads: 0 }
  await expect.poll(() => {
    if (submissionsOf(ctx.run(runId), shot2.shotId).length) return 'shot2-dispatched'
    settled.reads += 1
    return settled.reads >= 20 ? 'held' : 'watching'
  }, { message: 'S2：第 2 镜在整段观察窗里一直没被派', timeout: stationTimeout({ operations: 4 }), intervals: [2000] }).not.toBe('watching')
  const final = ctx.run(runId)
  scenario.perShot = await ctx.ledger(runId, [shot1.shotId, shot2.shotId])
  scenario.jobs = jobSummary(final)
  scenario.runStatus = final.status
  await ctx.fitView()
  await ctx.snap('03-zh-final-only-shot1')
  if (!scenario.deletion.observed) throw new Error('S2：没观察到「已授权、没提交」的窗口（见 report.scenario.deletion）——如实记下，不伪造')
  expect(submissionsOf(final, shot2.shotId).length, 'S2：制作流程没有提交第 2 镜').toBe(0)
  expect(submissionsOf(final, shot1.shotId).length, 'S2：第 1 镜恰好一次提交').toBe(1)
  scenario.verified = ['delete-queued-shot-node-detaches-unsubmitted-job', 'deleted-shot-never-submitted', 'only-shot1-billed']
}

// ═══ S3 · 急停 → 画布接手一镜 → 继续剩余 ═════════════════════════════════════════════════════════

async function scenarioPauseCanvasTakeoverResume(ctx) {
  const { win, scenario } = ctx
  const drafted = await ctx.draft(THREE_SHOT_ASK, 3, 'S3 起草')
  const runId = drafted.runId
  const [shot1, shot2, shot3] = drafted.generationPlan.shots
  scenario.runId = runId
  scenario.shots = Object.fromEntries([['shot1', shot1], ['shot2', shot2], ['shot3', shot3]].map(([key, shot]) => [key, { shotId: shot.shotId, nodeId: shot.nodeId }]))
  await ctx.switchToFullAuto()
  assertCheapShots(ctx.run(runId).generationPlan.shots, 'S3 说「生成」之前')

  // ── 放行三镜；第 1 镜一开始提交就在任务卡上按「暂停」（急停）──
  await sendCanvas(win, GO_ALL)
  await expect.poll(() => jobsOf(ctx.run(runId), shot1.shotId)[0]?.status ?? 'none',
    { message: 'S3：第 1 镜开始提交', timeout: MODEL_TURN_MS, intervals: [50] }).toMatch(/^(submit_intent_persisted|submitting|provider_accepted|polling)$/)
  await clickOrFail(win.locator(TASK_TRIGGER), 'S3：打开任务面板')
  const pause = win.locator(`${TASK_PANEL} [data-production-task-card] [data-production-control="pause"]`)
  await clickOrFail(pause, 'S3：任务卡「暂停」（急停）')
  const atPause = ctx.run(runId)
  scenario.observations.atPause = { runStatus: atPause.status, jobs: jobSummary(atPause) }
  await expect.poll(() => ctx.run(runId)?.status, { message: 'S3：Run 进入暂停', timeout: DEFAULT_TIMEOUT_MS }).toMatch(/^(pausing|paused)$/)
  await ctx.snap('01-zh-paused-from-task-card')
  await win.keyboard.press('Escape')
  scenario.media = [await ctx.expectLandedVideo(shot1.nodeId, 'S3 第 1 镜')]
  await expect.poll(() => ctx.run(runId)?.status, { message: 'S3：第 1 镜收尾之后 Run 落到已暂停', timeout: DEFAULT_TIMEOUT_MS }).toBe('paused')
  const paused = ctx.run(runId)
  scenario.observations.paused = { jobs: jobSummary(paused) }
  const pendingAfterPause = [shot2, shot3].map((shot) => ({ shotId: shot.shotId, submitted: submissionsOf(paused, shot.shotId).length, status: jobsOf(paused, shot.shotId)[0]?.status ?? null }))
  if (pendingAfterPause.some((entry) => entry.submitted > 0 || !UNSUBMITTED.has(entry.status))) {
    throw new Error(`S3：急停没挡住剩余镜头——第 2、3 镜在暂停之后仍被提交：${JSON.stringify(pendingAfterPause)}`)
  }

  // ── 画布手动生成第 2 镜（画布接手）：花钱前核对节点真正会跑的那一档 ──
  await ctx.fitView()
  const stopped = (nodeId) => win.locator(`[data-node-id="${nodeId}"] [data-shot-placeholder-state="stopped"]`)
  const stopProof = await proveProbe(stopped(shot3.nodeId), 'S3：第 3 镜挂着「已停 · 继续剩余」')
  await expect(stopped(shot2.nodeId), 'S3：第 2 镜也挂着「已停」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await ctx.snap('02-zh-paused-shot2-shot3-stopped')
  const shot2Meta = (await ctx.node(shot2.nodeId))?.meta
  scenario.observations.shot2CanvasMeta = { modelKey: shot2Meta?.modelKey, archetype: shot2Meta?.archetype, duration: shot2Meta?.duration, resolution: shot2Meta?.resolution, generate_audio: shot2Meta?.generate_audio }
  const canvasProblems = canvasNodeVideoProblems(shot2Meta)
  if (canvasProblems.length) throw new Error(`S3：画布那一镜不是被授权的那一档（一分钱没花）：${canvasProblems.join('；')}`)
  await ctx.zoomTo(shot2.nodeId)
  await ctx.select(shot2.nodeId)
  const generate = win.locator(`[data-node-id="${shot2.nodeId}"] ${GENERATE}`).first()
  await expect(generate, 'S3：暂停之后画布可以接手第 2 镜（↑ 能按）').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(generate, 'S3：第 2 镜的 ↑（画布接手）', { noWaitAfter: true })
  await expect.poll(() => {
    const job = jobsOf(ctx.run(runId), shot2.shotId)[0]
    return `${job?.status}:${job?.errorCode ?? ''}`
  }, { message: 'S3：画布认领落进 Run（第 2 镜的待发 job 被画布取代）', timeout: stationTimeout({ operations: 2 }) }).toBe('detached:canvas_claimed')
  scenario.observations.shot2Claim = ctx.run(runId).generationPlan.shots.find((shot) => shot.shotId === shot2.shotId)?.claim ?? null
  await expectAbsent(stopped(shot2.nodeId), { provenBy: stopProof, message: 'S3：画布接手之后第 2 镜不再挂「已停」' })
  await ctx.snap('03-zh-shot2-canvas-takeover-no-stopped')
  const shot2Media = await ctx.expectLandedVideo(shot2.nodeId, 'S3 第 2 镜（画布）')
  await expectAbsent(stopped(shot2.nodeId), { provenBy: stopProof, message: 'S3：第 2 镜画布出片之后也不挂「已停」' })

  // ── 在第 3 镜上点「继续剩余」：制作只派第 3 镜 ──
  // 先选中第 3 镜、等项目写入停稳（点按钮顺带改选中也会写一次项目）。
  await ctx.fitView()
  await ctx.select(shot3.nodeId)
  scenario.observations.projectRevisionBeforeResume = await ctx.waitProjectQuiet('S3 继续剩余之前')
  await clickOrFail(win.locator(`[data-node-id="${shot3.nodeId}"] [data-production-shot-action="resume-manual"]`), 'S3：第 3 镜的「继续剩余」')
  await expect.poll(() => submissionsOf(ctx.run(runId), shot3.shotId).length,
    { message: 'S3：继续剩余之后制作流程提交了第 3 镜', timeout: stationTimeout({ operations: 8 }) }).toBe(1)
  scenario.media.push(shot2Media, await ctx.expectLandedVideo(shot3.nodeId, 'S3 第 3 镜'))
  await ctx.fitView()
  await ctx.snap('04-zh-final-three-videos')

  // 任务面板：第 2 镜只有画布那一行（没有第二行），制作卡在跑的只剩它自己。
  await clickOrFail(win.locator(TASK_TRIGGER), 'S3：打开任务面板核对')
  const panel = win.locator(TASK_PANEL)
  await proveProbe(panel.locator(`[data-task-node-id="${shot2.nodeId}"]`), 'S3：任务面板里有第 2 镜画布那一笔')
  scenario.observations.taskPanelRowsForShot2 = await panel.locator(`[data-task-node-id="${shot2.nodeId}"]`).count()
  await ctx.snap('05-zh-task-panel')
  expect(scenario.observations.taskPanelRowsForShot2, 'S3：任务面板里第 2 镜只有一行').toBe(1)

  const final = ctx.run(runId)
  scenario.perShot = await ctx.ledger(runId, [shot1.shotId, shot2.shotId, shot3.shotId])
  scenario.jobs = jobSummary(final)
  scenario.runStatus = final.status
  const byShot = scenario.perShot
  expect([shot1, shot3].map((shot) => byShot[shot.shotId].production.length), 'S3：第 1、3 镜各一笔（制作）').toEqual([1, 1])
  expect(byShot[shot2.shotId].production.length, 'S3：第 2 镜制作一笔都没有').toBe(0)
  expect(byShot[shot2.shotId].canvas.length, 'S3：第 2 镜画布恰好一笔').toBe(1)
  scenario.verified = ['pause-leaves-shot2-shot3-unsubmitted', 'canvas-takes-over-paused-shot', 'taken-over-shot-loses-stopped-badge',
    'resume-submits-only-shot3', 'shot2-billed-once-by-canvas', 'task-panel-one-row-for-shot2']
}

// ═══ 入口 ═══════════════════════════════════════════════════════════════════════════════════════

const SCENARIOS = {
  1: () => runScenario('s1', scenarioPerShotConfirm),
  2: () => runScenario('s2', scenarioDeleteQueuedShot),
  3: () => runScenario('s3', scenarioPauseCanvasTakeoverResume),
}
// 缺省只跑 S1：要不要为 S2、S3 花钱由跑的人点名决定（S3 要在开拍确认的 10 分钟内走完，见文件头）。
const requested = String(process.env.NOMI_SHOT_CLAIM_SCENARIOS || '1').split(',').map((value) => value.trim()).filter(Boolean)
const unknown = requested.filter((key) => !SCENARIOS[key])
if (unknown.length) throw new Error(`NOMI_SHOT_CLAIM_SCENARIOS 只认 1、2、3：${unknown.join('、')}`)
for (const key of requested) {
  // 任何一段红了就停：后面的场景各自还要花真钱。
  if (!(await SCENARIOS[key]())) break
}
