#!/usr/bin/env node
// 一问一个（tests/ux/apimart-text-brains-real.paid.mjs）的零花费演练：同一份步骤（_apimartTextChecks.mjs 的 askEachBrain），
// 真 Electron、真 Agent 主进程大脑路（agentLane single-shot），APIMart 的地址被重定向到本机夹具，不出网、不花钱。
//
// 证什么：
//   ① 每个大脑只发一次请求，请求里的模型 id 就是点名的那个；HTTP 状态与有没有字回来照实记；
//   ② 一个调不通的（夹具回 404 model_not_found）只记一条失败、不重试、不挡后面的；
//   ③ 读图候选在隔离副本里补上读图声明之后，图真的进了请求（不是被「内置未声明 = 不支持」拦下）；
//      读出暗号的判通，没读出的判不通；
//   ④ 每一条一结束就有回执（jsonl 一行一条）；从中间一条续跑，前面的不再发；
//   ⑤ 鉴权头是夹具那把假 key（只比对、不打印）。
import fs from 'node:fs'
import path from 'node:path'
import { expect } from './_assert.mjs'
import { lockSpendToModels } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { FIXTURE_APIMART_API_KEY } from './agent-runtime-fixture.mjs'
import { ASK_CODE, imageBuffersOf, judgeRequestBody, makeCodeWord, readCodeWordFromPng, userTurnWith } from './_agentImageInputScore.mjs'
import { TEXT_ASK, allowImageInputFor, askEachBrain, brainSamples, renderBrainTable } from './_apimartTextChecks.mjs'

const BRAINS = ['deepseek-v4-pro', 'qwen3.8-max', 'gpt-6.1-terra', 'claude-opus-5-5']
const BROKEN = 'qwen3.8-max'
const IMAGE_SEEN = 'claude-opus-5-5'
const IMAGE_BLIND = 'gpt-6.1-terra'

