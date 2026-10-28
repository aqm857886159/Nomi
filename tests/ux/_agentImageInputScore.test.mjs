import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { modelImageInputSupport } from '../../electron/ai/agentUserContent'
import { builtinCatalogModelKeys } from '../../electron/catalog/seedBuiltins'
import {
  ASK_CODE, ASK_SCENE, DROPPED_NOTE, MODEL_ID, ROUNDS, VENDOR_KEY,
  assertEvidenceIsClean, codeWordLayout, decodePngLuminance, describeImageParts, errorSurfaceOf, fixtureWireProbe, gaugeProblems, imageBuffersOf,
  imageInputEvidence, journeyFailures, judgeRequestBody, makeCodeWord, netLogWireProbe, readCodeWordFromPng, readPngHeader, readRoundTranscript, renderCodeWordPng, roundSettled,
  scoreRealSize, scoreSawCodeWord, summarizeRounds, userTurnWith, wireFactsFromNetLog, writeEvidenceFile,
} from './_agentImageInputScore.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dataUri = (buffer, mime = 'image/png') => `data:${mime};base64,${buffer.toString('base64')}`
// 形如 OpenAI key 的样本串：运行时拼出来，源码里不留 sk-… 字面量（提交钩子的泄露扫描会把它当真 key 拦下）。
const KEY_SHAPED_SAMPLE = `sk-${'abcdefghijklmnopqrstuvwxyz'}`

describe('暗号：每次运行现生成，4 位随机数字', () => {
  it('形如 NOMI 4817，数字里没有 0 和 1（它们跟 O、I 长得像）', () => {
    for (let draw = 0; draw < 300; draw += 1) expect(makeCodeWord().text).toMatch(/^NOMI [2-9]{4}$/)
  })

  it('注入 pick 就确定：同一串抽签得到同一个暗号，不同抽签得到不同暗号', () => {
    const fixed = (indexes) => { let at = 0; return () => indexes[at++ % indexes.length] }
    expect(makeCodeWord(fixed([2, 6, 7, 1])).text).toBe('NOMI 4893')
    expect(makeCodeWord(fixed([0, 0, 0, 0])).digits).toBe('2222')
    expect(makeCodeWord(fixed([7, 7, 7, 7])).digits).toBe('9999')
  })

  it('随机性：300 次里至少出现 100 个不同的暗号（不是常量，也不是只有几个值）', () => {
    expect(new Set(Array.from({ length: 300 }, () => makeCodeWord().digits)).size).toBeGreaterThan(100)
  })
})

describe('暗号图：画出来的就是这个暗号（量具自检的阳性对照）', () => {
  it('画 → 读回，原样相等（多个暗号、多种点大小）', () => {
    for (const text of ['NOMI 4817', 'NOMI 2222', 'NOMI 9999', 'NOMI 3562', 'NOMI 0159']) {
      for (const dot of [8, 16, 20, 24]) {
        const { png, width, height } = renderCodeWordPng(text, { dot })
        expect(codeWordLayout(text, dot)).toMatchObject({ width, height })
        expect(readCodeWordFromPng(png)).toBe(text)
      }
    }
  })

  it('是合法的 8 位灰度 PNG，黑字白底，字比底少', () => {
    const { png, width, height } = renderCodeWordPng('NOMI 4817')
    const decoded = decodePngLuminance(png)
    expect(decoded).toMatchObject({ width, height })
    const black = decoded.luminance.filter((value) => value === 0).length
    const white = decoded.luminance.filter((value) => value === 255).length
    expect(black + white).toBe(width * height)
    expect(black).toBeGreaterThan(0)
    expect(black).toBeLessThan(white)
  })

  it('读得出的是画的那个：画 4817 读不出 4818，换一个数字就换一张图', () => {
    const left = renderCodeWordPng('NOMI 4817').png
    const right = renderCodeWordPng('NOMI 4818').png
    expect(left.equals(right)).toBe(false)
    expect(readCodeWordFromPng(left)).not.toBe('NOMI 4818')
    expect(readCodeWordFromPng(right)).toBe('NOMI 4818')
  })

  it('PNG 头只读开头 33 字节：宽、高、位深、色型；不是 PNG 就抛（真帧是 16 位 PNG，要如实记下）', () => {
    const { png, width, height } = renderCodeWordPng('NOMI 4817')
    expect(readPngHeader(png.subarray(0, 33))).toEqual({ width, height, bitDepth: 8, colorType: 0 })
    const sixteenBit = Buffer.from(png.subarray(0, 33))
    sixteenBit.writeUInt32BE(3840, 16)
    sixteenBit.writeUInt32BE(2160, 20)
    sixteenBit[24] = 16
    sixteenBit[25] = 2
    expect(readPngHeader(sixteenBit)).toEqual({ width: 3840, height: 2160, bitDepth: 16, colorType: 2 })
    expect(() => readPngHeader(Buffer.from('GIF89a'.padEnd(40, 'x')))).toThrow('不是 PNG')
    expect(() => readPngHeader(Buffer.alloc(10))).toThrow('不是 PNG')
  })

  it('读不出的图就抛，不猜：不是 PNG、被截断的 PNG、点阵里没有的字符', () => {
    expect(() => readCodeWordFromPng(Buffer.from('not a png'))).toThrow()
    // 上传被截断的图（只剩前 40 字节）：没有像素可读
    expect(() => readCodeWordFromPng(renderCodeWordPng('NOMI 4817').png.subarray(0, 40))).toThrow()
    expect(() => renderCodeWordPng('NOMI x817')).toThrow('点阵里没有字符')
    // 全是空格的图读成全空格，而不是读成某个暗号
    expect(readCodeWordFromPng(renderCodeWordPng('     ', { dot: 8 }).png)).toBe('     ')
  })
})

