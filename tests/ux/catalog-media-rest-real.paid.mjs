#!/usr/bin/env node
// 协调会话专用：APIMart 图片 / 视频型号的真付费抽检。一次只测计划里的那一个型号，只提交一次，失败就停，不自动重试。
// 计划文件（NOMI_MEDIA_REST_PAID_PLAN，JSON，放在仓库外）：{ "modelKey": "pixverse-v6" }，型号必须在样本表（_catalogMediaRestSamples.mjs）里。
// 样本表 = 每家一条「公开价最低的当前基础档」（价格见 PR 报告；价格只做挑样本的依据，不写进声明）。
// 凭据、出网名单、构建检查、回执全部由 openPaidWalk 负责，本脚本不接触 key。
// 走的是真界面：选型号 → 默认参数可见 →（带方式 / 参考的样本）参数面板切方式、「+」上传合成参考图 → 点生成 → 花钱确认 → 等产物落地；
// 请求体由网络闸账本核对（只看字段集合，不记 key）。
// 注意：走查按该型号的**默认参数**生成（不改时长 / 清晰度），实际花费看花钱确认框里的数。
// NOMI_MEDIA_REST_FREE_ONLY=1 时在点生成之前停下（零花费演练：选型号、默认参数可见、方式与参考放好、请求还没发）。
// TODO（P1）：音频那条抽检（tests/ux/catalog-latest-real.paid.mjs + catalogLatestSamples.ts，PR #1436）合入 main 后，
// 本脚本的样本表并进那一份通用抽检，同一个入口按计划文件挑样本，删掉这一份，不留两套并行脚本。
import fs from 'node:fs'
import path from 'node:path'
import { expect } from './_assert.mjs'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { createRelayProject, prepareRelayVideo, generateRelayVideo } from './_relayVideoWalk.mjs'
import { chooseSampleMode, mediaRestSampleFor, uploadSampleReferences, writeSampleReferenceFiles } from './_catalogMediaRestSamples.mjs'

const SCRIPT = 'catalog-media-rest-real.paid.mjs'

const plan = JSON.parse(fs.readFileSync(process.env.NOMI_MEDIA_REST_PAID_PLAN ?? '', 'utf8'))
// 样本表（含每条预计价、带参考的三条与只登记的 Run 路那条）在 _catalogMediaRestSamples.mjs。
const sample = mediaRestSampleFor(plan.modelKey)
const model = { vendorKey: 'apimart', modelKey: plan.modelKey }

// 授权名单 = Agent 大脑 + 这次要测的那一个型号：只授权大脑时，隔离副本里样本型号被关掉，下拉里根本选不到（11-07 演练实测）。
// 带本地参考图的样本：参考图要先经应用的托管上传中转交给供应商（hostedUploads 放行当前配置的那一个中转源）。
const paid = await openPaidWalk(SCRIPT, 'catalog-media-rest-real', [DEFAULT_PAID_BRAIN, model], {
  env: { ...process.env },
  hostedUploads: Boolean(sample.references?.length),
  ...(sample.buildMarkers ? { buildMarkers: sample.buildMarkers } : {}),
})
const { walk } = paid
let failure
let win
try {
  ;({ win } = await walk.start({ first: true }))
  await paid.lockToAuthorizedModels(win)
  const capture = (tag) => walk.snap(`media-rest-${tag}`)
  const prepared = await prepareRelayVideo({ win, newProject: () => createRelayProject(walk, win), model, capture, kind: sample.kind })
  // 带方式 / 参考的样本：经参数面板切方式，再经「+」真上传合成图（点生成之前，一分钱没花）。
  await chooseSampleMode({ win, prepared, sample, capture })
  const files = writeSampleReferenceFiles(sample, path.join(walk.outputDir, 'references'))
  await uploadSampleReferences({ win, prepared, sample, files, capture })
  walk.report.freeSegment = { prepared: true, model: plan.modelKey, kind: sample.kind, nodeId: prepared.nodeId, modeId: sample.modeId ?? null, references: (sample.references ?? []).map((item) => item.slot) }
  if (process.env.NOMI_MEDIA_REST_FREE_ONLY === '1') {
    walk.report.stoppedBeforeGeneration = true
  } else {
    walk.report.landed = await generateRelayVideo({ win, prepared, capture, kind: sample.kind })
    fs.copyFileSync(walk.report.landed.media.filePath, path.join(walk.outputDir, `landed${path.extname(walk.report.landed.media.filePath)}`))
    expect(walk.report.landed.media.filePath, 'a local file landed').toBeTruthy()
  }
} catch (error) {
  failure = error
  process.exitCode = 1
  if (win) await walk.snap('media-rest-blocked').catch(() => {})
} finally {
  await paid.finish(failure)
}
