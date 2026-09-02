/**
 * The single policy owner for the generation.single-shot semantic surface.
 *
 * This module deliberately does not route legacy generation calls. It only
 * classifies tombstones so old aliases remain fail-closed after their handlers
 * and catalog entries are removed.
 */

export const MCP_GENERATION_SINGLE_SHOT_FLAG = 'NOMI_MCP_GENERATION_SINGLE_SHOT_V1' as const
/** Separate opt-in for the paid E1 surface; the base flag only exposes zero-credit planning/editing. */
export const MCP_GENERATION_SINGLE_SHOT_E1_FLAG = 'NOMI_MCP_GENERATION_SINGLE_SHOT_E1_V1' as const
export const DEFAULT_MCP_GENERATION_NEXT_ACTION = 'nomi://settings/automation?section=mcp-generation' as const

export const MCP_GENERATION_READ_SCOPE = Object.freeze(['context', 'read', 'events'] as const)
export const MCP_GENERATION_E0_SCOPE = Object.freeze(['context', 'create', 'plan', 'preview', 'read', 'events'] as const)
export const MCP_GENERATION_E1_SCOPE = Object.freeze([
  'context',
  'create',
  'plan',
  'preview',
  'read',
  'events',
  'gate_request',
  'gate_decide',
  'start',
  'cancel',
  'reconcile',
  'steer',
] as const)

export type McpGenerationCapability = (typeof MCP_GENERATION_E1_SCOPE)[number]
export type McpGenerationPhase = 'schema_only' | 'e0_zero_credit' | 'e1_paid'

export type McpGenerationCheckpointState = Readonly<{
  p0Passed: boolean
  p2Passed: boolean
  p3Passed: boolean
}>

export type McpGenerationPolicySnapshot = Readonly<{
  flagEnabled: boolean
  phase: McpGenerationPhase
  effectiveScope: readonly McpGenerationCapability[]
  checkpoints: McpGenerationCheckpointState
  nextAction: string
}>

export type McpGenerationDecision =
  | Readonly<{ kind: 'allowed'; capability: McpGenerationCapability; phase: McpGenerationPhase }>
  | Readonly<{
      kind: 'blocked'
      capability: McpGenerationCapability
      phase: McpGenerationPhase
      code: 'feature_disabled' | 'phase_not_ready' | 'not_ready'
      nextAction: string
    }>

export type LegacyMcpGenerationRoute = 'generate' | 'nomi_generate' | 'production.start' | 'production.control' | 'production.decide-gate' | 'nomi_start_playbook'

export type McpGenerationRoute =
  | Readonly<{ kind: 'legacy'; route: LegacyMcpGenerationRoute }>
  | Readonly<{ kind: 'semantic' }>

export type McpGenerationPolicyOptions = Readonly<{
  env?: NodeJS.ProcessEnv
  checkpoints?: Partial<McpGenerationCheckpointState>
  nextAction?: string
}>

export type McpGenerationPolicy = Readonly<{
  snapshot(): McpGenerationPolicySnapshot
  isSingleShotEnabled(): boolean
  decide(capability: McpGenerationCapability): McpGenerationDecision
  classifyRoute(route: string): McpGenerationRoute
}>

// 这六条 legacy 生成路显式标 legacy（runtime plan §7 + P4 S7 收敛映射表，
// docs/plan/2026-08-25-p4-s7-legacy-converge.md §2）：guardLegacyGenerationRoute 见语义 binding 即拒
// （legacy_path_forbidden），不与新路径双写项目事实。集合缩水 = 语义 binding 可能从旧路穿透双写，
// 由 check:batch-machines 规则 legacy-routes-shrunk 钉死。挪动任何一条必须同步收敛映射表。
const LEGACY_GENERATION_ROUTES: ReadonlySet<LegacyMcpGenerationRoute> = new Set([
  'generate',
  'nomi_generate',
  'production.start',
  'production.control',
  'production.decide-gate',
  'nomi_start_playbook',
])

function readFlag(raw: string | undefined): boolean {
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'on'
}