describe('请求体读法：三种协议', () => {
  const png = renderCodeWordPng('NOMI 4817').png
  const text = (ask) => `${ask}\n\n[Selected original media references]\n[{"reference":"@image1"}]`
  const openai = (ask, images = [png]) => ({
    model: MODEL_ID,
    messages: [
      { role: 'system', content: 'You are Nomi.' },
      { role: 'user', content: [{ type: 'text', text: text(ask) }, ...images.map((image) => ({ type: 'image_url', image_url: { url: dataUri(image) } }))] },
    ],
  })
  const responses = (ask) => ({ model: MODEL_ID, input: [{ role: 'user', content: [{ type: 'input_text', text: text(ask) }, { type: 'input_image', image_url: dataUri(png) }] }] })
  const anthropic = (ask) => ({ model: MODEL_ID, messages: [{ role: 'user', content: [{ type: 'text', text: text(ask) }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }] }] })

  it.each([['openai-compatible', openai, 'image_url'], ['responses', responses, 'input_image'], ['anthropic', anthropic, 'image']])('%s：有图片部件、没有那句注 = ok，字节数对得上', (_, build, type) => {
    const verdict = judgeRequestBody(build(ASK_CODE), ASK_CODE)
    expect(verdict).toMatchObject({ found: true, ok: true, droppedNote: false, why: null })
    expect(verdict.images).toEqual([{ type, mime: 'image/png', bytes: png.length }])
  })

  it('图被丢掉的两种长相都判红：用户消息里只剩文字，或文字里附了「图片未发送」', () => {
    const noImage = judgeRequestBody(openai(ASK_CODE, []), ASK_CODE)
    expect(noImage).toMatchObject({ found: true, ok: false, droppedNote: false, images: [], why: '用户消息里没有图片部件' })
    const dropped = { messages: [{ role: 'user', content: [{ type: 'text', text: `${ASK_CODE}\n\n（注：1 ${DROPPED_NOTE}——当前模型不支持图片输入或读取失败。）` }] }] }
    expect(judgeRequestBody(dropped, ASK_CODE)).toMatchObject({ found: true, ok: false, droppedNote: true })
    expect(judgeRequestBody(dropped, ASK_CODE).why).toContain(DROPPED_NOTE)
    // 图在、注也在（不该同时出现，但出现了就是红）
    const both = { messages: [{ role: 'user', content: [{ type: 'text', text: `${ASK_CODE} ${DROPPED_NOTE}` }, { type: 'image_url', image_url: { url: dataUri(png) } }] }] }
    expect(judgeRequestBody(both, ASK_CODE).ok).toBe(false)
  })

  it('用户消息内容是纯字符串（没有部件）也读得出话，且判没图', () => {
    const body = { messages: [{ role: 'user', content: ASK_CODE }] }
    expect(userTurnWith(body, ASK_CODE)).toBe(body.messages[0])
    expect(judgeRequestBody(body, ASK_CODE)).toMatchObject({ found: true, ok: false, images: [] })
  })

  it('找不到带这句话的用户消息 = found:false；取的是最后一条带这句话的', () => {
    expect(judgeRequestBody(openai(ASK_SCENE), ASK_CODE)).toMatchObject({ found: false, ok: false })
    expect(judgeRequestBody({}, ASK_CODE)).toMatchObject({ found: false, ok: false })
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: ASK_CODE }] }, { role: 'assistant', content: 'x' }, openai(ASK_CODE).messages[1]] }
    expect(judgeRequestBody(body, ASK_CODE).ok).toBe(true)
  })

  it('字节数按 base64 的填充算，不解码', () => {
    for (const length of [1, 2, 3, 4, 5, 100]) {
      const buffer = Buffer.alloc(length, 7)
      expect(describeImageParts([{ type: 'image_url', image_url: { url: dataUri(buffer) } }])[0].bytes).toBe(length)
    }
    expect(describeImageParts([{ type: 'image_url', image_url: { url: 'https://example.invalid/a.png' } }])).toEqual([{ type: 'image_url', mime: null, bytes: null, remoteUrl: true }])
    expect(describeImageParts('不是数组')).toEqual([])
  })

  it('夹具大脑拿到的字节和发出去的一模一样：能从请求体里把暗号读回来', () => {
    for (const build of [openai, responses, anthropic]) {
      const [received] = imageBuffersOf(userTurnWith(build(ASK_CODE), ASK_CODE).content)
      expect(received.equals(png)).toBe(true)
      expect(readCodeWordFromPng(received)).toBe('NOMI 4817')
    }
  })
})

