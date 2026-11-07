#!/usr/bin/env node
// 协调专用，真付费只跑一次：「配音扣了钱却存不进项目」修好之后，APIMart nomi-audio 配音一条（speech，最便宜的一句台词），
// 带项目号经 nomi:tasks:run 提交一次，确认结果是项目里能读回、能解码的音频文件（docs/plan/2026-11-07-tts-save-expected-kind.md ★9）。
// 不重试（maxRetries 0），失败就停；凭据密文只在 openPaidWalk 里拷进隔离副本，跑完删掉。
// 零额度演练（同一条主进程路径、本机假服务、真 WAV / MP3 字节、真落盘关口）：tests/ux/tts-save-expected-kind-real.rehearsal.walk.mjs。
import fs from 'node:fs'
import { openPaidWalk } from './_paidRun.mjs'
import { clickOrFail } from './_assert.mjs'
import { probeLandedMedia } from './_agentVideoPaid.mjs'
import { stationTimeout } from './_station-budget.mjs'

const MODEL = { vendorKey: 'apimart', modelKey: 'nomi-audio' }
const NODE_ID = 'tts-save-expected-kind-sample'
const paid = await openPaidWalk('tts-save-expected-kind-real.paid.mjs', 'tts-save-expected-kind-real', [MODEL], {
  // 这次修复会原样进产物的字面量：用户文件的门拒收生成产物的错误码。产物里没有它 = 跑的不是修好的构建，花钱前拒跑。
  buildMarkers: ['local_file_import_refuses_generated_output'],
})
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  const { grantId } = await win.evaluate((id) => window.nomiDesktop.tasks.grantSpend({ nodeIds: [id], maxAttemptsPerNode: 1 }), NODE_ID)
  const request = {
    kind: 'text_to_audio', prompt: '海风轻拂。',
    extras: { modelKey: MODEL.modelKey, modeId: 'speech', projectId, nodeId: NODE_ID, grantId, maxRetries: 0 },
  }
  const pending = win.evaluate((input) => window.nomiDesktop.tasks.run({ vendor: MODEL.vendorKey, request: input }), request)
  // 先接住早到的拒绝，再去点普通的生成确认。
  pending.catch(() => {})
  await clickOrFail(win.locator('[data-spend-confirm-action="confirm"]'), 'Approve one dubbing line', { timeout: stationTimeout({ operations: 2 }) })
  const result = await pending
  walk.report.result = { status: result?.status, taskId: result?.id, assets: result?.assets }
  if (result?.status !== 'succeeded') throw new Error(`配音没有成功：${JSON.stringify(result).slice(0, 400)}`)
  const audio = (result.assets ?? []).filter((asset) => asset?.type === 'audio')
  if (audio.length !== 1) throw new Error(`应当正好一个音频结果，实际 ${audio.length}：${JSON.stringify(result.assets).slice(0, 400)}`)
  const landed = await probeLandedMedia(projectRoot, projectId, audio[0].url)
  if (!(landed.bytes > 0) || !fs.existsSync(landed.filePath)) throw new Error(`项目里没有这份配音文件：${landed.filePath}`)
  if (!(Number(landed.probe?.durationSeconds) > 0)) throw new Error(`落盘的文件解码不出时长：${JSON.stringify(landed.probe).slice(0, 300)}`)
  walk.report.landed = { bytes: landed.bytes, durationSeconds: landed.probe.durationSeconds }
  await walk.snap('dubbing-landed')
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