const walk = await createRuntimeWalk('apimart-text-brains-rehearsal', { generationProvider: 'apimart' })
let failure
try {
  walk.fixture.respond({
    label: 'text brains, one ask each', match: (body) => BRAINS.includes(body?.model) || body?.model === 'deepseek-v4-flash',
    reply: (body) => {
      if (body.model === BROKEN) return { type: 'http-error', status: 404, json: { error: { message: 'model_not_found', code: 'model_not_found' } } }
      const turn = userTurnWith(body, ASK_CODE)
      if (!turn) return { type: 'text', text: '好' }
      if (body.model === IMAGE_BLIND) return { type: 'text', text: '我看不到图片。' }
      const [image] = imageBuffersOf(turn.content)
      return { type: 'text', text: image ? readCodeWordFromPng(image) : '没有图' }
    },
  })
  walk.report.imageCandidates = allowImageInputFor(walk.settingsDir, [IMAGE_BLIND, IMAGE_SEEN])
  const { win, app } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  // 和真跑同一道前置：点名的大脑在被测 App 眼里都能用。
  await lockSpendToModels(win, BRAINS.map((modelKey) => ({ vendorKey: 'apimart', modelKey })))

  const codeWord = makeCodeWord()
  const samples = brainSamples(BRAINS, [IMAGE_BLIND, IMAGE_SEEN])
  const receiptsFile = path.join(walk.outputDir, 'brains.jsonl')
  const written = []
  const receipts = await askEachBrain({ win, app, projectId, samples, codeWord, record: (receipt, all) => {
    fs.appendFileSync(receiptsFile, `${JSON.stringify(receipt)}\n`)
    written.push(all.length)
  } })
  walk.report.brains = receipts
  fs.writeFileSync(path.join(walk.outputDir, 'brains.md'), `${renderBrainTable(receipts)}\n`)

  // ④ 回执一条一落
  expect(written).toEqual([1, 2, 3, 4, 5, 6])
  expect(fs.readFileSync(receiptsFile, 'utf8').trim().split('\n')).toHaveLength(6)
  expect(receipts.map((receipt) => [receipt.key, receipt.ok])).toEqual([
    ['deepseek-v4-pro', true], [BROKEN, false], [IMAGE_BLIND, true], [IMAGE_SEEN, true],
    [`${IMAGE_BLIND}#image`, false], [`${IMAGE_SEEN}#image`, true],
  ])
  // ① ② 一次一发、状态照实、不重试
  for (const receipt of receipts) expect(receipt.requests, `${receipt.key} 只发一次`).toBe(1)
  expect(receipts.find((receipt) => receipt.key === BROKEN)).toMatchObject({ httpStatus: [404], textReturned: false, error: 'HTTP 404 model_not_found：model_not_found' })
  expect(receipts.find((receipt) => receipt.key === 'deepseek-v4-pro')).toMatchObject({ httpStatus: [200], textReturned: true, text: '好' })
  expect(receipts.find((receipt) => receipt.key === 'deepseek-v4-pro').usage).toMatchObject({ inputTokens: expect.any(Number), outputTokens: expect.any(Number) })
  const asked = walk.fixture.requests.map((record) => record.body?.model)
  expect(asked).toEqual(['deepseek-v4-pro', BROKEN, IMAGE_BLIND, IMAGE_SEEN, IMAGE_BLIND, IMAGE_SEEN])
  // ③ 图真的进了请求；读出暗号才判通
  for (const record of walk.fixture.requests.slice(4)) {
    const judged = judgeRequestBody(record.body, ASK_CODE)
    expect(judged.ok, `${record.body?.model} 的请求里有图：${judged.why}`).toBe(true)
  }
  expect(receipts.find((receipt) => receipt.key === `${IMAGE_SEEN}#image`).sawImage).toMatchObject({ saw: true })
  expect(receipts.find((receipt) => receipt.key === `${IMAGE_BLIND}#image`).error).toContain('没读出')
  expect(walk.fixture.requests.slice(0, 4).every((record) => userTurnWith(record.body, TEXT_ASK))).toBe(true)
  // ⑤ 鉴权头是夹具那把（只比对）
  expect(walk.fixture.requests.every((record) => record.authorization === `Bearer ${FIXTURE_APIMART_API_KEY}`)).toBe(true)

  // ④ 续跑：从 IMAGE_SEEN 那条接着问，前面三条不再发
  const resumed = await askEachBrain({ win, app, projectId, samples, codeWord, from: IMAGE_SEEN })
  expect(resumed.map((receipt) => receipt.key)).toEqual([IMAGE_SEEN, `${IMAGE_BLIND}#image`, `${IMAGE_SEEN}#image`])
  expect(walk.fixture.requests.slice(6).map((record) => record.body?.model)).toEqual([IMAGE_SEEN, IMAGE_BLIND, IMAGE_SEEN])

  // 回执和报告里没有那把 key
  expect(fs.readFileSync(receiptsFile, 'utf8').includes(FIXTURE_APIMART_API_KEY)).toBe(false)
  // ⑥ 没指定大脑时，真实 Agent 发给哪一个模型。仅启用 APIMart；GPT 保持可用，以免靠关掉它让测试通过。
  await win.evaluate(async () => {
    for (const row of await window.nomiDesktop.modelCatalog.listModels({ kind: 'text' })) {
      if (row.vendorKey !== 'apimart' && row.enabled) {
        await window.nomiDesktop.modelCatalog.upsertModel({ vendorKey: row.vendorKey, modelKey: row.modelKey, enabled: false })
      }
    }
  })
  await lockSpendToModels(win, ['gpt-6-astra', 'deepseek-v4-pro', 'deepseek-v4-flash'].map(modelKey => ({ vendorKey: 'apimart', modelKey })))
  const beforeAuto = walk.fixture.requests.length
  for (const expected of ['deepseek-v4-pro', 'deepseek-v4-flash']) {
    if (expected === 'deepseek-v4-flash') await win.evaluate(() =>
      window.nomiDesktop.modelCatalog.upsertModel({ vendorKey: 'apimart', modelKey: 'deepseek-v4-pro', enabled: false }))
    const response = await win.evaluate(input => window.nomiDesktop.agentLane.send(input), {
      kind: 'single-shot', requestId: `auto-text-${expected}`, projectId, featureKey: 'catalog-text-check',
      prompt: TEXT_ASK, context: { approvalPolicy: { mode: 'request' } },
    })
    expect(response.ok).toBe(true)
    expect(response.singleShot.model.modelId).toBe(expected)
  }
  walk.report.automaticTextRequests = walk.fixture.requests.slice(beforeAuto).map(record => record.body.model)
  expect(walk.report.automaticTextRequests).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  expect(JSON.stringify(walk.report).includes(FIXTURE_APIMART_API_KEY)).toBe(false)
  walk.report.verified = ['one-request-per-brain', 'failure-recorded-and-continues', 'image-reaches-request', 'receipt-per-sample', 'resume-from', 'fixture-key-only', 'automatic-text-primary-and-backup']
} catch (error) { failure = error; process.exitCode = 1 }
finally { await walk.finish(failure) }
