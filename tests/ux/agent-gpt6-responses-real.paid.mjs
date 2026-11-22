#!/usr/bin/env node
// 真上游检查 · GPT-6.1 Sol 走 Responses：一轮要连用两次工具的 Agent 任务，在真应用里按创作者那一步跑。
// （设计卡 docs/plan/2026-11-22-gpt6-responses.md ★9「付费冒烟」；取代要明文 Key 的 tests/smoke/gpt6ResponsesSmoke.mts。）
//
// 要回答两件只有真中转站才知道的事：
//   ① APIMart 回不回推理条目（reasoning + encrypted_content）；
//   ② 第 2、3 次请求把推理条目原样带回、又不带 `include` 时，中转站收不收。
// 判据逐项照实打出来、不合成一个总结论（①②各自单列）：
//   R1 每次大脑请求都去 /v1/responses      R2 请求恰好 3 次
//   R3 第 1 次响应返回了推理条目            R4 第 2 次响应返回了推理条目
//   R5 第 2 次请求原样带回（id + 内容 + 顺序）  R6 第 3 次请求原样带回
//   R7 第 2、3 次请求都没有 include         R8 中转站收了回放（第 2、3 次请求之后回合没出错）
//   R9 两个工具结果都不是错误                R10 最后一句话到了
// 上游一条推理条目都没返回时，R3–R7 记「未验证」、总览是「部分」，不算过。
//
// Key 不经手：真付费走 _paidRun.mjs（Key 由应用从隔离拷贝里自己解密）；脚本里没有任何代理、不读任何请求头。
// 判据只读两处：闸记的出网账本（请求体先脱敏、不含请求头）和 Agent 会话记录（盘上的 JSONL）。
//
//   免费演练（假上游由脚本在本机起，回 Responses 推理条目；一分钱不花）：
//     NO_PROXY=127.0.0.1,localhost NOMI_TEST_NETWORK_GUARD=1 NOMI_PAID_REHEARSAL=no-key node tests/ux/agent-gpt6-responses-real.paid.mjs
//   没做成的版本（只在演练里认）：
//     NOMI_GPT6_WALK_FAKE_REJECT_REPLAY=1   假上游收到带推理条目的回放就回 400（模拟中转站拒收）→ 必须红，且点名「回放被拒」
//   真付费（协调跑，只跑一次，用本机真实资料里的 Key，不设 APIMART_API_KEY）：
//     NOMI_SPEND_OK=1 node tests/ux/agent-gpt6-responses-real.paid.mjs
//   预计 3 次大脑请求（每次输出上限由应用自己定；GPT-6.1 Sol 的价目约一两分钱以内）。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'

