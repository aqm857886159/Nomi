/**
 * 「找参考」在素材库里的**外壳**：一条返回条 + 面板本体。
 *
 * 为什么单独一个文件：它接管整个素材区（不是插在网格上面把网格推走），
 * 这层「接管 + 怎么回去」的编排跟素材库自己的列表/筛选/选择逻辑是两件事；
 * 塞回 AssetLibraryPanel 会把那个文件顶过 800 行（R9/R12 实测 801 行当场红）。
 *
 * 接管而不是推开的由来见 docs/qa/2026-09-08-find-reference-walkthrough.md P0-1：
 * 素材库的常态是「一整片已有素材」，推开会让上下文全丢、加完也看不到刚加的那条。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronLeft } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { FindReferencePanel } from './FindReferencePanel'
import type { ReferencePlatform } from '../../../electron/shared/contracts/referenceSearch'

export function FindReferenceSection({
  projectId,
  platform,
  assetCount,
  importedCount,
  onPlatformChange,
  onShareLink,
  onImported,
  onNeedKey,
  onBack,
}: {
  projectId: string | null
  platform: ReferencePlatform
  /** 返回条上的计数——让用户知道「回去」会回到多少东西那儿。 */
  assetCount: number
  /** 这一趟拿了几条。>0 时返回条改口，因为回去落的是「只看参考」而不是整片素材库。 */
  importedCount: number
  onPlatformChange: (platform: ReferencePlatform) => void
  onShareLink: (text: string) => void
  onImported: () => void
  onNeedKey: () => void
  onBack: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        data-find-reference-back
        className={cn(
          'flex items-center gap-1.5 border-b border-nomi-line-soft px-3 py-2 text-left',
          'text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
        )}
        onClick={onBack}
      >
        <IconChevronLeft size={14} stroke={1.8} aria-hidden="true" />
        {importedCount > 0
          ? t('assetLibrary.findReference.backToImported', { count: importedCount })
          : t('assetLibrary.findReference.backToLibrary', { count: assetCount })}
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FindReferencePanel
          projectId={projectId}
          platform={platform}
          onPlatformChange={onPlatformChange}
          onShareLink={onShareLink}
          onImported={onImported}
          onNeedKey={onNeedKey}
        />
      </div>
    </div>
  )
}
