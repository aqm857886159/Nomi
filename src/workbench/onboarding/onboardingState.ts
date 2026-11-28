/**
 * 上手清单、示例旅程与遥测首次询问的持久标记（跨会话）。
 *
 * 走 localStorage（不进 workbenchStore——那边的持久化绑定项目存档）。
 * try/catch 守护：localStorage 不可用时清单退化为全 false。
 * 开屏 SplashIntro 已按 Q18 删除，旧键 `nomi:splash:v1` 不再读写、留在老用户本机无害。
 */

import { getDesktopBridge } from '../../desktop/bridge'
import type { ModelClass, OnboardingFailReason, OnboardingStep } from '../../../electron/shared/contracts/telemetry'

const CHECKLIST_KEY = 'nomi:checklist:v1'
const CHECKLIST_FIRST_SHOWN_KEY = 'nomi:checklist-first-shown:v1'
const CHECKLIST_DISMISSED_KEY = 'nomi:checklist-dismissed:v1'
const JOURNEY_TOUR_KEY = 'nomi:journey-tour:v1'
const FIRST_GENERATION_TELEMETRY_KEY = 'nomi:first-generation-telemetry:v1'
let promptShownReportedThisSession = false
/**
 * 「帮 Nomi 变好」那张首次询问卡问过没有（用户 09-15 拍板②：**只问一次**）。
 *
 * 为什么住在这里而不是自己起一套：这份文件就是本仓「一次性、跨会话、localStorage、
 * try/catch 守着」的既有约定（splash / journey tour / checklist 都在这儿）。
 * 自己起一套的代价不是多几行，是**第二套「问过没有」的判断**——而那类判断一旦有两份，
 * 迟早出现「这台机器上它又弹了一次」。
 *
 * 记的是**问过**，不是**同意了**。同意与否的真相源是主进程的 telemetry-settings.json
 * （用户随时能在设置里改），这里只回答「还要不要再问他」。两者分开，所以
 * 「他当时点了不用了、后来自己去设置里打开」不会让这张卡再冒出来。
 */
const AGENT_CONSENT_KEY = 'nomi:agent-consent-asked:v1'
/** 告知范围升到 v2（界面流畅度分档）后，对已同意的用户再确认一次问过没有。同样记「问过」，不记「同意」。 */
const AGENT_CONSENT_SCOPE_KEY = 'nomi:agent-consent-scope-asked:v2'

/** 上手清单生命周期上限：首次显示满 2 天仍未完成 → 自动永久关闭，不再回来。 */
export const CHECKLIST_TTL_MS = 2 * 24 * 60 * 60 * 1000

export type ChecklistStep = 'model' | 'storyboard' | 'generated' | 'exported'
export type ChecklistState = Record<ChecklistStep, boolean>

const EMPTY: ChecklistState = { model: false, storyboard: false, generated: false, exported: false }