import { clickOrFail } from './_assert.mjs'
import { ENV_KEY_VENDOR, redact } from './_paidEnvKey.mjs'
import { openPaidWalk, paidRehearsalTier } from './_paidRun.mjs'
import { createRuntimeWalk, CREATION_PANEL, DOCUMENT, chooseAssistantModel, expandResidentPanel, sendCreation, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { stationTimeout } from './_station-budget.mjs'

const MODEL = { vendorKey: ENV_KEY_VENDOR, modelKey: 'gpt-6.1-sol' }
const BRAIN_PATH = /\/(?:chat\/completions|responses|messages)$/
const EXPECTED_PATH = '/v1/responses'
const EXPECTED_REQUESTS = 3
const REJECT_REPLAY = process.env.NOMI_GPT6_WALK_FAKE_REJECT_REPLAY === '1'
const SCRIPT = ['第1场 · 海港', '清晨的渔港，雾还没散。老渔民阿福把缆绳一圈圈绕在木桩上。', '远处的汽笛声压着浪头，他回头看了一眼空荡荡的码头。'].join('\n')
const ASK = '请先用 read_script 读一遍文稿全文（scope 填 full），等结果回来后再读一遍，两次都读完以后用一句话回答「读完了」。每次只调用一个工具，不要同时调用多个。'

if (REJECT_REPLAY && !paidRehearsalTier()) throw new Error('NOMI_GPT6_WALK_FAKE_REJECT_REPLAY 只在演练里认（NOMI_PAID_REHEARSAL=no-key）；真付费不许带假上游开关（一分钱没花）')

// ── 演练专用的本机假上游（真付费不起）──────────────────────────────────────────────
// 应用 → 它 → 本机替身（只为让闸的账本记下这一发：大脑请求）；大脑请求的响应由假的 Responses 夹具回。
// 回哪一条按请求里已有几个 function_call_output 定（不按先后排队：多一次别的模型调用不会错位）。
const FAKE_REPLIES = [
  { type: 'message', parts: [
    { type: 'responsesReasoning', id: 'rs_walk_1', encryptedContent: 'ENC_WALK_ONE', summary: 'plan the first read' },
    { type: 'toolCall', id: 'call_walk_1', name: 'read_script', arguments: { scope: 'full' } }] },
  { type: 'message', parts: [
    { type: 'responsesReasoning', id: 'rs_walk_2', encryptedContent: 'ENC_WALK_TWO' },
    { type: 'toolCall', id: 'call_walk_2', name: 'read_script', arguments: { scope: 'full' } }] },
  { type: 'text', text: '读完了。' },
]
async function startFakeUpstream({ target, rejectReplay }) {
  const { createHttpFixture } = tsxRequire('../agent-runtime/httpFixture.mts', import.meta.url)
  const fixture = await createHttpFixture([])
  const served = []
  const server = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const body = Buffer.concat(parts)
    const pathname = new URL(req.url ?? '/', 'http://fake').pathname
    const brain = req.method === 'POST' && BRAIN_PATH.test(pathname)
    const headers = { 'content-type': req.headers['content-type'] ?? 'application/json' }
    if (brain) {
      // 让替身账本记下这一发（它回 400，丢掉）；真正的回复在下面。
      await fetch(new URL(req.url, target), { method: 'POST', headers, body }).catch(() => {})
      if (!pathname.endsWith('/responses')) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'fake upstream only speaks Responses' } })); return }
      let input = []
      try { input = JSON.parse(body.toString('utf8')).input ?? [] } catch { /* 不是 JSON：按 0 个工具结果回 */ }
      const outputs = input.filter((item) => item?.type === 'function_call_output').length
      const carriesReasoning = input.some((item) => item?.type === 'reasoning')
      served.push({ outputs, carriesReasoning })
      if (rejectReplay && carriesReasoning) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Invalid input: reasoning item replay rejected (fake upstream)' } }))
        return
      }
      fixture.push(FAKE_REPLIES[Math.min(outputs, FAKE_REPLIES.length - 1)])
      const reply = await fetch(`${fixture.baseURL}/responses`, { method: 'POST', headers, body })
      res.writeHead(reply.status, { 'content-type': reply.headers.get('content-type') ?? 'text/event-stream' }).end(Buffer.from(await reply.arrayBuffer()))
      return
    }
    const forwarded = await fetch(new URL(req.url, target), { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }).catch(() => null)
    if (!forwarded) { res.writeHead(502).end(); return }
    res.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'application/json' }).end(Buffer.from(await forwarded.arrayBuffer()))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, served,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await fixture.close() } }
}

// ── 判据（纯函数，读账本 + 会话记录）──────────────────────────────────────────────
const PASS = '通过'
const FAIL = '不过'
const UNVERIFIED = '未验证'
const LIMIT = '量具限度'

/**
 * 请求体：闸的账本只存前 64KB（先脱敏）。Agent 的请求体比这大（系统提示 + 工具清单）：'input' 在最前面、整段都在，'tools' 在后面被截。
 * 所以被截的体不整体 JSON.parse，按括号逐段读：顶层键（到截断处为止）+ 完整的 input 数组。
 * keysComplete = 顶层键是不是全看到了；被截就不是——截断点之后的键（例如 include）账本里看不见。
 */
