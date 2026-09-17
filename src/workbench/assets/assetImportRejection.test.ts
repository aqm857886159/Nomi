import { describe, expect, it } from 'vitest'
import {
  ASSET_IMPORT_REJECTION_TEXT_KEY,
  assetImportRejectionCode,
  firstAssetImportRejection,
  unsupportedKindRejection,
} from './assetImportRejection'

// 「每个码都指回一条真实存在的词条」**不是** `satisfies Record<string, TranslationKey>` 管住的：
// `TranslationKey = ParseKeys` 对未知点分键回落 string，编译期一声不吭（2026-09-17 W-02 实证：
// `unsupported` 曾指着一条两边词典都没有的 `assetLibrary.skippedUnsupported` 出厂）。
// 现在由 `scripts/check-i18n-key-refs.ts` 的第 ③ 条（satisfies TranslationKey 整键字面量）扫住。

describe('导入被拒：码 → 人话的唯一 owner', () => {
  it('重复素材**不是**被拒：它那一份已经在库里，什么都没被挡住', () => {
    expect(Object.keys(ASSET_IMPORT_REJECTION_TEXT_KEY)).not.toContain('duplicate')
    // 「过大 / 没磁盘 / 类型不收」也不在这张计数表里：它们的人话由准入闸派生（带真实数字）。
    expect(Object.keys(ASSET_IMPORT_REJECTION_TEXT_KEY)).not.toContain('too-large')
  })

  it('按「用户最想问为什么」排序取第一个：准入闸挡下 → 超单次上限 → 失败', () => {
    // 准入闸那支的人话来自 mediaImportMessage（带真实字节数与上限），码带 policy 的 reason。
    const policy = firstAssetImportRejection({
      rejected: [{ fileName: 'big.mp4', rejection: { reason: 'over-hard-cap', fileBytes: 3e9, capBytes: 2e9, because: '硬上限' } }],
      skippedOverLimitCount: 1,
      failedCount: 3,
    })
    expect(policy?.errorKind).toBe('asset-import-over-hard-cap')
    expect(policy?.summary).toContain('big.mp4')
    expect(firstAssetImportRejection({ skippedOverLimitCount: 1, failedCount: 3 })?.errorKind)
      .toBe('asset-import-over-limit')
    expect(firstAssetImportRejection({ failedCount: 3 })?.errorKind).toBe('asset-import-failed')
  })

  it('「这个类型放不下」的摘要是人话、且与内联行同源（W-02：它曾是一串原始 key）', () => {
    const report = unsupportedKindRejection('9月12日(1).txt')
    expect(report.errorKind).toBe('asset-import-unsupported')
    expect(report.summary).toContain('9月12日(1).txt')
    // 摘要就是发进报文的 `context.summary`。它长得像一个键 = 真正的问题描述在传输里丢了。
    expect(report.summary).not.toMatch(/^[a-zA-Z]+\.[a-zA-Z]/)
  })

  it('什么都没被挡住就返回 null —— 没有被拒就没有反馈入口', () => {
    expect(firstAssetImportRejection({})).toBeNull()
    expect(firstAssetImportRejection({ rejected: [], skippedOverLimitCount: 0, failedCount: 0 })).toBeNull()
  })

  it('出门的码带 asset-import- 前缀，与生成域的 asset-too-large 刻意分家', () => {
    expect(assetImportRejectionCode('over-limit')).toBe('asset-import-over-limit')
    expect(assetImportRejectionCode('unsupported')).toBe('asset-import-unsupported')
    // 准入闸的 reason 直接当码用：分诊按它聚类，不再另立一套自己的名字。
    expect(assetImportRejectionCode('no-disk-space')).toBe('asset-import-no-disk-space')
  })
})