function normalizeCheckpoints(checkpoints: Partial<McpGenerationCheckpointState> | undefined): McpGenerationCheckpointState {
  return Object.freeze({
    p0Passed: checkpoints?.p0Passed === true,
    p2Passed: checkpoints?.p2Passed === true,
    p3Passed: checkpoints?.p3Passed === true,
  })
}

function derivePhase(flagEnabled: boolean, checkpoints: McpGenerationCheckpointState): McpGenerationPhase {
  if (!flagEnabled || !checkpoints.p0Passed || !checkpoints.p2Passed) return 'schema_only'
  return checkpoints.p3Passed ? 'e1_paid' : 'e0_zero_credit'
}

function scopeFor(phase: McpGenerationPhase): readonly McpGenerationCapability[] {
  if (phase === 'e1_paid') return MCP_GENERATION_E1_SCOPE
  if (phase === 'e0_zero_credit') return MCP_GENERATION_E0_SCOPE
  return MCP_GENERATION_READ_SCOPE
}

function isReadOnlyCapability(capability: McpGenerationCapability): boolean {
  return (MCP_GENERATION_READ_SCOPE as readonly string[]).includes(capability)
}

function isE0Capability(capability: McpGenerationCapability): boolean {
  return (MCP_GENERATION_E0_SCOPE as readonly string[]).includes(capability)
}

/**
 * Build the immutable policy used by the real desktop RPC and stdio entrypoints.
 *
 * The base feature flag is deliberately enough for E0 (context/create/edit/preview)
 * but never opens a paid gate by itself.  E1 requires a second explicit flag so a
 * rollout or test cannot accidentally turn on provider submission merely by enabling
 * the editable planning surface.
 */
export function createRuntimeMcpGenerationPolicy(env: NodeJS.ProcessEnv = process.env): McpGenerationPolicy {
  const baseEnabled = readFlag(env[MCP_GENERATION_SINGLE_SHOT_FLAG])
  const paidEnabled = baseEnabled && readFlag(env[MCP_GENERATION_SINGLE_SHOT_E1_FLAG])
  return createMcpGenerationPolicy({
    env,
    checkpoints: {
      p0Passed: baseEnabled,
      p2Passed: baseEnabled,
      p3Passed: paidEnabled,
    },
  })
}

export function createMcpGenerationPolicy(options: McpGenerationPolicyOptions = {}): McpGenerationPolicy {
  // Read the environment exactly once while constructing this immutable policy
  // snapshot. Callers that need a new rollout state must create a new snapshot.
  const env = options.env ?? process.env
  const flagEnabled = readFlag(env[MCP_GENERATION_SINGLE_SHOT_FLAG])
  const checkpoints = normalizeCheckpoints(options.checkpoints)
  const phase = derivePhase(flagEnabled, checkpoints)
  const nextAction = options.nextAction ?? DEFAULT_MCP_GENERATION_NEXT_ACTION
  const snapshot = Object.freeze({
    flagEnabled,
    phase,
    effectiveScope: scopeFor(phase),
    checkpoints,
    nextAction,
  })

  return {
    snapshot: () => snapshot,
    isSingleShotEnabled: () => flagEnabled,
    decide: (capability) => {
      if (!flagEnabled) {
        return {
          kind: 'blocked',
          capability,
          phase,
          code: 'feature_disabled',
          nextAction,
        }
      }

      if (phase === 'schema_only' && !isReadOnlyCapability(capability)) {
        return {
          kind: 'blocked',
          capability,
          phase,
          code: 'phase_not_ready',
          nextAction,
        }
      }

      if (phase === 'e0_zero_credit' && !isE0Capability(capability)) {
        return {
          kind: 'blocked',
          capability,
          phase,
          code: 'not_ready',
          nextAction,
        }
      }

      return { kind: 'allowed', capability, phase }
    },
    classifyRoute: (route) => {
      if (LEGACY_GENERATION_ROUTES.has(route as LegacyMcpGenerationRoute)) {
        return { kind: 'legacy', route: route as LegacyMcpGenerationRoute }
      }
      return { kind: 'semantic' }
    },
  }
}
