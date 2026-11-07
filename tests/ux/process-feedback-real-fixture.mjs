import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { createAgentRuntimeFixture, FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'

// Only the supplier is synthetic; queued/running/localization remain production paths.
export async function createProcessFixture(root, settingsDir) {
  const seed = await createAgentRuntimeFixture({ rootDir: root, settingsDir })
  await seed.close()
  const media = await fs.readFile(path.join(root, 'resources/onboarding-demo/shot-4.jpg'))
  const video = await fs.readFile(path.join(root, 'electron/providerAdapter/__fixtures__/certification-media/valid.mp4'))
  const jobs = []
  // 走查造「查询断连」用：查询连接直接断开，提交不受影响。
  let queryFault = false
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = JSON.parse(Buffer.concat(chunks))
      const job = { id: `pf-${jobs.length}`, body, done: false, queries: 0 }
      jobs.push(job)
      res.end(JSON.stringify({ id: job.id, status: 'running' }))
    } else {
      const job = jobs.find(j => req.url.endsWith(j.id))
      if (!job) { res.writeHead(404).end('{}'); return }
      job.queries++
      if (queryFault) { res.destroy(); return }
      res.end(JSON.stringify({ id: job.id, status: job.done ? 'succeeded' : 'running',
        ...(job.done ? { url: job.body.model === 'pf-video' ? `data:video/mp4;base64,${video.toString('base64')}` : `data:image/jpeg;base64,${media.toString('base64')}` } : {}) }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const file = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(await fs.readFile(file, 'utf8'))
  catalog.vendors[0].baseUrlHint = `http://127.0.0.1:${server.address().port}`
  catalog.models = catalog.models.filter(m => m.kind === 'image')
  catalog.models.push({ ...catalog.models[0], modelKey: 'pf-video', labelZh: 'Fixture 视频', kind: 'video', meta: { archetypeId: 'wan-2.7' } })
  catalog.mappings = [['agent-runtime-image', 'text_to_image'], ['agent-runtime-image', 'image_edit'], ['pf-video', 'text_to_video']].map(([modelKey, taskKind]) => ({
    id: `${modelKey}-${taskKind}`, vendorKey: FIXTURE_VENDOR, modelKey, taskKind, enabled: true, name: 'Process loopback',
    create: { method: 'POST', path: '/jobs', headers: { 'Content-Type': 'application/json' },
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}' },
      response_mapping: { task_id: 'id', status: 'status' }, provider_meta_mapping: { task_id: 'id' } },
    query: { method: 'GET', path: '/jobs/{{providerMeta.task_id}}', response_mapping: { task_id: 'id', status: 'status', [taskKind === 'text_to_video' ? 'video_url' : 'image_url']: 'url' } },
  }))
  await fs.writeFile(file, JSON.stringify(catalog))
  return { jobs, origin: catalog.vendors[0].baseUrlHint, setQueryFault(on) { queryFault = on }, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
