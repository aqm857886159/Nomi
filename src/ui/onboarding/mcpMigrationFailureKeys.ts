import type { McpMigrationFailure } from '../../desktop/mcpBridgeTypes'

// 迁移没改成的原因 → i18n 键尾（onboardingProviders.assistant.migration.failed.*）。
export const FAILURE_I18N: Record<McpMigrationFailure, string> = {
  'not-migratable': 'notMigratable',
  'client-not-installed': 'notMigratable',
  'isolated-instance': 'isolatedInstance',
  'config-unreadable': 'configUnreadable',
  'http-unavailable': 'unavailable',
  'backup-failed': 'backupFailed',
  'write-failed': 'writeFailed',
}
