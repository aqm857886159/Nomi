// 准入拒绝 → 人话（唯一一处）。
//
// 为什么要收口（2026-09-14 用户：「这地方要通用支持」）：拒绝文案此前每个入口各写各的，
// 而且全都只给计数不给数字——「已跳过：1 个过大」既没说多大、也没说上限是多少、更没说为什么，
// 用户拿它什么也做不了（D1：任何让用户去猜的东西默认砍）。这里把 rejection 里的机器可读数字
// 翻成一句能行动的话，所有入口调它。
import i18n from '../../i18n'
import type { TranslationKey } from '../../i18n/translationKey'
import {
  formatMediaBytes,
  type MediaImportRejection,
  type MediaKind,
} from '../../../electron/shared/contracts/mediaImportPolicy'

/**
 * 媒体种类 → 用户面的名字。**整键字面量**，由 `check:i18n-key-refs` 的第 ③ 条验存在性
 * （2026-09-17 W-02 之后它才真的扫得到 satisfies 里的键）。
 */
const KIND_LABEL_KEY = {
  image: 'assetLibrary.image',
  video: 'assetLibrary.video',
  audio: 'assetLibrary.audio',
  model3d: 'assetLibrary.model3d',
  document: 'assetLibrary.document',
  text: 'assetLibrary.text',
} as const satisfies Record<MediaKind, TranslationKey>

/**
 * 「这个位置只收 X、Y」里的那串 X、Y —— **从 rejection 自己带的 `accepted` 派生**，
 * 不是每个面各写一句散文（2026-09-17，W-18）。
 *
 * 为什么必须派生：原来这一格填的是 `MEDIA_IMPORT_SURFACES[*].narrowedBecause`，
 * 一句**写死的中文**（它住在 `electron/shared/`，是给开发者看的领域理由，不是用户文案）。
 * 它被塞进一条已翻译的句子里，于是英文界面拿到的是「破折号前英文、破折号后整段中文」——
 * 一句用户看不懂的解释。派生之后没有任何一格能再漏中文进来。
 */
function acceptedKindsText(accepted: readonly MediaKind[]): string {
  return accepted.map((kind) => i18n.t(KIND_LABEL_KEY[kind])).join(i18n.t('assetLibrary.listSeparator'))
}

export function mediaImportRejectionMessage(fileName: string, rejection: MediaImportRejection): string {
  const name = fileName || i18n.t('assetLibrary.unnamedFile')
  switch (rejection.reason) {
    case 'unsupported-kind':
      // 认得出是什么、只是这个面不收它 → 说清这个面收什么；压根认不出（.txt 这种）→
      // 只说「不是 Nomi 认得的媒体格式」，不许拿这个面的收窄理由去解释一个它根本没判过的文件
      // （W-09：用户拖了个 .txt，得到的解释是「音频与 3D 在画布上没有节点可落」）。
      return rejection.kind
        ? i18n.t('assetLibrary.rejectedUnsupportedKind', { name, accepted: acceptedKindsText(rejection.accepted) })
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
