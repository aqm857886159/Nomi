// 素材导入被拒的**码 → 人话**：这一族的唯一 owner。
//
// 为什么要有它（2026-09-15）：导入被拒是四个失败面之一，失败面上那颗「反馈」钮需要两样东西
// —— 一个稳定的机器码（用来在接收端按码聚类）和一句人话（印在摘要行上）。
// 人话**必须来自已经在用的那张表**（`src/i18n/locales/assetLibrary.ts` 的 `skipped*` 词条，
// 用户此刻就在内联行上读着它），不许为反馈另写一句：另写一句就是仓库里的第六张
// 错误码→人话表，而那一族的下场写在 `electron/shared/agentLane/laneErrorCodes.ts` 的头注释里。
//
// 所以这份文件里**一个新文案都没有**，只有「哪个计数对应哪个既有词条」这一层映射。
// 整键字面量存在这里而不是在用处拼 `assetLibrary.skipped${X}`：拼出来的动态前缀会盖掉
// 整个命名空间的死键检测（`src/i18n/translationKey.ts` 的理由）。
import i18n from '../../i18n'
import type { TranslationKey } from '../../i18n/translationKey'
import type { AudioImportResult } from './importAudioToLibrary'
import type { GenerationAssetImportResult } from '../generationCanvas/adapters/assetImportAdapter'
import { mediaImportRejectionMessage, mediaImportRejectionMessages } from './mediaImportMessage'
import type { MediaImportRejection } from '../../../electron/shared/contracts/mediaImportPolicy'

/** 交给失败面那颗「反馈」钮的两样东西：给接收端聚类的码 + 印在摘要行上的人话。 */
export type AssetImportRejectionReport = { errorKind: string; summary: string }

/**
 * 被拒的原因 → **整键**。这张表同时是**闭合的原因清单**（类型从它派生，不另立一个只为派型
 * 而存在的数组）。`satisfies` 让编译器保证每个键真的在词典里。
 *
 * `skippedDuplicate` 故意不在里面：重复素材被跳过时，用户想要的那份**已经在库里**，
 * 什么都没被挡住。给它一个「反馈」入口会把一个正常结果说成问题。
 *
 * 「过大 / 没磁盘 / 类型不收」这三支也不在里面：main 2026-09-14 起由准入闸
 * （`electron/shared/contracts/mediaImportPolicy`）逐条给出机器可读数字，人话由
 * `mediaImportMessage` 派生并带上真实字节数与上限——比计数句子多说了用户能行动的那部分，
 * 所以这里直接用它的码与句子，不保留一份只给计数的平行版本（P1）。
 */
export const ASSET_IMPORT_REJECTION_TEXT_KEY = {
  'over-limit': 'assetLibrary.skippedOverLimit',
  failed: 'assetLibrary.skippedFailed',
} as const satisfies Record<string, TranslationKey>

export type AssetImportRejection = keyof typeof ASSET_IMPORT_REJECTION_TEXT_KEY

/**
 * 「这个类型这里放不下」——**不在上面那张计数表里**（2026-09-17，W-02）。
 *
 * 它曾经在，指着 `assetLibrary.skippedUnsupported`，而那条词条**两边词典都没有**：
 * `i18n.t()` 于是把原始 key 原样返回，反馈卡把 `assetLibrary.skippedUnsupported` 印给用户，
 * 并且**就这么发进了报文的 `context.summary`**——真正的问题描述在传输里丢了。
 * （为什么两道防线都没拦住，见 `scripts/check-i18n-key-refs.ts` 新增的第 ③ 条。）
 *
 * 修在这一层而不是「发送前 t() 一下」：摘要的**取字点**就在这里，
 * 而用户此刻在内联行上读到的就是 `rejectedUnsupportedUnknown` 那一句。
 * 两处同源，才不会再出现「界面对、报文错」。计数不进句子——这一支是逐文件挡的，
 * 用户想问的是「我拖的那个文件为什么没进来」，文件名比个数有用。
 */
export function unsupportedKindRejection(fileName: string): AssetImportRejectionReport {
  return {
    errorKind: assetImportRejectionCode('unsupported'),
    summary: i18n.t('assetLibrary.rejectedUnsupportedUnknown', { name: fileName || i18n.t('assetLibrary.unnamedFile') }),
  }
}

/**
 * 出门给接收端的机器码。`asset-import-*` 这个前缀是刻意的：它与
 * `electron/shared/nomiErrorCodes.ts` 的 `asset-too-large` **不是同一件事**——
 * 那个说的是生成时上传通道全挂（HTTP 413），这里说的是素材库导入被本地策略挡住。
 * 两者的下一步动作不同（一个得压缩换模型、一个得换文件），共用一个码会让分诊读错。
 */
