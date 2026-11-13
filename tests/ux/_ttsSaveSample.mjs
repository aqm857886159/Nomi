import fs from 'node:fs'
import { clickOrFail } from './_assert.mjs'
import { probeLandedMedia } from './_agentVideoPaid.mjs'
import { stationTimeout } from './_station-budget.mjs'

export const DUBBING_MODEL = { vendorKey: 'apimart', modelKey: 'nomi-audio' }
const NODE_ID = 'tts-save-expected-kind-sample'

export async function runDubbingSample(walk) {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  const { grantId } = await win.evaluate((id) => window.nomiDesktop.tasks.grantSpend({ nodeIds: [id], maxAttemptsPerNode: 1 }), NODE_ID)
  const request = {
    kind: 'text_to_audio', prompt: '海风轻拂。',
    extras: { modelKey: DUBBING_MODEL.modelKey, modeId: 'speech', projectId, nodeId: NODE_ID, grantId, maxRetries: 0 },
  }
  // Playwright runs the callback in the renderer, so the whole IPC payload must cross that boundary.
  const pending = win.evaluate((payload) => window.nomiDesktop.tasks.run(payload), { vendor: DUBBING_MODEL.vendorKey, request })
  const [result] = await Promise.all([
    pending,
    clickOrFail(win.locator('[data-spend-confirm-action="confirm"]'), 'Approve one dubbing line', { timeout: stationTimeout({ operations: 2 }) }),
  ])
  walk.report.dubbing = { status: result?.status, taskId: result?.id }
  if (result?.status !== 'succeeded') throw new Error(`配音没有成功：${JSON.stringify(result).slice(0, 400)}`)
  const audio = (result.assets ?? []).filter((asset) => asset?.type === 'audio')
  if (audio.length !== 1) throw new Error(`应当正好一个音频结果，实际 ${audio.length}：${JSON.stringify(result.assets).slice(0, 400)}`)
  const landed = await probeLandedMedia(projectRoot, projectId, audio[0].url)
  if (!(landed.bytes > 0) || !fs.existsSync(landed.filePath)) throw new Error(`项目里没有这份配音文件：${landed.filePath}`)
  if (!(Number(landed.probe?.durationSeconds) > 0)) throw new Error(`落盘的文件解码不出时长：${JSON.stringify(landed.probe).slice(0, 300)}`)
  walk.report.landed = { bytes: landed.bytes, durationSeconds: landed.probe.durationSeconds }
  await walk.snap('dubbing-landed')
}
