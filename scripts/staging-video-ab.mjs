// 视频层验证：把「staging 引导出的写实关键帧」喂 apimart doubao-seedance-2.0 (i2v)，
// 出视频后抽首/尾帧比对——验证站位/动作从头到尾不崩（staging→关键帧→视频链的最后一环）。
// 真实视频额度。需 apimart key。用法：pnpm run build && APIMART_E2E=1 node scripts/staging-video-ab.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })
const MODEL_KEY = 'doubao-seedance-2.0'

const CASES = [
  { label: 'propose', frame: 'ab-rev-propose-B.png', prompt: '镜头缓慢推进，女人举起戒指盒，男人惊喜地用手捂住嘴，温暖烛光闪烁，两人保持站位。' },
  { label: 'three', frame: 'ab-three-poses-B.png', prompt: '镜头缓慢横移，三个人保持各自姿势——左边的人坐着、中间站立、右边单膝跪地，人物自然轻微活动。' },
]

const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repoRoot, env: { ...process.env } })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  if (process.env.APIMART_API_KEY) await win.evaluate((k) => window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: k, enabled: true }), process.env.APIMART_API_KEY)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(3500)
  let projectId = null
  for (let i = 0; i < 8 && !projectId; i++) {
    projectId = await win.evaluate(() => (window.location.href.match(/projectId=([^&#]+)/) || [])[1] || null)
    if (!projectId) await win.waitForTimeout(1000)
  }
  if (!projectId) { const href = await win.evaluate(() => window.location.href); console.log(`✗ projectId 解析失败, href=${href}`); await app.close(); process.exit(1) }
  const grant = await win.evaluate((ids) => window.nomiDesktop.tasks.grantSpend({ nodeIds: ids, maxAttemptsPerNode: 2 }), CASES.map((c) => c.label))
  const grantId = grant?.grantId
  console.log(`projectId=${projectId} grant=${grantId ? 'ok' : 'FAIL'}`)

  for (const c of CASES) {
    const filePath = path.join(outDir, c.frame)
    let dataUrl
    try { dataUrl = `data:image/png;base64,${readFileSync(filePath).toString('base64')}` } catch { console.log(`✗ 缺关键帧 ${c.frame}`); continue }
    const asset = await win.evaluate(async (a) => window.nomiDesktop.assets.importRemoteUrl({ projectId: a.pid, url: a.d, kind: 'generated', fileName: 'kf.png' }), { pid: projectId, d: dataUrl })
    const localUrl = asset?.data?.url
    if (!localUrl) { console.log(`✗ ${c.label} 导入失败`); continue }
    console.log(`— ${c.label}: i2v 生成中（关键帧=${c.frame}）—`)
    const start = await win.evaluate(async (a) => window.nomiDesktop.tasks.run({
      vendor: 'apimart',
      request: { kind: 'image_to_video', prompt: a.prompt, extras: { modelKey: a.mk, model: a.mk, image_urls: [a.url], resolution: '720p', duration: 5, generate_audio: false, grantId: a.grantId, nodeId: a.label } },
    }), { prompt: c.prompt, mk: MODEL_KEY, url: localUrl, grantId, label: c.label })
    if (!start?.id) { console.log(`  ✗ no taskId: ${JSON.stringify(start)?.slice(0, 200)}`); continue }
    console.log(`  taskId=${start.id} status=${start.status}`)
    let final = start
    const terminal = new Set(['succeeded', 'failed'])
    for (let i = 0; i < 50 && !terminal.has(final.status); i++) {
      await new Promise((r) => setTimeout(r, 12000))
      const resp = await win.evaluate(async (a) => window.nomiDesktop.tasks.result({ taskId: a.id, vendor: 'apimart', taskKind: 'image_to_video', prompt: a.prompt, modelKey: a.mk }), { id: start.id, prompt: c.prompt, mk: MODEL_KEY })
      final = resp?.result ?? final
      if (i % 3 === 0) console.log(`    poll ${i + 1}: ${final.status}`)
    }
    const video = (final.assets || []).find((x) => x.type === 'video' && x.url)
    if (!video) { console.log(`  ✗ ${c.label} 无视频 (status=${final.status})`); continue }
    console.log(`  ✓ 视频: ${video.url.slice(0, 70)}…`)
    // 下载视频到本地
    const vdata = await win.evaluate(async (u) => { const r = await fetch(u); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(b) }) }, video.url)
    if (typeof vdata === 'string' && vdata.startsWith('data:')) {
      const mp4 = path.join(outDir, `video-${c.label}.mp4`)
      writeFileSync(mp4, Buffer.from(vdata.split(',')[1], 'base64'))
      // 抽首帧 + 尾帧（约 4.5s）对比漂移
      try {
        execFileSync('ffmpeg', ['-y', '-i', mp4, '-vf', 'select=eq(n\\,0)', '-vframes', '1', path.join(outDir, `vframe-${c.label}-start.png`)], { stdio: 'ignore' })
        execFileSync('ffmpeg', ['-y', '-sseof', '-0.3', '-i', mp4, '-vframes', '1', path.join(outDir, `vframe-${c.label}-end.png`)], { stdio: 'ignore' })
        console.log(`  ✓ 抽帧 vframe-${c.label}-start/end.png`)
      } catch (e) { console.log(`  ⚠ 抽帧失败: ${e?.message}`) }
    }
  }
  console.log('\n═══ 视频 A/B 完成 ═══')
} catch (e) { console.log(`✗ ${e?.message || e}`) } finally { await app.close().catch(() => undefined) }
