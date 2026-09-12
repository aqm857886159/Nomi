/**
 * Harness-only contract for the model-access journeys.
 *
 * The journey fact source is manifest.mjs (+ electron/shared/contracts/modelAccessCapabilities.ts).
 * This file holds only what the *test harness* needs on top of that fact source
 * and that the manifest deliberately does not carry:
 *   - which onboarding-drawer component each journey drives (used to prove every
 *     rendered access surface has an owning journey or a scoped exclusion), and
 *   - the drawer components that are intentionally not model-access surfaces.
 *
 * Journey ids here must stay a subset of manifest.mjs ids; a mismatch is caught
 * by inventory.test.mjs.
 */

// Journey id → onboarding-drawer components that journey is responsible for.
// Journeys with no owned drawer surface are simply absent. Page/task variants of
// an access method are owned by the same journey as the method's card, so the
// journey matrix keeps covering that method regardless of which surface renders.
export const JOURNEY_ENTRY_COMPONENTS = Object.freeze({
  J01: ['OnboardingWizard'],
  // Known-vendor single-key access: card in the list + full-page connect form.
  J02: ['VendorOnboardCard', 'KnownVendorKeyConnectPage'],
  // Provider-adapter verification/repair also renders as a task list + workspace.
  J05: ['AdapterTaskList', 'AdapterTaskWorkspace'],
  J06: ['CustomCallEditor'],
  J07: ['CustomVendorCard'],
  J08: ['ComfyuiLocalCard', 'AddComfyuiInstanceButton'],
  J09: ['DreaminaMemberCard'],
  J10: ['CodexLocalImageCard'],
  // Local OpenAI-compatible text runtime discovery + one-click connect card.
  J16: ['LocalModelCard'],
})

export const IGNORED_DRAWER_COMPONENTS = Object.freeze({
  NetworkSection: 'network settings shared by all providers, not an access method',
  // Model-settings/workspace navigation chrome for already-connected models —
  // these host the access-method surfaces above, they are not new access methods.
  ModelSettingsHome: 'settings home/navigation shell for existing connections, not an access method',
  ModelSettingsDetailDialog: 'detail dialog chrome for an already-connected model, not an access method',
  ModelSettingsDetailBoundary: 'error boundary around the model detail view, not an access method',
  ModelWorkspacePage: 'workspace container for existing model settings, not an access method',
  ModelWorkspaceRecovery: 'recovery shell for the model workspace, not an access method',
  ConnectionWorkspacePage: 'workspace container for an existing connection, not an access method',
  ModelCapabilityEditor: 'edits capabilities of an already-connected model, not an access method',
  // Separate connector/certification flows with their own end-to-end coverage.
  AntigravityConnectionCard: 'Antigravity connector has its own connection flow outside the model-access matrix',
  IntegrationSelfCheckPanel: 'conversational integration certification has its own free self-check flow',
})
