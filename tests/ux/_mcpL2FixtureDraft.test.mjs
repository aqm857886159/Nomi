// 替身扮 APIMart Seedance 2.5 的两步（样片 → 出高清）：规则照官方页，走查靠它判「出高清有没有重发继承字段」。
// 替身自己先钉住：不合官方规则的请求回 400、不建任务；合规的两步都能走通，一个样片能出多次成片。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startFakeApimartServer } from './_mcpL2Fixture.mjs'

let server
beforeAll(async () => { server = await startFakeApimartServer() }, 60_000)
afterAll(async () => { await server?.close() })

async function post(body) {
  const res = await fetch(`${server.origin}/v1/videos/generations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json() }
}

const DRAFT = { model: 'seedance-2.5', prompt: '一个镜头', resolution: '480p', duration: 5, draft: true }

describe('替身：Seedance 2.5 样片两步', () => {
  it('样片 → 出高清（只带 model / draft_task_id / resolution）走通，同一样片能再出一次', async () => {
    const draft = await post(DRAFT)
    expect(draft.status).toBe(200)
    const draftId = draft.json.data[0].task_id
    const final = await post({ model: 'seedance-2.5', draft_task_id: draftId, resolution: '1080p' })
    expect(final.status).toBe(200)
    expect(final.json.data[0].task_id).not.toBe(draftId)
    expect((await post({ model: 'seedance-2.5', draft_task_id: draftId })).status).toBe(200)
  })

  it('反例：出高清重发提示词 / 时长 / 参考图 → 400，不建任务', async () => {
    const draftId = (await post(DRAFT)).json.data[0].task_id
    const before = server.hits.length
    const res = await post({ model: 'seedance-2.5', draft_task_id: draftId, resolution: '1080p', prompt: '一个镜头', duration: 5, image_urls: ['x'] })
    expect(res.status).toBe(400)
    expect(res.json.error.message).toBe('do not resend inherited fields: duration, image_urls, prompt')
    expect(server.hits.length).toBe(before + 1)
  })

  it('反例：样片号不是样片、已过期、和 draft:true 同发、成片清晰度不对 → 400', async () => {
    const plainId = (await post({ ...DRAFT, draft: undefined })).json.data[0].task_id
    expect((await post({ model: 'seedance-2.5', draft_task_id: plainId })).status).toBe(400)
    const draftId = (await post(DRAFT)).json.data[0].task_id
    expect((await post({ model: 'seedance-2.5', draft_task_id: draftId, draft: true })).status).toBe(400)
    expect((await post({ model: 'seedance-2.5', draft_task_id: draftId, resolution: '720p' })).status).toBe(400)
    server.expireDraft(draftId)
    expect((await post({ model: 'seedance-2.5', draft_task_id: draftId })).json.error.message).toBe(`draft expired: ${draftId}`)
  })

  it('反例：draft:true 配 480p 以外的清晰度 → 400；普通请求不受影响', async () => {
    expect((await post({ ...DRAFT, resolution: '1080p' })).status).toBe(400)
    expect((await post({ model: 'seedance-2.5', prompt: 'p', resolution: '1080p' })).status).toBe(200)
  })
})
