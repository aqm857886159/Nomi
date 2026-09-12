import { IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react'
import type { WorkspaceSyncInspection } from '../../../electron/shared/workspaceSyncContracts'

/**
 * 同步角标的**说法表**：一个状态 → 角标短词 / 完整那句 / 浮层标题与解释 / 色调 / 图标。
 * 住在组件外面，因为它是纯的（可单测），而组件文件只导出组件（fast-refresh）。
 */
export type SyncTone = 'ready' | 'warn' | 'danger'

export type SyncFace = {
  /** 角标上那两到四个字。 */
  badge: string
  /** 完整那句（悬停提示 + 浮层标题下的解释）。 */
  full: string
  title: string
  hint: string
  tone: SyncTone
  Icon: typeof IconCircleCheck
}

export const SYNC_TONE_CLASS: Record<SyncTone, string> = {
  ready: 'text-workbench-success',
  warn: 'text-nomi-warning',
  danger: 'text-workbench-danger',
}

/** 状态 → 这一枚角标的全部长相。一个 switch，别在 JSX 里铺四层三元。 */
export function syncFaceOf(
  inspection: WorkspaceSyncInspection,
  t: (key: string, options?: Record<string, unknown>) => string,
): SyncFace {
  switch (inspection.status) {
    case 'ready':
      return {
        badge: t('library.syncBadgeReady'), full: t('library.syncReady'),
        title: t('library.syncDetailsReady'), hint: t('library.syncDetailsReadyHint'),
        tone: 'ready', Icon: IconCircleCheck,
      }
    case 'external-change':
      return {
        badge: t('library.syncBadgeExternalChange'), full: t('library.syncExternalChange'),
        title: t('library.syncDetailsExternal'), hint: t('library.syncDetailsExternalHint'),
        tone: 'warn', Icon: IconInfoCircle,
      }
    case 'missing-assets':
      return {
        badge: t('library.syncBadgeMissingAssets', { count: inspection.missingAssetCount }),
        full: t('library.syncMissingAssets', { count: inspection.missingAssetCount }),
        title: t('library.syncDetailsMissing'),
        hint: t('library.syncDetailsMissingHint', { count: inspection.missingAssetCount }),
        tone: 'warn', Icon: IconInfoCircle,
      }
    default:
      // conflict / corrupt-manifest：都是「这份项目文件此刻读不下去」，说法一样。
      return {
        badge: t('library.syncBadgeCorrupt'), full: t('library.syncCorrupt'),
        title: t('library.syncDetailsCorrupt'), hint: t('library.syncDetailsCorruptHint'),
        tone: 'danger', Icon: IconAlertTriangle,
      }
  }
}
