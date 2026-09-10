import { useTranslation } from 'react-i18next'
import { DesignModal } from '../../design'
import { NomiMarkdown } from '../common/NomiMarkdown'
import { SkillMedia } from './SkillMedia'
import { galleryBody, type SkillGalleryEntry } from './skillGallery'

export function SkillDetail({ entry, onClose, onReference, onApply, onExport, onDelete }: {
  entry: SkillGalleryEntry; onClose: () => void; onReference: () => void; onApply: () => void
  onExport?: () => void; onDelete?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return <DesignModal opened onClose={onClose} xOffset={24} yOffset={48} styles={{ inner: { justifyContent: 'flex-end' } }} size={972} padding={0} title={t('libraries.gallery.detail')}
    classNames={{ content: 'rounded-nomi-lg bg-nomi-paper', header: 'border-b border-nomi-line px-6 py-4', body: 'p-0' }}>
    <div data-skill-detail={entry.id} className="flex h-[740px] max-h-[calc(100vh-160px)] flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[44%_56%] max-sm:grid-cols-1">
        <figure className="m-0 border-r border-nomi-line p-6">
          <SkillMedia cover={entry.cover} preview={entry.preview} play controls className="max-h-[440px] min-h-40 w-full rounded-nomi-sm object-contain" />
          {entry.upstream && <figcaption className="mt-3 text-caption text-nomi-ink-60">{t('libraries.gallery.upstream')}</figcaption>}
        </figure>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-6">
          <header className="mb-6">
            <h1 className="mb-3 font-nomi-display text-display font-medium text-nomi-ink">{entry.title}</h1>
            {entry.description !== entry.body && <p className="mb-3 text-body-sm leading-5 text-nomi-ink-60">{entry.description}</p>}
            <div className="flex flex-wrap items-center gap-2 text-caption text-nomi-ink-60">
              {entry.source && <a href={entry.source} target="_blank" rel="noreferrer" className="underline underline-offset-4">{t('libraries.gallery.source')}</a>}
              <span>{entry.license ?? t('libraries.gallery.licenseUnknown')}</span>
              {entry.author && <span className="truncate" title={entry.author}>{entry.author.replace(/^https?:\/\/[^/]+\//, '').split('/')[0]}</span>}
            </div>
          </header>
          {entry.skill?.manifestError && <p role="alert" className="mb-3 text-caption text-workbench-danger">{entry.skill.manifestError}</p>}
          <NomiMarkdown>{galleryBody(entry)}</NomiMarkdown>
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-nomi-line px-6 py-4">
        {onExport && <button type="button" onClick={onExport} className="rounded-nomi-sm px-3 py-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05">{t('libraries.skill.exportPackage')}</button>}
        {onDelete && <button type="button" onClick={onDelete} className="rounded-nomi-sm px-3 py-2 text-caption text-workbench-danger hover:bg-nomi-ink-05">{t('libraries.skill.deleteSkill')}</button>}
        <span className="flex-1" />
        <button type="button" onClick={onReference} disabled={Boolean(entry.skill?.manifestError)} className="rounded-nomi-sm border border-nomi-line px-3 py-2 text-caption text-nomi-ink disabled:opacity-40">{t('libraries.gallery.reference')}</button>
        <button type="button" onClick={onApply} disabled={Boolean(entry.skill?.manifestError)} className="rounded-nomi-sm bg-nomi-ink px-3 py-2 text-caption text-nomi-paper disabled:opacity-40">{t('libraries.gallery.apply')}</button>
      </footer>
    </div>
  </DesignModal>
}
