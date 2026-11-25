#!/usr/bin/env node
// 真模型数字 · 付费卡① 第 9 条（R13 第三档）：「不点名模型、也不写种类」的一句话，Agent 起草出来的是不是对的种类。
//
//   NOMI_SPEND_OK=1 node tests/ux/agent-shot-kind-real.paid.mjs （NOMI_REAL_LABEL=branch / main 可选）
//
// 为什么要它：第 9 条删掉了「按提示词关键词猜图还是视频」，建镜头时种类只从点名的模型 + 明写的种类来，两样都没有
// 宿主就请 Agent 写明（多一次来回），`draft_shots` 的工具说明也随之改了。工具说明一改，「外观绿」不等于接好了：
// 这条走查拿同一批话在改动前（main）和改动后（本分支）各跑一遍，比三个数。
//
// 只花文本模型的 token：大脑是真模型（APIMart 的 DeepSeek V3.2）；图片 / 视频模型只是被授权「出现在目录里」，
// **每一轮都停在付费卡、从不点生成**，所以没有任何一次真出图 / 出片。每一轮新开对话、清空画布。
//
// 量三件事（PR 正文要写的数）：
//   工具写对率      这一轮没有任何一次工具调用被宿主拒（参数不对 / 种类定不下来 / 模型做不了）
//   回合成功率      这一轮真的起草出了草稿，而且草稿里的种类（图 / 视频）和数量就是这句话要的——从盘上的 Run 读，
//                   不从卡上读：起草完要不要立刻摆卡是 Agent 自己的判断（它也可能先问一句「现在生成吗」），和这次改动无关；
//                   摆了卡的另记一个数（cardShown），卡上的种类也一并核
//   多出来的来回    被拒之后模型再调一次——每一次被拒都是一次多出来的来回（一并记下被拒的原因）
// 凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：明文 key 不落地、跑完删凭据副本、原库指纹跑前跑后比对。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { BRAIN, VIDEO } from './_agentVideoPaid.mjs'
import { openPaidWalk, readProductionRuns } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_INPUT,
  chooseAssistantModel, closeSpendCard, newConversation, openCanvas, sendCanvas, waitForV4TurnIdle, composerText } from './agent-runtime-walk-support.mjs'

const LABEL = process.env.NOMI_REAL_LABEL || 'run'
const IMAGE = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
/**
 * 不点名模型、也不写「图片 / 视频 / taskKind」这种字段名的说法：种类只在话里（画 / 一张 / 一段 / 5 秒）。
 * 数量也在话里，卡上的标题数要对得上。
 */
const CASES = [
  { id: 'K1', ask: '画两张海边日落', kind: 'image', count: 2 },
  { id: 'K2', ask: '做一段 5 秒的猫跳上桌', kind: 'video', count: 1 },
  { id: 'K3', ask: '来一张赛博朋克风的城市夜景海报', kind: 'image', count: 1 },
  { id: 'K4', ask: '拍一段 8 秒的雨夜街头，镜头慢慢推近', kind: 'video', count: 1 },
  { id: 'K5', ask: '画三张不同表情的柴犬头像', kind: 'image', count: 3 },
  { id: 'K6', ask: '小女孩在麦田里奔跑，来一段 5 秒的', kind: 'video', count: 1 },
  { id: 'K7', ask: '帮我出一张咖啡店菜单的封面，竖版', kind: 'image', count: 1 },
  { id: 'K8', ask: '做两段产品展示：一瓶香水在旋转台上慢慢转，每段 5 秒', kind: 'video', count: 2 },
  { id: 'K9', ask: '画一张水墨风的山水，横版', kind: 'image', count: 1 },
  { id: 'K10', ask: '一碗热气腾腾的拉面被端上桌，6 秒', kind: 'video', count: 1 },
  { id: 'K11', ask: '画一张古风少女的立绘', kind: 'image', count: 1 },
  { id: 'K12', ask: '来一段云海翻涌的延时', kind: 'video', count: 1 },
]
/** 只跑其中几句（连通性探测用）：NOMI_REAL_ONLY=K1,K2。写错的 id 直接报错，不静默少跑。 */
const ONLY = (process.env.NOMI_REAL_ONLY || '').split(',').map((id) => id.trim()).filter(Boolean)
for (const id of ONLY) if (!CASES.some((item) => item.id === id)) throw new Error(`NOMI_REAL_ONLY 里的 ${id} 不在用例表里`)
const SELECTED = ONLY.length ? CASES.filter((item) => ONLY.includes(item.id)) : CASES
/** 宿主拒掉一次工具调用的样子（参数被拒 / 种类定不下来 / 模型做不了这一种）。 */
const REJECTED = /Validation failed for tool|capability_input_invalid|generation_input_invalid|Unrecognized key\(s\)|must be (array|string|number|object)|Required/i
/** 第 9 条那一种退回：种类定不下来（没点名模型也没写种类）/ 点名的模型做不了这一种。 */
const KIND_REFUSAL = /kind_unspecified|model_cannot_do|cannot (do|make|produce)|state (the|which) kind|taskKind/i