export function readRequestBody(row) {
  const text = row?.body?.text
  if (typeof text !== 'string') return { input: null, keys: [], keysComplete: false, why: '账本里没有请求体' }
  if (!row.body.truncated) {
    try { const parsed = JSON.parse(text); return { input: parsed.input ?? [], keys: Object.keys(parsed), keysComplete: true, why: null } } catch { return { input: null, keys: [], keysComplete: false, why: '请求体不是合法 JSON' } }
  }
  const keys = []
  let input = null
  let depth = 0
  let inString = false
  let stringStart = 0
  let valueStart = -1
  let valueKey = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') {
        inString = false
        if (depth === 1 && text[i + 1] === ':') { valueKey = text.slice(stringStart + 1, i); keys.push(valueKey); valueStart = i + 2 }
      }
      continue
    }
    if (ch === '"') { inString = true; stringStart = i; continue }
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 1 && valueKey === 'input' && valueStart >= 0) {
        try { input = JSON.parse(text.slice(valueStart, i + 1)) } catch { /* 读不出来：input 留 null */ }
        valueKey = null
      }
    }
  }
  return { input, keys, keysComplete: false, why: input ? null : '请求体被闸截到 ' + text.length + ' 字节，连 input 也没读全' }
}
const pathOf = (row) => { try { return new URL(String(row.url)).pathname } catch { return '' } }

/** 一次响应里返回的推理条目：从会话记录的 assistant 消息里读（pi 把整条条目存在 thinkingSignature）。 */
function reasoningOf(message) {
  const found = []
  for (const part of Array.isArray(message?.content) ? message.content : []) {
    if (part?.type !== 'thinking' || typeof part.thinkingSignature !== 'string') continue
    try {
      const item = JSON.parse(part.thinkingSignature)
      if (item?.type === 'reasoning') found.push({ id: item.id, encrypted: typeof item.encrypted_content === 'string' ? item.encrypted_content : '' })
    } catch { /* 不是条目 JSON：不算 */ }
  }
  return found
}
const callsOf = (message) => (Array.isArray(message?.content) ? message.content : []).filter((part) => part?.type === 'toolCall')
const textOf = (message) => (Array.isArray(message?.content) ? message.content : []).filter((part) => part?.type === 'text').map((part) => String(part.text)).join('').trim()

