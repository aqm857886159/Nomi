#!/usr/bin/env node
// 剧本 PB05 · 「让 Agent 起草三镜视频、全自动开跑，中途暂停，再点『继续剩余』」
//
// 已知问题（0.22.1）：
//   · 用着用着分镜表自己冒出来了（没点过）；
//   · Agent 里点了暂停，上面的消息还一直在转；
//   · 点了之后弹「操作没成功，稍后再试」。
// 真实创作者会做的事：
//   A. 在创作页写着稿子，切到「直接生成」，让 Agent 把三镜做成视频（Agent 起草落进创作页左栏，这一步看分镜表 / 左栏会不会自己变）；
//   B. 回到生成页再说一次；开跑之后觉得不对，去任务卡上按「暂停」，过一会儿在剩下那一镜上点「继续剩余」。
// 乱用：在第 1 镜还在提交的时候按暂停（慢网关，真实会有）；A 里 Agent 失败后用户直接换个页面再说一次。
//
// 零花费：供应商是只认回环的制作夹具；B 的提交先压在供应商门口（夹具 holdSubmits），用户就在这时按暂停，
// 按完剧本才放开受理——窗口靠放开来收，不靠计时。视频由夹具压着，剧本说「供应商那边出片了」才放。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_APIMART_VENDOR } from '../../agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_PERMISSION, CREATION_PANEL, INTERVENTION_CONFIRM, PERMISSION_POPOVER,
  expandResidentPanel, permissionTier, sendCanvas, sendCreation,
} from '../../agent-runtime-walk-support.mjs'
import { clickBlank, fitCanvasView } from '../actions.mjs'
import { lastUserText as lastUserTextOf, operationIdOf, scriptTurn } from '../brain.mjs'
import { startPlaybook } from '../launch.mjs'

const VIDEO_MODEL = 'kling-v3'
const TASK_TRIGGER = '[data-task-center-trigger="true"]'
const TASK_PANEL = '[data-nomi-right-panel="tasks"]'

const pb = await startPlaybook({
  id: 'pb05-pause-resume',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  seed: () => ({ nodes: [], groups: [], edges: [] }),
})
const { smoke, fixture, monitor } = pb
const EN = pb.locale === 'en'
const win = () => smoke.win
const SHOTS = EN
  ? ['Morning harbour, small boats rocking in the mist', 'A cat sunbathing on the pier of the same harbour', 'Seagulls gliding past the masts']
  : ['清晨的渔港，几只小船在雾里轻轻晃', '同一个渔港的码头上，一只猫在晒太阳', '海鸥掠过桅杆']
const ask = (marker) => (EN
  ? `${marker}: turn these three shots into videos — 1) ${SHOTS[0]}; 2) ${SHOTS[1]}; 3) ${SHOTS[2]}.`
  : `${marker}：把这三镜做成视频——镜1，${SHOTS[0]}；镜2，${SHOTS[1]}；镜3，${SHOTS[2]}。`)
