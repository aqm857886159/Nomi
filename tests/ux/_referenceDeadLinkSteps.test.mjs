// reference-dead-link 三条走查共用步骤里的纯判据（不起 App、不花钱）：夹具 / 网络闸账本 → 统一观察 → 两个判据。
// 走查本身只在真窗口里跑；这里钉住"什么样的请求算对、什么样算错"，免得到花钱那一刻才发现判据读不出东西。
import { describe, expect, it } from 'vitest'

import { judgeDeadLinkSend, judgeRefusalRetry, observeFixture, observeLedger, writeProviderLink } from './_referenceDeadLinkSteps.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'

const DEAD = 'https://cdn.example.test/fixture/dead-reference.png'
const ALIVE = 'https://cdn.example.test/fixture/image.jpg'
const UPLOADED = 'https://upload.example.test/fixture/upload-1.jpg'
const upload = { fileNames: ['shot-5.jpg'], url: UPLOADED }

describe('judgeDeadLinkSend：失效链接换成上传后的新链接', () => {
  it('恰一笔创建请求、恰一次上传、请求里只有上传换来的地址 → 过', () => {
    const verdict = judgeDeadLinkSend({ creates: [{ imageUrls: [UPLOADED] }], uploads: [upload] }, { deadLink: DEAD })
    expect(verdict.problems).toEqual([])
    expect(verdict.summary).toMatchObject({ createRequests: 1, uploads: 1, sentTheDeadLink: false, allFromUpload: true })
  })

  it('发出去的还是失效链接 → 红', () => {
    const verdict = judgeDeadLinkSend({ creates: [{ imageUrls: [DEAD] }], uploads: [] }, { deadLink: DEAD })
    expect(verdict.problems.join('；')).toMatch(/还是那条失效的临时链接/);
    expect(verdict.problems.join('；')).toMatch(/上传了 0 次/)
  })

  it('请求里混着不是上传换来的地址 / 创建请求不是一笔 / 读不到任何图片地址 → 红', () => {
    expect(judgeDeadLinkSend({ creates: [{ imageUrls: [UPLOADED, ALIVE] }], uploads: [upload] }, { deadLink: DEAD }).problems.join('；')).toMatch(/不是上传换来的/)
    expect(judgeDeadLinkSend({ creates: [], uploads: [upload] }, { deadLink: DEAD }).problems.join('；')).toMatch(/创建请求有 0 笔/)
    expect(judgeDeadLinkSend({ creates: [{ imageUrls: [] }], uploads: [upload] }, { deadLink: DEAD }).problems.join('；')).toMatch(/读不到任何图片地址/)
    expect(judgeDeadLinkSend({ creates: [{ imageUrls: [UPLOADED], truncated: true }], uploads: [upload] }, { deadLink: DEAD }).problems.join('；')).toMatch(/被截断/)
  })
})

describe('judgeRefusalRetry：用户再点一次，仍可发送可读原链', () => {
  it('两次各发一次原链，且无上传', () => {
    const verdict = judgeRefusalRetry({ creates: [{ imageUrls: [ALIVE] }, { imageUrls: [ALIVE] }], uploads: [] }, { aliveLink: ALIVE })
    expect(verdict.problems).toEqual([])
    expect(verdict.summary).toEqual({ createRequests: 2, uploads: 0, firstSentOriginalLink: true, retrySentOriginalLink: true })
  })

  it('旧规则因为被拒而上传 → 红', () => {
    const verdict = judgeRefusalRetry({ creates: [{ imageUrls: [ALIVE] }, { imageUrls: [UPLOADED] }], uploads: [upload] }, { aliveLink: ALIVE })
    expect(verdict.problems).toEqual(['活链被额外上传了 1 次', '再次提交未使用可读原链'])
  })

  it('第一笔没发原链接、只有一笔、请求截断 → 红', () => {
    expect(judgeRefusalRetry({ creates: [{ imageUrls: [UPLOADED] }], uploads: [] }, { aliveLink: ALIVE }).problems).toEqual(expect.arrayContaining(['第一次提交未使用可读原链', expect.stringMatching(/创建请求有 1 笔/)]))
    expect(judgeRefusalRetry({ creates: [{ imageUrls: [ALIVE] }, { imageUrls: [ALIVE], truncated: true }], uploads: [] }, { aliveLink: ALIVE }).problems).toEqual(['再次提交未使用可读原链'])
  })
})

describe('把夹具 / 网络闸账本读成统一观察', () => {
  it('夹具：创建请求里的图片地址去重，上传带文件名和回的地址', () => {
    const observed = observeFixture({
      images: [{ body: { model: 'm', image_urls: [UPLOADED, UPLOADED], nested: { image: DEAD } } }],
      uploads: [{ uploadFileNames: ['shot-5.jpg'], uploadUrl: UPLOADED }],
    })
    expect(observed.creates).toEqual([{ imageUrls: [UPLOADED, DEAD] }])
    expect(observed.uploads).toEqual([{ fileNames: ['shot-5.jpg'], url: UPLOADED }])
  })

  it('账本：只认发往供应商主机的图片创建请求；上传对回同一个 seq 的响应里的公网地址；查询串已被网络闸打码', () => {
    const host = 'api.example.test'
    const entries = [
      { kind: 'allowed-request', seq: 1, host: 'upload.example.test', method: 'POST', url: 'https://upload.example.test/v1/uploads/images', body: { form: [{ name: 'file', fileName: 'shot-5.jpg' }] } },
      { kind: 'allowed-response', seq: 1, text: JSON.stringify({ url: `${UPLOADED}?<redacted>` }) },
      { kind: 'allowed-request', seq: 2, host, method: 'POST', url: `https://${host}/v1/images/generations`, body: { text: JSON.stringify({ image_urls: [`${UPLOADED}?<redacted>`] }) } },
      { kind: 'allowed-request', seq: 3, host, method: 'GET', url: `https://${host}/v1/tasks/abc` },
    ]
    const observed = observeLedger(entries, { host })
    expect(observed.creates).toHaveLength(1)
    expect(observed.uploads).toHaveLength(1)
    expect(judgeDeadLinkSend(observed, { deadLink: DEAD }).problems).toEqual([])
  })
})

describe('writeProviderLink：把参考图的 .meta 写成服务商的临时链接', () => {
  it('保留原有字段，写 kind 和 originalUrl；没有 .meta 就新写一份', () => {
    const root = makeTempDir('nomi-dead-link-steps-')
    try {
      const file = path.join(root, 'a.png')
      expect(writeProviderLink(file, DEAD)).toBe(DEAD)
      expect(JSON.parse(fs.readFileSync(`${file}.meta`, 'utf8'))).toEqual({ kind: 'generated', originalUrl: DEAD })
      fs.writeFileSync(`${file}.meta`, JSON.stringify({ width: 2, height: 2, originalUrl: null }))
      writeProviderLink(file, ALIVE)
      expect(JSON.parse(fs.readFileSync(`${file}.meta`, 'utf8'))).toEqual({ width: 2, height: 2, kind: 'generated', originalUrl: ALIVE })
    } finally {
      cleanupTestTemp(root)
    }
  })
})
