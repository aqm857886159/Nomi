// DIAGNOSTIC-ONLY probe (2026-09-11), not part of the product test suite. Reuses the exact same
// harness pattern as scripts/audio-ref-paid-smoke.mjs but swaps the degenerate 100x100 solid-color
// test-upload.png fixture for a real 720x720 photo (resources/onboarding-demo/kid.jpg), to test the
// hypothesis that APIMart's "invalid image content" / task_failed is about the placeholder image
// content, not about audio_urls itself. Controlled by MODE env var:
//   MODE=image_only   -> real photo, no audio_urls, generate_audio default(true)
//   MODE=image_audio  -> real photo + real audio (same fixture as the paid smoke script)
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.tmp', 'audio-ref-diag-probe')
mkdirSync(outDir, { recursive: true })
const MODEL_KEY = 'doubao-seedance-2.0'
const MODE = process.env.MODE || 'image_only'
const AUDIO_FIXTURE = path.join(repoRoot, 'tests/ux/fixtures/real-narration.mp3')
const IMAGE_FIXTURE = path.join(repoRoot, 'resources/onboarding-demo/kid.jpg')

const { app, win } = await launchNomiApp({ name: 'audio-ref-diag-probe', isolate: false })
try {
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(3500)
  let projectId = null
  for (let i = 0; i < 8 && !projectId; i++) {
    projectId = await win.evaluate(() => (window.location.href.match(/projectId=([^&#]+)/) || [])[1] || null)
    if (!projectId) await win.waitForTimeout(1000)
  }
  if (!projectId) { console.log(`✗ projectId 解析失败`); await app.close(); process.exit(1) }

  const quote = await win.evaluate((v) => window.nomiDesktop.tasks.quoteSpend([{ vendorKey: v.vendorKey, modelKey: v.modelKey }]), { vendorKey: 'apimart', modelKey: MODEL_KEY })
  const grant = await win.evaluate((a) => window.nomiDesktop.tasks.grantSpend({ nodeIds: [a.nodeId], maxAttemptsPerNode: 2, quoteId: a.quoteId }), { nodeId: 'diag-probe', quoteId: quote?.quoteId })
  const grantId = grant?.grantId
  console.log(`MODE=${MODE} projectId=${projectId} grant=${grantId ? 'ok' : 'FAIL'}`)
  if (!grantId) { console.log(`✗ grantSpend 失败: ${JSON.stringify(grant)}`); await app.close(); process.exit(1) }

  const imageDataUrl = `data:image/jpeg;base64,${readFileSync(IMAGE_FIXTURE).toString('base64')}`
  const imageAsset = await win.evaluate(async (a) => window.nomiDesktop.assets.importRemoteUrl({ projectId: a.pid, url: a.d, kind: 'generated', fileName: 'ref-face-real.jpg' }), { pid: projectId, d: imageDataUrl })
  const imageUrl = imageAsset?.data?.url
  let audioUrl = null
  if (MODE === 'image_audio') {
    const audioDataUrl = `data:audio/mpeg;base64,${readFileSync(AUDIO_FIXTURE).toString('base64')}`
    const audioAsset = await win.evaluate(async (a) => window.nomiDesktop.assets.importRemoteUrl({ projectId: a.pid, url: a.d, kind: 'generated', fileName: 'ref-voice.mp3' }), { pid: projectId, d: audioDataUrl })
    audioUrl = audioAsset?.data?.url
  }
  if (!imageUrl || (MODE === 'image_audio' && !audioUrl)) { console.log(`✗ 素材导入失败 image=${imageUrl} audio=${audioUrl}`); await app.close(); process.exit(1) }
  console.log(`素材就绪 image=${imageUrl.slice(0, 60)}… audio=${audioUrl ? audioUrl.slice(0, 60) + '…' : '(none)'}`)

  const extras = {
    modelKey: MODEL_KEY, model: MODEL_KEY,
    image_urls: [imageUrl],
    referenceImages: [imageUrl],
    size: '16:9', resolution: '480p', duration: 4,
    grantId, nodeId: 'diag-probe',
  }
  if (MODE === 'image_audio') { extras.audio_urls = [audioUrl]; extras.generate_audio = true }
  else { extras.generate_audio = false }

  console.log(`— ${MODE} 生成中 —`)
  const start = await win.evaluate(async (a) => window.nomiDesktop.tasks.run({
    vendor: 'apimart',
    request: { kind: 'image_to_video', prompt: '镜头缓慢推进，人物安静地看向镜头', extras: a.extras },
  }), { extras })
  if (!start?.id) { console.log(`✗ no taskId: ${JSON.stringify(start)?.slice(0, 300)}`); await app.close(); process.exit(1) }
  console.log(`taskId=${start.id} status=${start.status}`)

  let final = start
  const terminal = new Set(['succeeded', 'failed'])
  for (let i = 0; i < 40 && !terminal.has(final.status); i++) {
    await new Promise((r) => setTimeout(r, 12000))
    const resp = await win.evaluate(async (a) => window.nomiDesktop.tasks.result({ taskId: a.id, vendor: 'apimart', taskKind: 'image_to_video', prompt: a.prompt, modelKey: a.mk }), { id: start.id, prompt: '镜头缓慢推进，人物安静地看向镜头', mk: MODEL_KEY })
    final = resp?.result ?? final
    if (i % 3 === 0) console.log(`  poll ${i + 1}: ${final.status}`)
  }
  const video = (final.assets || []).find((x) => x.type === 'video' && x.url)
  writeFileSync(path.join(outDir, `${MODE}-final.json`), JSON.stringify(final, null, 2))
  if (!video) { console.log(`✗ 无视频 (status=${final.status}) final=${JSON.stringify(final).slice(0, 500)}`); await app.close(); process.exit(1) }
  console.log(`✓ 视频: ${video.url.slice(0, 100)}…`)
  const vdata = await win.evaluate(async (u) => { const r = await fetch(u); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(b) }) }, video.url)
  if (typeof vdata === 'string' && vdata.startsWith('data:')) {
    const mp4 = path.join(outDir, `${MODE}.mp4`)
    writeFileSync(mp4, Buffer.from(vdata.split(',')[1], 'base64'))
    console.log(`✓ 已存本地: ${mp4}`)
  }
  console.log(`\n═══ ${MODE} 探针完成 ═══`)
} catch (e) {
  console.log(`✗ ${e?.message || e}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
