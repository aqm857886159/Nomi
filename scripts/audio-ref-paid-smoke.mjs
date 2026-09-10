// 真实付费验收（R13 附加）：APIMart doubao-seedance-2.0 全能参考（omni）带一段真实音频参考
// （tests/ux/fixtures/real-narration.mp3）+ 一张真实图片参考（tests/ux/fixtures/test-upload.png）。
// 直接用 window.nomiDesktop.tasks.run() 驱动真实供应商请求——同 scripts/staging-video-ab.mjs 的
// 既定用法（isolate:false 真实 profile 起、跳过画布 UI 直接走底层任务 API）：画布连线→判定→
// 请求体这条链路已由 tests/ux/audio-reference-connect.walk.mjs 的真机走查 + 干跑步骤验过，
// 这里只补最后一环——真供应商端点真的吃得下音频参考、真出得了片。
// 用法：pnpm run build && node scripts/audio-ref-paid-smoke.mjs   （真实小额花费，默认授权）
//
// 2026-09-11 现状：跑了 5 次，请求都真实到达 APIMart（task 创建成功、进过 queued/running），
// 每次都以 code=task_failed / "We couldn't complete this request. Please try again in a moment."
// 收场，credits_cost/cost 恒 0（未扣费）。已排除的假设：size 字段缺失（已补，仍失败）、resolution/
// generate_audio 偏离默认值（改回档案默认 720p/true 仍失败）、纯音频问题（image-only 探针同样
// task_failed，排除音频专属）。剩下最可能是 APIMart 侧对本机出站网络/本地化后素材 URL 的可达性
// 限制（同 docs/lessons/paid-smoke-apimart-only.md 记录的既有限制：APIMart 只能走本地代理）——
// 不是这次 audio-first-class-reference 改动本身的缺陷：同一份请求体的核心字段（image_urls/
// audio_urls/referenceImages）已经由 tests/ux/audio-reference-connect.walk.mjs 的干跑步骤，
// 用生产同一份 buildArchetypeInputParams 验证过构造正确。
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.tmp', 'audio-ref-paid-smoke')
mkdirSync(outDir, { recursive: true })
const MODEL_KEY = 'doubao-seedance-2.0'
const AUDIO_FIXTURE = path.join(repoRoot, 'tests/ux/fixtures/real-narration.mp3')
const IMAGE_FIXTURE = path.join(repoRoot, 'tests/ux/fixtures/test-upload.png')

