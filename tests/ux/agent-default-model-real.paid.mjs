#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真模型数字 · 「设置里图片默认设成 X，同一句『画一张…』跑 N 次，Agent 起草的付费卡上是不是 X」
//
//   NOMI_SPEND_OK=1 node tests/ux/agent-default-model-real.paid.mjs （NOMI_REAL_ROUNDS=10 NOMI_REAL_LABEL=after 可选）
//
// 只花文本模型的 token：大脑是真模型（APIMart 的 DeepSeek V3.2）；图片模型只是被授权「出现在目录里」，
// **每一轮都停在付费卡、从不点生成**（点了也是用户的动作，这条走查永远不点），所以没有任何一次真出图。
// 每一轮新开对话，句子逐字相同——换一批句子再报一个好看的数字是自欺。
//
// 量三件事（PR 正文要写的数）：
//   跟默认的次数    卡上 / 落盘草稿里的模型 == 用户声明的图片默认（目标 N/N）
//   回合成功率      这一轮真的摆出了付费卡（而不是报错 / 卡住 / 没起草）
//   工具写对率      这一轮没有任何一次工具调用因为参数被拒
// 凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：明文 key 不落地、跑完删凭据副本、原库指纹跑前跑后比对。
import fs from 'node:fs'
import path from 'node:path'

import fs0 from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { BRAIN } from './_agentVideoPaid.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_ADD_FILE, COMPOSER_CHIP, COMPOSER_MODEL, MODEL_POPOVER,
  chooseAssistantModel, closeSpendCard, newConversation, openCanvas, readProject, sendCanvas, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

// 参数走环境变量：createRuntimeWalk 自己独占 argv（只认 --packaged）。
const ROUNDS = Number(process.env.NOMI_REAL_ROUNDS || 10)
const LABEL = process.env.NOMI_REAL_LABEL || 'run'
const IMAGE_DEFAULT = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
const IMAGE_OTHER = { vendorKey: 'apimart', modelKey: 'gpt-image-2' }
const ASK = process.env.NOMI_REAL_ASK || '帮我画一张雨后水洼里漂着一只红色纸船的图，1:1，就一张。起草好就直接提交生成，我在确认卡上点头。'
const ARG_REJECTED = /Validation failed for tool|capability_input_invalid|generation_input_invalid|Unrecognized key\(s\)|must be (array|string|number|object)|Required/i

