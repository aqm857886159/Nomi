// 「Agent 附图交给没声明读图能力的自配模型」的量具：场景、暗号图、请求体读法、判分、证据落盘（PR #1346）。
// 真付费走查（agent-image-input-real.paid.mjs）与零花费演练（agent-image-input-real.rehearsal.walk.mjs）共用这份；
// 本文件不起 App、不出网、不花钱，单测见 _agentImageInputScore.test.mjs。
//
// 量的是什么：用户在接入页给 APIMart 手填一个模型 id（自配、没声明读图能力 = 「不知道」那一档），在 Agent 面板附一张图，
//   · 第 1 轮「看得见」：附一张每次现生成、带随机暗号的图。回答里有这次的暗号 = 像素真的到了模型手里。暗号随机，模型猜不中。
//   · 第 2 轮「真尺寸」：附登记真素材 image-4k-png（4K 视频抽一帧）。没走错误面、有非空回答 = 真实大小的图没被后端拒、没被截断。
// 暗号图为什么自己画点阵：ffmpeg 的 drawtext 要显式字体文件（各平台路径不同），纯色块又读不出字。
//   这里手写一张 5×7 点阵 PNG（node:zlib 现成），再写一个读回去的解码器——单测用它证明「图里写的就是这个暗号」，
//   演练的夹具大脑也用它「看图」：只有请求体里的像素真的完整到了，夹具才答得出暗号。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomInt } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync, inflateSync } from 'node:zlib'

import { laneMessageText, laneMessages } from './agent-lane-observer.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// ── 场景 ─────────────────────────────────────────────────────────────────────

/** 接入页手填的那一行所属的供应商：内置 APIMart（真实资料里已有它的钥匙密文）。 */
export const VENDOR_KEY = 'apimart'
/**
 * 手填的模型 id。要同时满足三条（选它的理由写在交付报告里）：
 *   ① 不是 APIMart 的内置种子行（builtinCatalogModelKeys），手填也不会带 meta.supportsImageInput → 判据落「不知道」；
 *   ② 真能读图（OpenAI 官方模型页：Input modalities: text, image），APIMart 的 chat-completions 文档点名它；
 *   ③ 改前的名字正则（VISION_MODEL_RE）撞不上它——改前这一行的图会被丢掉，这条走查才拦得住「图在发出前被丢掉」回潮。
 */
export const MODEL_ID = 'gpt-5-mini'

export const ASK_CODE = '图里写的暗号是什么？只回暗号'
export const ASK_SCENE = '用一句话说这张图里有什么'

/** 图被判「不能读图」丢掉时，发给模型的话里附的那句注（electron/ai/agentUserContent.ts），请求体里出现它 = 图没发。 */
export const DROPPED_NOTE = '张图片未发送'

/** 三种协议里图片部件的 type：openai-compatible `image_url`、responses `input_image`、anthropic `image`。 */
export const IMAGE_PART_TYPES = Object.freeze(['image_url', 'input_image', 'image'])

export const ROUNDS = Object.freeze([
  Object.freeze({ id: 'sees-code', name: '看得见', ask: ASK_CODE }),
  Object.freeze({ id: 'real-size', name: '真尺寸', ask: ASK_SCENE }),
])

/** 量具数字的定义（写进证据，PR 正文照抄）。 */
export const IMAGE_INPUT_METRICS = Object.freeze({
  sawCodeWord: '第 1 轮：回答前缀 NOMI 对且 4 位数字按位置至少 3 位对 = 看见了；数字取 2–9 共 8 个，瞎猜概率 29/4096 ≈ 0.71%',
  realSizeOk: '第 2 轮：没走错误面（面板错误带 / 助手消息 stopReason=error）且回答非空 = 真实大小的图没被后端拒、没被截断',
  wireImagePart: '发出去的请求体里，带这一轮那句话的用户消息有图片部件（image_url / input_image / image），且没有「图片未发送」那句注',
})

// ── 暗号 ─────────────────────────────────────────────────────────────────────

/** 去掉 0 和 1：它们跟字母 O、I 长得像，读图的模型容易混；剩 8 个数字、4 位，随机撞中概率 1/4096。 */
const CODE_DIGITS = '23456789'
export const CODE_PREFIX = 'NOMI'

