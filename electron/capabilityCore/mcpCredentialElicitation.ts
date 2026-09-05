import type { ElicitationClient } from './mcpElicitation'
import type { ResultLocale } from './mcpToolResults'

// `nomi_integration action=open_credentials` — the one step in the model-onboarding flow that needs a
// provider API key. The MCP spec forbids asking for it in form mode and mandates URL mode, so:
//
//   1. open_credentials runs as before (it also enqueues the durable in-app handoff — unchanged).
//   2. The owning process mints a one-time loopback page and returns it as `credentialEntry`.
//   3. If the client declared url-mode elicitation, we send `elicitation/create` (mode: "url"). On
//      `accept` we poll the session for `credentialStatus: "ready"`, then fire
//      `notifications/elicitation/complete` and return the fresh projection.
//   4. If it did not, the URL is dropped (never hand a URL to a client that cannot present it safely)
//      and the result carries an explicit manual instruction instead: open Nomi → Settings → Models.
//
// What never happens in any branch: asking the model or the client for the key. `credentialEntry` is
// stripped from every returned payload — the URL is single-use and already spent by then.
//
// Copy is authored here rather than through desktopT for two reasons: it is agent-facing protocol
// prose (the capabilityCore convention, cf. mcpPlanTrust.ts), and electron/i18n.ts value-imports
// `electron`, which the bare-Node MCP launcher's import closure forbids (mcpLauncherClosure.test.ts).
// The credential PAGE is real UI and does go through desktopT — see credentialElicitationHttp.ts.

// The manual route names the button as it is actually labelled in the app (`modelSetup.addModel` /
// `customApiTitle`). It used to say "添加连接" / "Add connection", which appears nowhere in the UI — an
// escape hatch nobody can follow is not an escape hatch (cf. docs/lessons/vendor-manage-is-a-
// discoverability-problem.md). If those labels are renamed, this copy has to move with them.
const POLL_INTERVAL_MS = 1000
const DEFAULT_WAIT_MS = 5 * 60 * 1000

const L = (locale: ResultLocale, zh: string, en: string): string => (locale === 'en' ? en : zh)

const COPY = {
  ask: (locale: ResultLocale, name: string) => L(
    locale,
    `Nomi 需要「${name}」的 API 密钥。请打开这个 Nomi 本机页面填写——密钥只留在你的电脑上，不会经过这个对话。`,
    `Nomi needs the API key for "${name}". Open this local Nomi page to enter it — the key stays on your computer and never passes through this conversation.`,
  ),
  declined: (locale: ResultLocale) => L(
    locale,
    '没拿到密钥：安全页被取消或超时了。要手动接入就打开 Nomi → 设置 → 模型 →「添加一个 AI 模型」，在那里保存 key，然后让我继续。',
    'No key was received: the secure page was cancelled or timed out. To do it by hand, open Nomi → Settings → Models → "Add an AI model", save the key there, then ask me to continue.',
  ),
  manual: (locale: ResultLocale, name: string, opened: boolean) => L(
    locale,
    opened
      ? `你的 AI 客户端不支持 MCP 的 URL 模式 elicitation。Nomi 窗口已经打开在接入「${name}」的页面，粘上 key 保存后让我继续。`
      : `Nomi 没在运行。请先打开 Nomi → 设置 → 模型 →「添加一个 AI 模型」，在那里保存「${name}」的 key，然后让我继续。`,
    opened
      ? `Your AI client does not support MCP URL-mode elicitation. The Nomi window is open on the "${name}" setup page; paste the key, save it, then ask me to continue.`
      : `Nomi is not running. Open Nomi → Settings → Models → "Add an AI model", save the key for "${name}" there, then ask me to continue.`,
  ),
  // A `decline` is NOT evidence that a human said no. Measured 2026-09-06 against Codex CLI 0.153.4,
  // which declares `elicitation:{form:{},url:{}}` and then answers url-mode requests with
  // `{"action":"decline"}` without ever showing the URL to anyone (openai/codex#11816). Reporting that
  // as "the secure page was cancelled or timed out" blamed the user for cancelling a page they never
  // saw — and it came back as a tool error, so the agent had nothing left to do. Say what is actually
  // known ("it did not open"), and keep the flow alive by handing back the same manual route.
  notOpened: (locale: ResultLocale, name: string, opened: boolean) => L(
    locale,
    opened
      ? `填写页没有在你的 AI 客户端里打开（有些客户端会直接拒掉这类链接，也可能是你取消了）。Nomi 窗口已经打开在接入「${name}」的页面，粘上 key 保存后让我继续。`
      : `填写页没有打开，且 Nomi 没在运行。请先打开 Nomi → 设置 → 模型 →「添加一个 AI 模型」，在那里保存「${name}」的 key，然后让我继续。`,
    opened
      ? `The entry page did not open in your AI client (some clients refuse these links outright, or you may have cancelled it). The Nomi window is open on the "${name}" setup page; paste the key, save it, then ask me to continue.`
      : `The entry page did not open and Nomi is not running. Open Nomi → Settings → Models → "Add an AI model", save the key for "${name}" there, then ask me to continue.`,
  ),
}

