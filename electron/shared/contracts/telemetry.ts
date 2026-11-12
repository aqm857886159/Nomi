export type TelemetryStatus = 'disabled' | 'unconfigured' | 'configured'
export const TELEMETRY_RESULT_VALUES = ['success', 'failure', 'cancel'] as const
export type TelemetryResult = typeof TELEMETRY_RESULT_VALUES[number]
export type DurationBucket = '<1s' | '1-5s' | '>5s'
export type CapabilitySlot = 'text' | 'image' | 'image-edit' | 'video' | 'audio' | '3d'
/**
 * 生成失败的「类别码」形状（照 OpenTelemetry `error.type`：低基数的错误类别，不是消息）。
 * 取值只来自 `GenerationErrorKind`（src/workbench/observability/narrate.ts）这一张分类表；
 * 主进程在门口只认形状（短的 kebab-case 标识），装不下一句话、一个路径或一个 URL。
 */
export const TELEMETRY_ERROR_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/
export type TelemetrySettingsView = {
  schemaVersion: 1
  enabled: boolean
  endpointMode: 'nomi'
  consentedAt: string | null
  installSessionId: string | null
  /** 用户同意的告知范围版本；小于当前版本（2）= 需要在界面上重新确认一次。 */
  scopeVersion: 1 | 2
  endpointConfigured: boolean
  status: TelemetryStatus
}
export type TelemetrySummaryItem = { eventName: string; timestamp: string }
export type TelemetrySummary = {
  pending: TelemetrySummaryItem[]
  sent: TelemetrySummaryItem[]
  pendingCount: number
  sentCount: number
  failedCount: number
  endpointConfigured: boolean
}

/**
 * 出站被拒的子码（`network.outbound.refused`，2026-11-12）：回答「拦下的是哪一步、哪种原因、走的哪条路、
 * 地址属于哪一类、本机有没有合成解析、探测当时是什么状态」。全部是枚举：没有地址、域名、URL 或用户内容。
 * 判据在 `electron/networkOutboundPolicy.ts`，这里只是它对外说话用的词表（主进程门口按它校验）。
 */
export const OUTBOUND_REFUSAL_STAGES = ['submit', 'retrieval'] as const
export const OUTBOUND_REFUSAL_REASONS = ['private-host', 'private-address', 'unresolvable'] as const
export const OUTBOUND_REFUSAL_ROUTES = ['direct', 'app-proxy', 'provider-proxy'] as const
export const OUTBOUND_ADDRESS_FAMILIES = ['4', '6', 'none'] as const
/** 地址类别按 RFC 段名分，不按代理软件分。 */
export const OUTBOUND_ADDRESS_CLASSES = [
  'name', 'loopback', 'rfc1918', 'cgnat', 'link-local', 'benchmarking-v4',
  'unique-local-v6', 'ietf-protocol-v6', 'other-reserved', 'public', 'none',
] as const
/** 拒绝那一刻探测的状态：没探 / 确认是合成解析 / 没确认 / 当场重探后仍没确认。 */
export const OUTBOUND_PROBE_OUTCOMES = ['not-probed', 'confirmed', 'unconfirmed', 'unconfirmed-after-reprobe'] as const
export type OutboundAddressClass = typeof OUTBOUND_ADDRESS_CLASSES[number]
export type OutboundProbeOutcome = typeof OUTBOUND_PROBE_OUTCOMES[number]
export type OutboundRefusalTelemetryProps = {
  stage: typeof OUTBOUND_REFUSAL_STAGES[number]
  reason: typeof OUTBOUND_REFUSAL_REASONS[number]
  route: typeof OUTBOUND_REFUSAL_ROUTES[number]
  addressFamily: typeof OUTBOUND_ADDRESS_FAMILIES[number]
  addressClass: OutboundAddressClass
  syntheticResolver: boolean
  probe: OutboundProbeOutcome
}