/** 卡标题 → 种类与数量（中文界面：「生成这 N 张图片？」「生成这 N 段视频？」）。 */
// 2026-11-15 拆开后确认条不画标题问话：几镜、图还是视频只在主按钮上（「生成 N 张 / 段」；单段只写「生成」，种类读不出记 null）。
function cardKindOf(label) {
  const text = String(label ?? '').replace('⏎', '').trim()
  if (text === '生成') return { kind: null, count: 1 }
  const match = /(\d+)\s*(张|段)/.exec(text)
  if (!match) return { kind: null, count: null }
  return { kind: match[2] === '张' ? 'image' : 'video', count: Number(match[1]) }
}

/**
 * 发一句话，并证明面板真的收下了它（输入框清空，或回合已经在跑）。收不下就把面板上此刻说的话带回来——
 * 第一次跑时这一步无声地没发出去，后面整轮只是在等一个不存在的回合。
 */
async function sendAccepted(win, text) {
  const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
  const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
  const accepted = async () => (await running.count()) > 0 || (await composerText(input).catch(() => '')).trim() === ''
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sendCanvas(win, text)
    const ok = await expect.poll(accepted, { timeout: DEFAULT_TIMEOUT_MS }).toBe(true).then(() => true, () => false)
    if (ok) return attempt
    const notices = await win.locator('.mantine-Notification-root, [role="status"], [role="alert"]').allInnerTexts().catch(() => [])
    console.log(`[shot-kind ${LABEL}] 第 ${attempt} 次发送没被收下；面板上：${JSON.stringify(notices.map((note) => note.replace(/\s+/g, ' ').slice(0, 160)))}`)
  }
  throw new Error('composer did not accept the message after 3 attempts')
}

