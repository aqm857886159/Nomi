import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：中转接入「认得出的模型走它的原生报文」通用策略。
//
// 两台假中转，跑同一套流程：
//   A. 富中转（同时提供 /v1/video/generations 与 /api/v3/contents/generations/tasks）
//      → 存量自愈应把 Seedance 升级到方舟原生报文；发一次带首帧+尾帧+角色图+参考视频的生成，
//        断言这些素材真的进了 content 数组（这正是通用最小模板发不出去的那一堆）。
//   B. 简中转（只有 /v1/video/generations）
//      → 保持通用模板；同样一次请求应被 L3 第三闸**拒发并说人话**（尾帧/角色图/参考视频发不出），
//        而不是静默退化成纯文生把钱扣了。
// 用法：node scripts/relay-native-wire-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const MODEL = 'doubao-seedance-2-0-260128'
const NOW = '2026-07-30T00:00:00.000Z'
const FIRST = 'https://cdn.example.com/first.png'
const LAST = 'https://cdn.example.com/last.png'
const ROLE = 'https://cdn.example.com/role.png'
const MOVE = 'https://cdn.example.com/camera-move.mp4'

/** 起一台假中转。rich=true 时额外提供方舟原生端点。 */
function startRelay(rich) {
  const seen = { arkBody: null, legacyBody: null }
  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0]
    const readBody = (cb) => { let raw = ''; req.on('data', (c) => { raw += c }); req.on('end', () => cb(raw)) }
    if (rich && req.method === 'POST' && url === '/api/v3/contents/generations/tasks') {
      readBody((raw) => {
        try { seen.arkBody = JSON.parse(raw) } catch { seen.arkBody = { __raw: raw } }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'cgt-mock-1', status: 'queued' }))
      })
      return
    }
    if (rich && req.method === 'GET' && url.startsWith('/api/v3/contents/generations/tasks/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid token', type: 'new_api_error' } }))
      return
    }
    if (req.method === 'POST' && url === '/v1/video/generations') {
      readBody((raw) => {
        try { seen.legacyBody = JSON.parse(raw) } catch { seen.legacyBody = { __raw: raw } }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ task_id: 'task-mock-1', status: 'processing' }))
      })
      return
    }
    if (req.method === 'GET' && url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL }] }))
      return
    }
    // API 命名空间下的未知路由 → 404 回显；顶层未知 → 后台 SPA 200（真实 new-api 就这样）
    if (url.startsWith('/api/') || url.startsWith('/v1/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `Invalid URL (${req.method} ${url})`, type: 'invalid_request_error' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><html><head><title>Dashboard</title></head><body></body></html>')
  })
  return { server, seen }
}

/** 种一份「已经接进来、走通用模板」的存量目录（模拟用户当前状态）。 */
function seedCatalog(settingsDir, vendorKey, baseUrl) {
  writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
    version: 8,
    vendors: [{
      key: vendorKey, name: 'Seedance 中转', enabled: true, baseUrlHint: baseUrl,
      authType: 'bearer', authHeader: null, authQueryParam: null,
      providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW,
    }],
    models: [{
      modelKey: MODEL, vendorKey, modelAlias: MODEL, labelZh: 'Doubao Seedance 2 0 260128',
      kind: 'video', enabled: true, createdAt: NOW, updatedAt: NOW,
    }],
    mappings: ['text_to_video', 'image_to_video'].map((taskKind) => ({
      id: `mapping-generic-${taskKind}`, vendorKey, taskKind, modelKey: MODEL, name: taskKind, enabled: true,
      create: {
        method: 'POST', path: '/v1/video/generations',
        headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
        body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', duration: '{{request.params.duration}}', size: '{{request.params.size}}', image: '{{request.params.image_url}}' },
        response_mapping: { task_id: 'task_id' }, provider_meta_mapping: { task_id: 'task_id' },
      },
      query: {
        method: 'GET', path: '/v1/video/generations/{{providerMeta.task_id}}',
        headers: { Authorization: 'Bearer {{user_api_key}}' },
        response_mapping: { task_id: 'task_id', status: 'status', video_url: 'data[*].url' },
      },
      createdAt: NOW, updatedAt: NOW,
    })),
    apiKeysByVendor: { [vendorKey]: { apiKey: 'sk-mock', enc: 'plain', enabled: true, createdAt: NOW, updatedAt: NOW } },
  }, null, 2), 'utf8')
}

