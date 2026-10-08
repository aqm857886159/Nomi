import React, { type JSX } from 'react'
import { IconArrowRight, IconGridDots, IconList, IconPlus, IconSearch, IconStack2, IconX } from '@tabler/icons-react'
import { WorkbenchButton } from '../design'
import { AutoReferenceApp } from './autoReferenceScreens'
import { cardNode, referenceEdges, refNode, useLabLanguage, useSeededCanvas } from './listViewStage'
import { AnchorStrip, AppChrome, BatchBar, InspectorPanel, ListCardView, MediaBox, SectionHeader } from './storyboardListViewParts'
import {
  createListSections,
  listCopy,
  REFS,
  type ListViewLocale,
  type ListViewState,
  type RefId,
} from './storyboardListViewData'

function ListSurface({ state, locale, narrow }: { state: ListViewState; locale: ListViewLocale; narrow: boolean }): JSX.Element {
  const t = listCopy[locale]
  const sections = React.useMemo(() => createListSections(state), [state])
  const allCards = sections.flatMap((section) => section.cards)
  const nodes = React.useMemo(
    () => [
      ...(Object.keys(REFS) as RefId[]).map((id) => refNode(id, locale)),
      ...allCards.filter((card) => card.kind !== 'director').map((card) => cardNode(card, locale)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, locale],
  )
  const edges = React.useMemo(() => allCards.flatMap((card) => referenceEdges(card.id, card.refs)), [allCards])
  const ready = useSeededCanvas(nodes, edges)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(allCards.filter((card) => card.selected).map((card) => card.id)),
  )
  const [inspectorId, setInspectorId] = React.useState<string | null>(state === 'selected' ? 'shot-2' : null)
  const [connected, setConnected] = React.useState('shot-4')
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectorId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const selectedCard = allCards.find((card) => card.id === inspectorId)
  const extraWide = window.innerWidth >= 1536
  const cardMediaHeight = extraWide && !selectedCard ? 180 : 220
  const toggleCard = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const visibleSections = sections.map((section) => ({
    ...section,
    cards: section.cards.map((card) => ({
      ...card,
      selected: selectedIds.has(card.id),
      connectionOn: card.id === 'shot-4' && connected === 'shot-4',
    })),
  }))
  const selectedCards = visibleSections.flatMap((section) => section.cards).filter((card) => card.selected)
  if (!ready) return <div />
  return (
    <div className="mx-auto max-w-[1440px] p-4" data-lab-ready="true">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-[260px] items-center gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 py-1.5 text-caption text-nomi-ink-40">
          <IconSearch size={15} stroke={1.7} /> {t.longHint}
        </div>
      </div>
      <div className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm">
        <AnchorStrip locale={locale} />
        {state === 'deep-link' ? (
          <div className="flex items-center gap-2 border-b border-nomi-line px-4 py-2">
            <span className="rounded-pill bg-nomi-accent-soft px-2 py-1 text-caption text-nomi-accent">
              {t.filter} <IconX className="ml-1 inline" size={13} />
            </span>
          </div>
        ) : null}
        <BatchBar selected={selectedCards} locale={locale} onClear={() => setSelectedIds(new Set())} onGenerate={() => undefined} />
        <div
          className="grid min-w-0"
          style={{
            gridTemplateColumns: selectedCard
              ? narrow
                ? 'minmax(0, 1fr) minmax(300px, 320px)'
                : 'minmax(0, 1fr) minmax(440px, 480px)'
              : 'minmax(0, 1fr)',
          }}
        >
          <div className="min-w-0 p-4">
            {visibleSections.map((section) => (
              <section key={section.id} className="mb-5 last:mb-0" data-list-section={section.id}>
                <SectionHeader section={section} locale={locale} />
                <div className={`grid gap-x-8 gap-y-4 pl-8 ${selectedCard ? 'grid-cols-2' : extraWide ? 'grid-cols-4' : 'grid-cols-3'}`}>
                  {section.cards.map((card, index) => (
                    <ListCardView
                      key={card.id}
                      card={card}
                      locale={locale}
                      index={index}
                      mediaHeight={cardMediaHeight}
                      onSelect={() => setInspectorId((current) => (current === card.id ? null : card.id))}
                      onToggle={() => toggleCard(card.id)}
                      onConnect={() => setConnected((current) => (current === card.id ? '' : card.id))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {selectedCard ? <InspectorPanel card={selectedCard} locale={locale} onClose={() => setInspectorId(null)} /> : null}
        </div>
      </div>
    </div>
  )
}

function CanvasSurface({ locale, empty }: { locale: ListViewLocale; empty: boolean }): JSX.Element {
  const t = listCopy[locale]
  const storyboard = createListSections('default')[0].cards
  const posterGroupLabel = locale === 'en' ? 'Canvas group · Poster pass' : '画布分组 · 海报试稿'
  const shotLabel = (index: number) => (locale === 'en' ? storyboard[index].titleEn : storyboard[index].title)
  return (
    <div className="mx-auto max-w-[1440px] p-4" data-lab-ready="true">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <IconGridDots size={15} /> {t.generationCanvas}
        </div>
        <WorkbenchButton size="sm" variant="default">
          <IconPlus size={14} /> {t.addNode}
        </WorkbenchButton>
      </div>
      <div
        className="relative min-h-[650px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg"
        style={{ backgroundImage: 'radial-gradient(var(--nomi-ink-10) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
      >
        {empty ? (
          <div className="absolute inset-0 grid place-items-center">
            <div className="grid justify-items-center gap-3 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-nomi-ink-05 text-nomi-ink-60">
                <IconStack2 size={24} />
              </span>
              <h2 className="text-body font-semibold text-nomi-ink">{t.noNodes}</h2>
              <WorkbenchButton size="sm" variant="default">
                <IconArrowRight size={14} /> {t.backCanvas}
              </WorkbenchButton>
            </div>
          </div>
        ) : (
          <>
            <div className="absolute left-[10%] top-[18%] w-[240px] rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-sm">
              <div className="mb-2">
                <span className="rounded-pill bg-nomi-ink px-1.5 py-0.5 text-micro text-nomi-paper">{shotLabel(2)}</span>
              </div>
              <MediaBox card={storyboard[2]} height={120} />
            </div>
            <div className="absolute left-[47%] top-[28%] w-[260px] rounded-nomi border border-nomi-accent bg-nomi-paper p-3 shadow-nomi-md">
              <div className="mb-2">
                <span className="rounded-pill bg-nomi-ink px-1.5 py-0.5 text-micro text-nomi-paper">{shotLabel(3)}</span>
              </div>
              <MediaBox card={storyboard[3]} height={132} />
              <div className="mt-2 flex justify-end">
                <WorkbenchButton size="sm" variant="accent">
                  <IconList size={13} /> {t.canvasNodeHint}
                </WorkbenchButton>
              </div>
            </div>
            <div className="absolute left-[73%] top-[62%] w-[220px] rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-sm">
              <span className="text-caption font-semibold text-nomi-ink">{posterGroupLabel}</span>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {createListSections('default')[1].cards.map((card) => (
                  <img key={card.id} className="aspect-square w-full rounded-nomi-sm object-cover" src={card.art} alt="" />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ListViewApp(): JSX.Element {
  const params = new URL(window.location.href).searchParams
  const state = (params.get('state') as ListViewState | null) ?? 'default'
  const [locale, setLocale] = React.useState<ListViewLocale>(params.get('locale') === 'en' ? 'en' : 'zh')
  const [view, setView] = React.useState<'canvas' | 'list'>(state === 'canvas' || state === 'empty' ? 'canvas' : 'list')
  const languageReady = useLabLanguage(locale)
  return (
    <div className="flex h-screen flex-col bg-nomi-bg text-nomi-ink">
      <AppChrome
        locale={locale}
        state={state}
        view={view}
        hideLabHeader={params.get('capture') === 'product'}
        onLocale={setLocale}
        onView={setView}
      />
      <div className="min-h-0 flex-1 overflow-auto" data-list-scroll="true">
        {!languageReady ? null : view === 'canvas' ? (
          <CanvasSurface locale={locale} empty={state === 'empty'} />
        ) : (
          <ListSurface key={`${state}-${locale}`} state={state === 'empty' ? 'default' : state} locale={locale} narrow={params.get('narrow') === '1'} />
        )}
      </div>
    </div>
  )
}

export function StoryboardListViewApp(): JSX.Element {
  const screen = new URL(window.location.href).searchParams.get('screen')
  return screen === 'autoref' ? <AutoReferenceApp /> : <ListViewApp />
}