describe('付费走查读网络闸账本（只下看见了什么的结论）', () => {
  const entry = (text, overrides = {}) => ({ kind: 'allowed-request', via: 'fetch', seq: 1, method: 'POST', url: 'https://api.apimart.ai/v1/chat/completions', host: 'api.apimart.ai', body: { text, truncated: true }, ...overrides })
  const prefix = (ask, tail) => `{"model":"gpt-5-mini","messages":[{"role":"system","content":"x"},{"role":"user","content":[{"type":"text","text":"${ask}"}${tail}`

  it('前缀里有那句话又有图片部件 = image-in-request；有那句注 = dropped-note；其余 unknown', () => {
    const withImage = wireFactsFromNetLog([entry(prefix(ASK_CODE, ',{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBOR'))], { host: 'api.apimart.ai', ask: ASK_CODE })
    expect(withImage).toMatchObject({ requests: 1, askInPrefix: 1, imagePartInPrefix: 1, droppedNoteInPrefix: 0, truncated: 1, verdict: 'image-in-request' })
    const withNote = wireFactsFromNetLog([entry(prefix(`${ASK_CODE}（注：1 ${DROPPED_NOTE}——…）`, ']}]}'))], { host: 'api.apimart.ai', ask: ASK_CODE })
    expect(withNote).toMatchObject({ droppedNoteInPrefix: 1, imagePartInPrefix: 0, verdict: 'dropped-note' })
    // 前缀没盖到那句话（系统提示太长）、别家主机、别的路径、GET：都不下结论
    const cutOff = wireFactsFromNetLog([entry('{"model":"gpt-5-mini","messages":[{"role":"system","content":"很长很长'), entry(prefix(ASK_CODE, ',{"type":"image_url"'), { host: 'other.invalid' }), entry(prefix(ASK_CODE, ',{"type":"image_url"'), { url: 'https://api.apimart.ai/v1/models' }), entry(prefix(ASK_CODE, ',{"type":"image_url"'), { method: 'GET' })], { host: 'api.apimart.ai', ask: ASK_CODE })
    expect(cutOff).toMatchObject({ askInPrefix: 0, verdict: 'unknown' })
    // 不点主机就不按主机筛（付费走查里放行名单只有被授权的那一家，用户目录里的线路是哪个主机不由走查猜）
    expect(wireFactsFromNetLog([entry(prefix(ASK_CODE, ',{"type":"image_url"'), { host: 'other.invalid' })], { ask: ASK_CODE }).verdict).toBe('image-in-request')
    expect(wireFactsFromNetLog([entry(prefix(ASK_CODE, ',{"type":"image_url"'), { host: 'other.invalid' })], { host: 'api.apimart.ai', ask: ASK_CODE }).verdict).toBe('unknown')
    expect(wireFactsFromNetLog([], { host: 'api.apimart.ai', ask: ASK_CODE })).toMatchObject({ requests: 0, verdict: 'unknown' })
    expect(wireFactsFromNetLog(undefined, { host: 'api.apimart.ai', ask: ASK_CODE }).verdict).toBe('unknown')
  })
})