const draftSteps = () => [
  { name: 'draft_shots', args: { shots: SHOTS.map((prompt, index) => ({ title: `镜头 ${index + 1}`, prompt, taskKind: 'text_to_video', model: `${VIDEO_MODEL}@${FIXTURE_APIMART_VENDOR}` })) } },
  { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
  { text: EN ? 'All three shots are generating.' : '三镜都开始生成了。' },
]

let harnessError = null
let runId = null
const run = () => monitor.readRuns().find((candidate) => candidate.runId === runId) ?? null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })

  // ── A：创作页里起草 ───────────────────────────────────────────────────────────────
  await monitor.step('切到创作页', async () => {
    await clickOrFail(win().locator('.nomi-stepper__step[data-mode="creation"]').first(), '顶栏「创作」')
    await expandResidentPanel(win())
    await expect(win().locator(`${CREATION_PANEL} ${COMPOSER}`)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }, { surfaces: ['workspaceMode', 'agentPanel', 'rightPanel', 'canvasViewport', 'creationSelection'] })

  await monitor.step('把权限档切到「直接生成」（二次确认上点头）', async () => {
    await clickOrFail(win().locator(`${CREATION_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
    await expect(win().locator(`${CREATION_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
    await clickOrFail(win().locator(`${CREATION_PANEL} ${permissionTier('direct')}`), '「全自动」')
    const switchCard = win().locator(`${CREATION_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
    await expect(switchCard, '切档要问一次').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    monitor.consentFullAuto({ label: '切到全自动（之后 Agent 的生成不再逐次问）' })
    await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到直接生成')
    await expect(win().locator(`${CREATION_PANEL} [data-v4-block="auto-mode"]`), '全自动档的常驻提醒').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }, { surfaces: [] })

  const creationTurn = scriptTurn(fixture, { label: 'pb05-creation', marker: 'PB05-创作', steps: draftSteps() })
  await monitor.step('用户（创作页）：把这三镜做成视频', () => sendCreation(win(), ask('PB05-创作')), { surfaces: [] })
  await monitor.step('等 Agent 这一轮说完（创作页）', async () => {
    await creationTurn.done
    await expect(win().locator(`${CREATION_PANEL} ${COMPOSER}[data-mode="running"]`)).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
  }, { user: false, surfaces: [] })
  await monitor.settle('创作页那一轮之后')

  // ── B：生成页里起草 → 暂停 → 继续剩余 ─────────────────────────────────────────────────
  await monitor.step('切到生成页', async () => {
    await clickOrFail(win().locator('.nomi-stepper__step[data-mode="generation"]').first(), '顶栏「生成」')
    await expandResidentPanel(win())
    await expect(win().locator(`${CANVAS_PANEL} ${COMPOSER}`)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }, { surfaces: ['workspaceMode', 'agentPanel', 'rightPanel', 'canvasViewport', 'creationSelection'] })

  const videosBefore = fixture.videos.length
  // 这一次的提交先压在供应商门口：第 1 镜到了门口还没受理，用户就是在这时按的暂停。
  fixture.holdSubmits(true)
  const canvasTurn = scriptTurn(fixture, { label: 'pb05-canvas', marker: 'PB05-生成', steps: draftSteps() })
  await monitor.step('用户（生成页）：把这三镜做成视频', () => sendCanvas(win(), ask('PB05-生成')), { surfaces: [] })
  await monitor.step('等 Agent 起草、第 1 镜开始提交', async () => {
    await expect.poll(() => fixture.videos.length, { message: '第 1 镜的提交到了供应商门口', timeout: stationTimeout({ turns: 1 }) }).toBeGreaterThan(videosBefore)
    runId = monitor.readRuns().filter((candidate) => candidate.generationPlan?.shots?.length === 3).at(-1)?.runId ?? null
  }, { user: false, surfaces: [] })

  await monitor.step('在任务卡上按「暂停」（第 1 镜还压在供应商门口）', async () => {
    await clickOrFail(win().locator(TASK_TRIGGER), '顶栏任务中心')
    await clickOrFail(win().locator(`${TASK_PANEL} [data-production-task-card] [data-production-control="pause"]`).first(), '任务卡「暂停」')
    // 这一下就是「别再花了」：之后才到供应商门口的提交都不再有授权覆盖。
    monitor.revokeConsents({ label: '任务卡「暂停」' })
    monitor.note({ kind: 'paused-at', submittedBefore: fixture.videos.length - videosBefore })
    await expect.poll(() => run()?.status, { message: 'Run 进入暂停', timeout: DEFAULT_TIMEOUT_MS }).toMatch(/^(pausing|paused)$/)
    await win().keyboard.press('Escape')
  }, { surfaces: ['rightPanel'] })

  await monitor.step('供应商受理了门口那一笔、随后出片（夹具先放受理、再放片），等在飞的镜头收尾', async () => {
    fixture.holdSubmits(false)
    await canvasTurn.done
    fixture.releaseVideos()
    await expect.poll(() => (run()?.jobs ?? []).some((job) => job.providerTaskId) && (run()?.jobs ?? []).filter((job) => job.providerTaskId)
      .every((job) => ['ready', 'adopted', 'needs_attention', 'cancelled_remote'].includes(job.status)),
    { message: '交给供应商的那几镜都收尾', timeout: stationTimeout({ operations: 8 }) }).toBe(true)
  }, { user: false, surfaces: [] })

  await monitor.settle('暂停之后，在飞的镜头都已收尾')

  // 用户要在某一镜上点按钮，先得看见它：画布只渲染视野里的卡，不适应视图就找不到「已停」的那几镜
  // （上一版剧本就这样空过了「继续剩余」这一步）。视口是用户自己挪的，这一步声明它。
  await monitor.step('把画布上的卡片放进视野（适应视图）', async () => {
    await clickBlank(win()).catch(() => undefined)
    await fitCanvasView(win())
  }, { surfaces: ['canvasViewport'] })

  await monitor.step('在还没拍的那一镜上点「继续剩余」', async () => {
    const resume = win().locator('[data-shot-placeholder-state="stopped"] [data-production-shot-action]')
    if (!(await resume.count())) {
      // 暂停之后剩下的镜照样交完了（上面铁律 1 那条），画布上没有「已停」的镜头可继续——如实记下。
      monitor.note({ kind: 'nothing-to-resume', runStatus: run()?.status, jobs: (run()?.jobs ?? []).map((job) => job.status) })
      return
    }
    // 点之前 Run 停在哪（落盘的 run.json 正被改写时可能一瞬读不到，读到为止）。
    let stoppedAs = null
    await expect.poll(() => (stoppedAs = run()?.status ?? null), { message: '读到这次制作的 Run', timeout: DEFAULT_TIMEOUT_MS }).not.toBeNull()
    monitor.consentFullAuto({ label: '「继续剩余」' })
    await clickOrFail(resume.first(), '「继续剩余」')
    // 结论可能是一条一闪而过的 toast：等它出现，或者 Run 真的动起来。
    // 「动起来」= 离开点之前的停着状态，先读后台落盘的 Run（不受界面卡顿影响）：夹具出片很快，Run 可能在两次轮询之间
    // 就从「进行中」走到「等粗剪确认」——只认 running / completed 会把真接着拍了的 Run 判成「没结论」（2026-09-30 实跑撞到）。
    await expect.poll(async () => {
      const now = run()
      if (now && now.status !== stoppedAs) return true
      return (await win().locator('.mantine-Notification-root').count()) > 0
    }, { message: '点完有个结论（提示或 Run 动了）', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
    monitor.note({ kind: 'resume-outcome', from: stoppedAs, to: run()?.status ?? null })
  }, { surfaces: [] })

  // ── C：Agent 在忙的时候按停止（用户口中的「在 Agent 里点了暂停」）──────────────────────────
  const held = fixture.expectText({ label: 'pb05-stop: the model is still thinking', match: (body) => lastUserTextOf(body).includes('PB05-停'), reply: { type: 'hold' } })
  await monitor.step('用户：再问一句，Agent 想了很久', async () => {
    await sendCanvas(win(), EN ? 'PB05-停: which of the three shots is the strongest?' : 'PB05-停：这三镜里哪一镜最好？')
    await held.received
    await expect(win().locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }, { surfaces: [] })
  await monitor.step('用户在 Agent 面板里按停止', async () => {
    await clickOrFail(win().locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"] [data-v4-control="send"]`), '输入框上的停止钮')
    await expect(win().locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`), '按了停止，输入框退出运行态').toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
  }, { surfaces: [] })

  await monitor.settle('收尾')
  monitor.note({ kind: 'run-final', runId, status: run()?.status, jobs: (run()?.jobs ?? []).map((job) => ({ shotId: job.metadata?.shotId, status: job.status, providerTaskId: job.providerTaskId ?? null })) })
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb05 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
