#!/usr/bin/env node
// 真实用户任务 · **真花钱**那条腿（R13 四件真实：真应用 / 真面板输入 / 真工具轨迹 / 真模型真素材）。
//
//   NOMI_SPEND_OK=1 node tests/ux/agent-spend-real-image.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 为什么非要花这一次钱：`agent-spend-full-auto.walk.mjs` 的供应商是 loopback 夹具，它证得到
// 「档位改变了宿主的行为」，证不到「档位代答之后图真的出来了」——那台夹具上封印那步必然被拒。
// 2026-09-18 修完 `draft_shots` 丢 `candidate` 的根因之后，必须有人亲眼看见两件事在真供应商上成立：
//
//   ① 「只问花钱」（safe-auto）档：问一句 → 报价卡出现 → 点确认 → 真图落到画布上；
//   ② 「全自动」（project）档：同一句话 → **一张卡都不出** → 真图照样落到画布上，
//      而工具回执说的是「档位替你答了、已经开跑」，不是「有张卡在等你」。
//
// 大脑与生图都走 APIMart（内置供应商，谁的机器上都有）：大脑 DeepSeek V3.2，生图最便宜的 z-image-turbo。
// 凭据是**真实资料目录里的 safeStorage 密文 + Windows 的 Local State**，原样拷进隔离副本（_realProfile.mjs）——
// 明文 key 从头到尾不落任何文件、不进报告、不回显；跑完凭据副本当场删除，原库指纹跑前跑后比对（_paidRun.mjs）。
// 隔离副本里别的生成模型全部停用：模型从 `list_models` 里点谁，都只能点到 z-image-turbo，花销可预期。
// 目录行原样用真实的那一行，不再补价格：2026-09-21 起「未知价不许挡生成」，Agent 付费卡未标价照样能确认。
//
// zh / en 各留一张真截图：① 在中文界面走，② 走之前从设置里把界面切成 English（真人怎么切就怎么切）。
import { clickOrFail, expect } from './_assert.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { laneMessages, laneMessageText, readLaneTranscripts } from './agent-lane-observer.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, PERMISSION_POPOVER,
  chooseAssistantModel, openCanvas, permissionTier, readProject, sendCanvas,
} from './agent-runtime-walk-support.mjs'

// 真模型一轮的安全上限走公共预算 owner（tests/ux/_station-budget.mjs），不自造墙钟常量。
const MODEL_TURN_MS = stationTimeout({ turns: 1 })
const BRAIN = { vendorKey: 'apimart', modelKey: 'deepseek-v3.2' }
const IMAGE = { vendorKey: 'apimart', modelKey: 'z-image-turbo' }

// 真人会点名模型（「用 XX 生成」），而这正好是本条 lane 要证的那条路：
// 模型把 `candidate{providerId,modelId}` 填进 `draft_shots` → 宿主按它花钱。
const ASK_PAID = '用 Z-Image Turbo 生成一张日出海面的图，16:9 横构图。'
const ASK_AUTO = 'Make one more image with Z-Image Turbo: the same sea at dusk, 16:9 wide shot.'

/**
 * 画布上这个项目现在有几张**真的出了图**的节点——按落盘产物 `result.url` 算，不按节点存在算。
 * 草稿节点建起来是免费副作用（`draft_shots` 就会建），只有 `result.url` 才证明供应商真的回了一张图。
 */
async function renderedShots(win, projectId) {
  const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []
  return nodes.filter((node) => typeof node?.result?.url === 'string' && node.result.url.length > 0).length
}

/** 这个项目里 Agent 调过的每一次 `generate`，连同宿主回给它的那段结果（按转录的时间顺序）。 */
function generateResults(projectRoot) {
  const calls = new Set()
  const results = []
  for (const session of readLaneTranscripts(projectRoot)) {
    for (const message of laneMessages(session)) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) if (part.type === 'toolCall' && part.name === 'generate') calls.add(part.id)
      }
      if (message.role === 'toolResult' && calls.has(message.toolCallId)) {
        results.push({ isError: message.isError === true, text: laneMessageText(message) })
      }
    }
  }
  return results
}

