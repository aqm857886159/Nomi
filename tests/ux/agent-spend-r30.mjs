#!/usr/bin/env node
// R30：付费确认卡这条链的**两个数字**——工具写对率 + 回合成功率。
//
//   node tests/ux/agent-spend-r30.mjs                       # 零额度 loopback 夹具（进 CI 的那一档）
//   NOMI_SPEND_OK=1 NOMI_R30_ARM=deepseek node tests/ux/agent-spend-r30.mjs  # 真实模型（APIMart 上的 DeepSeek，小额 token）
//   （真实档直接复用这台机器上已配好的 APIMart 凭据——那条记录是 safeStorage 密文，连同 Windows 的
//    Local State 原样拷进隔离副本（tests/ux/_realProfile.mjs），同机解得开；明文 key 不落任何文件、不进报告、不回显。）
//
// 话术集在 `agent-spend-r30-cases.mjs`：**先写这 22 句用户会怎么说，再跑模型**
// （2026-09-09 用户定的顺序；按界面面排 case 量到的是我们自己的界面，不是模型的能力）。
// 含两句阴性对照——一个「永远建草稿」的模型会在全阳性集上拿满分，那种绿灯不作数。
//
// 两个数怎么算（都按**首次**调用算，重试不冲淡首错）：
//   · 工具写对率 = 首次 `nomi_generation_plan` 通过运行时校验且真落成一份待确认草稿 / 有效样本
//   · 回合成功率 = 这一回合停在「面板上出现带真实价格的付费卡 + 模型说了句话」/ 有效样本
//     （阴性对照反过来：没有卡、模型正常回话 = 成功）
//
// 两档共用同一套判据与同一批话术，唯一的区别是**谁在回话**：loopback 档由夹具照话术派发
// 一次 `nomi_generation_plan`（量的是我们这条链接不接得住），DeepSeek 档由真实模型自己决定
// （量的是模型面对真实说法写不写得对）。
//
// 生成供应商两档都是 loopback 夹具：整场**一次付费调用都不会发生**。
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_TEXT_MODEL_LABEL, FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, chooseAssistantModel, createRuntimeWalk,
  openCanvas, readProject, sendCanvas,
} from './agent-runtime-walk-support.mjs'
import { SPEND_R30_CASES } from './agent-spend-r30-cases.mjs'
import { assertPaidRunAllowed } from './_paidRun.mjs'
import { removeRealCredentials, seedRealModels } from './_realProfile.mjs'

/**
 * 这一场里模型**实际按下了哪些工具**——从宿主自己的转录里数，不是从我们的期望里数。
 *
 * 为什么非要这一栏：两个率说「没写对」的时候，它分不出「模型没动手」和「模型动了手、
 * 但走的是另一条路」。这两件事的处置完全相反（前者是模型能力，后者是我们的工具面设计），
 * 把它们混成一个数字，就是让一次真实测量什么也没说。
 */
function toolRouteCensus(projectRoot) {
  const sessions = path.join(projectRoot, '.nomi', 'agent-sessions')
  if (!fs.existsSync(sessions)) return { note: '这一场没有转录（宿主没落盘）' }
  const files = []
  const walkDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walkDir(full)
      else if (entry.name.endsWith('.jsonl') && !full.includes('.trace')) files.push(full)
    }
  }
  walkDir(sessions)
  const census = {}
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    for (const match of raw.matchAll(/toolcall_start[^}]*"name":"([a-z_0-9]+)"/g)) {
      census[match[1]] = (census[match[1]] ?? 0) + 1
    }
  }
  return census
}

// 档位走**环境变量**而不是命令行参数：走查启动器自己要校验 argv（只允许 `--packaged <路径>`），
// 多一个 flag 会被它当成用法错误挡下来。
const DEEPSEEK = process.env.NOMI_R30_ARM === 'deepseek'
/** 真实档的大脑：APIMart（内置供应商，谁的机器上都有）上的 DeepSeek，真实目录里的那一行原样用。 */
const DEEPSEEK_BRAIN = { vendorKey: 'apimart', modelKey: 'deepseek-v3.2' }
const PRICE_TOTAL = '[data-v4-price="total"]'
const CARD = `${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`

/**
 * 这次请求里**最后一句用户说的话**。
 *
 * 夹具按「第一条还没被消费且匹配的期望」派发，而请求体带的是整段历史——
 * 拿整段历史去 `includes` 会让第 4 句的请求同时命中第 3 句的期望（历史里它还在）。
 * 一旦某一句没发出去，它的期望就会留在队列里劫持后面的请求，错位一路滚下去。
 * 只看最后一句用户说的话，谁也劫持不了谁。
 */
