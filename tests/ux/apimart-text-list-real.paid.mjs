#!/usr/bin/env node
// 协调跑。APIMart 文字模型列表对账（零花费：只有两次只读 GET，/v1/models?expand=category&category=chat 和 /v1/user/balance）。
// 名字带 .paid 是因为它要真凭据：走付费闸（openPaidWalk）拷真实资料的隔离副本，Key 只以密文经过本进程，解密和请求都在被测 App 主进程里。
// 跑：NOMI_SPEND_OK=1 node tests/ux/apimart-text-list-real.paid.mjs（Nomi 先关掉；先在本工作树 pnpm build）。
// 产物：<outputDir>/text-list.md（两张表 + 读图事实）、text-list.rows.json（列表原样的 id / 分类 / 标签）、report.json。
// 零花费演练：tests/ux/apimart-text-list.rehearsal.walk.mjs（同一份步骤，对端换成本机假服务）。
import { require as tsxRequire } from 'tsx/cjs/api'
import { DEFAULT_PAID_BRAIN, openPaidWalk } from './_paidRun.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { apimartOriginOf, readUsedBalance, reconcileTextList } from './_apimartTextChecks.mjs'

const { APIMART_TEXT_MODELS } = tsxRequire('../../electron/catalog/apimartTexts.ts', import.meta.url)

const paid = await openPaidWalk('apimart-text-list-real.paid.mjs', 'apimart-text-list-real', [DEFAULT_PAID_BRAIN], {
  // 只认真实资料里那把（env-key 路走可见接入页会真打一次大脑，这里一分钱都不该花）。
  env: { ...process.env, [ENV_KEY_VAR]: '' },
  // 产物里要有这次对齐的标记（价目接口地址只在这次的声明里出现）。
  buildMarkers: ['api/pricing/model?model='],
})
const { walk } = paid
let failure
try {
  const { app } = await walk.start({ first: true })
  const origin = apimartOriginOf(walk.settingsDir)
  walk.report.origin = origin
  const before = await readUsedBalance(app, { settingsDir: walk.settingsDir, origin })
  const result = await reconcileTextList({ app, settingsDir: walk.settingsDir, origin, declared: APIMART_TEXT_MODELS, outputDir: walk.outputDir })
  const after = await readUsedBalance(app, { settingsDir: walk.settingsDir, origin })
  walk.report.textList = { ...result, markdown: undefined, rows: undefined }
  walk.report.usedBalance = { before: before?.usedBalance ?? null, after: after?.usedBalance ?? null }
  console.log(result.markdown)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