/** 每次运行现生成一个暗号 `NOMI 4817`。`pick(n)` 取 [0, n) 的整数，单测可注入。 */
export function makeCodeWord(pick = (max) => randomInt(max)) {
  const digits = Array.from({ length: 4 }, () => CODE_DIGITS[pick(CODE_DIGITS.length)]).join('')
  return Object.freeze({ prefix: CODE_PREFIX, digits, text: `${CODE_PREFIX} ${digits}` })
}

// ── 点阵图 ───────────────────────────────────────────────────────────────────

const GLYPH_W = 5
const GLYPH_H = 7
const GLYPH_GAP = 1
const MARGIN = 3
const BLANK = '00000'

/** 5×7 点阵（经典 HD44780 字形）。只收暗号会用到的字符，另补 0 和 1 让单测能画任意数字。 */
const GLYPHS = Object.freeze({
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': Array.from({ length: GLYPH_H }, () => BLANK),
})

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, checksum])
}

/** 点阵图的版面：每个字符 5 点宽 + 1 点间隔，四周各留 3 点白边；一个点画成 dot×dot 像素。 */
export function codeWordLayout(text, dot = 20) {
  const columns = [...text].length * (GLYPH_W + GLYPH_GAP) - GLYPH_GAP + 2 * MARGIN
  const rows = GLYPH_H + 2 * MARGIN
  return { columns, rows, dot, width: columns * dot, height: rows * dot }
}

/** 把暗号画成黑字白底的 8 位灰度 PNG。返回 { png, width, height }。 */
export function renderCodeWordPng(text, { dot = 20 } = {}) {
  const layout = codeWordLayout(text, dot)
  const grid = Array.from({ length: layout.rows }, () => new Uint8Array(layout.columns))
  ;[...text].forEach((character, index) => {
    const glyph = GLYPHS[character]
    if (!glyph) throw new Error(`点阵里没有字符 ${JSON.stringify(character)}`)
    glyph.forEach((line, y) => [...line].forEach((bit, x) => {
      if (bit === '1') grid[MARGIN + y][MARGIN + index * (GLYPH_W + GLYPH_GAP) + x] = 1
    }))
  })
  const stride = layout.width + 1
  const raw = Buffer.alloc(stride * layout.height, 255)
  for (let y = 0; y < layout.height; y += 1) {
    raw[y * stride] = 0 // 每行的滤波类型：无
    const cells = grid[Math.floor(y / dot)]
    for (let x = 0; x < layout.width; x += 1) if (cells[Math.floor(x / dot)]) raw[y * stride + 1 + x] = 0
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(layout.width, 0)
  header.writeUInt32BE(layout.height, 4)
  header[8] = 8 // 位深
  header[9] = 0 // 灰度
  const png = Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
  return { png, width: layout.width, height: layout.height }
}

/** PNG 的 IHDR（前 33 字节就够）：宽、高、位深、色型。不是 PNG 就抛。大文件只读开头，不整个读进来。 */
export function readPngHeader(head) {
  if (!Buffer.isBuffer(head) || head.length < 26 || !head.subarray(0, 8).equals(PNG_SIGNATURE) || head.toString('ascii', 12, 16) !== 'IHDR') throw new Error('不是 PNG（签名或 IHDR 对不上）')
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), bitDepth: head[24], colorType: head[25] }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const dLeft = Math.abs(estimate - left)
  const dUp = Math.abs(estimate - up)
  const dUpLeft = Math.abs(estimate - upLeft)
  if (dLeft <= dUp && dLeft <= dUpLeft) return left
  return dUp <= dUpLeft ? up : upLeft
}

/**
 * 把一张 8 位 PNG（灰度 / RGB / 灰度+透明 / RGBA，不隔行）读成亮度格。
 * 暗号图经过产品原样转发就是我们自己写的灰度图；多支持几种色型，是为了产品哪天转码再发，量具仍读得出，而不是先坏。
 */
