import { cn } from '../../utils/cn'
import { SkillMedia } from './SkillMedia'
import type { SkillGalleryEntry } from './skillGallery'

export function SkillCard({ entry, onOpen }: { entry: SkillGalleryEntry; onOpen: (entry: SkillGalleryEntry) => void }): JSX.Element {
  return <button type="button" onClick={() => onOpen(entry)} data-skill-card={entry.id}
    className={cn('w-full overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper p-0 text-left transition-colors hover:border-nomi-accent focus-visible:outline-nomi-accent')}>
    <SkillMedia cover={entry.cover} preview={entry.preview} className="aspect-[16/10] w-full object-cover" />
    <span className="block p-3">
      <strong className="block truncate text-title leading-snug text-nomi-ink">{entry.title}</strong>
      <span className="mt-2 line-clamp-2 min-h-8 text-caption leading-4 text-nomi-ink-60">{entry.description}</span>
    </span>
  </button>
}