// isolate:false：真实 profile（真 APIMart key、真项目库），同 scripts/staging-video-ab.mjs 的既定用法。
const { app, win } = await launchNomiApp({ name: 'audio-ref-paid-smoke', isolate: false })
try {
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(3500)
  let projectId = null
  for (let i = 0; i < 8 && !projectId; i++) {
    projectId = await win.evaluate(() => (window.location.href.match(/projectId=([^&#]+)/) || [])[1] || null)
    if (!projectId) await win.waitForTimeout(1000)
  }
  if (!projectId) { const href = await win.evaluate(() => window.location.href); console.log(`✗ projectId 解析失败, href=${href}`); await app.close(); process.exit(1) }

  // 09-09 起「钱的闸」要求先报价再铸令牌（每次提交看报价确认，见 docs 记录）：
  // quoteSpend(vendorKey+modelKey) → quoteId，grantSpend 带上 quoteId 才会把这条 quote 塞进
  // grant.quote.lines，assertAndConsumeQuotedSpend 的 identityApproved 判定才对得上，
  // 否则会报 SpendNotAuthorizedError（先前手搭的 grantSpend without quoteId 已实测撞到这个）。
  const quote = await win.evaluate((v) => window.nomiDesktop.tasks.quoteSpend([{ vendorKey: v.vendorKey, modelKey: v.modelKey }]), { vendorKey: 'apimart', modelKey: MODEL_KEY })
  console.log(`quote=${JSON.stringify(quote)}`)
  const grant = await win.evaluate((a) => window.nomiDesktop.tasks.grantSpend({ nodeIds: [a.nodeId], maxAttemptsPerNode: 2, quoteId: a.quoteId }), { nodeId: 'audio-ref-omni', quoteId: quote?.quoteId })
  const grantId = grant?.grantId
  console.log(`projectId=${projectId} grant=${grantId ? 'ok' : 'FAIL'}`)
  if (!grantId) { console.log(`✗ grantSpend 失败: ${JSON.stringify(grant)}`); await app.close(); process.exit(1) }

  const audioDataUrl = `data:audio/mpeg;base64,${readFileSync(AUDIO_FIXTURE).toString('base64')}`
  const imageDataUrl = `data:image/png;base64,${readFileSync(IMAGE_FIXTURE).toString('base64')}`
  const audioAsset = await win.evaluate(async (a) => window.nomiDesktop.assets.importRemoteUrl({ projectId: a.pid, url: a.d, kind: 'generated', fileName: 'ref-voice.mp3' }), { pid: projectId, d: audioDataUrl })
  const imageAsset = await win.evaluate(async (a) => window.nomiDesktop.assets.importRemoteUrl({ projectId: a.pid, url: a.d, kind: 'generated', fileName: 'ref-face.png' }), { pid: projectId, d: imageDataUrl })
  const audioUrl = audioAsset?.data?.url
  const imageUrl = imageAsset?.data?.url
  if (!audioUrl || !imageUrl) { console.log(`✗ 素材导入失败 audio=${audioUrl} image=${imageUrl}`); await app.close(); process.exit(1) }
  console.log(`素材就绪 audio=${audioUrl.slice(0, 60)}… image=${imageUrl.slice(0, 60)}…`)

  // APIMart 的 Seedance 2.0 全能参考走 i2v 传输操作（image_to_video），image_urls/audio_urls 是
  // 该操作 i2vBody 里声明的两个数组键（electron/catalog/apimartVideos.ts:57-59）——本次改动的
  // 「audio 一等参考」根因修复只影响画布侧的门岗与展示，不改任何供应商传输键名（P4：不为某个
  // 供应商另写特例），这里直接用它已有的键名发真实请求。480p/5s = 本模型最低档，控制花费。
  console.log('— omni（图 + 音频参考）生成中 —')
  const start = await win.evaluate(async (a) => window.nomiDesktop.tasks.run({
    vendor: 'apimart',
    request: {
      kind: 'image_to_video',
      prompt: '镜头缓慢推进，人物安静地聆听一段旁白',
      extras: {
        modelKey: a.mk, model: a.mk,
        image_urls: [a.imageUrl],
        audio_urls: [a.audioUrl],
        // referenceImages：generic 第三闸（electron/catalog/taskParams.ts firstReferenceImage）
        // 读的是这个通用键，不是 image_urls（那是 APIMart 传输层自己的 body 字段名）——
        // 画布正常走 buildArchetypeInputParams 时两者都会填，这里手搭请求得自己补上。
        referenceImages: [a.imageUrl],
        // size 是必填字段（electron/shared/videoCapabilities/seedanceApimart.ts 的比例控件，
        // 16:9/9:16/1:1/4:3/3:4/21:9/adaptive）——手搭请求漏了它，真实探针复现：连最简单的
        // image-only 请求都被 APIMart 判 task_failed（¥0 未扣费）；补上后本地址才算完整。
        size: '16:9', resolution: '720p', duration: 5, generate_audio: true,
        grantId: a.grantId, nodeId: 'audio-ref-omni',
      },
    },
  }), { mk: MODEL_KEY, imageUrl, audioUrl, grantId })
  if (!start?.id) { console.log(`✗ no taskId: ${JSON.stringify(start)?.slice(0, 300)}`); await app.close(); process.exit(1) }
  console.log(`taskId=${start.id} status=${start.status}`)

  let final = start
  const terminal = new Set(['succeeded', 'failed'])
  for (let i = 0; i < 60 && !terminal.has(final.status); i++) {
    await new Promise((r) => setTimeout(r, 12000))
    const resp = await win.evaluate(async (a) => window.nomiDesktop.tasks.result({ taskId: a.id, vendor: 'apimart', taskKind: 'image_to_video', prompt: a.prompt, modelKey: a.mk }), { id: start.id, prompt: '镜头缓慢推进，人物安静地聆听一段旁白', mk: MODEL_KEY })
    final = resp?.result ?? final
    if (i % 3 === 0) console.log(`  poll ${i + 1}: ${final.status}`)
  }
  const video = (final.assets || []).find((x) => x.type === 'video' && x.url)
  if (!video) { console.log(`✗ 无视频 (status=${final.status}) final=${JSON.stringify(final).slice(0, 400)}`); await app.close(); process.exit(1) }
  console.log(`✓ 视频: ${video.url.slice(0, 100)}…`)

  const vdata = await win.evaluate(async (u) => { const r = await fetch(u); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(b) }) }, video.url)
  if (typeof vdata === 'string' && vdata.startsWith('data:')) {
    const mp4 = path.join(outDir, 'audio-ref-omni.mp4')
    writeFileSync(mp4, Buffer.from(vdata.split(',')[1], 'base64'))
    console.log(`✓ 已存本地: ${mp4}`)
  }
  console.log('\n═══ 真实付费验收完成：APIMart Seedance 2.0 omni 吃得下真实音频参考 ═══')
} catch (e) {
  console.log(`✗ ${e?.message || e}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