export function judgeGpt6Responses({ ledger, messages }) {
  const requests = ledger.filter((row) => row.kind === 'allowed-request' && String(row.method).toUpperCase() === 'POST' && BRAIN_PATH.test(pathOf(row)))
  const bodies = requests.map(readRequestBody)
  const assistants = messages.filter((message) => message.role === 'assistant')
  const toolResults = messages.filter((message) => message.role === 'toolResult')
  const returned = assistants.map(reasoningOf)
  const items = []
  const add = (id, name, status, detail) => items.push({ id, name, status, detail })

  const paths = requests.map(pathOf)
  const wrong = paths.map((p, i) => ({ p, i })).filter(({ p }) => p !== EXPECTED_PATH)
  if (!requests.length) add('R1', '每次大脑请求都去 /v1/responses', FAIL, '一次大脑请求都没记到')
  else add('R1', '每次大脑请求都去 /v1/responses', wrong.length ? FAIL : PASS,
    wrong.length ? `第 ${wrong[0].i + 1} 次请求去了 ${wrong[0].p}，不是 ${EXPECTED_PATH}（${paths.join(' · ')}）` : paths.join(' · '))
  add('R2', `请求恰好 ${EXPECTED_REQUESTS} 次`, requests.length === EXPECTED_REQUESTS ? PASS : FAIL, `实际 ${requests.length} 次`)

  const sawReasoning = returned.slice(0, 2).map((list) => list.filter((item) => item.id && item.encrypted))
  sawReasoning.forEach((list, i) => add(`R${3 + i}`, `第 ${i + 1} 次响应返回了推理条目`, assistants[i] ? (list.length ? PASS : FAIL) : FAIL,
    !assistants[i] ? `会话记录里没有第 ${i + 1} 次回复` : list.length ? `${list.map((item) => `${item.id}（encrypted_content ${item.encrypted.length} 字符）`).join('、')}` : '回复里没有带 encrypted_content 的推理条目'))
  for (let i = sawReasoning.length; i < 2; i += 1) add(`R${3 + i}`, `第 ${i + 1} 次响应返回了推理条目`, FAIL, `会话记录里没有第 ${i + 1} 次回复`)
  const anyReturned = sawReasoning.some((list) => list.length)

  // 回放：第 k 次请求（k = 2、3）里，之前每次响应的推理条目都原样在场，顺序是「推理条目 → 它同一响应的工具调用 → 工具结果」。
  const shapeOf = (input) => (input ?? []).filter((item) => item?.type && item.type !== 'message').map((item) => item.type)
  const replay = (k) => {
    const id = `R${5 + k - 2}`
    const name = `第 ${k} 次请求原样带回推理条目`
    if (!anyReturned) return add(id, name, UNVERIFIED, '上游没返回推理条目，回放没被检验到')
    const { input, why } = bodies[k - 1] ?? { input: null, why: `没有第 ${k} 次请求` }
    if (!input) return add(id, name, UNVERIFIED, why)
    const problems = []
    const expectedShape = []
    for (let j = 0; j < k - 1; j += 1) {
      for (const item of sawReasoning[j] ?? []) {
        const sent = input.find((candidate) => candidate?.type === 'reasoning' && candidate.id === item.id)
        if (!sent) problems.push(`${item.id} 没带回`)
        else if (sent.encrypted_content !== item.encrypted) problems.push(`${item.id} 的 encrypted_content 和返回的不一致`)
        expectedShape.push('reasoning')
      }
      const calls = callsOf(assistants[j]).length
      expectedShape.push(...Array(calls).fill('function_call'), ...Array(calls).fill('function_call_output'))
    }
    const shape = shapeOf(input)
    if (shape.join() !== expectedShape.join()) problems.push(`条目顺序不对：期望 ${expectedShape.join('→')}，实际 ${shape.join('→')}`)
    add(id, name, problems.length ? FAIL : PASS, problems.length ? problems.join('；') : `顺序 ${shape.join('→')}，内容逐字一致`)
  }
  replay(2)
  replay(3)

  // include：账本只存前 64KB，键在截断点之后就看不见——这是量具的限度，单列「限度」，不当通过也不当未验证；
  // 请求体全文里没有 include 由请求层测试钉（electron/agentLane/gpt6Responses.test.ts，REASONING_KEYS）。
  const laterBodies = bodies.slice(1, 3)
  if (laterBodies.length < 2) add('R7', '第 2、3 次请求都没有 include', UNVERIFIED, '没有第 2 / 3 次请求')
  else if (laterBodies.some((entry) => entry.keys.includes('include'))) add('R7', '第 2、3 次请求都没有 include', FAIL, '回放请求里带了 include')
  else if (laterBodies.every((entry) => entry.keysComplete)) add('R7', '第 2、3 次请求都没有 include', PASS, '请求体全文里没有')
  else add('R7', '第 2、3 次请求都没有 include', LIMIT, '账本只存前 64KB：可见的顶层键（' + laterBodies[0].keys.join('、') + '）里没有，截断点之后的键看不见；全文由请求层测试钉')

  // 中转站收没收：第 k 次请求带着推理条目、之后回合出错（那一条回复是错误、或根本没有回复）= 回放被拒。
  const rejected = []
  for (let k = 2; k <= Math.min(requests.length, EXPECTED_REQUESTS); k += 1) {
    const carries = (bodies[k - 1].input ?? []).some((item) => item?.type === 'reasoning')
    const reply = assistants[k - 1]
    if (carries && (!reply || reply.stopReason === 'error')) rejected.push({ k, why: reply?.errorMessage ?? '没有收到回复' })
  }
  const firstError = assistants.find((message) => message.stopReason === 'error')
  if (rejected.length) add('R8', '中转站收了回放', FAIL, `回放被拒：第 ${rejected[0].k} 次请求带着推理条目，之后回合出错（${redact(String(rejected[0].why), []).slice(0, 240)}）`)
  else if (requests.length < 2) add('R8', '中转站收了回放', UNVERIFIED, '第 1 次请求就没走到下一步，回放没发生')
  else if (firstError) add('R8', '中转站收了回放', FAIL, `回放没被拒，但回合出错：${redact(String(firstError.errorMessage ?? ''), []).slice(0, 240)}`)
  else add('R8', '中转站收了回放', anyReturned ? PASS : UNVERIFIED, anyReturned ? `第 2、3 次请求之后回合都往下走了（共 ${assistants.length} 条回复）` : '上游没返回推理条目，请求里没有可回放的东西')

  add('R9', '两个工具结果都不是错误', toolResults.length === 2 && toolResults.every((result) => result.isError !== true) ? PASS : FAIL,
    `${toolResults.length} 个工具结果，${toolResults.filter((result) => result.isError === true).length} 个是错误`)
  const last = assistants.at(-1)
  add('R10', '最后一句话到了', last && last.stopReason !== 'error' && textOf(last) && callsOf(last).length === 0 ? PASS : FAIL,
    last && textOf(last) ? `「${textOf(last).slice(0, 40)}」` : '最后一条回复没有文字')

  const failed = items.filter((item) => item.status === FAIL)
  const unverified = items.filter((item) => item.status === UNVERIFIED)
  const status = failed.length ? 'failed' : unverified.length ? 'partial' : 'passed'
  return { status, items, requests: requests.length, headline: status === 'failed' ? `不过（${failed.map((item) => item.id).join('、')}）` : status === 'partial' ? `部分：${unverified.map((item) => item.id).join('、')} 未验证（不算过）` : '全部通过' }
}