const paid = await openPaidWalk('agent-spend-real-image.paid.mjs', 'spend-real-image', [BRAIN, IMAGE])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  // 宿主拒绝时那句**原话**只进 console（`useAgentPanelSpendConfirm` 的 `[spend-confirm] host refused`）；
  // 面板上只留一句给用户看的人话。走查要能说清「为什么没出图」，就得同时收着这两路。
  const consoleLines = []
  win.on('console', (message) => { consoleLines.push(`${message.type()}: ${message.text()}`.slice(0, 400)) })
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)

  // ═══ ① 「只问花钱」档（默认 safe-auto）：卡必须出来，点了才花钱 ═══
  await sendCanvas(win, ASK_PAID)
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await expect(card, '「只问花钱」档下，真模型点名一个真模型之后，报价卡必须出现在槽里')
    .toBeVisible({ timeout: MODEL_TURN_MS })
  // 按下去之前核对这张卡要花在谁身上：画布上的草稿节点必须就是被授权的 z-image-turbo（不对就一分钱不花）。
  const drafted = ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).filter((node) => !node.result)
  expect(drafted.map((node) => `${node.meta?.modelVendor}/${node.meta?.modelKey}`), '卡上要花钱的就是被授权的那个图模型')
    .toEqual([`${IMAGE.vendorKey}/${IMAGE.modelKey}`])
  await walk.snap('paid-01-zh-spend-card-before-confirm')
  // 按下去之前先在真实 DOM 上架一个通知观察者：宿主要是拒了，它只会用一条活 6 秒的 toast 说话，
  // 去 locator 上现断言跟它的自动消失赛跑（与 `agent-spend-confirm-executes.walk.mjs` 同一手法）。
  await win.evaluate(() => {
    window.__nomiToastLog = []
    const record = () => {
      for (const node of document.querySelectorAll('[class*="mantine-Notification-root"]')) {
        const text = (node.textContent ?? '').trim()
        if (text && !window.__nomiToastLog.includes(text)) window.__nomiToastLog.push(text)
      }
    }
    record()
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true })
  })
  // `noWaitAfter`：这一下会触发主进程的落地链，默认的「等页面稳下来」会和它拉锯。
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '报价卡上那颗主按钮', { noWaitAfter: true })
  try {
    await expect.poll(() => renderedShots(win, projectId), { timeout: MODEL_TURN_MS }).toBeGreaterThanOrEqual(1)
  } catch (error) {
    const spoken = (await win.evaluate(() => window.__nomiToastLog ?? [])).join(' | ')
    const refused = consoleLines.filter((line) => line.includes('spend-confirm') || line.includes('refused') || line.includes('capab'))
    throw new Error(`点了确认之后图没出来。\n面板对用户说：${spoken || '（一个字都没说——那本身就是 bug）'}`
      + `\n宿主原话：${refused.join(' | ') || '（console 里也没有）'}\n${error}`)
  }
  await walk.snap('paid-02-zh-image-really-arrived')

  // ═══ 界面切成 English（真人走法：设置 → 通用 → English）═══
  await clickOrFail(win.getByRole('button', { name: /^(设置|Settings)$/ }).first(), '顶栏「设置」按钮')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '设置导航「通用」')
  await clickOrFail(win.locator('[data-settings-locale="en"]'), '语言分段控件「English」')
  await expect(win.locator('[data-settings-locale="en"][aria-pressed="true"]'), '界面已切到 English').toBeVisible()
  await clickOrFail(win.locator('[data-settings-close]'), '设置对话框「关闭」按钮')

  // ═══ ② 「全自动」档：同一件事，一张卡都不出，图照样出来 ═══
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), 'permission tier picker')
  await expect(win.locator(`${CANVAS_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('project')}`), 'switch to full-auto')
  const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard, 'switching tiers still asks once — that click is the authorisation').toBeVisible()
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), 'confirm full-auto')

  const before = await renderedShots(win, projectId)
  const generatesBefore = generateResults(projectRoot).length
  await sendCanvas(win, ASK_AUTO)
  await expect.poll(() => renderedShots(win, projectId), { timeout: MODEL_TURN_MS }).toBeGreaterThan(before)
  await expect(card, 'full-auto: no priced card may appear — the tier answered it').toHaveCount(0)
  const landed = ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).filter((node) => node.result?.url)
  expect(landed.every((node) => node.meta?.modelVendor === IMAGE.vendorKey && node.meta?.modelKey === IMAGE.modelKey),
    'full-auto spent only on the authorised image model').toBe(true)
  // 图已经落盘 = 这一轮的活干完了，不再去等 composer 的「运行中」相：那一相在图出来之前就退了。
  await walk.snap('paid-03-en-full-auto-no-card-image-arrived')
  // 回执必须说「档位替你答了、已经在跑」，不能说「有张卡在等你」（T-ED-02 修的正是这一句）。
  // 真相源是宿主回给模型的那段工具结果（转录落盘），不是面板上的哪一块字。
  const autoResults = generateResults(projectRoot).slice(generatesBefore)
  expect(autoResults.length, 'full-auto leg: the agent called generate').toBeGreaterThan(0)
  expect(autoResults.at(-1).isError, 'full-auto leg: generate succeeded').toBe(false)
  expect(autoResults.at(-1).text, 'full-auto leg: the receipt says the tier approved it and generation started')
    .toMatch(/full-auto approval mode/i)

  walk.report.verified = ['safe-auto-card-then-real-image', 'full-auto-no-card-still-real-image']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