export function assetImportRejectionCode(rejection: AssetImportRejection | 'unsupported' | MediaImportRejection['reason']): string {
  return `asset-import-${rejection}`
}

type RejectionCounts = {
  /** 被准入闸逐条挡下的文件（main 2026-09-14 起：策略给机器可读数字，人话由 mediaImportMessage 派生）。 */
  readonly rejected?: readonly { fileName: string; rejection: MediaImportRejection }[]
  readonly skippedOverLimitCount?: number
  readonly failedCount?: number
}

/**
 * 这次导入里**第一个挡住用户的**原因。
 *
 * 只取第一个而不是全部：摘要行是一句话，而「为什么这次没进来」的第一个原因就足以定位；
 * 完整的计数用户仍在内联行上看得到（`skippedSummary` 把它们全列了）。
 * 顺序按「用户最可能想问为什么」排：被准入闸挡下 → 超单次上限 → 失败。
 *
 * 准入闸那一支的人话**不在这里另写**：它来自 `mediaImportMessage`（那是「拒绝 → 人话」的唯一
 * owner，句子里带着真实字节数与上限），码则是 `asset-import-<policy reason>`——分诊按它聚类。
 */
export function firstAssetImportRejection(counts: RejectionCounts): AssetImportRejectionReport | null {
  const admitted = counts.rejected?.[0]
  if (admitted) {
    return {
      errorKind: assetImportRejectionCode(admitted.rejection.reason),
      summary: mediaImportRejectionMessage(admitted.fileName, admitted.rejection),
    }
  }
  if (counts.skippedOverLimitCount) return rejectionOf('over-limit', counts.skippedOverLimitCount)
  if (counts.failedCount) return rejectionOf('failed', counts.failedCount)
  return null
}

/* ── 导入结果 → 用户看到的那句话 + 失败面那颗钮要的上下文 ──────────────────────────
 *
 * 这两个函数 2026-09-15 从 `AssetLibraryPanel.tsx` 搬过来（那份文件破了 800 行上限）。
 * 搬到这里不只是为了让门岗绿：它们算的东西（哪个原因挡住了用户、那句人话是哪一条）
 * 本来就是这份 owner 的职责，留在组件里等于把这一族的判据劈成两半。
 *
 * 那句人话一个字都不在这里新写——逐条拒绝来自 `mediaImportRejectionMessages`，
 * 计数类来自既有的 `assetLibrary.skipped*` 词条，和内联行里用户此刻读到的逐字一致。
 */
export function rejectionOf(rejection: AssetImportRejection, count: number): AssetImportRejectionReport {
  // 这两条词条都是**片段**（「N 个超单次上限」/「N 个失败」），由 `skippedSummary` 包成整句
  // —— 和内联行里看到的逐字一致。
  return {
    errorKind: assetImportRejectionCode(rejection),
    summary: i18n.t('assetLibrary.skippedSummary', { items: i18n.t(ASSET_IMPORT_REJECTION_TEXT_KEY[rejection], { count }) }),
  }
}

export function reportMediaImport(
  result: GenerationAssetImportResult,
  present: (message: string) => void,
  onRejection?: (rejection: AssetImportRejectionReport) => void,
): void {
  const skipped: string[] = mediaImportRejectionMessages(result.rejected)
  if (result.skippedOverLimitCount) skipped.push(i18n.t('assetLibrary.skippedOverLimit', { count: result.skippedOverLimitCount }))
  if (result.skippedDuplicateCount) skipped.push(i18n.t('assetLibrary.skippedDuplicate', { count: result.skippedDuplicateCount }))
  if (result.failedCount) skipped.push(i18n.t('assetLibrary.skippedFailed', { count: result.failedCount }))
  if (skipped.length) present(i18n.t('assetLibrary.skippedSummary', { items: skipped.join(i18n.t('assetLibrary.listSeparator')) }))
  const blocking = firstAssetImportRejection(result)
  if (blocking) onRejection?.(blocking)
}

export function reportAudioImport(
  result: AudioImportResult,
  present: (message: string) => void,
  onRejection?: (rejection: AssetImportRejectionReport) => void,
): void {
  const skipped: string[] = mediaImportRejectionMessages(result.rejected)
  if (result.skippedDuplicateCount) skipped.push(i18n.t('assetLibrary.skippedDuplicate', { count: result.skippedDuplicateCount }))
  if (result.failedCount) skipped.push(i18n.t('assetLibrary.skippedFailed', { count: result.failedCount }))
  if (skipped.length) present(i18n.t('assetLibrary.skippedSummary', { items: skipped.join(i18n.t('assetLibrary.listSeparator')) }))
  const blocking = firstAssetImportRejection(result)
  if (blocking) onRejection?.(blocking)
}