// ── 走查 ─────────────────────────────────────────────────────────────────────────
let launchEnv
const paid = await openPaidWalk('agent-gpt6-responses-real.paid.mjs', 'agent-gpt6-responses-real', [MODEL], {
  buildMarkers: ['textProtocol'],
  recordAllowedBodies: true,
  judgesBodyInRehearsal: true,
  rehearsalShots: EXPECTED_REQUESTS,
  createWalk: (name, options) => { launchEnv = options.env; return createRuntimeWalk(name, { env: launchEnv }) },
})
const { walk } = paid
let fake
let failure
let verdict
try {
  if (paid.rehearsal) {
    const upstream = paid.vendorUpstream()
    if (!upstream.target) throw new Error('演练的本机替身没起来，没有上游可接（一分钱没花）')
    fake = await startFakeUpstream({ target: upstream.target, rejectReplay: REJECT_REPLAY })
    Object.assign(launchEnv, upstream.launchEnvVia(fake.origin))
  }
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await expandResidentPanel(win)
  await chooseAssistantModel(win, paid.label(MODEL.vendorKey, MODEL.modelKey), CREATION_PANEL)
  const doc = win.locator(DOCUMENT)
  await clickOrFail(doc, '文稿编辑区')
  await doc.fill(SCRIPT)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  try {
    await sendCreation(win, ASK)
    await waitForV4TurnIdle(win, { panel: CREATION_PANEL, doneTimeout: stationTimeout({ turns: 3 }) })
  } catch (error) {
    // 回合没走完不等于不用判：下面照账本和会话记录判，红得有名目（请求去了哪、回放被不被拒），不是只剩一句超时。
    walk.report.harnessError = redact(String(error?.message ?? error).split('\n')[0], [])
    console.log(`[gpt6-walk] 回合没按时落地：${walk.report.harnessError}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const messages = readLaneTranscripts(walk.report.projectRoot).flatMap((session) => laneMessages(session))
  verdict = judgeGpt6Responses({ ledger: paid.readAllowedRequests(), messages })
  walk.report.gpt6Responses = { ...verdict, rejectReplaySimulated: REJECT_REPLAY, fakeServed: fake?.served ?? null }
  for (const item of verdict.items) console.log(`[gpt6-walk] ${item.id} ${item.name}：${item.status} — ${item.detail}`)
  console.log(`[gpt6-walk] 总览：${verdict.headline}；大脑请求 ${verdict.requests} 次`)
  fs.writeFileSync(path.join(walk.outputDir, 'gpt6-responses-verdict.json'), `${JSON.stringify(walk.report.gpt6Responses, null, 2)}\n`)
  if (verdict.status === 'failed') throw new Error(`GPT-6.1 Sol Responses 检查不过：${verdict.items.filter((item) => item.status === FAIL).map((item) => `${item.id} ${item.detail}`).join(' ｜ ')}`)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  await fake?.close()
  if (!failure && verdict?.status === 'partial') process.exitCode = 3
}
