#!/usr/bin/env node
// 协调跑，会花钱（每个文字大脑问一句「只回复一个字：好」，读图候选再带一张暗号图问一次；一共约几十次很短的调用）。
// 走 Agent 真实的主进程大脑路（agentLane single-shot → 选型 → 装配 → appFetch），不走 nomi:tasks:run 任务通道。
// 每个模型只问一次、不重试；失败记下接着问下一个。每一条一结束就写回执：report.json 的 brains 随时是最新的，
// 另追加到 <outputDir>/brains.jsonl（进程被杀也留得下）。
//
// 跑：NOMI_SPEND_OK=1 node tests/ux/apimart-text-brains-real.paid.mjs（Nomi 先关掉；先在本工作树 pnpm build）
//   NOMI_TEXT_BRAINS_FROM=<模型 id 或 <id>#image>  从这一条接着问（前面的在已记录的一次里问过，不再付钱）
//   NOMI_TEXT_IMAGE_CANDIDATES=<逗号分隔>          读图候选；缺省 = 这次去掉读图声明的 7 个。设成空串 = 不问图
// 零花费演练：tests/ux/apimart-text-brains.rehearsal.walk.mjs（同一份步骤，对端换成本机夹具）。
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { openPaidWalk } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { makeCodeWord } from './_agentImageInputScore.mjs'
import { allowImageInputFor, apimartOriginOf, askEachBrain, brainSamples, readUsedBalance, renderBrainTable } from './_apimartTextChecks.mjs'

const { APIMART_TEXT_MODELS } = tsxRequire('../../electron/catalog/apimartTexts.ts', import.meta.url)

/** 这次（2026-11-07 按官方文档对齐）去掉读图声明的 7 个：没有一手依据，带图真调用一次才决定加不加回去。 */
const IMAGE_CANDIDATES_REMOVED_20261107 = Object.freeze([
  'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5.1', 'gemini-4-argon', 'gemini-3.8-flash', 'deepseek-v4.1-flash',
])

const brains = APIMART_TEXT_MODELS.filter((model) => !model.meta?.promptRefineOnly).map((model) => model.modelKey)
const rawCandidates = process.env.NOMI_TEXT_IMAGE_CANDIDATES
const imageCandidates = rawCandidates === undefined ? [...IMAGE_CANDIDATES_REMOVED_20261107]
  : rawCandidates.split(',').map((value) => value.trim()).filter(Boolean)
const unknown = imageCandidates.filter((key) => !brains.includes(key))
if (unknown.length) throw new Error(`读图候选不是声明里的文字大脑：${unknown.join('、')}（一分钱没花）`)
const from = process.env.NOMI_TEXT_BRAINS_FROM || undefined
const samples = brainSamples(brains, imageCandidates)
if (from && !samples.some((sample) => sample.key === from)) throw new Error(`续跑起点不认识：${from}（一分钱没花）`)

const paid = await openPaidWalk('apimart-text-brains-real.paid.mjs', 'apimart-text-brains-real',
  brains.map((modelKey) => ({ vendorKey: 'apimart', modelKey })), {
    env: { ...process.env, [ENV_KEY_VAR]: '' },
    buildMarkers: ['api/pricing/model?model='],
  })
const { walk } = paid
let failure
try {
  // App 起来之前给候选补读图声明（只在隔离副本里）；不补，产品会按「内置未声明 = 不支持」把图拦下不发。
  walk.report.imageCandidates = allowImageInputFor(walk.settingsDir, imageCandidates)
  const { win, app } = await walk.start({ first: true })
  const opened = await walk.newProject()
  const projectId = opened?.projectId ?? walk.report.projectId
  if (!projectId) throw new Error('一问一个要一个开着的项目')
  const origin = apimartOriginOf(walk.settingsDir)
  walk.report.resumedFrom = from ?? null
  walk.report.usedBalanceBefore = (await readUsedBalance(app, { settingsDir: walk.settingsDir, origin }))?.usedBalance ?? null
  const receiptsFile = path.join(walk.outputDir, 'brains.jsonl')
  walk.report.brainsFile = receiptsFile
  walk.report.brains = []
  const receipts = await askEachBrain({ win, app, projectId, samples, from, codeWord: makeCodeWord(),
    record: (receipt, all) => {
      walk.report.brains = all
      fs.appendFileSync(receiptsFile, `${JSON.stringify(receipt)}\n`)
      console.log(`[brains] ${receipt.key}: ${receipt.ok ? '通' : `不通 ${receipt.error}`}`)
    } })
  walk.report.usedBalanceAfter = (await readUsedBalance(app, { settingsDir: walk.settingsDir, origin }))?.usedBalance ?? null
  const table = renderBrainTable(receipts)
  fs.writeFileSync(path.join(walk.outputDir, 'brains.md'), `${table}\n`)
  console.log(table)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
