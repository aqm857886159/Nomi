#!/usr/bin/env node
// 协调会话专用：APIMart 图片 / 视频型号的真付费抽检。一次只测计划里的那一个型号，只提交一次，失败就停，不自动重试。
// 计划文件（NOMI_MEDIA_REST_PAID_PLAN，JSON，放在仓库外）：{ "modelKey": "pixverse-v6" }，型号必须在下面的样本表里。
// 样本表 = 每家一条「公开价最低的当前基础档」（价格见 PR 报告；价格只做挑样本的依据，不写进声明）。
// 凭据、出网名单、构建检查、回执全部由 openPaidWalk 负责，本脚本不接触 key。
// 走的是真界面：选型号 → 默认参数可见 → 点生成 → 花钱确认 → 等产物落地；请求体由网络闸账本核对（只看字段集合，不记 key）。
// 注意：走查按该型号的**默认参数**生成（不改时长 / 清晰度），实际花费看花钱确认框里的数。
// NOMI_MEDIA_REST_FREE_ONLY=1 时在点生成之前停下（零花费演练：选型号、默认参数可见、请求还没发）。
// TODO（P1）：音频那条抽检（tests/ux/catalog-latest-real.paid.mjs + catalogLatestSamples.ts，PR #1436）合入 main 后，
// 本脚本的样本表并进那一份通用抽检，同一个入口按计划文件挑样本，删掉这一份，不留两套并行脚本。
import fs from 'node:fs'
import path from 'node:path'
import { expect } from './_assert.mjs'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { createRelayProject, prepareRelayVideo, generateRelayVideo } from './_relayVideoWalk.mjs'

const SCRIPT = 'catalog-media-rest-real.paid.mjs'
// 每家最便宜的当前基础档各一条（kind 决定走图片节点还是视频节点）。
const SAMPLES = Object.freeze({
  // 图片
  'gpt-image-2.6-flare': { kind: 'image' },
  'gemini-3.1-flash-lite-image-ext': { kind: 'image' },
  'flux-3-image-klein': { kind: 'image' },
  'grok-imagine-image-2.0': { kind: 'image' },
  'hy-image-v3.5-preview': { kind: 'image' },
  'muse-image-ext': { kind: 'image' },
  'wan2.7-image': { kind: 'image' },
  // 视频
  'pixverse-v6': { kind: 'video' },
  'pixverse-v6-max': { kind: 'video' },
  'viduq3-turbo': { kind: 'video' },
  'kling-v4': { kind: 'video' },
  'grok-imagine-video-1.5': { kind: 'video' },
  'veo3.1-fast-official': { kind: 'video' },
  'muse-video-ext': { kind: 'video' },
  'wan3.0-video-prime': { kind: 'video' },
  'flux-3-video': { kind: 'video' },
  'gemini-omni-1.2-flash': { kind: 'video' },
})

const plan = JSON.parse(fs.readFileSync(process.env.NOMI_MEDIA_REST_PAID_PLAN ?? '', 'utf8'))
const sample = SAMPLES[plan.modelKey]
if (!sample) throw new Error(`型号 ${plan.modelKey} 不在付费抽检样本表里（只测每家最便宜的当前基础档，一次一条）`)
const model = { vendorKey: 'apimart', modelKey: plan.modelKey }

// 授权名单 = Agent 大脑 + 这次要测的那一个型号：只授权大脑时，隔离副本里样本型号被关掉，下拉里根本选不到（11-07 演练实测）。
const paid = await openPaidWalk(SCRIPT, 'catalog-media-rest-real', [DEFAULT_PAID_BRAIN, model], { env: { ...process.env } })
const { walk } = paid
let failure
let win
try {
  ;({ win } = await walk.start({ first: true }))
  await paid.lockToAuthorizedModels(win)
  const capture = (tag) => walk.snap(`media-rest-${tag}`)
  const prepared = await prepareRelayVideo({ win, newProject: () => createRelayProject(walk, win), model, capture, kind: sample.kind })
  walk.report.freeSegment = { prepared: true, model: plan.modelKey, kind: sample.kind, nodeId: prepared.nodeId }
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
