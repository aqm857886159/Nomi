// 手机虚拟相机桥的**入站帧唯一判据**（2026-09-11 安全加固 ④）。
// 网络那头是一个谁都能连的局域网端口，所以「这一帧长得对不对」必须有一处说了算，而不是散在
// 消息回调里各判一点。这里只做纯判定（不碰 socket、不碰事件），因此能被单测逐条喂。
//
// 判定失败一律是 malformed —— 调用方的处置是**断开**，不是静默 return：静默吞掉畸形帧正是
// 「本地看不出、线上才炸」那一族（R17）。正常手机页发不出畸形帧，这条对真实用户零影响。
import { MOBILE_CONTROL_MAX_BYTES } from '../shared/contracts/directorMobileBridge'

export const MOBILE_PACKET_FLOATS = 8
export const MOBILE_PACKET_BYTES = MOBILE_PACKET_FLOATS * 4

/**
 * 位姿包各槽的量程（与 mobilePage.ts 的发包端逐项对齐）：
 * 摇杆 x/z 与升降是归一化的 [-1,1]；三个角增量是两包之间的度数；焦距是毫米；复位是 0/1 标志。
 * 留 1e-3 的浮点余量：页面算的是 dx/r，float32 往返后可能差最后一位。
 */
const PACKET_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [-1, 1],
  [-1, 1],
  [-1, 1],
  [-360, 360],
  [-360, 360],
  [-360, 360],
  [0, 1000],
  [0, 1],
]
const BOUND_EPSILON = 1e-3

export type MobileControlMessage =
  | { type: 'hello'; name: string | null }
  | { type: 'record'; action: 'start' | 'stop' }
  | { type: 'pong'; t: number }

export type MobileFrameVerdict<T> = { ok: true; value: T } | { ok: false; reason: string }

const ALLOWED_KEYS: Record<string, ReadonlySet<string>> = {
  hello: new Set(['type', 'role', 'name']),
  record: new Set(['type', 'action']),
  pong: new Set(['type', 't']),
}

/** 二进制位姿包：长度必须正好 32 字节，8 个 Float32 必须有限且落在各自量程里。 */
export function decodePacketValues(data: Buffer): number[] | null {
  if (data.byteLength !== MOBILE_PACKET_BYTES) return null
  const values: number[] = []
  for (let index = 0; index < MOBILE_PACKET_FLOATS; index += 1) {
    const value = data.readFloatLE(index * 4)
    if (!Number.isFinite(value)) return null
    const [low, high] = PACKET_BOUNDS[index]
    if (value < low - BOUND_EPSILON || value > high + BOUND_EPSILON) return null
    values.push(value)
  }
  return values
}

/** 文本控制帧：严格白名单 hello / record / pong，逐字段判类型与取值，多余的键也算畸形。 */
export function parseControlMessage(raw: string): MobileFrameVerdict<MobileControlMessage> {
  if (raw.length > MOBILE_CONTROL_MAX_BYTES) return { ok: false, reason: 'control frame too large' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'control frame is not JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'control frame is not an object' }
  const message = parsed as Record<string, unknown>
  const type = message.type
  if (typeof type !== 'string' || !(type in ALLOWED_KEYS)) return { ok: false, reason: `unknown control type` }
  for (const key of Object.keys(message)) {
    if (!ALLOWED_KEYS[type].has(key)) return { ok: false, reason: `unexpected field on ${type}` }
  }
  if (type === 'hello') {
    if (message.role !== undefined && message.role !== 'phone') return { ok: false, reason: 'hello.role is not phone' }
    if (message.name !== undefined && typeof message.name !== 'string') return { ok: false, reason: 'hello.name is not a string' }
    const name = typeof message.name === 'string' ? message.name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 60) : ''
    return { ok: true, value: { type: 'hello', name: name || null } }
  }
  if (type === 'record') {
    if (message.action !== 'start' && message.action !== 'stop') return { ok: false, reason: 'record.action is not start/stop' }
    return { ok: true, value: { type: 'record', action: message.action } }
  }
  if (typeof message.t !== 'number' || !Number.isFinite(message.t)) return { ok: false, reason: 'pong.t is not a finite number' }
  return { ok: true, value: { type: 'pong', t: message.t } }
}