const imageTmp = makeTempDir('real-two-images-')
/** 每一轮两张**内容不同**的图（同内容会被素材库按内容去重，第二轮就挂不上新的）。 */
const twoImagesFor = (round) => [0, 1].map((slot) => {
  const file = path.join(imageTmp, `r${round}-${slot}.png`)
  const color = ((round * 7 + slot * 90) % 200 + 40).toString(16).padStart(2, '0')
  execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', `color=c=0x${color}${slot ? '40' : 'c0'}${slot ? 'e0' : '30'}:s=256x256`, '-frames:v', '1', file], { stdio: 'pipe' })
  return file
})
const paid = await openPaidWalk('agent-default-model-real.paid.mjs', 'agent-default-model-real', [BRAIN, IMAGE_DEFAULT, IMAGE_OTHER])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)

  // 用户的真实操作：在 Agent 面板的模型弹层里把「图片默认」选成 X。
  const defaultLabel = paid.label(IMAGE_DEFAULT.vendorKey, IMAGE_DEFAULT.modelKey)
  const popover = win.locator(`${CANVAS_PANEL} ${MODEL_POPOVER}`)
  // 挑完对话模型后弹层可能还开着：开着就直接用，别再点一下把它关了。
  if (!(await popover.isVisible().catch(() => false))) await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`), 'Agent 模型选择器')
  await expect(popover).toBeVisible()
  const line = popover.locator('[data-v4-model-row="图片默认"]')
  await clickOrFail(line.locator('button').first(), '「图片默认」那一行的下拉')
  const option = win.locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]').filter({ hasText: defaultLabel }).first()
  await clickOrFail(option, `下拉里的「${defaultLabel}」`)
  await expect(line, '弹层那一行现在写着默认模型').toContainText(defaultLabel)
  await win.keyboard.press('Escape')
  walk.report.declaredDefault = { ...IMAGE_DEFAULT, label: defaultLabel }

  const seenCalls = new Set()
  let nodesSeen = 0
  const rounds = []
  for (let round = 1; round <= ROUNDS; round += 1) {
    const record = { round, cardShown: false, cardModelLabel: null, draftModel: null, followedDefault: null, argRejected: false, namedModelInCall: null, deviationFact: false, said: '', error: null }
    try {
      // 每一轮从空画布起步：上一轮留下的草稿节点会让真模型去问「是替换还是新建」，那测的就不是默认模型了。
      if (nodesSeen > 0) {
        const draftNodes = win.locator('.react-flow__node')
        const proof = await proveProbe(draftNodes, '上一轮留下的草稿节点在画布上')
        await win.locator('.react-flow__pane').first().click({ position: { x: 5, y: 300 } })
        await win.keyboard.press('Control+a')
        await win.keyboard.press('Delete')
        await expectAbsent(draftNodes, { provenBy: proof, message: '清空上一轮的草稿节点' })
        nodesSeen = 0
      }
      await newConversation(win, CANVAS_PANEL)
      // 新对话的空态出现 = 会话真的换好了；换好之前发的话会被面板以「对话已经换过了」拒掉。
      await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="empty"]`), '新对话的空态').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
      if (await noShare.isVisible().catch(() => false)) await noShare.click()
      if (process.env.NOMI_REAL_ATTACH_TWO === '1') {
        // 「把这两张合成一张」得真有两张：每轮随消息挂两张图（本机 ffmpeg 现生成的纯色图，不是素材库里的用户素材）。
        const chooser = win.waitForEvent('filechooser', { timeout: stationTimeout() })
        await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_ADD_FILE}`), '输入框的「+」')
        await (await chooser).setFiles(twoImagesFor(round))
        await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER} ${COMPOSER_CHIP}`).nth(1), '两张图都挂上了').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
        // 两张图落进项目素材才算上传完（发送前不能还在上传）。
        await expect.poll(() => fs0.existsSync(path.join(projectRoot, 'assets')) && fs0.readdirSync(path.join(projectRoot, 'assets'), { recursive: true }).filter((name) => String(name).endsWith('.png')).length,
          { message: '两张图落进项目素材', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThanOrEqual(2 * round)
      }
      await sendCanvas(win, ASK)
      const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
      // 等这一轮落地（卡在等人时输入框仍是运行态，所以先等「卡出现」或「回合结束」二者其一）。
      await expect.poll(async () => (await card.isVisible().catch(() => false)) || (await win.locator(`${CANVAS_PANEL} ${COMPOSER}:not([data-mode="running"])`).count()) > 0, { timeout: stationTimeout({ turns: 2 }), message: '这一轮迟迟没落地' }).toBe(true)
      record.cardShown = await card.isVisible().catch(() => false)
      if (!record.cardShown) { record.error = 'no-card' }
      record.cardModelLabel = !record.cardShown ? null : ((await card.innerText()).replace(/\s+/g, ' ').match(new RegExp(`(${defaultLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${(paid.label(IMAGE_OTHER.vendorKey, IMAGE_OTHER.modelKey) ?? 'x').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`)) ?? [])[1] ?? null
      await walk.snap(`round-${String(round).padStart(2, '0')}-card`)
      if (record.cardShown) await closeSpendCard(card, '这一轮到此为止：不点生成，关掉这张卡').catch(() => undefined)
      await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, doneTimeout: stationTimeout({ turns: 2 }) }).catch(() => undefined)
    } catch (error) {
      record.error = String(error?.message ?? error).split('\n')[0]
    }
    // 草稿落成画布节点后，节点 meta 里就是宿主真正记下的模型（落盘的那份）。
    try {
      const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
      const fresh = nodes.slice(nodesSeen).filter((node) => node.kind === 'image')
      nodesSeen = nodes.length
      const node = fresh.at(-1)
      if (node?.meta?.modelKey) record.draftModel = `${node.meta.modelVendor ?? '?'}/${node.meta.modelKey}`
    } catch (error) { record.error ??= String(error?.message ?? error).split('\n')[0] }
    // 这一轮的工具轨迹：从磁盘上的 lane transcript 读，不信面板文字。
    for (const session of readLaneTranscripts(projectRoot)) {
      const sessionKey = `${session.filePath ?? session.name}|`
      for (const message of laneMessages(session)) {
        if (message.role === 'assistant' && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part?.type === 'text' && typeof part.text === 'string' && !seenCalls.has(`${sessionKey}text:${part.text}`)) { seenCalls.add(`${sessionKey}text:${part.text}`); record.said += part.text }
            if (part?.type !== 'toolCall' || seenCalls.has(sessionKey + part.id)) continue
            seenCalls.add(sessionKey + part.id)
            const args = JSON.stringify(part.arguments ?? {})
            const named = /"modelId":"([^"]+)"/.exec(args)
            if (named) record.namedModelInCall = named[1]
          }
        } else if (message.role === 'toolResult' && !seenCalls.has(sessionKey + message.toolCallId)) {
          seenCalls.add(sessionKey + message.toolCallId)
          const text = (Array.isArray(message.content) ? message.content : []).filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
          if (message.isError && ARG_REJECTED.test(text)) record.argRejected = true
          if (/modelDeviatesFromUserDefault/.test(text)) record.deviationFact = true
          // 草稿里宿主真正记下的模型（draft 结果里带 candidateId + providerId + modelId 的那个对象）。
          if (/draft/.test(message.toolName ?? '') && !message.isError) {
            try {
              const find = (node) => {
                if (!node || typeof node !== 'object') return null
                if (node.candidateId && node.providerId && node.modelId) return node
                for (const value of Object.values(node)) { const hit = find(value); if (hit) return hit }
                return null
              }
              const found = find(JSON.parse(text))
              if (found) record.draftModel = `${found.providerId}/${found.modelId}`
            } catch { /* 结果不是 JSON：草稿模型缺席，如实记 null */ }
          }
        }
      }
    }
    record.followedDefault = record.draftModel === `${IMAGE_DEFAULT.vendorKey}/${IMAGE_DEFAULT.modelKey}`
    if (record.draftModel && record.error === 'no-card') record.error = null
    // 回复里提到模型时说的是显示名还是 id（宿主给的事实带显示名；模型对用户只许说显示名）。
    const labels = [defaultLabel, paid.label(IMAGE_OTHER.vendorKey, IMAGE_OTHER.modelKey)].filter(Boolean)
    record.displayNameMentions = labels.reduce((sum, label) => sum + (record.said.split(label).length - 1), 0)
    record.idMentions = (record.said.match(/apimart\/|gpt-image-2|gemini-3\.1-flash-image-preview/g) ?? []).length
    rounds.push(record)
    console.log(`[real-default] 第 ${round} 轮：卡=${record.cardShown} 草稿模型=${record.draftModel} 跟默认=${record.followedDefault} 点名=${record.namedModelInCall ?? '-'} 参数被拒=${record.argRejected}${record.error ? ' 错误=' + record.error : ''}`)
  }

  const followed = rounds.filter((entry) => entry.followedDefault).length
  const succeeded = rounds.filter((entry) => entry.draftModel && !entry.error).length
  const cards = rounds.filter((entry) => entry.cardShown).length
  const toolCorrect = rounds.filter((entry) => !entry.argRejected).length
  walk.report.numbers = { mentions: { displayName: rounds.reduce((n, r) => n + r.displayNameMentions, 0), id: rounds.reduce((n, r) => n + r.idMentions, 0) }, label: LABEL, rounds: ROUNDS, followedDefault: `${followed}/${ROUNDS}`, turnSuccess: `${succeeded}/${ROUNDS}`, cardShown: `${cards}/${ROUNDS}`, toolWriteCorrect: `${toolCorrect}/${ROUNDS}` }
  walk.report.rounds = rounds
  console.log(`[real-default] ${JSON.stringify(walk.report.numbers)}`)
  fs.writeFileSync(path.join(walk.report.outputDir, `real-default-${LABEL}.json`), JSON.stringify({ numbers: walk.report.numbers, declaredDefault: walk.report.declaredDefault, rounds }, null, 2))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
