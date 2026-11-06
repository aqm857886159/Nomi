#!/usr/bin/env node
// 真实付费核对 · 参考卡出站提示词 = 描述框里的字（设计卡 docs/plan/2026-11-07-prompt-outbound-description.md ★9「真付费」）。**只写脚本，由协调来跑。**
//
//   pnpm build
//   NOMI_SPEND_OK=1 node tests/ux/anchor-outbound-real.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>] [--expect-before]
//     # 凭据缺省从真实资料目录拷进隔离副本（key 不经脚本）；也可 APIMART_API_KEY=<key，只从环境读> 走可见接入页。
//   # 花钱之前先跑零花费演练（同一份步骤、不出网、不要 key）：
//   node tests/ux/anchor-outbound-real.rehearsal.walk.mjs
//
// 同一输入改前 / 改后各跑一次（共两张图）：
//   改后（本分支构建）：不带参数。花钱之前先自检构建产物算出的提示词含描述；发出去的请求含描述原文与画风词、不含结构化特征段。
//   改前（对照）：在 origin/main 的构建上加 --expect-before：只记录读数，不因「请求里没有描述」而失败；证据里 wire.sentContainsDescription 应为 false。
// 两次用同一张样本卡（_anchorOutboundSteps.mjs 的 ANCHOR）、同一个被授权的图片模型（是否最便宜由协调确认，价目不进仓库）。
// 画风因果（描述丢失是否就是用户那次插画风的原因）要看两张图本身，由协调亲眼对比；脚本只证"请求里有没有那些字"。
//
// 构建标记：本修复没有只在修复后才出现的稳定字面量（旧写法保留了同样的分区标题），所以不靠 buildMarkers，
// 改靠花钱前自检（compiledHasDescription，见 runAnchorOutboundJourney）；这一点偏离 _paidRun 常规，已在设计卡里写明。
// 凭据与护栏：全部走 tests/ux/_paidRun.mjs 的 openPaidWalk（CI 拒跑、没有 NOMI_SPEND_OK=1 拒跑、隔离资料目录、出网只放行授权供应商）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openPaidWalk } from './_paidRun.mjs'
import {
  ANCHOR_OUTBOUND_PAID_MODELS, ANCHOR_OUTBOUND_PAID_OPTIONS, IMAGE, observeLedgerPrompts, runAnchorOutboundJourney,
} from './_anchorOutboundSteps.mjs'

const SCRIPT = 'anchor-outbound-real.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXPECT_BEFORE = process.argv.includes('--expect-before')
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-11-07-anchor-outbound/paid', EXPECT_BEFORE ? 'before' : 'after')
const API_HOST = 'api.apimart.ai'

const paid = await openPaidWalk(SCRIPT, 'anchor-outbound', ANCHOR_OUTBOUND_PAID_MODELS, { ...ANCHOR_OUTBOUND_PAID_OPTIONS })
const { walk } = paid
const evidence = { script: SCRIPT, mode: 'paid', variant: EXPECT_BEFORE ? 'before' : 'after', startedAt: new Date().toISOString(), model: `${IMAGE.vendorKey}/${IMAGE.modelKey}` }
let failure
try {
  await runAnchorOutboundJourney({
    paid, evidence, expectBefore: EXPECT_BEFORE,
    // 在 finish 之前读：env-key 路收尾会删账本原件。
    observe: () => observeLedgerPrompts(paid.readAllowedRequests(), { host: API_HOST }),
  })
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  writeEvidence(failure)
}

function writeEvidence(error) {
  const report = {
    ...evidence,
    finishedAt: new Date().toISOString(),
    paidCalls: walk.report.paidCalls ?? null,
    spend: (walk.report.spend?.media ?? []).map(({ taskId, status, model, vendor }) => ({ taskId, status, model, vendor })),
    providerTaskIds: (walk.report.spend?.media ?? []).map((entry) => entry.taskId).filter(Boolean),
    networkAllowlist: walk.report.networkAllowlist ?? null,
    networkBlocked: walk.report.networkBlocked ?? [],
    walkOutputDir: walk.report.outputDir ? path.relative(REPO_ROOT, walk.report.outputDir) : null,
    failure: error ? String(error?.message ?? error).slice(0, 2000) : null,
  }
  const key = String(process.env.APIMART_API_KEY ?? '').trim()
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (key.length >= 8 && text.includes(key)) { console.error('[paid] 证据摘要里出现了 key 原串，拒绝写入仓库——请更换这把 key'); process.exitCode = 1; return }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const file = path.join(EVIDENCE_DIR, 'report.json')
  fs.writeFileSync(file, text)
  console.log(`[paid] 证据摘要：${path.relative(REPO_ROOT, file)}`)
}
