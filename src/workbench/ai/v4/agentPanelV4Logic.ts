import type { ComposerMode, PermissionLabel } from './agentPanelV4Types'
import { PERMISSION_POLICIES } from './agentPanelV4Types'

export function useComposerHeight(panelHeight: number, mode: ComposerMode, lineCount = 1): number {
  const base = mode === 'running' ? 84 : 84
  const max = panelHeight >= 800 ? Math.round(panelHeight * 0.4) : panelHeight >= 640 ? Math.round(panelHeight * 0.3) : 62 + 6 * 22
  if (panelHeight < 640) return Math.min(max, Math.max(base, lineCount * 22 + 62))
  return Math.min(max, Math.max(base, lineCount * 22 + 62))
}

export function approvalPolicyForLabel(label: PermissionLabel) {
  return PERMISSION_POLICIES[label]
}

export function shouldSubmitComposer(event: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}