async function runCase({ label, rich, port }) {
  const { server, seen } = startRelay(rich)
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${port}/v1` // 用户就是这么填的（带 /v1）
  const vendorKey = `relay-${port}`
  const settingsDir = makeTempDir('native-wire-walk-')
  seedCatalog(settingsDir, vendorKey, baseUrl)

  const { app, win } = await launchNomiApp({
    name: 'relay-native-wire',
    settingsDir,
    env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
    settleMs: 4000, // 等启动后的异步体检跑完
  })
  try {

    const mappings = await win.evaluate(() => window.nomiDesktop.modelCatalog.listMappings())
    const mine = mappings.filter((m) => m.vendorKey === vendorKey && m.taskKind === 'image_to_video')
    const paths = [...new Set(mine.map((m) => m.create?.path))]
    console.log(`  [${label}] 图生视频通道的 path = ${JSON.stringify(paths)}`)
    const models = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels())
    console.log(`  [${label}] 模型 meta = ${JSON.stringify(models.find((m) => m.vendorKey === vendorKey)?.meta)}`) // wireProfile/archetypeId 诚实标注

    const outcome = await win.evaluate(async ({ vendorKey, model, refs }) => {
      const b = window.nomiDesktop
      const { grantId } = await b.tasks.grantSpend({ nodeIds: ['walk'] })
      try {
        const r = await b.tasks.run({
          vendor: vendorKey,
          request: {
            kind: 'image_to_video',
            prompt: '人物面对镜头介绍产品',
            extras: {
              modelKey: model, nodeId: 'walk', grantId, duration: 5, ratio: '16:9', resolution: '720p',
              firstFrameUrl: refs.first, lastFrameUrl: refs.last,
              referenceImageUrls: [refs.role], referenceVideoUrls: [refs.move],
              archetypeInput: {
                volcengine_first_role_image_content: { type: 'image_url', image_url: { url: refs.first }, role: 'first_frame' },
                volcengine_last_role_image_content: { type: 'image_url', image_url: { url: refs.last }, role: 'last_frame' },
                volcengine_image_contents: [{ type: 'image_url', image_url: { url: refs.role }, role: 'reference_image' }],
                volcengine_video_contents: [{ type: 'video_url', video_url: { url: refs.move }, role: 'reference_video' }],
              },
            },
          },
        })
        return { ok: true, result: r }
      } catch (e) {
        return { ok: false, error: String(e?.message || e) }
      }
    }, { vendorKey, model: MODEL, refs: { first: FIRST, last: LAST, role: ROLE, move: MOVE } })

    if (outcome.ok) {
      const body = seen.arkBody || seen.legacyBody
      const blob = JSON.stringify(body)
      console.log(`  [${label}] 发出去的是 ${seen.arkBody ? '方舟原生' : '通用模板'}报文`)
      console.log(`  [${label}] 首帧=${blob.includes(FIRST)} 尾帧=${blob.includes(LAST)} 角色图=${blob.includes(ROLE)} 参考视频=${blob.includes(MOVE)}`)
      console.log(`  [${label}] ratio/resolution/generate_audio 在不在：${['ratio', 'resolution', 'generate_audio'].map((k) => `${k}=${k in (body || {})}`).join(' ')}`)
    } else {
      console.log(`  [${label}] 被拒发（预期行为）：${outcome.error.replace(/^Error:\s*/, '').slice(0, 200)}`)
      console.log(`  [${label}] vendor 收到请求了吗：${seen.arkBody || seen.legacyBody ? '收到了（不该）' : '零调用 ✓'}`)
    }
  } finally {
    await app.close()
    server.close()
  }
}

await runCase({ label: 'A 富中转', rich: true, port: 8891 })
await runCase({ label: 'B 简中转', rich: false, port: 8892 })
