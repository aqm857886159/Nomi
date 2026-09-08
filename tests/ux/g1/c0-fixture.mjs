import fs from 'node:fs'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { flattenRequestText, createAgentRuntimeFixture, FIXTURE_VENDOR } from '../agent-runtime-fixture.mjs'

import { hasToolResult, recorded } from '../agent-runtime-walk-support.mjs'

export const MODEL = 'c0-loopback-video'
export const shots = [
  '小禾背相机来到河边旧街，广角交代傍晚与方向。',
  '小禾放下相机，注意到修鞋摊前飘动的蓝布。',
  '近景，师傅的手抚平小鞋，针线缓缓穿过皮面。',
  '中景，孩子踮脚等待，小禾蹲下安静拍摄。',
  '孩子接过鞋子微笑，小禾在门口点头致谢。',
  '小禾坐在相邻长椅，将素材按相遇、等待、归还排序。',
  '小禾删去多余停顿，屏幕里孩子穿鞋跑向家人。',
  '导出完成，小禾完整播放，合上电脑抬头看夕阳和蓝布。',
].map((prompt, i) => ({ index: i + 1, shotKind: 'video', durationSec: 8,
  anchorIds: [], modelKey: MODEL, modeId: 't2v',
  params: { duration: 8, size: '16:9' }, prompt: `C0-S${i + 1}：${prompt}` }))

// These are deliberately synthetic motion/audio test signals, NOT a pre-made film.
// Each request selects its own shot; results enter the project only through generation.
export async function createC0Fixture(rootDir, settingsDir, mediaDir) {
  const text = await createAgentRuntimeFixture({ rootDir, settingsDir })
  const calls = []
  const sockets = new Set()
  let server
  try {
    fs.mkdirSync(mediaDir, { recursive: true })
    const results = shots.map((shot) => {
      const file = path.join(mediaDir, `shot-${shot.index}.mp4`)
      execFileSync(ffmpeg.path, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
        `testsrc2=size=640x360:rate=24,hue=h=${shot.index * 35}`,
        '-f', 'lavfi', '-i', `sine=frequency=${220 + shot.index * 55}:sample_rate=44100`,
        '-t', String(shot.durationSec), '-c:v', 'libx264', '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', file], { stdio: 'pipe' })
      return `data:video/mp4;base64,${fs.readFileSync(file).toString('base64')}`
    })
    server = http.createServer(async (req, res) => {
      try {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const index = shots.findIndex((shot) => body.prompt?.includes(`C0-S${shot.index}：`))
        if (req.method !== 'POST' || req.url !== '/v1/videos/generations'
          || body.model !== MODEL || index < 0 || calls.includes(index + 1)) {
          res.writeHead(400).end('Unexpected or duplicate C0 generation')
          calls.push('unexpected')
          return
        }
        calls.push(index + 1)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ url: results[index] }] }))
      } catch {
        calls.push('unexpected')
        res.writeHead(400).end('Invalid C0 fixture request')
      }
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const catalogFile = path.join(settingsDir, 'model-catalog.json')
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
    const vendorKey = 'c0-video-loopback'
    catalog.vendors.push({ ...catalog.vendors.find((v) => v.key === FIXTURE_VENDOR),
      key: vendorKey, name: 'C0 zero-cost video', baseUrlHint: `http://127.0.0.1:${server.address().port}` })
    catalog.apiKeysByVendor[vendorKey] = { ...catalog.apiKeysByVendor[FIXTURE_VENDOR], vendorKey }
    catalog.models.push({ modelKey: MODEL, vendorKey, labelZh: 'C0 模拟视频',
      kind: 'video', enabled: true, published: true, meta: { archetypeId: 'wan-2.7' } })
    catalog.mappings.push({ id: 'c0-video-t2v', vendorKey, modelKey: MODEL,
      taskKind: 'text_to_video', name: 'C0 loopback', enabled: true,
      create: { method: 'POST', path: '/v1/videos/generations',
        headers: { 'Content-Type': 'application/json' },
        body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}' },
        response_mapping: { video_url: 'data.0.url' } } })
    fs.writeFileSync(catalogFile, JSON.stringify(catalog))
    return { text, calls, async close() {
      await text.close()
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    } }
  } catch (error) {
    await text.close()
    if (server) {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
    throw error
  }
}

// Provider behavior only; the walk owns every UI action and domain assertion.
export async function createDryScheduler(root, settingsDir, mediaDir, report) {
  const fixture = await createC0Fixture(root, settingsDir, mediaDir)
  let plan, done
  const planId = 'c0-plan-1', reviews = []
  return {
    model: MODEL,
    async attach() {},
    async assertNoGeneration(expect) { expect(fixture.calls).toEqual([]) },
    preparePlan() {
    plan = fixture.text.expectText({ label: 'C0 full script -> plan',
      match: (body) => flattenRequestText(body).includes('小禾') && !hasToolResult(body, planId),
      reply: { type: 'tool', id: planId, name: 'nomi_canvas_plan', args: {
        operation: 'propose_storyboard_plan', title: '日落前的一分钟', anchors: [], shots,
      } },
    })
    done = fixture.text.expectText({ label: 'C0 approved plan terminal', match: (body) => hasToolResult(body, planId),
      reply: { type: 'text', text: 'C0_PLAN_DONE：八镜共64秒，请审阅分镜后生成。' } })
    },
    async planRequested() { await recorded(plan.received, 'C0 planner') },
    async planCompleted({ win, panel, expect }) {
      await recorded(done.received, 'C0 plan result')
      await expect(win.locator(panel)).toContainText('C0_PLAN_DONE')
    },
    verifyPlan(actual, expect) { expect(actual.map((s) => s.prompt)).toEqual(shots.map((s) => s.prompt)) },
    prepareGeneration() {
    for (const shot of shots) reviews.push(fixture.text.expectText({
      label: `C0 synthetic review ${shot.index}`,
      match: (body) => {
        const text = flattenRequestText(body)
        return text.includes('资深影视分镜审片') && text.includes(`镜头意图(提示词)：${shot.prompt}`)
      },
      reply: { type: 'text', text: JSON.stringify({ reason: '零额度测试信号，不能评故事质量；待真实模型验收。', scores: { identity: 0, composition: 0, continuity: 0, action: 0 } }) },
    }))
    },
    async generationCompleted({ expect }) {
      expect([...fixture.calls].sort((a, b) => a - b)).toEqual(shots.map((s) => s.index))
      await Promise.all(reviews.map((r) => recorded(r.received, 'C0 synthetic review')))
    },
    async finish() {
      fixture.text.assertClean()
      report.r30.simulated = { firstTool: '1/1 (100%)', turns: '1/1 (100%)' }
    },
    async close() { await fixture.close(); fixture.text.assertClean() },
  }
}
