#!/usr/bin/env node
// 真实付费核对 · 参考素材的临时链接失效后改用本机文件（设计卡 docs/plan/2026-11-01-reference-link-delivery.md ★9「真付费」）。**只写脚本，由协调来跑。**
//
//   pnpm build
//   NOMI_SPEND_OK=1 node tests/ux/reference-dead-link-real.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//     # 凭据缺省从真实资料目录拷进隔离副本（key 不经脚本）；也可 APIMART_API_KEY=<key，只从环境读> 走可见接入页。
//   # 花钱之前先跑零花费演练（同一份步骤、不出网、不要 key）：
//   node tests/ux/reference-dead-link-real.rehearsal.walk.mjs
//
// 只花**一张图**（APIMart 官方渠道，被授权的那一个图片模型，见 _referenceDeadLinkSteps.mjs 的 IMAGE；是否最便宜由协调确认，价目不进仓库）。
// 步骤本体在 _referenceDeadLinkSteps.mjs（零花费演练用的是同一份）：
//   经节点上的「添加参考」把一张本机图片放进项目 → 把这张图落盘旁边的 .meta 改成"服务商的临时链接"，指向**同一家 API 主机上的一个 404 地址**
//   （https://api.apimart.ai/nomi-dead-link-check.png，在放行名单内；和真生成图落盘的 .meta 是同一个形状）→ 点 ↑ 生成。
// 要证明的是**发出去的是上传后的新链接**：发之前的试探 GET 那条地址得到 4xx，判它失效，走托管上传换新链接；真正发往 api.apimart.ai 的那份创建请求里
// 没有 nomi-dead-link-check，图片地址都是上传换来的；生成成功、结果带供应商任务号；整场恰好一笔创建请求、一次上传（POST 仍只有一次）。
// 这比"先花一张真图、再改它的 .meta"少花一张，走的是同一段代码（读 .meta → 试探 → 上传 → 发）。
//
// 一次付费之前的整套核对（任何一项不成立就一分钱不花）：节点就是被授权的那个模型（addReferenceNode）；参考图真的落在项目里、.meta 已改成那条地址。
// 花钱后：节点恰好一次提交、成功、结果带任务号；按网络闸账本判请求体（observeLedger → judgeDeadLinkSend）；证据摘要写
// docs/evidence/2026-11-01-reference-dead-link/paid/report.json（落盘前查 key）。
//
// 构建标记：openPaidWalk 的 buildMarkers 用试探的日志事件名 'reference-link-probe'（产物里没有它 = 构建不含这次修复，拒跑）。
// 凭据与护栏：全部走 tests/ux/_paidRun.mjs 的 openPaidWalk（CI 拒跑、没有 NOMI_SPEND_OK=1 拒跑、构建产物过期或不含本修复拒跑、隔离资料目录、
// 出网只放行授权供应商与当前托管中转、跑完删凭据副本）；key 只从环境变量读，不进报告 / 日志 / 截图。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openPaidWalk } from './_paidRun.mjs'
import {
  IMAGE, REFERENCE_DEAD_LINK_PAID_MODELS, REFERENCE_DEAD_LINK_PAID_OPTIONS, observeLedger, runReferenceDeadLinkJourney,
} from './_referenceDeadLinkSteps.mjs'

const SCRIPT = 'reference-dead-link-real.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-11-01-reference-dead-link/paid')
const API_HOST = 'api.apimart.ai'
const DEAD_LINK = `https://${API_HOST}/nomi-dead-link-check.png`

const paid = await openPaidWalk(SCRIPT, 'reference-dead-link', REFERENCE_DEAD_LINK_PAID_MODELS, { ...REFERENCE_DEAD_LINK_PAID_OPTIONS })
const { walk } = paid
const evidence = { script: SCRIPT, mode: 'paid', startedAt: new Date().toISOString(), model: `${IMAGE.vendorKey}/${IMAGE.modelKey}`, deadLinkHost: API_HOST }
let failure
try {
  await runReferenceDeadLinkJourney({
    paid, evidence, locales: ['zh-CN'], links: { dead: DEAD_LINK },
    // 在 finish 之前读：env-key 路收尾会删账本原件。
    observe: () => observeLedger(paid.readAllowedRequests(), { host: API_HOST, probeUrl: DEAD_LINK }),
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
  // 证据摘要进仓库：落盘前最后一道，内容里不许有 key 原串（openPaidWalk 的证据目录自检管不到这里）。
  const key = String(process.env.APIMART_API_KEY ?? '').trim()
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (key.length >= 8 && text.includes(key)) { console.error('[paid] 证据摘要里出现了 key 原串，拒绝写入仓库——请更换这把 key'); process.exitCode = 1; return }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const file = path.join(EVIDENCE_DIR, 'report.json')
  fs.writeFileSync(file, text)
  console.log(`[paid] 证据摘要：${path.relative(REPO_ROOT, file)}`)
}
