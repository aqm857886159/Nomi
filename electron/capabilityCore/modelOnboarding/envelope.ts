// 接模型工具面的返回信封（4 个工具同一形状）。设计正本 §4.3。
//
// 这份信封里最重要的一格是 `unverified`：它把「接好了吗」从一个模型要靠语气拿捏的问题，
// 变成一个它手里有答案的问题。只要里面还有 model_produces_output，它就**不能**说「接好了」。
// 这是 GitHub issue_write 那段「STOP — do not claim the operation succeeded」在本域的等价物,
// 只是我们用结构表达，而不是靠一段大写祈使句（先例库结论 5）。门岗 O5 扫的就是这条。
import type { OnboardingNextActionKind, OnboardingStateId } from './declarations'

/** 哪些话此刻**没有证据**。空数组 = 全部有证据。 */
export const UNVERIFIED_CLAIMS = [
  'endpoint_reachable',
  'credential_accepted',
  'model_id_exists',
  'adapter_compiles',
  /** 唯一一条只有用户在画布上真跑一次才能消掉的。自检**永远**消不掉它。 */
  'model_produces_output',
] as const
export type UnverifiedClaim = typeof UNVERIFIED_CLAIMS[number]

export type UnverifiedEntry = {
  claim: UnverifiedClaim
  /** 为什么没证据（英文，模型读的那份）。 */
  reason: string
  /** 什么才算证据。 */
  evidenceWouldBe: string
}

export type OnboardingChange = { state: OnboardingStateId; summary: string }

export type BlastRadius = {
  /** 画布模型框里会多出几行。 */
  modelsAppearing: number
  /** 会少掉几行。 */
  modelsDisappearing: number
  /** 永久删掉几条（只有 nomi_remove_provider 非 0）。 */
  recordsDeleted: number
  /** 本域 billable 恒 false —— 09-11 拍板：这条路上一个花钱的动作都没有。 */
  outboundRequests: Array<{ origin: string; count: number; billable: false }>
}

export type OnboardingNextAction = {
  kind: OnboardingNextActionKind
  /** 一句人话，与界面同源、模型可直接转述。 */
  userSees: string
  /** kind ∈ {waiting_for_user, working} 时必有。 */
  waitWith?: 'nomi_await_setup'
  /** user_sees_key_page 且宿主支持 URL elicitation 时的本机安全页地址。 */
  url?: string
}

export type OnboardingResult = {
  ok: true
  setupId?: string
  vendorKey?: string
  /** 给 undo 用；reversible_local 必有。重放同一跳返回同一个 changeId。 */
  changeId?: string
  /** 用户看得见的那一片，与 nomi_list_models 同形状的子集。 */
  state: unknown
  unverified: UnverifiedEntry[]
  changes: OnboardingChange[]
  blastRadius: BlastRadius
  nextAction: OnboardingNextAction
}

export type OnboardingFailure = {
  ok: false
  code: 'wrong_verb' | 'needs_input' | 'not_found' | 'invalid_args' | 'stale_fingerprint' | 'provider_failed'
  message: string
  /** wrong_verb 时点名正确动作。**只点名，不代调**（原则 7）。 */
  useInstead?: string
  /** needs_input 时，缺什么**一次列全**（实测 22 次失败里 9 次死在逐个抛）。 */
  needs?: string[]
  /** 上游原文，截断但不改写。 */
  evidence?: { status?: number; bodyExcerpt?: string }
  nextAction: string
}

const REASON: Record<UnverifiedClaim, { reason: string; evidenceWouldBe: string }> = {
  endpoint_reachable: {
    reason: 'Nomi has not reached this base URL yet.',
    evidenceWouldBe: 'a successful self-check (nomi_model_setup action check_connection)',
  },
  credential_accepted: {
    reason: 'The provider has not accepted this key on any request yet.',
    evidenceWouldBe: 'a self-check where the provider answered without an auth error',
  },
  model_id_exists: {
    reason: 'Nomi has not seen this model id in the provider\'s own model list.',
    evidenceWouldBe: 'the model id appearing in the provider\'s model list during a self-check',
  },
  adapter_compiles: {
    reason: 'No request recipe has compiled for this provider yet.',
    evidenceWouldBe: 'a draft_adapter call that compiled without a rejected field',
  },
  model_produces_output: {
    reason: 'Nothing has actually been generated with this model. A self-check never proves this: it only checks the address, the key and the model id.',
    evidenceWouldBe: 'the user\'s first real generation on the canvas, or the "try it" button on the model page',
  },
}

/** 把 claim 列表变成信封里那一格（理由与「什么才算证据」是派生的，不逐处手写）。 */
export function unverified(...claims: UnverifiedClaim[]): UnverifiedEntry[] {
  return [...new Set(claims)].map((claim) => ({ claim, ...REASON[claim] }))
}

/** 这一跳什么都没改：空的 blastRadius。 */
export function noBlast(): BlastRadius {
  return { modelsAppearing: 0, modelsDisappearing: 0, recordsDeleted: 0, outboundRequests: [] }
}

/** 自检发出的免费请求（billable 恒 false，类型上就不给写 true 的机会）。 */
export function freeRequests(origin: string, count: number): BlastRadius['outboundRequests'] {
  return count > 0 ? [{ origin, count, billable: false }] : []
}