function lastUserText(body) {
  const users = (body?.messages ?? []).filter((message) => message.role === 'user')
  const last = users.at(-1)
  const content = last?.content
  if (typeof content === 'string') return content
  return (Array.isArray(content) ? content : [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('\n')
}

/**
 * 真实档：把**这台机器上已经配好的** APIMart DeepSeek 接进那份隔离目录，当对话模型用。
 *
 * 为什么是「拷已有的记录」而不是「把 env 里的 key 写进去」：本仓对凭据是 fail-closed 的——
 * `enc:"plain"` 的 key 记录永远不会被当成可用凭据（`secrets.ts` 的 decryptApiKeyRecord 只认
 * safeStorage 密文）。所以真实档复用真实目录里那条**已加密**的记录与它的钥匙（owner：_realProfile.mjs），
 * 明文 key 从头到尾不落任何文件、不进报告、不回显；它花的是真 token，所以走付费走查的同一道闸（_paidRun.mjs）。
 *
 * 生成模型仍是 loopback 夹具那一行：模型「决定要生成什么」是真的，真去生成永远到不了外面的钱。
 */
const paidGuard = DEEPSEEK ? assertPaidRunAllowed('agent-spend-r30.mjs (deepseek arm)') : null
const walk = await createRuntimeWalk(DEEPSEEK ? 'spend-r30-deepseek' : 'spend-r30-loopback')
const brainLabel = DEEPSEEK
  ? seedRealModels({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, models: [DEEPSEEK_BRAIN] })[0].labelZh
  : FIXTURE_TEXT_MODEL_LABEL

const rows = []
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, brainLabel, CANVAS_PANEL)

  const nodeCount = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length
  const settled = async (count, timeout = DEFAULT_TIMEOUT_MS) =>
    expect.poll(nodeCount, { timeout }).toBe(count).then(() => true, () => false)

  let expected = 0
  for (const sample of SPEND_R30_CASES) {
    // 上一句的草稿**留在画布上**（真实用户也不会每次都手动清）。落盘是防抖的，所以下一句开始前
    // 先等它稳定下来——不等就会把上一句的残留读成这一句的产出，那是一条会把两个数一起做假的读法。
    // 落盘是防抖的，所以下一句开始前先等画布稳定下来——不等就会把上一句的残留读成这一句的产出。
    // 等不到预期数目**不报红**：真实模型可能一句话建了不止一个节点，那不是仪器坏了，是它的行为，
    // 记下来重新对基线即可（报红会让一次测量在中途中断，剩下的样本就丢了）。
    const stable = await settled(expected)
    const before = stable ? expected : await nodeCount()
    expected = before
    if (!DEEPSEEK) {
      // loopback 档：夹具照这一句派发一次工具调用（阴性对照那两句只回话）。
      const callId = `r30-${sample.id}`
      walk.fixture.expectText({
        label: `${sample.id} drafts`,
        match: (body) => lastUserText(body).includes(sample.text),
        reply: sample.expectsDraft
          ? { type: 'tool', id: callId, name: 'draft_shots', args: {
              shots: [{ prompt: sample.text, taskKind: 'text_to_image', candidate: { providerId: FIXTURE_VENDOR, modelId: FIXTURE_IMAGE_MODEL }, parameters: { size: '1024x1024' } }],
            } }
          : { type: 'text', text: '这一笔要花多少钱，等你点头之前我不会动手。' },
      })
      if (sample.expectsDraft) {
        // 20 动词：卡在 generate 那一刻出现；operationId 由宿主生成，从草稿结果里读回再释放 generate。
        let operationId
        const drafted = walk.fixture.expectText({
          label: `${sample.id} drafted`,
          match: (body) => {
            const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === callId)
            if (!result) return false
            operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
            return true
          },
          reply: { type: 'hold' },
        })
        drafted.received.then(() => drafted.release({ type: 'tool', id: `${callId}-generate`, name: 'generate', args: { operationId } }))
        walk.fixture.expectText({
          label: `${sample.id} settles`,
          match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === `${callId}-generate`),
          reply: { type: 'text', text: '报价卡已经在面板里，等你确认。' },
        })
      }
    }
    await sendCanvas(win, sample.text)
    // 落地判据：composer 退出运行态（两档同一条）。预算从站点预算派生，不写死墙钟数
    // （R18）：真实模型那档给「一个完整回合」的预算，夹具那档给四步操作的预算。
    await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`).first())
      .toBeHidden({ timeout: DEEPSEEK ? stationTimeout({ turns: 1 }) : stationTimeout({ operations: 4 }) })

    // 回合结束**不等于**卡已经在屏幕上：草稿要先落画布，宿主投影再被轮询读到。
    // 所以这里等的是**产出本身**（Playwright 自己的等待器，不是私造的墙钟轮询，R18）。
    // 阴性对照那两句等满同一段时间才判「没出卡」——不等就判，等于用仪器的慢换一个假绿。
    const card = win.locator(CARD).first()
    const cardVisible = await card.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) }).then(() => true, () => false)
    const priceText = cardVisible ? await win.locator(`${CARD} ${PRICE_TOTAL}`).first().innerText().catch(() => '') : ''
    // 这一句到底有没有**新**落下一份草稿。这是两个数唯一的判据——
    // 卡是否在屏幕上不能当判据：草稿留在画布上不清，介入槽里那张卡从第一句起就一直在。
    // 阴性对照因此会在这里等满一整段时间才判「没长出新的」（不等就判 = 假绿）。
    const grew = await settled(before + 1)
    if (grew) expected = before + 1
    const said = await win.locator(`${CANVAS_PANEL} [data-v4-block="assistant"]`).last().innerText().catch(() => '')
    // 「写对」= 草稿真的落下来了（节点 + 卡 + 一个真实的数），不是「模型说了它要生成」。
    const drafted = grew && cardVisible && /\d+\.\d{2}/.test(priceText)
    const toolCorrect = sample.expectsDraft ? drafted : !drafted
    const turnOk = sample.expectsDraft ? drafted : (!drafted && said.trim().length > 0)
    // 回合的最后一句话留在行里：两个数说「不对」的时候，得看得出是模型没写对、还是这条链根本没通。
    rows.push({ id: sample.id, expectsDraft: sample.expectsDraft, landed: grew, drafted, price: priceText, toolCorrect, turnOk, said: said.slice(0, 200) })
    console.log(`[r30] ${sample.id} ${toolCorrect ? '写对' : '写错'} · ${turnOk ? '回合成' : '回合败'} · ${priceText || '无卡'}`)

  }

  const total = rows.length
  const positives = rows.filter((row) => row.expectsDraft)
  const toolCorrect = rows.filter((row) => row.toolCorrect).length
  const turnOk = rows.filter((row) => row.turnOk).length
  const landed = positives.filter((row) => row.landed).length
  const pct = (n) => `${n}/${total} (${Math.round((n / total) * 1000) / 10}%)`
  Object.assign(walk.report, {
    r30: {
      arm: DEEPSEEK ? `${DEEPSEEK_BRAIN.vendorKey}/${DEEPSEEK_BRAIN.modelKey} (real)` : 'loopback fixture (zero quota)',
      cases: total,
      toolWriteRate: pct(toolCorrect),
      turnSuccessRate: pct(turnOk),
      // 第三个数**不是**验收门，是读数的注脚：它把「模型压根没动手」和「动了手但没走这条链」分开。
      draftLandedRate: `${landed}/${positives.length} (${Math.round((landed / positives.length) * 1000) / 10}%)`,
      toolRoutes: toolRouteCensus(walk.report.projectRoot ?? ''),
      scope: '判据=这一句是否新落下一份待确认草稿（画布节点 +1）且介入槽里那张卡印着真实金额；回合成功另要求模型正常回话。草稿不清场，所以卡是否在屏幕上不能当per-case判据，节点增量才是。含 2 条阴性对照。',
      rows,
    },
  })
  console.log(`\nR30 [${DEEPSEEK ? 'deepseek' : 'loopback'}] 工具写对率 ${pct(toolCorrect)} · 回合成功率 ${pct(turnOk)}`)
  console.log(`  落草稿 ${walk.report.r30.draftLandedRate}（阳性样本）· 工具路线 ${JSON.stringify(walk.report.r30.toolRoutes)}`)
  for (const row of rows.filter((entry) => !entry.toolCorrect || !entry.turnOk)) console.log('  ✗', JSON.stringify(row))
  expect(walk.fixture.images.length, '整场一次供应商生成都没发生（零额度）').toBe(0)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  // 真实档：App 关了之后删掉凭据副本、比对原库指纹（与其它付费走查同一套收尾）。
  await walk.finish(failure, DEEPSEEK ? {
    collect: () => ({
      credentialCopyRemoved: removeRealCredentials({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir }),
      realProfileAfter: paidGuard.assertRealProfileUntouched(),
    }),
  } : {})
}