export function decodePngLuminance(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('不是 PNG')
  let offset = 8
  let header = null
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header || !idat.length) throw new Error('PNG 缺 IHDR 或 IDAT')
  if (header.depth !== 8 || header.interlace !== 0) throw new Error(`只读 8 位不隔行的 PNG（拿到位深 ${header.depth}、隔行 ${header.interlace}）`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType]
  if (!channels) throw new Error(`不认的 PNG 色型 ${header.colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = header.width * channels
  const pixels = Buffer.alloc(stride * header.height)
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]
      if (predictor === undefined) throw new Error(`不认的 PNG 滤波类型 ${filter}`)
      pixels[y * stride + x] = (source[x] + predictor) & 255
    }
  }
  const luminance = new Uint8Array(header.width * header.height)
  for (let i = 0; i < luminance.length; i += 1) {
    const at = i * channels
    luminance[i] = channels >= 3 ? Math.round((pixels[at] * 299 + pixels[at + 1] * 587 + pixels[at + 2] * 114) / 1000) : pixels[at]
  }
  return { width: header.width, height: header.height, luminance }
}

const GLYPH_BY_BITMAP = new Map(Object.entries(GLYPHS).map(([character, rows]) => [rows.join('/'), character]))

/**
 * 把我们画的暗号图读回成字符串。点的大小和个数从图的宽高反推（图被等比缩放也读得出）：
 * 行数固定 13 点，列数 = 字符数 × 6 − 1 + 6。读不出（点阵对不上任何字符）就抛，不猜。
 */
export function readCodeWordFromPng(buffer) {
  const { width, height, luminance } = decodePngLuminance(buffer)
  const rows = GLYPH_H + 2 * MARGIN
  const dot = height / rows
  const columns = Math.round(width / dot)
  const count = (columns - 2 * MARGIN + GLYPH_GAP) / (GLYPH_W + GLYPH_GAP)
  if (!Number.isInteger(count) || count < 1) throw new Error(`图的宽高 ${width}×${height} 对不上点阵版面`)
  const on = (column, row) => luminance[Math.min(height - 1, Math.floor((row + 0.5) * dot)) * width + Math.min(width - 1, Math.floor((column + 0.5) * dot))] < 128
  let text = ''
  for (let index = 0; index < count; index += 1) {
    const bitmap = Array.from({ length: GLYPH_H }, (_, y) => Array.from({ length: GLYPH_W }, (__, x) => (on(MARGIN + index * (GLYPH_W + GLYPH_GAP) + x, MARGIN + y) ? '1' : '0')).join(''))
    const character = GLYPH_BY_BITMAP.get(bitmap.join('/'))
    if (character === undefined) throw new Error(`第 ${index + 1} 个字符的点阵对不上任何字形`)
    text += character
  }
  return text
}

// ── 请求体读法（三种协议）────────────────────────────────────────────────────

/** 一条消息的文字：content 是字符串，或一串部件里带 text 的那些。 */
export function textOfContent(content) {
  if (typeof content === 'string') return content
  return (Array.isArray(content) ? content : []).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n')
}

function messagesOf(body) {
  if (Array.isArray(body?.messages)) return body.messages // openai-compatible / anthropic
  if (Array.isArray(body?.input)) return body.input // responses
  return []
}

/** 请求体里最后一条文字含 `ask` 的用户消息；没有返回 null。 */
export function userTurnWith(body, ask) {
  const messages = messagesOf(body)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && textOfContent(message.content).includes(ask)) return message
  }
  return null
}

const DATA_URI = /^data:([^;,]+)(?:;[^,]*)?;base64,/

function imageSource(part) {
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url // chat: { image_url: { url } }；responses: { image_url: '…' }
  if (typeof url === 'string') {
    const head = DATA_URI.exec(url)
    return head ? { mime: head[1], base64: url.slice(head[0].length) } : { mime: null, base64: null, remote: true }
  }
  if (part.source?.type === 'base64' && typeof part.source.data === 'string') return { mime: part.source.media_type ?? null, base64: part.source.data } // anthropic
  if (typeof part.image === 'string') return { mime: part.mimeType ?? null, base64: part.image }
  return { mime: null, base64: null }
}

const base64Bytes = (base64) => (base64 ? Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) : null)

/** 一条消息里的图片部件，只留事实（type / mime / 字节数），不带 base64——证据里不许落图。 */
export function describeImageParts(content) {
  return (Array.isArray(content) ? content : [])
    .filter((part) => IMAGE_PART_TYPES.includes(part?.type))
    .map((part) => {
      const source = imageSource(part)
      return { type: part.type, mime: source.mime, bytes: base64Bytes(source.base64), ...(source.remote ? { remoteUrl: true } : {}) }
    })
}

/** 一条消息里图片部件的原始字节（夹具大脑「看图」用）。 */
export function imageBuffersOf(content) {
  return (Array.isArray(content) ? content : [])
    .filter((part) => IMAGE_PART_TYPES.includes(part?.type))
    .flatMap((part) => { const { base64 } = imageSource(part); return base64 ? [Buffer.from(base64, 'base64')] : [] })
}

/** 这一个请求体对这一轮的判决：带这句话的用户消息有没有图片部件、有没有「图片未发送」那句注。 */
export function judgeRequestBody(body, ask) {
  const turn = userTurnWith(body, ask)
  if (!turn) return { found: false, ok: false, images: [], droppedNote: false, why: '请求体里找不到带这一轮那句话的用户消息' }
  const images = describeImageParts(turn.content)
  const droppedNote = textOfContent(turn.content).includes(DROPPED_NOTE)
  const ok = images.length > 0 && !droppedNote
  return { found: true, ok, images, droppedNote, why: ok ? null : droppedNote ? `发给模型的话里附了「${DROPPED_NOTE}」那句注：图在发出前被丢掉了` : '用户消息里没有图片部件' }
}

/**
 * 付费走查没有夹具，读网络闸账本（NOMI_WALK_NET_BODIES）里发往供应商的聊天请求。账本只留请求体脱敏后的**前 64 KiB**，
 * 所以这里只下「看见了什么」的结论，不下「没有」的结论：前缀里同时有这句话和图片部件 = 图在请求里；有这句话和那句注 = 图被丢了；
 * 其余（没抓到、前缀没覆盖到）一律 unknown，由模型的回答兜底。只作参考，不单独判红。
 */
export function wireFactsFromNetLog(entries, { host = null, ask }) {
  const posts = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.kind === 'allowed-request' && entry.method === 'POST'
    && (host === null || entry.host === host) && /\/(?:chat\/completions|responses|messages)\b/.test(String(entry.url)))
  const withAsk = posts.filter((entry) => String(entry.body?.text ?? '').includes(ask))
  const imageMarker = new RegExp(`"type":"(?:${IMAGE_PART_TYPES.join('|')})"`)
  const withImage = withAsk.filter((entry) => imageMarker.test(String(entry.body?.text ?? '')))
  const withNote = withAsk.filter((entry) => String(entry.body?.text ?? '').includes(DROPPED_NOTE))
  const verdict = withNote.length ? 'dropped-note' : withImage.length ? 'image-in-request' : 'unknown'
  return { source: 'net-log', requests: posts.length, askInPrefix: withAsk.length, imagePartInPrefix: withImage.length, droppedNoteInPrefix: withNote.length, truncated: withAsk.filter((entry) => entry.body?.truncated).length, verdict }
}

// ── 转录读法（盘上 lane 转录，不信面板文字）────────────────────────────────────

const KEY_SHAPED = /\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i
const clip = (text, length) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, length)
const scrubKeys = (text) => String(text ?? '').replace(new RegExp(KEY_SHAPED.source, 'gi'), '[REDACTED]')
const assistantText = (message) => (Array.isArray(message?.content) ? message.content : []).filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')

/** 这一轮新出现的转录读成事实：用户消息带几个附件声明、助手说了什么、有没有停在错误上。 */
export function readRoundTranscript(sessions) {
  const users = []
  const assistants = []
  for (const session of sessions) {
    for (const message of laneMessages(session)) {
      if (message.role === 'user' || message.role === 'nomi.input') {
        users.push({ text: laneMessageText(message), attachmentClaims: Array.isArray(message.context?.attachments) ? message.context.attachments.length : 0 })
      } else if (message.role === 'assistant') {
        const parts = Array.isArray(message.content) ? message.content : []
        assistants.push({
          model: `${message.provider ?? '?'}/${message.model ?? '?'}`,
          stopReason: message.stopReason ?? null,
          errorMessage: message.errorMessage ? clip(scrubKeys(message.errorMessage), 400) : null,
          text: assistantText(message),
          toolCalls: parts.filter((part) => part?.type === 'toolCall').map((part) => part.name),
          input: Number(message.usage?.input) || 0,
          output: Number(message.usage?.output) || 0,
        })
      }
    }
  }
  const last = assistants.at(-1) ?? null
  return {
    users,
    assistants,
    models: [...new Set(assistants.map((entry) => entry.model))],
    finalAnswer: last && last.stopReason !== 'toolUse' && last.toolCalls.length === 0 ? last.text : '',
    stopReason: last?.stopReason ?? null,
    errorMessage: assistants.map((entry) => entry.errorMessage).filter(Boolean).at(-1) ?? null,
    toolCalls: assistants.flatMap((entry) => entry.toolCalls),
    usage: { input: assistants.reduce((sum, entry) => sum + entry.input, 0), output: assistants.reduce((sum, entry) => sum + entry.output, 0) },
  }
}

/** 这一轮落地了没有：最后一条助手消息带终止原因，且不是停在工具调用上。 */
export function roundSettled(sessions) {
  const last = sessions.flatMap((session) => laneMessages(session)).at(-1)
  return Boolean(last && last.role === 'assistant' && last.stopReason && last.stopReason !== 'toolUse')
}

// ── 判分 ─────────────────────────────────────────────────────────────────────

const normalize = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * 第 1 轮：前缀 NOMI 对，且 4 位数字按位置至少对 3 位 = 看见了。
 * 数字只取 2–9 共 8 个，瞎猜至少 3 位对的概率是 (4×7+1)/8⁴ = 29/4096 ≈ 0.71%。
 * 完整暗号（含 NOMI）另记，不作判据——模型读到图但点阵字误读 1 位仍算看见了。
 */
export function scoreSawCodeWord({ answer, codeWord }) {
  const normalized = normalize(answer)
  const text = String(answer ?? '').trim()
  const prefixAt = normalized.indexOf(normalize(codeWord.prefix))
  const answerDigits = prefixAt < 0 ? '' : normalized.slice(prefixAt + normalize(codeWord.prefix).length).replace(/[^0-9]/g, '').slice(0, codeWord.digits.length)
  const matchingDigits = [...codeWord.digits].reduce((matches, digit, index) => matches + (answerDigits[index] === digit ? 1 : 0), 0)
  const saw = text.length > 0 && prefixAt >= 0 && answerDigits.length === codeWord.digits.length && matchingDigits >= 3
  return { saw, fullCodeEchoed: saw && normalized.includes(normalize(codeWord.text)), answerChars: text.length }
}

/** 模型说「没看到图」的几种说法（只作旁注：非空回答按任务书算过，这一条标出「回答非空却像是没收到图」的情形）。 */
export const DENIES_IMAGE = /看不到|没(?:有)?看到|无法(?:查看|读取|看到|识别|访问)|读不到|没(?:有)?(?:收到|附带|附上|上传)(?:任何|这张|那张)?(?:图|图片|图像)|未(?:收到|看到)(?:任何)?(?:图|图片)|can(?:no|')t (?:see|view|access|open)|(?:do not|don't|didn't) (?:see|receive)|no (?:image|picture|attachment)|unable to (?:view|see|open)/i

/** 第 2 轮：没走错误面 + 回答非空 = 真实大小的图没被拒、没被截断。 */
export function scoreRealSize({ answer, errorSurface }) {
  const text = String(answer ?? '').trim()
  const ok = !errorSurface && text.length > 0
  return { ok, answerChars: text.length, deniesImage: text.length > 0 && DENIES_IMAGE.test(text), why: ok ? null : errorSurface ? `走了错误面：${errorSurface}` : '回答是空的' }
}

/** 这一轮有没有走错误面：面板错误带有字，或助手消息停在 error 上。返回一句话，没有就 null。 */
export function errorSurfaceOf({ errorBar, stopReason, errorMessage }) {
  if (errorBar) return `面板错误带：${clip(errorBar, 200)}`
  if (stopReason === 'error') return `助手消息 stopReason=error${errorMessage ? `：${clip(errorMessage, 200)}` : ''}`
  return null
}

/** 量具自己的问题（不是模型的）。空 = 这一场的数可以用。 */
export function gaugeProblems(rounds, { expectedModelKey }) {
  const problems = []
  for (const record of rounds) {
    const label = `第 ${record.index} 轮（${record.name}）`
    if (record.harnessError) problems.push(`${label}量具出错：${record.harnessError}`)
    if (record.settle?.timedOut) problems.push(`${label}超时没落地（已按停止）`)
    if (record.settle?.interventions?.length) problems.push(`${label}冒出介入卡 ${record.settle.interventions.join('、')}，走查不替用户答（已按停止）`)
    if (!record.sessions) problems.push(`${label}盘上没有新的 lane 转录`)
    if (record.attachmentClaims !== 1) problems.push(`${label}发出的消息带 ${record.attachmentClaims} 个附件声明，应是 1 个`)
    const foreign = (record.models ?? []).filter((model) => !model.endsWith(`/${expectedModelKey}`))
    if (foreign.length) problems.push(`${label}答话的模型不是 ${expectedModelKey}：${foreign.join('、')}`)
  }
  return problems
}

/** 汇总成几个数（写进证据和报告）。 */
export function summarizeRounds(rounds) {
  const byId = new Map(rounds.map((record) => [record.id, record]))
  const code = byId.get('sees-code')
  const size = byId.get('real-size')
  return {
    rounds: rounds.length,
    sawCodeWord: code ? code.score?.saw === true : null,
    fullCodeEchoed: code ? code.score?.fullCodeEchoed === true : null,
    realSizeOk: size ? size.score?.ok === true : null,
    realSizeDeniesImage: size ? size.score?.deniesImage === true : null,
    errorSurfaceRounds: rounds.filter((record) => record.errorSurface).length,
    harnessErrors: rounds.filter((record) => record.harnessError).length,
  }
}

// ── 证据 ─────────────────────────────────────────────────────────────────────

export const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-10-27-vision-capability-declared')
const EVIDENCE_MAX_CHARS = 200_000

/** 证据文本落进仓库前最后一道：不许有 key 原串（调用方给的）、形如 key 的串、内联的图片数据，也不许大到不像摘要。命中就抛。 */
export function assertEvidenceIsClean(text, secrets = []) {
  for (const secret of secrets) {
    if (secret && String(secret).length >= 8 && text.includes(secret)) throw new Error('证据里出现了 key 原串，拒绝写入仓库——请更换这把 key')
  }
  if (KEY_SHAPED.test(text)) throw new Error('证据里有形如 key 的串（sk-… / Bearer …），拒绝写入仓库')
  if (/data:image\/|[A-Za-z0-9+/]{2000,}/.test(text)) throw new Error('证据里有内联的图片数据，拒绝写入仓库（只留字节数）')
  if (text.length > EVIDENCE_MAX_CHARS) throw new Error(`证据 ${text.length} 字符，超过摘要上限 ${EVIDENCE_MAX_CHARS}`)
}

/**
 * 证据摘要写进仓库（docs/evidence/…/<paid|rehearsal>/report.json）。公开仓库：本机路径换成 <repo> / ~，落盘前过 assertEvidenceIsClean。
 * 返回写下的相对路径。`dir` / `repoRoot` / `home` 给单测换掉。
 */
export function writeEvidenceFile(relativeFile, report, { secrets = [], dir = EVIDENCE_DIR, repoRoot = REPO_ROOT, home = os.homedir() } = {}) {
  const text = `${JSON.stringify(report, null, 2)}\n`.split(repoRoot).join('<repo>').split(home).join('~')
  assertEvidenceIsClean(text, secrets)
  const file = path.join(dir, relativeFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return path.relative(repoRoot, file)
}

// ── 请求体从哪读（演练读夹具，真付费读网络闸账本）──────────────────────────────

/** 演练：读夹具收到的聊天请求（完整请求体）。每个带这一轮那句话的请求都要有图片部件、都不能带那句注。 */
export function fixtureWireProbe(fixture) {
  return (round) => {
    const judged = fixture.requests.map((record) => judgeRequestBody(record.body, round.ask)).filter((entry) => entry.found)
    const verdict = !judged.length ? 'unknown' : judged.every((entry) => entry.ok) ? 'image-in-request' : judged.some((entry) => entry.droppedNote) ? 'dropped-note' : 'no-image'
    return { source: 'fixture', verdict, requests: judged.length, images: judged[0]?.images ?? [], droppedNote: judged.some((entry) => entry.droppedNote), why: judged.find((entry) => !entry.ok)?.why ?? null }
  }
}

/** 真付费：读网络闸账本里发往供应商的聊天请求前缀（只能下「看见了什么」的结论，见 wireFactsFromNetLog）。 */
export function netLogWireProbe(paid) {
  return (round) => wireFactsFromNetLog(paid.readAllowedRequests(), { ask: round.ask })
}

// ── 这一场的红绿与证据摘要 ──────────────────────────────────────────────────────

/** 这一场哪里红了（空 = 全绿）。量具的问题、硬断言、两轮的结论，一并列出来。`requireWire`：演练要求两轮的请求体都读到了图片部件。 */
export function journeyFailures(journey, { requireWire = false } = {}) {
  const failures = []
  failures.push(...(journey.gaugeProblems ?? []).map((problem) => `量具：${problem}`))
  failures.push(...(journey.hard ?? []).filter((entry) => !entry.ok).map((entry) => `硬断言 ${entry.id}：${entry.detail}`))
  const code = journey.rounds?.find((record) => record.id === 'sees-code')
  const size = journey.rounds?.find((record) => record.id === 'real-size')
  if (!code) failures.push('第 1 轮没有跑')
  else if (code.score?.saw !== true) failures.push(`第 1 轮没认出暗号（回答：${JSON.stringify(code.finalAnswer ?? '')}${code.errorSurface ? `；${code.errorSurface}` : ''}）`)
  if (!size) failures.push('第 2 轮没有跑')
  else if (size.score?.ok !== true) failures.push(`第 2 轮不 ok：${size.score?.why ?? '未知'}`)
  if (requireWire) {
    for (const record of journey.rounds ?? []) if (record.wire?.verdict !== 'image-in-request') failures.push(`${record.id}：请求体里没读到图片部件（${record.wire?.verdict ?? '没读请求体'}）`)
  }
  return failures
}

const relativeToRepo = (file) => (file ? path.relative(REPO_ROOT, file) : null)

/** 证据摘要的公共部分（两边同一份形状）。 */
export function imageInputEvidence({ script, mode, startedAt, journey, walk, failure, images, buildMarker, model, requireWire = false }) {
  const failures = failure ? [] : journeyFailures(journey, { requireWire })
  return {
    script, mode, startedAt, finishedAt: new Date().toISOString(),
    result: failure || failures.length ? 'failed' : 'passed',
    failure: failure ? String(failure?.message ?? failure).slice(0, 4000) : null,
    failures,
    buildMarker, model,
    handTypedModel: journey.model ?? null,
    asks: ROUNDS.map((round) => ({ id: round.id, name: round.name, ask: round.ask })),
    metrics: IMAGE_INPUT_METRICS,
    codeWord: images?.codeWord?.text ?? null,
    images: images ? {
      code: { bytes: images.code.bytes, width: images.code.width, height: images.code.height },
      real: { bytes: images.real.bytes, width: images.real.width, height: images.real.height, bitDepth: images.real.bitDepth ?? null, colorType: images.real.colorType ?? null, attachCapBytes: images.real.attachCapBytes ?? null, source: images.real.source },
    } : null,
    numbers: journey.numbers ?? null,
    hard: { checks: journey.hard?.length ?? 0, failures: (journey.hard ?? []).filter((entry) => !entry.ok) },
    gaugeProblems: journey.gaugeProblems ?? null,
    rounds: journey.rounds ?? [],
    screenshots: journey.shots ?? [],
    brain: { text: walk.report.spend?.text ?? null, mediaCalls: walk.report.spend?.media?.length ?? null },
    networkBlocked: walk.report.networkBlocked ?? [],
    walkOutputDir: relativeToRepo(walk.report.outputDir),
  }
}
