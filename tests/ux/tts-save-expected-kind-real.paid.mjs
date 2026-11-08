#!/usr/bin/env node
// 协调专用，真付费只跑一次：「配音扣了钱却存不进项目」修好之后，APIMart nomi-audio 配音一条（speech，最便宜的一句台词），
// 带项目号经 nomi:tasks:run 提交一次，确认结果是项目里能读回、能解码的音频文件（docs/plan/2026-11-07-tts-save-expected-kind.md ★9）。
// 不重试（maxRetries 0），失败就停；凭据密文只在 openPaidWalk 里拷进隔离副本，跑完删掉。
// 零额度演练（同一条主进程路径、本机假服务、真 WAV / MP3 字节、真落盘关口）：tests/ux/tts-save-expected-kind-real.rehearsal.walk.mjs。
import { openPaidWalk } from './_paidRun.mjs'
import { DUBBING_MODEL, runDubbingSample } from './_ttsSaveSample.mjs'

const paid = await openPaidWalk('tts-save-expected-kind-real.paid.mjs', 'tts-save-expected-kind-real', [DUBBING_MODEL], {
  // 这次修复会原样进产物的字面量：用户文件的门拒收生成产物的错误码。产物里没有它 = 跑的不是修好的构建，花钱前拒跑。
  buildMarkers: ['local_file_import_refuses_generated_output'],
})
const { walk } = paid
let failure
try {
  await runDubbingSample(walk)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
