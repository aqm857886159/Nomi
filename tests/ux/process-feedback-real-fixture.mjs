import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createAgentRuntimeFixture, FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'

// Only the supplier is synthetic; queued/running/localization remain production paths.
export async function createProcessFixtureServer({ media = Buffer.alloc(0), video = Buffer.alloc(0), onPostInitiated } = {}) {
  const jobs = []
  // 在 HTTP 入口收到 POST 的第一时间（读 body 之前）同步登记每笔提交的到达时刻与单调序号，
  // 杜绝「确认前已发起但晚读完 body 才记入 jobs」造成的确认前计数假绿（#1705 复盘）。
  const postEvents = []
  let nextPostSeq = 0
  let inFlightPosts = 0
  // 走查造「查询断连」用：查询连接直接断开，提交不受影响。
  let queryFault = false
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST') {
      const event = {
        seq: ++nextPostSeq,
        receivedAt: performance.now(),
        wallTimeMs: Date.now(),
        url: req.url ?? '',
        recorded: false,
        jobId: null,
      }
      postEvents.push(event)
      inFlightPosts += 1
      onPostInitiated?.(event)
      try {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const body = JSON.parse(Buffer.concat(chunks))
        const job = { id: `pf-${jobs.length}`, body, done: false, queries: 0, seq: event.seq, receivedAt: event.receivedAt }
        jobs.push(job)
        event.recorded = true
        event.jobId = job.id
        res.end(JSON.stringify({ id: job.id, status: 'running' }))
      } catch (error) {
        if (!res.writableEnded) {
          res.writeHead(400).end(JSON.stringify({ error: String(error?.message || error) }))
        }
      } finally {
        inFlightPosts -= 1
      }
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
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    jobs,
    postEvents,
    postInitiatedAt: () => postEvents.map(event => event.receivedAt),
    inFlightPosts: () => inFlightPosts,
    origin,
    setQueryFault(on) { queryFault = on },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}

export async function createProcessFixture(root, settingsDir) {
  const seed = await createAgentRuntimeFixture({ rootDir: root, settingsDir })
  await seed.close()
  const media = await fs.readFile(path.join(root, 'resources/onboarding-demo/shot-4.jpg'))
  const video = await fs.readFile(path.join(root, 'electron/providerAdapter/__fixtures__/certification-media/valid.mp4'))
  const fixture = await createProcessFixtureServer({ media, video })
  const file = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(await fs.readFile(file, 'utf8'))
  catalog.vendors[0].baseUrlHint = fixture.origin
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
  return fixture
}
