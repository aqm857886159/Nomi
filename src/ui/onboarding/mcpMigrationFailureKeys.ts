import type { McpMigrationFailure, McpMigrationResult } from '../../desktop/mcpBridgeTypes'

// 迁移没改成的原因 → i18n 键尾（onboardingProviders.assistant.migration.failed.*）。
export const FAILURE_I18N: Record<McpMigrationFailure, string> = {
  'not-migratable': 'notMigratable',
  'client-not-installed': 'notMigratable',
  'isolated-instance': 'isolatedInstance',
  'config-unreadable': 'configUnreadable',
  'http-unavailable': 'unavailable',
  'backup-failed': 'backupFailed',
  'write-failed': 'writeFailed',
  'host-changed': 'hostChanged',
  'read-only': 'readOnly',
}

/** 「再试一次」只重试没改成的宿主；已改好的不再碰。 */
export function retryTargets(results: readonly McpMigrationResult[]): string[] {
  return results.filter((r) => !r.ok).map((r) => r.client)
}

/** 重试后的合并：已改好的保留原结果，失败的换成新结果。 */
export function mergeRetryResults(previous: readonly McpMigrationResult[], retried: readonly McpMigrationResult[]): McpMigrationResult[] {
  const byClient = new Map(retried.map((r) => [r.client, r]))
  return previous.map((r) => (r.ok ? r : byClient.get(r.client) ?? r))
}
