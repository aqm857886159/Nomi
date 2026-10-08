import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：中转接入的视频模型「图生视频」全链路（存量自愈 → 选中通道 → 首帧真的发上线）。
//
// 真机报障(2026-07-30)：用户接了个只有 Seedance 视频模型的 new-api 中转，视频节点连上首帧图就报
//   「模型…在本机没有配置『图生视频』通道…请在「模型接入」里删除该模型后重新接入一次」
// 而重新接入**也不会**建这条通道 —— newapiTransportFor("video") 从来只返回 text_to_video。
// 更深一层：commit 的 reconcile 还会把 body 里的 `image: {{request.params.image_url}}` 覆盖成
// `{{request.params.image}}`（UI 参数键叫 image、wire 模板读 image_url，同一个东西两个名字），
// 于是连线的首帧连 wire 都到不了。
//
// 本走查种一份**和用户机器同形的 v7 存量目录**（video 模型 + 只有 text_to_video、且 body 已被
// 覆盖成 {{request.params.image}}），起真 App：
//   ① v7→v8 迁移自愈出 image_to_video 通道（不必删了重加）；
//   ② 真发一次 image_to_video 任务到本地假中转；
//   ③ 假中转断言收到的 body 里 image = 我们给的首帧 URL（不是空、不是模板串）；
//   ④ 轮询到 succeeded，拿回视频地址。
// 用法：node scripts/relay-i2v-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.relay-i2v-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('relay-i2v-walk-')

const MODEL = 'doubao-seedance-2-0-260128'
const VENDOR = 'relay-example-com'
const FIRST_FRAME = 'https://cdn.example.com/first-frame.png'
const RESULT_VIDEO = 'https://cdn.example.com/out.mp4'
const NOW = '2026-07-30T00:00:00.000Z'

// ── 假 new-api（形状照抄用户那家）───────────────────────────────────────────────
let createBody = null
let pollHits = 0
const mock = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  if (req.method === 'POST' && url === '/v1/video/generations') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try { createBody = JSON.parse(raw) } catch { createBody = { __unparsable: raw } }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ task_id: 'task-mock-1', status: 'processing' }))
    })
    return
  }
  if (req.method === 'GET' && url.startsWith('/v1/video/generations/')) {
    pollHits += 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ task_id: 'task-mock-1', status: 'succeeded', data: [{ url: RESULT_VIDEO }] }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `no route ${req.method} ${url}` } }))
})
await new Promise((r) => mock.listen(8898, '127.0.0.1', r))
const BASE_URL = 'http://127.0.0.1:8898'
console.log('  🟢 假 new-api on ' + BASE_URL)

// ── 种 v7 存量目录：有视频模型，只有 text_to_video，且 body 已被 reconcile 覆盖 ──
writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 7,
  vendors: [{
    key: VENDOR, name: 'Seedance 2.0 视频生成', enabled: true, baseUrlHint: BASE_URL,
    authType: 'bearer', authHeader: null, authQueryParam: null,
    providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW,
  }],
  models: [{
    modelKey: MODEL, vendorKey: VENDOR, modelAlias: MODEL, labelZh: 'Doubao Seedance 2 0 260128',
    kind: 'video', enabled: true, createdAt: NOW, updatedAt: NOW,
  }],
  mappings: [{
    id: 'mapping-legacy-t2v', vendorKey: VENDOR, taskKind: 'text_to_video', name: '文生视频',
    enabled: true,
    create: {
      method: 'POST', path: '/v1/video/generations',
      headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
      // 存量真实形状：首帧位已被 reconcile 覆盖成 taskParams 从不产出的 image 键。
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', duration: '{{request.params.duration}}', size: '{{request.params.size}}', image: '{{request.params.image}}' },
      response_mapping: { task_id: 'task_id' }, provider_meta_mapping: { task_id: 'task_id' },
    },
    query: {
      method: 'GET', path: '/v1/video/generations/{{providerMeta.task_id}}',
      headers: { Authorization: 'Bearer {{user_api_key}}' },
      response_mapping: { task_id: 'task_id', status: 'status', video_url: 'data[*].url', error_message: 'error.message' },
    },
    createdAt: NOW, updatedAt: NOW,
  }],
  apiKeysByVendor: { [VENDOR]: { apiKey: 'sk-mock-key', enc: 'plain', enabled: true, createdAt: NOW, updatedAt: NOW } },
}, null, 2), 'utf8')
console.log('  🌱 种下 v7 存量目录：video 模型 + 只有 text_to_video（无图生视频通道）')

const { app, win } = await launchNomiApp({
  name: 'relay-i2v',
  settingsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 2500,
})
try {

  // ① 迁移自愈：v7 → v8，长出 image_to_video 通道
  const mappings = await win.evaluate(async () => {
    const b = window.nomiDesktop
    return b.modelCatalog.listMappings()
  })
  const i2v = mappings.filter((m) => m.taskKind === 'image_to_video')
  console.log(`  ① 自愈出的图生视频通道 = ${i2v.length} 条；modelKey=${i2v.map((m) => m.modelKey).join(',')}`)
  console.log(`     首帧位读的键 = ${JSON.stringify(i2v[0]?.create?.body?.image)}`)

  // ②③④ 真发一次图生视频（首帧 = FIRST_FRAME），走完整 IPC 链路
  const runResult = await win.evaluate(async ({ vendor, model, firstFrame }) => {
    const b = window.nomiDesktop
    const { grantId } = await b.tasks.grantSpend({ nodeIds: ['walkthrough-node'] })
    return b.tasks.run({
      vendor,
      request: {
        kind: 'image_to_video',
        prompt: '人物面对镜头自然介绍产品',
        extras: { modelKey: model, firstFrameUrl: firstFrame, nodeId: 'walkthrough-node', grantId, duration: 5 },
      },
    })
  }, { vendor: VENDOR, model: MODEL, firstFrame: FIRST_FRAME })

  console.log('  ② 假中转收到的 create body =', JSON.stringify(createBody))
  console.log(`  ③ 首帧真的发上线 = ${createBody?.image === FIRST_FRAME}`)
  console.log(`  ④ 轮询次数=${pollHits}；任务结果 =`, JSON.stringify(runResult)?.slice(0, 300))
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
