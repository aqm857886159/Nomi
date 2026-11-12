#!/usr/bin/env node
// 真实付费核对 · 方式按输入现算（I-mode-bar 合并前那一条）：方式格 = owner 算的 = 请求里的方式 → 真上游收下 → 结果落回节点。**只写脚本，由协调来跑。**
//
//   pnpm build
//   NOMI_SPEND_OK=1 node tests/ux/composer-b3-reference.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//     # 凭据缺省从真实资料目录拷进隔离副本（key 不经脚本）；也可 APIMART_API_KEY=<key，只从环境读> 走可见接入页。
//   # 花钱之前先跑零花费演练（同一份步骤、不出网、不要 key）：
//   node tests/ux/composer-b3-reference-paid.rehearsal.walk.mjs
//   # 探测模式（走到确认框为止、绝不点生成）：
//   NOMI_SPEND_OK=1 NOMI_PAID_PROBE_DIALOG=1 node tests/ux/composer-b3-reference.paid.mjs
//
// 只花**一条**视频（APIMart 官方渠道）：Seedance 2.0 fast · 480p · 4 秒 · 无音频（_agentVideoPaid.mjs 里被授权的最便宜一档；
// 档案里时长最短 4 秒、清晰度最低 480p；Mini 变体没有价目可比，不换授权档）。
// 步骤本体在 _composerB3ReferenceSteps.mjs（零花费演练用的是同一份）。2026-11-12 起换成协调定的最小一幕：
//   视频节点放 1 张图、不手选方式 → 底栏方式格显示的 = owner（modeForInputs）算的 = 请求体里真用的那一族参考键 → 发 → 成片落回。
// 旧的「首尾帧 + 3 张未用到」一幕在「方式按输入现算」之后造不出来（放 5 张时首尾帧收不下全部、菜单置灰），已换掉；
// 「放超过上限、不会发的图不上传」那一幕和 _referenceLeakWire.mjs 的判据改动留后续。
//
// 一次付费之前的整套核对（任何一项不成立就一分钱不花）：
//   ① 节点就是被授权那一档（cheapVideoNodeProblems）；② 节点上没存方式（没人手选）；③ owner 对这一幕算出的方式能发、收下那 1 张；
//   ④ 底栏方式格上的字 = owner 那种的名字（名字按方式菜单的归类、词典键取）；⑤ 参考行里那 1 张在用、没有「未用到」。
// 花钱后：节点恰好一次提交、结果带供应商任务号、成片 ffprobe 量过并在隔离副本删除前拷进走查输出目录（工作树 .tmp/ 下，不进仓库）；
// 成片落地之后按网络闸的最新账本判请求体（judgeLedgerModeWire：图走 owner 那一族键、另一族不出现、张数对、只上传过那 1 张）；
// 节点上没有 reference-not-in-use 拒发。证据摘要写 docs/evidence/2026-10-24-composer-b3-reference/paid/report.json。
//
// 请求体从哪抓：走查网络闸（scripts/walkthrough-network-guard.cjs）在 fetch 层对放行名单上的请求记账（openPaidWalk 的
// recordAllowedBodies）。不记请求头（key 在头里）；正文里的签名查询串、key 形状的串先打码再落盘。托管上传的 multipart 记文件名，
// 上传回的公网地址用来把请求体里的地址对回本地文件名。报告里只留文件名，不留签名参数。
//
// 构建标记：openPaidWalk 的 buildMarkers 用 modeForInputs 的结局字面量 'inputsNotAccepted'（产物里没有它 = 跑在「方式按输入现算」
// 之前的构建上，拒跑）；_paidRun.test.mjs 的 paidBuildMarkerProblems 零花费地盯着它还在不在产品源码里。
//
// 探测模式（NOMI_PAID_PROBE_DIALOG=1，照 director-reference-attach.paid.mjs）：供应商的源不进放行名单，就算托管策略是「允许」、
// 点 ↑ 直接提交，网络闸也当场挡下，结构上花不了钱。走到确认框出现为止：截图、点「取消」、核对节点上没有提交记录。
// 已知坑（10-22 实跑）：App 启动时查余额 / 对账的只读请求在探测模式下会被网络闸挡下、走查当场失败并点名被挡主机；
// 用环境变量里的 key 接入时接入页验证 key 也会被挡。遇到就改跑零花费演练 + 正常模式（它在确认框之前同样停下来做整套核对）。
// 探测模式抓不到请求体（请求在确认之后才组装发出）。
//
// 凭据与护栏：全部走 tests/ux/_paidRun.mjs 的 openPaidWalk（CI 拒跑、没有 NOMI_SPEND_OK=1 拒跑、构建产物过期或不含本修复拒跑、
// 隔离资料目录、出网只放行授权供应商与当前托管中转、跑完删凭据副本）；key 只从环境变量读，不进报告 / 日志 / 截图。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VIDEO } from './_agentVideoPaid.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import {
  COMPOSER_B3_PAID_MODELS, COMPOSER_B3_PAID_OPTIONS, judgeLedgerModeWire, runComposerB3ReferenceJourney,
} from './_composerB3ReferenceSteps.mjs'

const SCRIPT = 'composer-b3-reference.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-10-24-composer-b3-reference/paid')
const PROBE = process.env.NOMI_PAID_PROBE_DIALOG === '1'

const paid = await openPaidWalk(SCRIPT, 'composer-b3-reference', COMPOSER_B3_PAID_MODELS, { ...COMPOSER_B3_PAID_OPTIONS, vendorNetwork: !PROBE })
const { walk } = paid
const evidence = { script: SCRIPT, mode: PROBE ? 'probe-dialog' : 'paid', startedAt: new Date().toISOString(), model: `${VIDEO.vendorKey}/${VIDEO.modelKey} · fast · 480p · 4s · 无音频` }
let failure
try {
  await runComposerB3ReferenceJourney({
    paid, evidence, probe: PROBE,
    // 在 finish 之前读：env-key 路收尾会删账本原件。
    judgeWire: (scene) => judgeLedgerModeWire(paid.readAllowedRequests(), scene),
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
    providerTaskIds: evidence.providerTaskIds ?? (walk.report.spend?.media ?? []).map((entry) => entry.taskId).filter(Boolean),
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
  const file = path.join(EVIDENCE_DIR, PROBE ? 'probe-report.json' : 'report.json')
  fs.writeFileSync(file, text)
  console.log(`[paid] 证据摘要：${path.relative(REPO_ROOT, file)}`)
}