const paid = await openPaidWalk('agent-shot-kind-real.paid.mjs', `agent-shot-kind-real-${LABEL}`, [BRAIN, IMAGE, VIDEO])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectRoot } = await walk.newProject()
  await openCanvas(win)
  await paid.lockToAuthorizedModels(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)

  const seen = new Set()
  const seenRuns = new Set()
  const rounds = []
  for (const item of SELECTED) {
    const record = { id: item.id, ask: item.ask, expected: { kind: item.kind, count: item.count }, cardShown: false, cardButton: null, card: null,
      calls: [], rejected: [], kindStated: null, said: '', error: null }
    try {
      const nodes = win.locator('.react-flow__node')
      if (await nodes.count()) {
        // 每一轮从空画布起步：上一轮的草稿节点会让真模型去问「替换还是新建」，测的就不是这件事了。
        const proof = await proveProbe(nodes, '上一轮留下的草稿节点在画布上')
        await win.locator('.react-flow__pane').first().click({ position: { x: 5, y: 300 } })
        await win.keyboard.press('Control+a')
        await win.keyboard.press('Delete')
        await expectAbsent(nodes, { provenBy: proof, message: '清空上一轮的草稿节点' })
      }
      await newConversation(win, CANVAS_PANEL)
      await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="empty"]`), '新对话的空态').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
      if (await noShare.isVisible().catch(() => false)) await noShare.click()
      record.sendAttempts = await sendAccepted(win, item.ask)
      const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
      await expect.poll(async () => (await card.isVisible().catch(() => false)) || (await win.locator(`${CANVAS_PANEL} ${COMPOSER}:not([data-mode="running"])`).count()) > 0,
        { timeout: stationTimeout({ turns: 3 }), message: '这一轮迟迟没落地' }).toBe(true)
      record.cardShown = await card.isVisible().catch(() => false)
      if (record.cardShown) {
        record.cardButton = (await card.locator('[data-v4-control="confirm"]').innerText()).trim()
        record.card = cardKindOf(record.cardButton)
      }
      await walk.snap(`${item.id}-card`)
      if (record.cardShown) await closeSpendCard(card, `${item.id}：到此为止，不点生成，关掉这张卡`).catch(() => undefined)
      await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, doneTimeout: stationTimeout({ turns: 2 }) }).catch(() => undefined)
    } catch (error) {
      record.error = String(error?.message ?? error).split('\n')[0]
    }
    // 这一轮的工具轨迹：从磁盘上的 lane transcript 读，不信面板文字。
    for (const session of readLaneTranscripts(projectRoot)) {
      const key = `${session.filePath ?? session.name}|`
      for (const message of laneMessages(session)) {
        if (message.role === 'assistant' && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part?.type === 'text' && typeof part.text === 'string' && !seen.has(`${key}text:${part.text}`)) { seen.add(`${key}text:${part.text}`); record.said += part.text }
            if (part?.type !== 'toolCall' || seen.has(key + part.id)) continue
            seen.add(key + part.id)
            const args = JSON.stringify(part.arguments ?? {})
            record.calls.push({ tool: part.name, args: args.slice(0, 600) })
            if (part.name === 'draft_shots' && record.kindStated === null) record.kindStated = /"(taskKind|mode|modeId)"\s*:/.test(args)
          }
        } else if (message.role === 'toolResult' && !seen.has(key + message.toolCallId)) {
          seen.add(key + message.toolCallId)
          const text = (Array.isArray(message.content) ? message.content : []).filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
          // 宿主把这一次调用退回给模型（错误结果）= 模型得再来一次：一次多出来的来回。原因按文字归一类，便于比两边。
          if (message.isError === true) {
            record.rejected.push({ tool: message.toolName ?? null, kindRefusal: KIND_REFUSAL.test(text), argRefusal: REJECTED.test(text), why: text.replace(/\s+/g, ' ').slice(0, 300) })
          }
        }
      }
    }
    // 这一轮起草的草稿：盘上新出现的那个 Run，镜头（不算参考卡）的种类与数量。
    const fresh = readProductionRuns(projectRoot).filter((run) => !seenRuns.has(run.runId))
    for (const run of fresh) seenRuns.add(run.runId)
    const shots = fresh.flatMap((run) => (run.generationPlan?.shots?.length ? run.generationPlan.shots : run.generationPlan?.candidate ? [{ candidate: run.generationPlan.candidate }] : []))
      .filter((shot) => shot.role !== 'anchor')
    const kinds = [...new Set(shots.map((shot) => (/video/i.test(String(shot.candidate?.mode ?? shot.candidate?.modeId ?? '')) ? 'video' : 'image')))]
    record.draft = shots.length ? { count: shots.length, kinds, models: [...new Set(shots.map((shot) => `${shot.candidate?.providerId}/${shot.candidate?.modelId}`))] } : null
    record.toolWriteCorrect = record.rejected.length === 0
    // 盘上没认出新起草的 Run（Agent 改了上一轮那份草稿而不是新起一份）时，退到卡上读：卡摆的就是这一次要生成的那几镜。
    const judged = record.draft ? { kind: record.draft.kinds.length === 1 ? record.draft.kinds[0] : 'mixed', count: record.draft.count, from: 'draft' }
      : record.card ? { ...record.card, from: 'card' } : null
    record.judgedFrom = judged?.from ?? null
    record.kindCorrect = Boolean(judged && judged.kind === item.kind)
    record.countCorrect = Boolean(judged && judged.count === item.count)
    record.cardKindCorrect = record.cardShown ? Boolean(record.card && record.card.kind === item.kind) : null
    record.turnSuccess = Boolean(judged) && record.kindCorrect && !record.error
    rounds.push(record)
    console.log(`[shot-kind ${LABEL}] ${item.id}「${item.ask}」：草稿=${record.draft ? `${record.draft.count}×${record.draft.kinds.join('/')}` : '-'} 种类对=${record.kindCorrect} 数量对=${record.countCorrect} 卡=${record.cardShown ? record.cardButton : '-'} 被拒=${record.rejected.length}${record.error ? ' 错误=' + record.error : ''}`)
  }

  const total = rounds.length
  const count = (predicate) => rounds.filter(predicate).length
  walk.report.numbers = {
    label: LABEL,
    rounds: total,
    toolWriteCorrect: `${count((r) => r.toolWriteCorrect)}/${total}`,
    turnSuccess: `${count((r) => r.turnSuccess)}/${total}`,
    kindCorrect: `${count((r) => r.kindCorrect)}/${total}`,
    countCorrect: `${count((r) => r.countCorrect)}/${total}`,
    cardShown: `${count((r) => r.cardShown)}/${total}`,
    cardKindCorrect: `${count((r) => r.cardKindCorrect === true)}/${count((r) => r.cardShown)}`,
    extraRoundTrips: rounds.reduce((sum, r) => sum + r.rejected.length, 0),
    roundsWithExtraRoundTrip: count((r) => r.rejected.length > 0),
    draftStatedKind: `${count((r) => r.kindStated === true)}/${count((r) => r.kindStated !== null)}`,
  }
  walk.report.rounds = rounds
  console.log(`[shot-kind ${LABEL}] ${JSON.stringify(walk.report.numbers)}`)
  fs.writeFileSync(path.join(walk.report.outputDir, `shot-kind-real-${LABEL}.json`), JSON.stringify({ numbers: walk.report.numbers, rounds }, null, 2))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