export function readChecklist(): ChecklistState {
  try {
    const raw = window.localStorage.getItem(CHECKLIST_KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<ChecklistState>
    return { ...EMPTY, ...parsed }
  } catch {
    return { ...EMPTY }
  }
}

export function markChecklistStep(step: ChecklistStep): void {
  try {
    const state = readChecklist()
    state[step] = true
    window.localStorage.setItem(CHECKLIST_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/**
 * 引导旅途（首页主动点的「60 秒看 Nomi 怎么出片」预置回放）是否看过。
 * 用于首页 CTA 文案在「看一遍 / 重看一遍」之间切换；不阻断、永远可重看。
 */
export function hasSeenJourneyTour(): boolean {
  try {
    return window.localStorage.getItem(JOURNEY_TOUR_KEY) === 'seen'
  } catch {
    return false
  }
}

export function markJourneyTourSeen(): void {
  try {
    window.localStorage.setItem(JOURNEY_TOUR_KEY, 'seen')
  } catch {
    /* ignore */
  }
}

/** 首次询问卡问过没有。两个钮（「愿意」「不用了」）都写这个标记 —— 都算问过了。 */
export function hasAskedAgentConsent(): boolean {
  try {
    return window.localStorage.getItem(AGENT_CONSENT_KEY) === 'asked'
  } catch {
    // localStorage 不可用时退化成「问过了」：宁可少问一次，也不要每次开面板都弹一张卡。
    return true
  }
}

export function hasAskedAgentConsentScope(): boolean {
  try {
    return window.localStorage.getItem(AGENT_CONSENT_SCOPE_KEY) === 'asked'
  } catch {
    return true
  }
}

export function markAgentConsentScopeAsked(): void {
  try {
    window.localStorage.setItem(AGENT_CONSENT_SCOPE_KEY, 'asked')
  } catch {
    /* ignore */
  }
}

export function markAgentConsentAsked(): void {
  try {
    window.localStorage.setItem(AGENT_CONSENT_KEY, 'asked')
  } catch {
    /* ignore */
  }
}

/** 上手清单是否已永久关闭（用户点「不再提示」或满 2 天自动过期）。关了不再回来。 */
export function isChecklistDismissed(): boolean {
  try {
    return window.localStorage.getItem(CHECKLIST_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function markChecklistDismissed(): void {
  try {
    window.localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** 首次显示时间戳：仅第一次写入（已存在不覆盖），返回最终值。注入 now 便于测试。 */
export function ensureChecklistFirstShownAt(now: number): number {
  try {
    const raw = window.localStorage.getItem(CHECKLIST_FIRST_SHOWN_KEY)
    const existing = raw == null ? NaN : Number(raw)
    if (Number.isFinite(existing)) return existing
    window.localStorage.setItem(CHECKLIST_FIRST_SHOWN_KEY, String(now))
    return now
  } catch {
    return now
  }
}

/** 首次显示满 TTL（默认 2 天）即过期。从未记录首显 → 顺手记为 now，本次不算过期。 */
export function isChecklistExpired(now: number): boolean {
  const firstShown = ensureChecklistFirstShownAt(now)
  return now - firstShown >= CHECKLIST_TTL_MS
}

/**
 * 新手激活与模型接入闭合漏斗上报（仅枚举，零密钥 / URL / 文本内容）。
 * `vendorKey` 只作 IPC 侧归类线索，由主进程 `withMainProcessFacts` 转成 `builtin | local | custom` 后丢弃。
 */
export function trackOnboardingStep(input: {
  step: OnboardingStep
  providerClass?: ModelClass
  vendorKey?: string
  failReason?: OnboardingFailReason
}): void {
  try {
    const telemetry = getDesktopBridge()?.telemetry
    if (!telemetry?.track) return
    void telemetry.track({
      eventName: 'onboarding.step',
      props: {
        step: input.step,
        providerClass: input.providerClass ?? 'builtin',
        ...(input.step === 'verify_failed' ? { failReason: input.failReason ?? 'other' } : {}),
      },
      ...(input.vendorKey ? { vendorKey: input.vendorKey } : {}),
    })
  } catch {
    /* ignore */
  }
}

/** 首屏引导曝光去重：同一进程生命周期只记一次分母，避免 SWR 重验刷高分母。 */
export function trackOnboardingPromptShownOnce(providerClass: ModelClass = 'builtin'): void {
  if (promptShownReportedThisSession) return
  promptShownReportedThisSession = true
  trackOnboardingStep({ step: 'prompt_shown', providerClass })
}

/**
 * 首次生成成功激活转化：同时检查 `readChecklist().generated`，避免升级前已出过片的老用户被误记成首日激活。
 * 返回 true 表示本次是该装机第一次成功生成，调用方随即发一次 `first_generation_succeeded`。
 */
export function tryConsumeFirstGenerationTelemetry(): boolean {
  try {
    if (window.localStorage.getItem(FIRST_GENERATION_TELEMETRY_KEY) === '1') return false
    if (readChecklist().generated) {
      window.localStorage.setItem(FIRST_GENERATION_TELEMETRY_KEY, '1')
      return false
    }
    window.localStorage.setItem(FIRST_GENERATION_TELEMETRY_KEY, '1')
    return true
  } catch {
    return false
  }
}

export function resetOnboardingTelemetrySessionForTests(): void {
  promptShownReportedThisSession = false
}