describe('请求体从哪读：演练读夹具的完整请求，真付费读账本', () => {
  const png = renderCodeWordPng('NOMI 4817').png
  const withImage = (ask) => ({ messages: [{ role: 'user', content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: dataUri(png) } }] }] })
  const withoutImage = (ask) => ({ messages: [{ role: 'user', content: [{ type: 'text', text: ask }] }] })
  const withNote = (ask) => ({ messages: [{ role: 'user', content: [{ type: 'text', text: `${ask}\n\n（注：1 ${DROPPED_NOTE}——当前模型不支持图片输入或读取失败。）` }] }] })
  const probe = (...bodies) => fixtureWireProbe({ requests: bodies.map((body) => ({ body })) })(ROUNDS[0])

  it('每个带这一轮那句话的请求都有图 = image-in-request，并带出图片部件的 type / mime / 字节数', () => {
    expect(probe(withImage(ASK_CODE))).toEqual({ source: 'fixture', verdict: 'image-in-request', requests: 1, images: [{ type: 'image_url', mime: 'image/png', bytes: png.length }], droppedNote: false, why: null })
    expect(probe(withImage(ASK_CODE), withImage(ASK_CODE)).requests).toBe(2)
  })

  it('请求里没图 = no-image，带那句注 = dropped-note，一个请求都没有 = unknown（不当绿）', () => {
    expect(probe(withoutImage(ASK_CODE))).toMatchObject({ verdict: 'no-image', why: '用户消息里没有图片部件' })
    expect(probe(withNote(ASK_CODE))).toMatchObject({ verdict: 'dropped-note', droppedNote: true })
    expect(probe()).toMatchObject({ verdict: 'unknown', requests: 0, images: [] })
  })

  it('只要有一个请求丢了图就判红，不是只看第一个；别的轮的请求、没读完的请求不算', () => {
    expect(probe(withImage(ASK_CODE), withoutImage(ASK_CODE)).verdict).toBe('no-image')
    expect(probe(withImage(ASK_CODE), withNote(ASK_CODE)).verdict).toBe('dropped-note')
    expect(probe(withImage(ASK_CODE), withoutImage(ASK_SCENE), null, undefined).verdict).toBe('image-in-request')
  })

  it('真付费读账本：按这一轮的话筛，读 paid.readAllowedRequests()', () => {
    const entry = (text) => ({ kind: 'allowed-request', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/chat/completions', body: { text, truncated: true } })
    const paid = { readAllowedRequests: () => [entry(`{"messages":[{"role":"user","content":[{"type":"text","text":"${ASK_CODE}"},{"type":"image_url"`)] }
    expect(netLogWireProbe(paid)(ROUNDS[0])).toMatchObject({ source: 'net-log', verdict: 'image-in-request', askInPrefix: 1 })
    expect(netLogWireProbe(paid)(ROUNDS[1])).toMatchObject({ verdict: 'unknown', askInPrefix: 0 })
  })
})

