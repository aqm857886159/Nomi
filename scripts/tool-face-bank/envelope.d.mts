// envelope.mjs 的类型声明 —— 它同时被真实模型臂（探针 server / DeepSeek 直连）和零额度夹具
// （electron/capabilityCore/modelOnboardingLoopback.test.ts）用，后者要过 `check:test-types`。
// 形状的真相源是题库 `tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json` 的 `_worlds.byState`。

export type ProbeModel = {
  modelKey: string
  kind: string
  visible?: boolean
  lastSelfCheck?: { ok: boolean; code: number; excerpt: string } | null
  notInPickerBecause?: string
}
export type ProbeConnection = {
  vendorKey: string
  name?: string
  baseUrl?: string
  authStyle?: string
  hasStoredKey?: boolean
  models?: ProbeModel[]
  candidates?: ProbeModel[]
}
export type ProbeSetup = {
  id: string
  vendorKey?: string
  name?: string
  waitingOn?: string | null
  step?: string
  compileRequest?: { contractSchema: string }
}
export type ProbeWorld = { connections: ProbeConnection[]; setups: ProbeSetup[] }
export type ProbeEnvelope = {
  ok: boolean
  setupId: string
  vendorKey: string
  changeId: string
  unverified: Array<{ claim: string; why: string }>
  changes: unknown[]
  blastRadius: {
    recordsDeleted: number
    modelsAppearing: number
    modelsDisappearing: number
    outboundRequests: Array<{ url: string; billable: boolean }>
  }
  nextAction: { kind: string; userSees: string; waitWith: string | null; url: string | null }
  state?: { fingerprint: string; connections: ProbeConnection[]; setups: ProbeSetup[] }
}

export function worldFor(state: string): ProbeWorld
export function envelopeFor(
  name: string,
  args: Record<string, unknown>,
  seq?: number,
  world?: ProbeWorld,
): ProbeEnvelope