type Ticket = { elicitationId: string; url: string; sessionId: string; display: { name: string } }

export type CredentialElicitationOutcome =
  | { kind: 'result'; result: Record<string, unknown> }
  | { kind: 'error'; message: string }

function ticketOf(projection: unknown): Ticket | null {
  const entry = (projection as Record<string, unknown> | null)?.credentialEntry as Record<string, unknown> | undefined
  if (!entry || typeof entry.url !== 'string' || typeof entry.elicitationId !== 'string') return null
  const display = (entry.display || {}) as Record<string, unknown>
  return {
    elicitationId: entry.elicitationId,
    url: entry.url,
    sessionId: String(entry.sessionId || ''),
    display: { name: typeof display.name === 'string' ? display.name : '' },
  }
}

/** Everything but the spent one-time ticket. Nothing downstream should ever see it again. */
function withoutTicket(projection: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  const record = { ...(projection as Record<string, unknown> | null ?? {}) }
  delete record.credentialEntry
  delete record.credentialUiOpened
  return extra ? { ...record, ...extra } : record
}

export async function runIntegrationCredentialElicitation(input: {
  built: Record<string, unknown>
  invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>
  elicitation: Pick<ElicitationClient, 'requestUrl' | 'notifyComplete'>
  locale?: ResultLocale
  wait?: (ms: number) => Promise<void>
  waitMs?: number
  signal?: AbortSignal
}): Promise<CredentialElicitationOutcome> {
  const locale = input.locale ?? 'zh-CN'
  const opened = await input.invoke('integration.open_credentials', input.built)
  const uiOpened = (opened as Record<string, unknown> | null)?.credentialUiOpened === true
  const ticket = ticketOf(opened)
  // The provider name for the manual instruction: the ticket knows it, and so does the projection when
  // no ticket could be minted. Never a placeholder — the user has to recognise which connection to open.
  const projectionName = String(((opened as Record<string, unknown> | null)?.config as Record<string, unknown> | undefined)?.name || '')
  const manual = (name: string) => ({ mode: 'manual' as const, instructions: COPY.manual(locale, name || projectionName, uiOpened) })
  const notOpened = (name: string) => ({
    mode: 'manual' as const,
    reason: 'not_opened' as const,
    instructions: COPY.notOpened(locale, name || projectionName, uiOpened),
  })
  if (!ticket) {
    // No loopback page available in the owning process. The durable handoff already fired, so the
    // in-app route is live; say so rather than leaving the agent to improvise.
    return { kind: 'result', result: withoutTicket(opened, { credentialEntry: manual('') }) }
  }

  const asked = await input.elicitation.requestUrl({
    elicitationId: ticket.elicitationId,
    url: ticket.url,
    message: COPY.ask(locale, ticket.display.name),
  }, input.signal)

  if (!asked.supported) {
    return { kind: 'result', result: withoutTicket(opened, { credentialEntry: manual(ticket.display.name) }) }
  }
  if (asked.action !== 'accept') {
    // Not an error: the session is still `needs_credential`, the in-app route is live, and the caller
    // has somewhere to go. Only a page that was opened and then abandoned (below) is a real dead end.
    return { kind: 'result', result: withoutTicket(opened, { credentialEntry: notOpened(ticket.display.name) }) }
  }

  // `accept` is consent to open the URL, not proof the key was saved. The session is the only honest
  // source of truth, and polling it works whether the page is served by this process or the open GUI.
  const wait = input.wait || ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const deadline = Date.now() + (input.waitMs ?? DEFAULT_WAIT_MS)
  for (;;) {
    if (input.signal?.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error('MCP request cancelled')
    const current = await input.invoke('integration.get', { sessionId: ticket.sessionId }) as Record<string, unknown>
    if (current?.credentialStatus === 'ready') {
      input.elicitation.notifyComplete(ticket.elicitationId)
      return { kind: 'result', result: withoutTicket(current) }
    }
    if (Date.now() >= deadline) return { kind: 'error', message: COPY.declined(locale) }
    await wait(POLL_INTERVAL_MS)
  }
}