describe('这一场的红绿', () => {
  const green = () => ({
    gaugeProblems: [], hard: [],
    rounds: [
      { id: 'sees-code', score: { saw: true }, finalAnswer: 'NOMI 4817', errorSurface: null, wire: { verdict: 'image-in-request' } },
      { id: 'real-size', score: { ok: true }, finalAnswer: '一张街景', errorSurface: null, wire: { verdict: 'image-in-request' } },
    ],
  })

  it('全绿 = 空；缺一轮、第 1 轮没认出、第 2 轮不 ok、量具问题、硬断言，各自点名', () => {
    expect(journeyFailures(green())).toEqual([])
    expect(journeyFailures({ ...green(), rounds: [] })).toEqual(['第 1 轮没有跑', '第 2 轮没有跑'])
    const missed = green()
    missed.rounds[0] = { id: 'sees-code', score: { saw: false }, finalAnswer: '我这边没有看到图片', errorSurface: null }
    missed.rounds[1] = { id: 'real-size', score: { ok: false, why: '走了错误面：助手消息 stopReason=error：413' } }
    missed.gaugeProblems = ['第 2 轮（真尺寸）超时没落地（已按停止）']
    missed.hard = [{ id: 'tier-unknown', ok: false, detail: '判成了 unsupported' }, { id: 'real-size:wire', ok: true, detail: null }]
    const failures = journeyFailures(missed)
    expect(failures).toHaveLength(4)
    expect(failures[0]).toBe('量具：第 2 轮（真尺寸）超时没落地（已按停止）')
    expect(failures[1]).toBe('硬断言 tier-unknown：判成了 unsupported')
    expect(failures[2]).toContain('第 1 轮没认出暗号（回答："我这边没有看到图片"')
    expect(failures[3]).toBe('第 2 轮不 ok：走了错误面：助手消息 stopReason=error：413')
  })

  it('演练要求两轮的请求体都读到了图片部件：unknown 也红；真付费不要求（账本前缀读不到不判红）', () => {
    const unread = green()
    unread.rounds[1].wire = { verdict: 'unknown' }
    unread.rounds[0].wire = undefined
    expect(journeyFailures(unread)).toEqual([])
    expect(journeyFailures(unread, { requireWire: true })).toEqual([
      'sees-code：请求体里没读到图片部件（没读请求体）', 'real-size：请求体里没读到图片部件（unknown）',
    ])
  })
})

describe('证据摘要', () => {
  const images = { codeWord: { text: 'NOMI 4817' }, code: { bytes: 3235, width: 1180, height: 260, file: '/tmp/secret-path/nomi-code.png' }, real: { bytes: 29_703_774, width: 3840, height: 2160, bitDepth: 16, colorType: 2, attachCapBytes: 31_457_280, source: '登记表', file: '/tmp/secret-path/reference-4k.png' } }
  const walk = { report: { spend: { text: { replies: 2 }, media: [] }, networkBlocked: [], outputDir: path.join(repoRoot, '.tmp/pi-agent-image-input-real-1') } }
  const journey = () => ({ model: { modelKey: MODEL_ID, imageInputTier: 'unknown' }, hard: [], gaugeProblems: [], numbers: { rounds: 2 }, shots: ['01-a.png'], rounds: [
    { id: 'sees-code', score: { saw: true }, wire: { verdict: 'image-in-request' } }, { id: 'real-size', score: { ok: true }, wire: { verdict: 'image-in-request' } },
  ] })
  const evidence = (overrides = {}) => imageInputEvidence({ script: 's.mjs', mode: 'rehearsal', startedAt: 't0', journey: journey(), walk, failure: undefined, images, buildMarker: 'm', model: `apimart/${MODEL_ID}`, ...overrides })

  it('全绿 = passed；带出手填那一行的事实、数字、截图名；只留图的尺寸，不带路径、不带图本身', () => {
    const report = evidence()
    expect(report).toMatchObject({ result: 'passed', failure: null, failures: [], codeWord: 'NOMI 4817', model: 'apimart/gpt-5-mini', screenshots: ['01-a.png'], walkOutputDir: '.tmp/pi-agent-image-input-real-1' })
    expect(report.handTypedModel).toEqual({ modelKey: MODEL_ID, imageInputTier: 'unknown' })
    expect(report.images).toEqual({ code: { bytes: 3235, width: 1180, height: 260 }, real: { bytes: 29_703_774, width: 3840, height: 2160, bitDepth: 16, colorType: 2, attachCapBytes: 31_457_280, source: '登记表' } })
    expect(JSON.stringify(report)).not.toContain('secret-path')
    expect(() => assertEvidenceIsClean(JSON.stringify(report))).not.toThrow()
  })

  it('有红的轮或抛出的异常 = failed；演练要求请求体时 unknown 也算红', () => {
    const missed = journey()
    missed.rounds[0].score.saw = false
    expect(evidence({ journey: missed })).toMatchObject({ result: 'failed', failures: [expect.stringContaining('第 1 轮没认出暗号')] })
    expect(evidence({ failure: new Error('点不到「+」') })).toMatchObject({ result: 'failed', failure: '点不到「+」', failures: [] })
    const unread = journey()
    unread.rounds[1].wire = { verdict: 'unknown' }
    expect(evidence({ journey: unread }).result).toBe('passed')
    expect(evidence({ journey: unread, requireWire: true }).result).toBe('failed')
  })
})

