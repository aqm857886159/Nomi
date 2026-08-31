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
  projectLocation: {
    get: () => Promise<DesktopProjectLocationResult>
    pick: () => Promise<DesktopProjectLocationResult>
    reset: () => Promise<DesktopProjectLocationResult>
    reveal: () => Promise<DesktopProjectLocationResult>
  }
  automationPolicy: {
    get: () => Promise<import('../../electron/settings/automationPolicyContract').AutomationPolicySettings>
    set: (payload: unknown) => Promise<import('../../electron/settings/automationPolicyContract').AutomationPolicySettings>
  }
  videoAnalysis: {
    get: () => Promise<import('../../electron/settings/videoAnalysisSettings').VideoAnalysisSettings>
    set: (payload: {
      engineOrigin?: string
      apiToken?: string
      clearApiToken?: boolean
      externalInference?: boolean
      engineSourceRetention?: 'delete_after_analysis' | 'keep'
    }) => Promise<import('../../electron/settings/videoAnalysisSettings').VideoAnalysisSettings>
  }
}
