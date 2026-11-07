#!/usr/bin/env node
// 协调会话专用（本线只写、不跑）：剩余 APIMart 视频型号的真付费抽检，一次只测计划里的那一个型号，每次只提交一次。
// 计划文件（NOMI_MEDIA_REST_PAID_PLAN，JSON，放在仓库外）：{ "modelKey": "pixverse-v6", "duration": 5, "resolution": "540p" }
// 只许挑当前价目里「每家最便宜的当前基础档」；凭据、出网名单、构建检查、回执全部由 openPaidWalk 负责，本脚本不接触 key。
// 走的是真界面：选型号 → 默认参数可见 → 点生成 → 花钱确认 → 等产物落地；请求体由网络闸账本核对（只看字段集合，不记 key）。
// NOMI_MEDIA_REST_FREE_ONLY=1 时在点生成之前停下（零花费演练：选型号、默认参数可见、请求还没发）。
// 图片型号没有可复用的真界面步骤，这一批只靠合同测试（electron/catalog/apimartMediaRestWire.test.ts）核请求体，付费抽检未写。
import fs from 'node:fs'
import path from 'node:path'
import { expect } from './_assert.mjs'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { createRelayProject, prepareRelayVideo, generateRelayVideo } from './_relayVideoWalk.mjs'

const SCRIPT = 'catalog-media-rest-real.paid.mjs'
// 每个型号一次付费抽检允许的最低配置（价目来自 APIMart 价格表，2026-11-07；价格只做护栏，不写进声明）。
const CHEAPEST = Object.freeze({
  'pixverse-v6': { duration: 5, resolution: '540p' },
  'pixverse-v6-max': { duration: 5, resolution: '540p' },
  'viduq3-turbo': { duration: 1, resolution: '540p' },
  'kling-v4': { duration: 3, resolution: '720p' },
  'grok-imagine-video-1.5': { duration: 1, resolution: '480p' },
  'veo3.1-fast-official': { duration: 4, resolution: '720p' },
})

const plan = JSON.parse(fs.readFileSync(process.env.NOMI_MEDIA_REST_PAID_PLAN ?? '', 'utf8'))
const allowed = CHEAPEST[plan.modelKey]
if (!allowed) throw new Error(`型号 ${plan.modelKey} 不在付费抽检名单里（只测每家最便宜的当前基础档）`)
if (plan.duration !== allowed.duration || plan.resolution !== allowed.resolution) {
  throw new Error(`付费计划必须是该型号的最低配置：${allowed.duration} 秒 / ${allowed.resolution}`)
}
const model = { vendorKey: 'apimart', modelKey: plan.modelKey }

const paid = await openPaidWalk(SCRIPT, 'catalog-media-rest-real', [DEFAULT_PAID_BRAIN], { env: { ...process.env } })
const { walk } = paid
let failure
let win
try {
  ;({ win } = await walk.start({ first: true }))
  await paid.lockToAuthorizedModels(win)
  const capture = (tag) => walk.snap(`media-rest-${tag}`)
  const prepared = await prepareRelayVideo({ win, newProject: () => createRelayProject(walk, win), model, capture })
  walk.report.freeSegment = { prepared: true, model: plan.modelKey, nodeId: prepared.nodeId }
  if (process.env.NOMI_MEDIA_REST_FREE_ONLY === '1') {
    walk.report.stoppedBeforeGeneration = true
  } else {
    walk.report.landed = await generateRelayVideo({ win, prepared, capture })
    fs.copyFileSync(walk.report.landed.media.filePath, path.join(walk.outputDir, 'landed.mp4'))
    expect(walk.report.landed.media.filePath, 'a local file landed').toBeTruthy()
  }
} catch (error) {
  failure = error
  process.exitCode = 1
  if (win) await walk.snap('media-rest-blocked').catch(() => {})
} finally {
  await paid.finish(failure)
}