describe('转录：这一轮发了什么、答了什么、有没有停在错误上', () => {
  const session = (...messages) => [{ entries: messages.map((message) => ({ type: 'message', message })) }]
  const user = (text, attachments = [{ assetId: 'asset-1', version: 1 }]) => ({ role: 'nomi.input', content: [{ type: 'text', text }], context: { attachments } })
  const answer = (text, extra = {}) => ({ role: 'assistant', provider: 'apimart', model: MODEL_ID, stopReason: 'stop', content: [{ type: 'text', text }], usage: { input: 1200, output: 14 }, ...extra })

  it('用户消息的附件声明数、最终回答、模型、用量', () => {
    const read = readRoundTranscript(session(user(ASK_CODE), answer('NOMI 4817')))
    expect(read).toMatchObject({ finalAnswer: 'NOMI 4817', stopReason: 'stop', errorMessage: null, models: ['apimart/gpt-5-mini'], toolCalls: [], usage: { input: 1200, output: 14 } })
    expect(read.users).toEqual([{ text: ASK_CODE, attachmentClaims: 1 }])
  })

  it('停在工具调用上 = 没有最终回答、没落地；停在 error 上 = 落地了但走了错误面', () => {
    const calling = session(user(ASK_CODE), { role: 'assistant', provider: 'apimart', model: MODEL_ID, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'c1', name: 'look_at_media', arguments: {} }] })
    expect(readRoundTranscript(calling)).toMatchObject({ finalAnswer: '', toolCalls: ['look_at_media'] })
    expect(roundSettled(calling)).toBe(false)
    const failed = session(user(ASK_SCENE), answer('', { stopReason: 'error', errorMessage: '413 Request Entity Too Large', content: [] }))
    expect(roundSettled(failed)).toBe(true)
    expect(readRoundTranscript(failed)).toMatchObject({ finalAnswer: '', stopReason: 'error', errorMessage: '413 Request Entity Too Large' })
    expect(roundSettled(session(user(ASK_CODE)))).toBe(false)
    expect(roundSettled([])).toBe(false)
  })

  it('错误原文里形如 key 的串被抹掉，且截短', () => {
    const read = readRoundTranscript(session(user(ASK_SCENE), answer('', { stopReason: 'error', errorMessage: `401 Bearer ${'a'.repeat(40)} rejected ${'x'.repeat(900)}`, content: [] })))
    expect(read.errorMessage).not.toMatch(/a{40}/)
    expect(read.errorMessage.length).toBeLessThanOrEqual(420)
  })

  it('没带附件声明的用户消息读成 0（发出去的话里根本没挂图）', () => {
    expect(readRoundTranscript(session({ role: 'user', content: ASK_CODE }, answer('x'))).users[0].attachmentClaims).toBe(0)
  })
})

