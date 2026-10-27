import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { AssetImportProgress } from '../store/assetImportProgressStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 服务端渲染只读 zustand 的初始快照，读不到 report 进去的进度；这里把「这张卡的进度」直接喂给组件，
// 比例换算（importRevealRatio）仍用真的。
const fed = vi.hoisted(() => ({ nodeId: 'n-import-converting', progress: undefined as AssetImportProgress | undefined }))
vi.mock('../store/assetImportProgressStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('../store/assetImportProgressStore')>(),
  useAssetImportProgressStore: <T>(selector: (state: { byNode: Record<string, AssetImportProgress | undefined> }) => T): T =>
    selector({ byNode: { [fed.nodeId]: fed.progress } }),
}))
import { NodeImportingOverlay } from './NodeImportingOverlay'

const node = { id: fed.nodeId, meta: { uploadStatus: 'uploading' } } as unknown as GenerationCanvasNode

/** 卡片上那一句阶段词（GenerationWaitingSurface 的 data-process-label）。 */
function labelFor(progress: AssetImportProgress): string {
  fed.progress = progress
  const markup = renderToStaticMarkup(React.createElement(NodeImportingOverlay, { node }))
  return /data-process-label[^>]*>([^<]*)</.exec(markup)?.[1] ?? ''
}

describe('导入卡的「转换格式」阶段词', () => {
  afterAll(async () => { await i18n.changeLanguage('zh-CN') })

  it.each(['zh-CN', 'en'])('知道总时长：带百分比和源文件大小（%s）', async (locale) => {
    await i18n.changeLanguage(locale)
    // 1 MB 的源，转到 35%
    expect(labelFor({ copiedBytes: 367_002, totalBytes: 1_048_576, phase: 'converting' }))
      .toBe(i18n.t('generationCommon.observability.import.converting', { percent: 35, size: '1.0 MB' }))
  })

  it.each(['zh-CN', 'en'])('总时长未知（主进程只报开头的 0）：不带百分比，有大小就带大小（%s）', async (locale) => {
    await i18n.changeLanguage(locale)
    expect(labelFor({ copiedBytes: 0, totalBytes: 1_048_576, phase: 'converting' }))
      .toBe(i18n.t('generationCommon.observability.import.convertingUnmeasured', { size: '1.0 MB' }))
    expect(labelFor({ copiedBytes: 0, totalBytes: 0, phase: 'converting' }))
      .toBe(i18n.t('generationCommon.observability.import.convertingUnmeasuredUnknownSize'))
  })

  it('反例：转换阶段比例为 0 时不许挂着「0%」', async () => {
    await i18n.changeLanguage('zh-CN')
    const label = labelFor({ copiedBytes: 0, totalBytes: 1_048_576, phase: 'converting' })
    expect(label).not.toBe(i18n.t('generationCommon.observability.import.converting', { percent: 0, size: '1.0 MB' }))
    expect(label).not.toContain('0%')
  })

  it('还没开始转换（preparing / 0）仍说「检查中」，不受转换阶段影响', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(labelFor({ copiedBytes: 0, totalBytes: 1_048_576, phase: 'preparing' }))
      .toBe(i18n.t('generationCommon.observability.import.checking', { size: '1.0 MB' }))
  })
})
