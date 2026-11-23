import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconFileText } from '@tabler/icons-react'
import { AnchoredPopover } from '../../../design/AnchoredPopover'
import { LibraryPicker } from '../../library/LibraryPicker'
import { libraryGroup } from '../../library/libraryGroups'
import { NodeEffectRecommendations } from './NodeEffectRecommendations'
import { NodePromptToolIconButton } from './NodePromptToolCluster'
import { usePromptLibrary } from '../../promptLibrary/usePromptLibrary'
import { useUserPrompts } from '../../promptLibrary/useUserPrompts'
import { promptDisplayTitle } from '../../promptLibrary/promptDisplay'
import { filterPrompts, type LibraryPrompt } from '../../api/promptLibraryApi'
import { isBuiltinPromptSourceId } from '../../../../electron/shared/contracts/promptLibrary'
import { compatibleNodePresets } from './nodePromptPresets'

const STARTER_EFFECTS = ['effect-character-three-view', 'effect-scene-three-view', 'effect-natural-texture', 'effect-fill-outpaint']

export function useNodeEffectChips({ enabled, empty, kind, onSelect }: {
  enabled: boolean; empty: boolean; kind: string; onSelect: (item: LibraryPrompt) => void
}): { recommendations: JSX.Element | null; more: JSX.Element } {
  const { t, i18n } = useTranslation()
  const library = usePromptLibrary(enabled)
  const user = useUserPrompts(enabled)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const compatible = compatibleNodePresets(library.items, user.items, kind)
  const effects = compatible.filter(p => p.curation?.kind === 'effect')
  const categories = [
    t('libraries.layout.all'),
    t('libraries.layout.mine'),
    t('libraries.layout.segment.builtin'),
    t('libraries.layout.segment.public'),
  ]
  const rows = filterPrompts(compatible, 'all', query).map(item => ({
    id: item.id, name: promptDisplayTitle(item), desc: item.prompt,
    section: item.origin === 'user' ? categories[1] : isBuiltinPromptSourceId(item.sourceId) ? categories[2] : categories[3],
    group: libraryGroup(item, i18n.language),
    ...(item.mediaType === 'image' && item.mediaUrl ? { cover: item.mediaUrl } : {}),
    preview: item.mediaUrl ? { url: item.mediaUrl, type: item.mediaType } : undefined,
    illustration: item.curation?.preview?.provenance === 'illustration',
  }))
  const loading = library.loading || user.loading
  const failed = Boolean(library.error || user.error)
  // 还焦点归 AnchoredPopover（Esc / 选一项还给触发钮，因点外面关闭不还），这里不自己塞回去。
  const close = () => setOpen(false)
  const recommendations = empty ? <NodeEffectRecommendations>
    {STARTER_EFFECTS.flatMap(id => {
      const item = effects.find(p => p.id === id)
      return item ? [<button key={id} type="button" onClick={() => onSelect(item)} data-effect-chip={id}
        className="shrink-0 whitespace-nowrap rounded-pill bg-nomi-ink-05 px-2 py-1 text-caption leading-4 text-nomi-ink-80 hover:text-nomi-accent">{promptDisplayTitle(item)}</button>] : []
    })}
  </NodeEffectRecommendations> : null
  const more = <>
    <NodePromptToolIconButton ref={anchorRef} toolId="effects" icon={<IconFileText size={16} stroke={2} />}
      label={t('generationCommon.composerBarV1.effects')} aria-expanded={open} aria-haspopup="dialog" data-effect-more
      onClick={() => {
        if (open) { close(); return }
        setQuery(''); user.reload(); setOpen(true)
      }} />
    {open && enabled ? <AnchoredPopover anchorRef={anchorRef} onClose={close}>
      <div role="dialog" aria-label={t('generationCommon.composerBarV1.effects')} data-testid="node-effect-menu">
        <div data-testid="node-prompt-presets">
        <LibraryPicker rows={rows} categories={categories} query={query} onQueryChange={setQuery} onClose={close} autoFocus
          panelLabel={t('generationCommon.composerBarV1.effects')}
          searchLabel={t('libraries.prompt.searchAria')} mediaFallback={<IconFileText size={20} stroke={1.5} />}
          onSelect={row => { const item = compatible.find(p => p.id === row.id); if (item) onSelect(item); close() }}
          previewAttributes={row => ({ 'data-prompt-preview': row.id })}
          status={loading ? <p role="status" className="px-2.5 py-2 text-caption text-nomi-ink-60">{t('common.loading')}</p>
            : failed ? <div role="alert" className="flex items-center gap-2 px-2.5 py-2 text-caption text-nomi-ink-60">
              <span>{t('libraries.prompt.fetchFailed')}</span><button type="button" className="text-nomi-accent" onClick={() => { library.reload(); user.reload() }}>{t('common.retry')}</button>
            </div> : null}
          empty={!loading && !failed ? <p role="status" className="px-2.5 py-3 text-caption text-nomi-ink-60">{t('libraries.prompt.noMatch')}</p> : null} />
        </div>
      </div>
    </AnchoredPopover> : null}
  </>
  return { recommendations, more }
}