describe('判分', () => {
  const codeWord = { prefix: 'NOMI', digits: '4817', text: 'NOMI 4817' }

  it('第 1 轮：前缀对且 4 位数字按位置至少对 3 位 = 看见了；全对另记', () => {
    for (const answer of ['NOMI 4817', 'NOMI 4811', 'nomi-4817', 'NOMI4817', '暗号是 NOMI 4817。', '「NOMI 4817」']) {
      expect(scoreSawCodeWord({ answer, codeWord }).saw, answer).toBe(true)
    }
    expect(scoreSawCodeWord({ answer: 'NOMI 4817', codeWord }).fullCodeEchoed).toBe(true)
    expect(scoreSawCodeWord({ answer: 'NOMI 4811', codeWord }).fullCodeEchoed).toBe(false)
    expect(scoreSawCodeWord({ answer: 'NOMI 4362', codeWord: { prefix: 'NOMI', digits: '4862', text: 'NOMI 4862' } })).toMatchObject({ saw: true, fullCodeEchoed: false })
  })

  it('第 1 轮：只对 2 位或前缀错 = 没看见', () => {
    for (const answer of ['NOMI 4899', 'NOMI 1234', 'NOIM 4817', '4862']) {
      expect(scoreSawCodeWord({ answer, codeWord }).saw, answer).toBe(false)
    }
  })

  it('第 1 轮：没回答或没有前缀 = 没看见（阴性对照，判分不是恒真）', () => {
    for (const answer of ['我这边没有看到图片', '', '   ', undefined, null, 'NOMI']) {
      expect(scoreSawCodeWord({ answer, codeWord }).saw, String(answer)).toBe(false)
    }
    // 提问那一句本身不含暗号：模型照抄问题也过不了
    expect(scoreSawCodeWord({ answer: ASK_CODE, codeWord }).saw).toBe(false)
  })

  it('第 2 轮：没走错误面且回答非空 = ok；错误面或空回答 = 不 ok', () => {
    expect(scoreRealSize({ answer: '一张街景照片，路边有行人。', errorSurface: null })).toMatchObject({ ok: true, deniesImage: false, why: null })
    expect(scoreRealSize({ answer: '', errorSurface: null })).toMatchObject({ ok: false, why: '回答是空的' })
    expect(scoreRealSize({ answer: '   ', errorSurface: null }).ok).toBe(false)
    const refused = scoreRealSize({ answer: '一张街景', errorSurface: '助手消息 stopReason=error：413' })
    expect(refused.ok).toBe(false)
    expect(refused.why).toContain('走了错误面')
  })

  it('第 2 轮：回答非空却像是没收到图，另标 deniesImage（旁注，不改 ok）', () => {
    for (const answer of ['我这边看不到图片，只能读到文件本身。', '没有收到任何图片。', 'I cannot see any image attached.', 'No image was attached.', '无法查看这张图']) {
      expect(scoreRealSize({ answer, errorSurface: null }), answer).toMatchObject({ ok: true, deniesImage: true })
    }
  })

  it('错误面：面板错误带有字，或助手消息停在 error', () => {
    expect(errorSurfaceOf({ errorBar: null, stopReason: 'stop', errorMessage: null })).toBeNull()
    expect(errorSurfaceOf({ errorBar: '请求失败 413', stopReason: 'stop', errorMessage: null })).toContain('面板错误带')
    expect(errorSurfaceOf({ errorBar: null, stopReason: 'error', errorMessage: 'too large' })).toContain('too large')
    expect(errorSurfaceOf({ errorBar: null, stopReason: 'error', errorMessage: null })).toContain('stopReason=error')
  })
})

describe('量具自己的问题与汇总', () => {
  const good = (overrides = {}) => ({ index: 1, id: 'sees-code', name: '看得见', harnessError: null, settle: { timedOut: false, interventions: [] }, sessions: 1, attachmentClaims: 1, models: ['apimart/gpt-5-mini'], ...overrides })

  it('干净的两轮没有问题', () => {
    expect(gaugeProblems([good(), good({ index: 2, id: 'real-size', name: '真尺寸' })], { expectedModelKey: MODEL_ID })).toEqual([])
  })

  it('量具出错、超时、介入卡、没有转录、附件声明不是 1 个、答话的不是被授权的模型，都点名', () => {
    const problems = gaugeProblems([
      good({ harnessError: '点不到「+」' }),
      good({ index: 2, settle: { timedOut: true, interventions: ['spend'] }, sessions: 0, attachmentClaims: 0, models: ['apimart/deepseek-v4-pro'] }),
    ], { expectedModelKey: MODEL_ID })
    expect(problems).toHaveLength(6)
    expect(problems.join('\n')).toMatch(/量具出错.*点不到/)
    expect(problems.join('\n')).toMatch(/超时没落地/)
    expect(problems.join('\n')).toMatch(/介入卡 spend/)
    expect(problems.join('\n')).toMatch(/没有新的 lane 转录/)
    expect(problems.join('\n')).toMatch(/0 个附件声明/)
    expect(problems.join('\n')).toMatch(/不是 gpt-5-mini：apimart\/deepseek-v4-pro/)
  })

  it('汇总：两轮各一个结论，错误面与量具错误计数', () => {
    const rounds = [
      { id: 'sees-code', score: { saw: true, fullCodeEchoed: true }, errorSurface: null, harnessError: null },
      { id: 'real-size', score: { ok: false, deniesImage: false }, errorSurface: '助手消息 stopReason=error', harnessError: null },
    ]
    expect(summarizeRounds(rounds)).toEqual({ rounds: 2, sawCodeWord: true, fullCodeEchoed: true, realSizeOk: false, realSizeDeniesImage: false, errorSurfaceRounds: 1, harnessErrors: 0 })
    expect(summarizeRounds([])).toMatchObject({ rounds: 0, sawCodeWord: null, realSizeOk: null })
  })

  it('场景表：两轮，句子逐字照任务书', () => {
    expect(ROUNDS.map((round) => [round.id, round.ask])).toEqual([['sees-code', '图里写的暗号是什么？只回暗号'], ['real-size', '用一句话说这张图里有什么']])
  })
})

