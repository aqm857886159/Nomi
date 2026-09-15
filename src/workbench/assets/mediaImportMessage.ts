// 准入拒绝 → 人话（唯一一处）。
//
// 为什么要收口（2026-09-14 用户：「这地方要通用支持」）：拒绝文案此前每个入口各写各的，
// 而且全都只给计数不给数字——「已跳过：1 个过大」既没说多大、也没说上限是多少、更没说为什么，
// 用户拿它什么也做不了（D1：任何让用户去猜的东西默认砍）。这里把 rejection 里的机器可读数字
// 翻成一句能行动的话，所有入口调它。
import i18n from '../../i18n'
import {
  formatMediaBytes,
  type MediaImportRejection,
} from '../../../electron/shared/contracts/mediaImportPolicy'

export function mediaImportRejectionMessage(fileName: string, rejection: MediaImportRejection): string {
  const name = fileName || i18n.t('assetLibrary.unnamedFile')
  switch (rejection.reason) {
    case 'unsupported-kind':
      return rejection.narrowedBecause
        ? i18n.t('assetLibrary.rejectedUnsupportedKind', { name, because: rejection.narrowedBecause })
        : i18n.t('assetLibrary.rejectedUnsupportedUnknown', { name })
    case 'no-disk-space':
      return i18n.t('assetLibrary.rejectedNoDiskSpace', {
        name,
        size: formatMediaBytes(rejection.fileBytes),
        free: formatMediaBytes(rejection.freeBytes),
      })
    case 'over-hard-cap':
      return i18n.t('assetLibrary.rejectedOverHardCap', {
        name,
        size: formatMediaBytes(rejection.fileBytes),
        cap: formatMediaBytes(rejection.capBytes),
        because: rejection.because,
      })
  }
}

/** 一批拒绝 → 逐条人话（每条都带自己的数字，不合并成计数）。 */
export function mediaImportRejectionMessages(
  rejected: readonly { fileName: string; rejection: MediaImportRejection }[],
): string[] {
  return rejected.map((item) => mediaImportRejectionMessage(item.fileName, item.rejection))
}
