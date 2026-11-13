import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconDownload, IconExternalLink, IconTrash, IconX } from '@tabler/icons-react'
import { DesignModal } from '../../design'
import { NomiMarkdown } from '../common/NomiMarkdown'
import { LibraryDetailMeta, LibraryDetailFooter, LibraryDetailIconButton, LibraryDetailPrimary } from '../library/LibraryDetailParts'
import { SkillMedia } from './SkillMedia'
import { galleryBody, type SkillGalleryEntry } from './skillGallery'

/**
 * 技能详情（SkillDetail 板）：右侧一张 720 宽的卡，只关详情、不关库（点背景 / Esc / ×）。
 * 头部 = 封面 + 名字 + 简介 + 一行「分组 · 内置 / 我的 · 来源 ↗ · 许可 · 作者」；底栏 = （我的）删除在最左，导出图标 + 唯一主按钮「放进对话」。
 * 「用到节点」删了（Q4，用户 10-24：把整篇方法正文塞进节点提示词，想用到节点跟 Nomi 说一句）。
 */
export function SkillDetail({ entry, addToChatBlockedReason, onClose, onAddToChat, onExport, onDelete }: {
  entry: SkillGalleryEntry
  /** 「放进对话」现在为什么点不了（没开项目）；有它主按钮就禁用并把原因写在悬停里（C1）。 */
  addToChatBlockedReason?: string
  onClose: () => void
  onAddToChat: () => void
  onExport: () => void
  onDelete?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const invalid = entry.skill.manifestError
  const blockedReason = invalid ? t('libraries.skill.invalidReason') : addToChatBlockedReason
  const author = entry.author?.replace(/^https?:\/\/[^/]+\//, '').split('/')[0]
  return (
    <DesignModal
      opened
      contentAttributes={{ 'data-skill-detail': entry.id }}
      accessibleName={entry.title}
      onClose={onClose}
      title={
        <header className="relative flex shrink-0 gap-5 border-b border-nomi-line px-6 pb-5 pt-6">
          <SkillMedia cover={entry.cover} preview={entry.preview} play illustration={entry.illustration} expiredLabel={t('libraries.prompt.card.expired')}
            className="h-[120px] w-48 shrink-0 overflow-hidden rounded-nomi-sm object-cover" />
          <div className="flex min-w-0 flex-col gap-2 pr-8">
            <span className="m-0 font-nomi-display text-h1 font-medium leading-8 text-nomi-ink" data-skill-detail-title>{entry.title}</span>
            {entry.description ? <p className="m-0 text-body-sm leading-5 text-nomi-ink-60">{entry.description}</p> : null}
            <LibraryDetailMeta data-skill-detail-meta>
              {entry.group ? <span>{entry.group.label}</span> : null}
              <span>{entry.skill.origin === 'user' ? t('libraries.layout.mine') : t('libraries.layout.segment.builtin')}</span>
              {entry.source ? (
                <a href={entry.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-nomi-ink-60 underline underline-offset-[3px] hover:text-nomi-ink">
                  {t('libraries.gallery.source')}<IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
                </a>
              ) : null}
              <span>{entry.license ?? t('libraries.gallery.licenseUnknown')}</span>
              {author ? <span className="max-w-40 truncate" title={entry.author}>{author}</span> : null}
            </LibraryDetailMeta>
          </div>
          <button
            type="button"
            aria-label={t('libraries.layout.close')}
            onClick={onClose}
            className="absolute right-4 top-4 grid size-7 cursor-pointer place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink"
            data-skill-detail-close
          >
            <IconX size={16} stroke={2} />
          </button>
        </header>
      }
      actions={
        <LibraryDetailFooter
          leading={onDelete ? (
            <LibraryDetailIconButton danger icon={<IconTrash size={16} stroke={1.8} />} label={t('libraries.skill.deleteSkill')} onClick={onDelete} data-skill-detail-delete />
          ) : null}
        >
          <LibraryDetailIconButton icon={<IconDownload size={16} stroke={1.8} />} label={t('libraries.skill.exportPackage')} onClick={onExport} data-skill-detail-export />
          <LibraryDetailPrimary disabledReason={blockedReason} onClick={onAddToChat} data-skill-detail-add-to-chat>
            {t('libraries.skill.addToChat')}
          </LibraryDetailPrimary>
        </LibraryDetailFooter>
      }
      withCloseButton={false}
      size={720}
      padding={0}
      xOffset={24}
      yOffset={48}
      styles={{ inner: { justifyContent: 'flex-end' } }}
      classNames={{ content: 'rounded-modal bg-nomi-paper shadow-nomi-lg', header: 'p-0', title: 'w-full', body: 'p-0' }}
    >
      <div>

        <div className="px-6 py-5">
          <div className="max-w-[640px] text-body leading-relaxed text-nomi-ink-80">
            {invalid ? <p role="alert" className="mb-3 mt-0 text-caption text-workbench-danger" data-skill-detail-invalid>{invalid}</p> : null}
            <NomiMarkdown>{galleryBody(entry)}</NomiMarkdown>
          </div>
        </div>

      </div>
    </DesignModal>
  )
}