describe('证据落盘：不许有钥匙、图片数据、本机路径', () => {
  it('形如 key 的串、调用方给的 key 原串、内联图片数据、超长文本都拒绝', () => {
    expect(() => assertEvidenceIsClean(`{"a":"${KEY_SHAPED_SAMPLE}"}`)).toThrow('形如 key')
    expect(() => assertEvidenceIsClean('{"a":"Bearer abcdefghijklmnopqrstuvwxyz0123"}')).toThrow('形如 key')
    expect(() => assertEvidenceIsClean('{"a":"my-real-secret-value"}', ['my-real-secret-value'])).toThrow('key 原串')
    expect(() => assertEvidenceIsClean('{"a":"data:image/png;base64,AAAA"}')).toThrow('内联的图片数据')
    expect(() => assertEvidenceIsClean(`{"a":"${'A'.repeat(2500)}"}`)).toThrow('内联的图片数据')
    expect(() => assertEvidenceIsClean(`{"a":"${'好'.repeat(200_001)}"}`)).toThrow('超过摘要上限')
    expect(() => assertEvidenceIsClean('{"a":"短于八位的 secret 不作比对"}', ['short'])).not.toThrow()
    expect(() => assertEvidenceIsClean('{"result":"passed","numbers":{"sawCodeWord":true}}', ['rehearsal-fake-key-0123456789abcdef'])).not.toThrow()
  })

  it('写成 <repo>/<name>/report.json，路径里的仓库根与家目录被换掉；拒绝时不落盘', () => {
    const dir = makeTempDir('agent-image-input-evidence-')
    const written = writeEvidenceFile('rehearsal/report.json', { note: '/work/repo/tests/ux/a.mjs 与 /home/me/x', n: 1 }, { dir, repoRoot: '/work/repo', home: '/home/me' })
    expect(written).toBe(path.relative('/work/repo', path.join(dir, 'rehearsal/report.json')))
    const text = fs.readFileSync(path.join(dir, 'rehearsal/report.json'), 'utf8')
    expect(JSON.parse(text)).toEqual({ note: '<repo>/tests/ux/a.mjs 与 ~/x', n: 1 })
    expect(() => writeEvidenceFile('paid/report.json', { leaked: KEY_SHAPED_SAMPLE }, { dir })).toThrow('形如 key')
    expect(fs.existsSync(path.join(dir, 'paid/report.json'))).toBe(false)
    expect(() => writeEvidenceFile('paid/report.json', { leaked: 'rehearsal-fake-key-0123456789abcdef' }, { dir, secrets: ['rehearsal-fake-key-0123456789abcdef'] })).toThrow('key 原串')
    expect(fs.existsSync(path.join(dir, 'paid/report.json'))).toBe(false)
  })
})

describe('这条走查的前提钉在产品代码上', () => {
  it('手填的那一行落在「不知道」档：不是 APIMart 的种子行，手填也没有读图声明', () => {
    expect(builtinCatalogModelKeys(VENDOR_KEY).has(MODEL_ID)).toBe(false)
    expect(modelImageInputSupport({ vendorKey: VENDOR_KEY, modelKey: MODEL_ID, meta: { onboarding: { addedVia: 'manual' } } })).toBe('unknown')
    // 对照：同一家的内置纯文本种子行是「不能」，显式声明的行照声明——判据只认声明，不认名字
    expect(modelImageInputSupport({ vendorKey: VENDOR_KEY, modelKey: 'deepseek-v4-pro', meta: undefined })).toBe('unsupported')
    expect(modelImageInputSupport({ vendorKey: VENDOR_KEY, modelKey: MODEL_ID, meta: { supportsImageInput: false } })).toBe('unsupported')
    expect(modelImageInputSupport({ vendorKey: VENDOR_KEY, modelKey: MODEL_ID, meta: { supportsImageInput: true } })).toBe('supported')
  })

  it('图被丢时发给模型的那句注，仍是产品里写的那一句', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'electron/ai/agentUserContent.ts'), 'utf8')
    expect(source).toContain(DROPPED_NOTE)
  })

  it('构建标记是本 PR 产品源码里的固定字面量，改前没有', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'electron/video/deconstructVisionLeg.ts'), 'utf8')
    expect(source).toContain('Model does not accept image input:')
  })
})
