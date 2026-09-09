export type DesktopProjectLocation = {
  path: string
  source: 'environment' | 'custom' | 'default'
}

export type DesktopProjectLocationError =
  | 'not-directory'
  | 'not-writable'
  | 'open-failed'
  | 'managed-by-environment'

export type DesktopProjectLocationResult =
  | { ok: true; location: DesktopProjectLocation; canceled?: boolean }
  | { ok: false; error: DesktopProjectLocationError }

export type DesktopSettingsBridge = {
  attentionSound: import("../../electron/shared/contracts/attentionSound").AttentionSoundBridge
  projectLocation: {
    get: () => Promise<DesktopProjectLocationResult>
    check: () => Promise<DesktopProjectLocationResult>
    pick: () => Promise<DesktopProjectLocationResult>
    reset: () => Promise<DesktopProjectLocationResult>
    reveal: () => Promise<DesktopProjectLocationResult>
  }
  automationPolicy: {
    get: () => Promise<import('../../electron/settings/automationPolicyContract').AutomationPolicySettings>
    set: (payload: unknown) => Promise<import('../../electron/settings/automationPolicyContract').AutomationPolicySettings>
  }
  assetRelay: {
    get: () => Promise<{ enabled: boolean; endpoint: string; hasToken: boolean }>
    set: (payload: { enabled: boolean; endpoint: string; token?: string; clearToken?: boolean }) =>
      Promise<{ enabled: boolean; endpoint: string; hasToken: boolean }>
  }
  systemPrompts: {
    get: () => Promise<import('../../electron/settings/systemPromptsContract').SystemPromptOverrides>
    set: (payload: unknown) => Promise<import('../../electron/settings/systemPromptsContract').SystemPromptOverrides>
  }
  generationModelDefaults: {
    get: () => Promise<import('../../electron/settings/generationModelDefaultsContract').GenerationModelDefaults>
    set: (payload: unknown) => Promise<import('../../electron/settings/generationModelDefaultsContract').GenerationModelDefaults>
  },
  vendorPreference: {
    get: () => Promise<import('../../electron/shared/contracts/vendorPreference').VendorPreferenceSettings>
    set: (payload: unknown) => Promise<import('../../electron/shared/contracts/vendorPreference').VendorPreferenceSettings>
  }
  canvasMenuPreference: {
    get: () => Promise<import('../../electron/shared/contracts/canvasMenuPreference').CanvasMenuPreferenceSettings>
    set: (payload: unknown) => Promise<import('../../electron/shared/contracts/canvasMenuPreference').CanvasMenuPreferenceSettings>
  }
  telemetry?: {
    get: () => Promise<import('../../electron/shared/contracts/telemetry').TelemetrySettingsView>
    set: (payload: unknown) => Promise<import('../../electron/shared/contracts/telemetry').TelemetrySettingsView>
    summary: () => Promise<import('../../electron/shared/contracts/telemetry').TelemetrySummary>
    deleteAll: () => Promise<{ deletedCount: number }>
  }
  diagnostics?: {
    exportBundle: () => Promise<import('../../electron/shared/contracts/diagnostics').DiagnosticsExportResult>
    openTraceDirectory?: (laneName?: string) => Promise<import('../../electron/shared/contracts/agentTrace').AgentTraceOpenResult>
  }
}
