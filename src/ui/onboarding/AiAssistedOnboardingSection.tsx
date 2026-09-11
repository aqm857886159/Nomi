/**
 * 「用 AI 帮我接入」卡在模型页上的接线层。
 *
 * 分成容器 + 卡两层的理由：卡要能被设计实验室用**真实 props** 陈列（UI 交付定义 = 实验室截图拍板），
 * 所以它一行桥都不许读；桥、订阅、轮询与「首次描边」这些只在真产品里成立的东西住这里。
 *
 * 进度**不新造状态机**：会话真相源是主进程（`integrationSessionGet` 的投影），
 * 这里只做「哪个会话是外部 Agent 在推」+「stage → 五步」两件事。
 */
import React from 'react'

import { getDesktopBridge } from '../../desktop/bridge'
import type { McpInfo } from '../../desktop/mcpBridgeTypes'
import type { IntegrationStage } from '../../../electron/shared/integrationContract'
import { ASSISTANT_CLIENT_LABEL, type AssistantClientKey } from './assistantActivationState'
import { AiAssistedOnboardingCard } from './AiAssistedOnboardingCard'
import { projectAssistedProgress, type AssistedProgressView } from './assistedProgressProjection'

/** 「首次出现给一次 accent 描边，看过即消」——不做常驻高亮（设计定稿 §Checkpoints ①）。 */
const FIRST_SEEN_KEY = 'nomi:assisted-onboarding-seen:v1'
/** 会话轮询间隔。事件驱动拿不到 stage 变化（握手队列只在「要用户做点什么」时才响）。 */
const SESSION_POLL_MS = 1500

type LiveSession = { sessionId: string; host: AssistantClientKey | 'external' }
type SessionSnapshot = {
  stage: IntegrationStage
  name: string
  reasonCode: string | null
}

const TERMINAL: readonly IntegrationStage[] = ['completed', 'failed', 'partial', 'cancelled']

function readSnapshot(value: unknown): SessionSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const stage = record.stage
  if (typeof stage !== 'string') return null
  const config = (record.config ?? {}) as Record<string, unknown>
  const blocking = (record.blockingReason ?? null) as Record<string, unknown> | null
  return {
    stage: stage as IntegrationStage,
    name: typeof config.name === 'string' && config.name.trim() ? config.name : '',
    reasonCode: blocking && typeof blocking.code === 'string' ? blocking.code : null,
  }
}

export function AiAssistedOnboardingSection({
  onManualConnect,
}: {
  onManualConnect: () => void
}): JSX.Element | null {
  const [info, setInfo] = React.useState<McpInfo | null>(null)
  const [session, setSession] = React.useState<LiveSession | null>(null)
  const [snapshot, setSnapshot] = React.useState<SessionSnapshot | null>(null)
  const lastLiveStage = React.useRef<IntegrationStage | null>(null)
  const [firstSeen, setFirstSeen] = React.useState(false)

  const bridge = getDesktopBridge()
  const readMcpInfo = bridge?.capability?.mcpInfo
  const listHandoffs = bridge?.onboarding?.integrationHandoffList
  const subscribeHandoffs = bridge?.onboarding?.integrationHandoffSubscribe
  const getSession = bridge?.onboarding?.integrationSessionGet

  // MCP 快照：卡只拿它判「这家连上没」和「其它」那段配置，读不到就整段状态行不显。
  React.useEffect(() => {
    if (!readMcpInfo) return
    const refresh = () => {
      try {
        setInfo(readMcpInfo() ?? null)
      } catch {
        setInfo(null)
      }
    }
    refresh()
    window.addEventListener('nomi-automation-policy-changed', refresh)
    return () => window.removeEventListener('nomi-automation-policy-changed', refresh)
  }, [readMcpInfo])

  // 谁在推这次接入：握手队列里 ownerClientId 不是 'nomi' 的那条 = 外部 Agent 发起的。
  React.useEffect(() => {
    if (!listHandoffs) return
    let alive = true
    const reload = () => {
      void listHandoffs()
        .then((entries) => {
          if (!alive) return
          const external = [...entries]
            .filter((entry) => entry.ownerClientId !== 'nomi')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .at(-1)
          if (!external) return
          setSession((current) => (
            current?.sessionId === external.sessionId
              ? current
              : { sessionId: external.sessionId, host: external.ownerClientId as LiveSession['host'] }
          ))
        })
        .catch(() => {
          // 老 preload / 桥异常：不显进度，也不谎报失败。
        })
    }
    reload()
    const unsubscribe = subscribeHandoffs?.(reload)
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [listHandoffs, subscribeHandoffs])

  // 会话本体：轮询到终态为止。终态没有步号，所以要记住它出事之前停在哪一步。
  React.useEffect(() => {
    if (!getSession || !session) return
    let alive = true
    let timer: number | null = null
    const tick = () => {
      void getSession(session.sessionId)
        .then((value) => {
          if (!alive) return
          const next = readSnapshot(value)
          setSnapshot(next)
          if (next && !TERMINAL.includes(next.stage)) lastLiveStage.current = next.stage
          if (!next || !TERMINAL.includes(next.stage)) timer = window.setTimeout(tick, SESSION_POLL_MS)
        })
        .catch(() => {
          if (alive) timer = window.setTimeout(tick, SESSION_POLL_MS)
        })
    }
    tick()
    return () => {
      alive = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [getSession, session])

  // 首次描边：读写都包 try/catch（隐私窗口 / 清过站点数据时 localStorage 会直接抛）。
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(FIRST_SEEN_KEY)) return
      setFirstSeen(true)
      window.localStorage.setItem(FIRST_SEEN_KEY, 'seen')
    } catch {
      // 存不下就当看过了：描边是锦上添花，不该因为存储不可用而每次都亮。
    }
  }, [])

  const progress = React.useMemo(() => {
    if (!snapshot) return null
    const view: AssistedProgressView = projectAssistedProgress({
      stage: snapshot.stage,
      lastLiveStage: lastLiveStage.current,
    })
    // 接完就把进度收起来：模型已经在上面的「已接入」里了，卡该退回它本来的样子。
    if (view.outcome === 'completed') return null
    return {
      view,
      name: snapshot.name,
      hostLabel: session && session.host !== 'external' ? ASSISTANT_CLIENT_LABEL[session.host] : null,
      reasonCode: snapshot.reasonCode,
    }
  }, [session, snapshot])

  const openAssistantConnections = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation' } }))
  }, [])

  return (
    <AiAssistedOnboardingCard
      info={info}
      progress={progress}
      onOpenAssistantConnections={openAssistantConnections}
      onManualConnect={onManualConnect}
      firstSeen={firstSeen}
    />
  )
}
