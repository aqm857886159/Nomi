import React, { type JSX } from 'react'
import {
  IconArrowRight,
  IconChevronDown,
  IconMovie,
  IconDots,
  IconExternalLink,
  IconEye,
  IconGridDots,
  IconLink,
  IconList,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconStack2,
  IconTag,
  IconX,
} from '@tabler/icons-react'
import {
  DesignBadge,
  DesignCheckbox,
  DesignSegmentedControl,
  DesignTextarea,
  NomiSelect,
  WorkbenchButton,
  WorkbenchIconButton,
} from '../design'
import { copy as shotCopy, dataImage, statusLabel, statusTone } from './storyboardLayoutExploreData'
import {
  anchors,
  createListSections,
  listCopy,
  type ListCard,
  type ListSection,
  type ListViewLocale,
  type ListViewState,
} from './storyboardListViewData'

function MediaBox({ card, height = 104 }: { card: ListCard; height?: number }): JSX.Element {
  if (card.kind === 'director') {
    return (
      <div className="grid place-items-center rounded-nomi-sm bg-nomi-ink text-nomi-paper" style={{ height }}>
        <div className="grid place-items-center gap-1 text-center">
          <IconMovie size={24} stroke={1.5} />
          <span className="text-caption">PREVIZ</span>
        </div>
      </div>
    )
  }
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-nomi-sm bg-nomi-ink-05"
      style={{ height }}
    >
      <div
        className="relative max-h-full max-w-full overflow-hidden rounded-nomi-sm"
        style={
          card.ratio === '9:16'
            ? { height: '100%', aspectRatio: '9 / 16' }
            : { width: '100%', maxHeight: '100%', aspectRatio: card.ratio.replace(':', '/') }
        }
      >
        <img
          className="absolute inset-0 size-full object-cover"
          src={dataImage(
            Number(card.id.replace(/\D/g, '') || '1'),
            card.ratio,
            card.shot?.tone ?? '#3b4657|#151a22',
            '',
          )}
          alt=""
        />
        <span className="absolute right-1.5 top-1.5 rounded-nomi-sm bg-nomi-ink/60 px-1.5 py-0.5 text-micro font-medium text-nomi-paper">
          {card.ratio}
        </span>
      </div>
    </div>
  )
}

function AnchorChip({ card, locale }: { card: ListCard; locale: ListViewLocale }): JSX.Element {
  const t = listCopy[locale]
  if (card.anchorState === 'none') return <span className="text-micro text-nomi-ink-40">{card.anchorLabel}</span>
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-micro ${card.anchorState === 'pending' ? 'bg-nomi-ink-05 text-nomi-ink-60' : 'bg-nomi-accent-soft text-nomi-accent'}`}
    >
      <IconTag size={11} stroke={1.7} />
      {card.anchorState === 'pending' ? t.pending : card.anchorLabel}
    </span>
  )
}

function ConnectionButton({
  active,
  locale,
  onClick,
}: {
  active: boolean
  locale: ListViewLocale
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}): JSX.Element {
  const t = listCopy[locale]
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? t.connectPrevious : t.connect}
      aria-pressed={active}
      className={`absolute -left-3 top-1/2 z-10 inline-flex -translate-y-1/2 items-center gap-1 rounded-pill border px-1.5 py-1 text-micro shadow-nomi-sm ${active ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent' : 'border-nomi-line bg-nomi-paper text-nomi-ink-40 hover:text-nomi-ink'}`}
    >
      <IconLink size={12} stroke={1.7} />
      {active ? t.connectPrevious : null}
    </button>
  )
}

function CardTitle({
  card,
  locale,
  onToggle,
}: {
  card: ListCard
  locale: ListViewLocale
  onToggle: (event: React.SyntheticEvent) => void
}): JSX.Element {
  const t = listCopy[locale]
  return (
    <div className="mt-2 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <DesignCheckbox
            checked={card.selected}
            onChange={onToggle}
            aria-label={locale === 'en' ? `Select ${card.titleEn}` : `选择${card.title}`}
          />
          <span className="truncate text-caption font-semibold text-nomi-ink">
            {locale === 'en' ? card.titleEn : card.title}
          </span>
          {card.kind === 'shot' && card.shot ? (
            <DesignBadge size="xs" tone={statusTone(card.shot.status)}>
              {statusLabel(card.shot.status, shotCopy[locale === 'en' ? 'en' : 'zh'])}
            </DesignBadge>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <AnchorChip card={card} locale={locale} />
          {card.autoReference ? <span className="text-micro text-nomi-ink-40">· {t.autoRef}</span> : null}
        </div>
      </div>
      <WorkbenchIconButton
        icon={<IconDots size={16} stroke={1.7} />}
        label={locale === 'en' ? 'Card menu' : '卡片菜单'}
        size="sm"
      />
    </div>
  )
}

function ListCardView({
  card,
  locale,
  index,
  mediaHeight,
  onSelect,
  onToggle,
  onConnect,
}: {
  card: ListCard
  locale: ListViewLocale
  index: number
  mediaHeight: number
  onSelect: () => void
  onToggle: () => void
  onConnect: () => void
}): JSX.Element {
  const prompt = locale === 'en' ? card.promptEn : card.prompt
  return (
    <article
      className={`group relative rounded-nomi border bg-nomi-paper p-2.5 shadow-nomi-sm transition-[border-color,box-shadow] ${card.selected ? 'border-nomi-accent ring-1 ring-inset ring-nomi-accent/25' : 'border-nomi-line hover:border-nomi-ink-30'}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
      role="button"
      tabIndex={0}
    >
      {card.kind === 'shot' && index > 0 ? (
        <ConnectionButton
          active={Boolean(card.connectionOn)}
          locale={locale}
          onClick={(event) => {
            event.stopPropagation()
            onConnect()
          }}
        />
      ) : null}
      <MediaBox card={card} height={mediaHeight} />
      <CardTitle
        card={card}
        locale={locale}
        onToggle={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      />
      <p className="mt-1.5 line-clamp-1 text-body-sm text-nomi-ink">{prompt}</p>
      <div className="mt-2 flex items-center justify-between border-t border-nomi-line pt-2 text-micro text-nomi-ink-60">
        <span>
          {card.kind === 'director' ? (locale === 'en' ? 'Canvas-only node' : '仅在画布打开') : card.groupLabel}
        </span>
        {card.kind === 'director' ? <IconExternalLink size={13} stroke={1.7} /> : <span>{card.ratio}</span>}
      </div>
    </article>
  )
}

function SectionHeader({ section, locale }: { section: ListSection; locale: ListViewLocale }): JSX.Element {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-body-sm font-semibold text-nomi-ink">
            {locale === 'en' ? section.titleEn : section.title}
          </h2>
          <span className="rounded-pill bg-nomi-ink-05 px-1.5 py-0.5 text-micro text-nomi-ink-60">
            {section.cards.length}
          </span>
        </div>
        <p className="mt-0.5 text-micro text-nomi-ink-60">{locale === 'en' ? section.subtitleEn : section.subtitle}</p>
      </div>
      <WorkbenchIconButton
        icon={<IconChevronDown size={15} stroke={1.7} />}
        label={locale === 'en' ? 'Collapse group' : '收起分组'}
        size="sm"
      />
    </div>
  )
}

function AnchorStrip({ locale }: { locale: ListViewLocale }): JSX.Element {
  const t = listCopy[locale]
  return (
    <div className="flex items-center gap-2 overflow-hidden border-b border-nomi-line px-4 py-2.5">
      <span className="shrink-0 text-caption font-semibold text-nomi-ink">{t.anchors}</span>
      {anchors.map((anchor) => (
        <span
          key={anchor.id}
          className="inline-flex items-center gap-1.5 rounded-pill border border-nomi-line bg-nomi-paper px-2 py-1 text-caption text-nomi-ink-80"
        >
          <span
            className={`size-1.5 rounded-full ${anchor.status === 'pending' ? 'bg-nomi-ink-30' : 'bg-nomi-accent'}`}
          />
          {locale === 'en' ? anchor.labelEn : anchor.label}
          <span className="text-micro text-nomi-ink-40">{anchor.status === 'pending' ? t.pending : t.locked}</span>
        </span>
      ))}
    </div>
  )
}

function BatchBar({
  selectedCount,
  locale,
  onGenerate,
}: {
  selectedCount: number
  locale: ListViewLocale
  onGenerate: () => void
}): JSX.Element {
  const t = listCopy[locale]
  if (!selectedCount) return <div className="h-0 overflow-hidden" />
  return (
    <div className="flex items-center gap-2 border-b border-nomi-line bg-nomi-ink-05 px-4 py-2">
      <DesignCheckbox checked readOnly label={`${selectedCount} ${t.selectedCount}`} />
      <span className="text-caption text-nomi-ink-60">
        {locale === 'en' ? 'Across storyboard and canvas groups' : '跨分镜与画布分组'}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <WorkbenchButton size="sm" variant="primary" onClick={onGenerate}>
          <IconSparkles size={14} /> {t.generateSelected}
        </WorkbenchButton>
        <WorkbenchIconButton
          icon={<IconX size={15} stroke={1.7} />}
          label={locale === 'en' ? 'Clear selection' : '清除选择'}
          size="sm"
        />
      </div>
    </div>
  )
}

function InspectorPanel({
  card,
  locale,
  onClose,
}: {
  card: ListCard
  locale: ListViewLocale
  onClose: () => void
}): JSX.Element {
  const t = listCopy[locale]
  const shot = card.shot
  const prompt = locale === 'en' ? card.promptEn : card.prompt
  return (
    <aside className="min-w-0 border-l border-nomi-line bg-nomi-paper">
      <div className="flex items-center justify-between gap-2 border-b border-nomi-line px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-nomi-ink">
            {locale === 'en' ? card.titleEn : card.title}
          </div>
          <div className="mt-0.5 text-caption text-nomi-ink-60">
            {card.groupLabel} · {card.ratio}
          </div>
        </div>
        <WorkbenchIconButton icon={<IconX size={15} stroke={1.7} />} label={t.close} size="sm" onClick={onClose} />
      </div>
      <div className="overflow-auto p-4">
        <MediaBox card={card} height={190} />
        <div className="mt-4 flex items-center justify-between">
          <span className="text-caption font-semibold uppercase tracking-[0.08em] text-nomi-ink-60">{t.prompt}</span>
          <WorkbenchIconButton
            icon={<IconExternalLink size={15} stroke={1.7} />}
            label={locale === 'en' ? 'Expand prompt' : '展开提示词'}
            size="sm"
          />
        </div>
        <DesignTextarea aria-label={t.prompt} value={prompt} readOnly minRows={3} maxRows={5} className="mt-2" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-pill bg-nomi-accent-soft px-2 py-1 text-caption text-nomi-accent">@林薇</span>
          <span className="rounded-pill bg-nomi-ink-05 px-2 py-1 text-caption text-nomi-ink-60">
            {t.references} · 2
          </span>
        </div>
        <section className="mt-4 border-t border-nomi-line pt-3">
          <div className="mb-2 text-caption font-semibold uppercase tracking-[0.08em] text-nomi-ink-60">
            {t.parameters}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NomiSelect
              ariaLabel={locale === 'en' ? 'Model' : '模型'}
              value={shot?.model ?? 'Seedance 2.5'}
              options={[{ value: shot?.model ?? 'Seedance 2.5', label: shot?.model ?? 'Seedance 2.5' }]}
              onChange={() => undefined}
            />
            <NomiSelect
              ariaLabel={locale === 'en' ? 'Ratio' : '画幅'}
              value={card.ratio}
              options={[{ value: card.ratio, label: card.ratio }]}
              onChange={() => undefined}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {['28', '0.42', 'Auto'].map((value, index) => (
              <div key={value} className="rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-2 py-1.5">
                <div className="text-micro text-nomi-ink-60">{['Steps', 'Motion', 'Seed'][index]}</div>
                <div className="mt-0.5 text-caption font-medium text-nomi-ink">{value}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-4 border-t border-nomi-line pt-3">
          <div className="mb-2 flex items-center justify-between text-caption font-semibold uppercase tracking-[0.08em] text-nomi-ink-60">
            <span>{t.references}</span>
            <span className="text-micro font-normal normal-case text-nomi-ink-40">
              {t.manualRef} / {t.autoRef}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-pill border border-nomi-accent bg-nomi-accent-soft px-2 py-1 text-caption text-nomi-accent"
            >
              <IconTag size={12} /> @林薇 <span className="text-micro">· {t.manualRef}</span>
              <IconX size={12} />
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-pill border border-nomi-line bg-nomi-ink-05 px-2 py-1 text-caption text-nomi-ink-60"
            >
              <IconSparkles size={12} /> 雨夜妆造 <span className="text-micro">· {t.autoRef}</span>
              <IconX size={12} />
            </button>
          </div>
        </section>
        <section className="mt-4 border-t border-nomi-line pt-3">
          <div className="mb-2 flex items-center justify-between text-caption font-semibold uppercase tracking-[0.08em] text-nomi-ink-60">
            <span>{t.versions}</span>
            <span className="text-micro font-normal normal-case text-nomi-ink-40">3</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((version) => (
              <div
                key={version}
                className={`relative overflow-hidden rounded-nomi-sm border ${version === 3 ? 'border-nomi-accent' : 'border-nomi-line'}`}
              >
                <img
                  className="aspect-square size-full object-cover"
                  src={dataImage(
                    version,
                    card.ratio === '9:16' ? '1:1' : card.ratio,
                    shot?.tone ?? '#3b4657|#151a22',
                    '',
                  )}
                  alt=""
                />
                <span className="absolute bottom-1 left-1 rounded-pill bg-nomi-ink/60 px-1.5 py-0.5 text-micro text-nomi-paper">
                  v{version}
                </span>
              </div>
            ))}
          </div>
        </section>
        <div className="mt-4 flex justify-end">
          <WorkbenchButton size="sm" variant="accent" onClick={() => undefined}>
            <IconEye size={14} /> {t.openCanvas}
          </WorkbenchButton>
        </div>
      </div>
    </aside>
  )
}

function ListSurface({
  state,
  locale,
  narrow,
}: {
  state: ListViewState
  locale: ListViewLocale
  narrow: boolean
}): JSX.Element {
  const t = listCopy[locale]
  const sections = React.useMemo(() => createListSections(state, locale), [state, locale])
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(sections.flatMap((section) => section.cards.filter((card) => card.selected).map((card) => card.id))),
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
  const allCards = sections.flatMap((section) => section.cards)
  const selectedCard = allCards.find((card) => card.id === inspectorId)
  const cardMediaHeight = state === 'long' ? 72 : selectedCard ? 112 : 68
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
  return (
    <div className="mx-auto max-w-[1440px] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <IconSearch size={15} stroke={1.7} /> {t.longHint}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-caption text-nomi-ink-60">{locale === 'en' ? 'Review state' : '走查状态'}</span>
          <DesignBadge size="xs" tone="success">
            light / token-only
          </DesignBadge>
          <WorkbenchIconButton
            icon={<IconSettings size={15} stroke={1.7} />}
            label={locale === 'en' ? 'List settings' : '列表设置'}
            size="sm"
          />
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
        <BatchBar selectedCount={selectedIds.size} locale={locale} onGenerate={() => undefined} />
        <div
          className="grid min-w-0"
          style={{
            gridTemplateColumns: selectedCard
              ? narrow
                ? 'minmax(0, 1fr) minmax(300px, 320px)'
                : 'minmax(0, 1fr) minmax(360px, 420px)'
              : 'minmax(0, 1fr)',
          }}
        >
          <div className="min-w-0 p-4">
            {visibleSections.map((section) => (
              <section key={section.id} className="mb-5 last:mb-0">
                <SectionHeader section={section} locale={locale} />
                <div
                  className={`grid gap-3 ${state === 'long' ? 'grid-cols-5' : selectedCard ? (narrow ? 'grid-cols-2' : 'grid-cols-3') : 'grid-cols-4'}`}
                >
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
          {selectedCard ? (
            <InspectorPanel card={selectedCard} locale={locale} onClose={() => setInspectorId(null)} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CanvasSurface({ locale, empty }: { locale: ListViewLocale; empty: boolean }): JSX.Element {
  const t = listCopy[locale]
  return (
    <div className="mx-auto max-w-[1440px] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <IconGridDots size={15} /> {locale === 'en' ? 'Generation canvas' : '生成画布'}
        </div>
        <WorkbenchButton size="sm" variant="default">
          <IconPlus size={14} /> {locale === 'en' ? 'Add node' : '添加节点'}
        </WorkbenchButton>
      </div>
      <div
        className="relative min-h-[650px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg"
        style={{
          backgroundImage: 'radial-gradient(var(--nomi-ink-10) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
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
              <span className="absolute left-2 top-2 rounded-pill bg-nomi-ink px-1.5 py-0.5 text-micro text-nomi-paper">
                镜 03
              </span>
              <MediaBox card={createListSections('default', locale)[0].cards[2]} height={120} />
              <div className="mt-2 text-caption font-semibold text-nomi-ink">镜 03 · 低机位</div>
            </div>
            <div className="absolute left-[47%] top-[28%] w-[260px] rounded-nomi border border-nomi-accent bg-nomi-paper p-3 shadow-nomi-md">
              <span className="absolute left-2 top-2 rounded-pill bg-nomi-ink px-1.5 py-0.5 text-micro text-nomi-paper">
                镜 04
              </span>
              <MediaBox card={createListSections('default', locale)[0].cards[3]} height={132} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-caption font-semibold text-nomi-ink">镜 04 · 俯拍</span>
                <WorkbenchButton size="sm" variant="accent">
                  <IconList size={13} /> {t.canvasNodeHint}
                </WorkbenchButton>
              </div>
            </div>
            <div className="absolute left-[73%] top-[62%] w-[220px] rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-sm">
              <span className="text-caption font-semibold text-nomi-ink">画布分组 · 海报试稿</span>
              <div className="mt-2 grid grid-cols-3 gap-1">
                <IconPhoto className="text-nomi-ink-40" size={18} />
                <IconPhoto className="text-nomi-ink-40" size={18} />
                <IconPhoto className="text-nomi-ink-40" size={18} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AppChrome({
  locale,
  state,
  view,
  onLocale,
  onView,
}: {
  locale: ListViewLocale
  state: ListViewState
  view: 'canvas' | 'list'
  onLocale: (locale: ListViewLocale) => void
  onView: (view: 'canvas' | 'list') => void
}): JSX.Element {
  const t = listCopy[locale]
  return (
    <header className="border-b border-nomi-line bg-nomi-paper px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
            <IconStack2 size={15} /> {locale === 'en' ? 'Generate · Rainy convenience store' : '生成 · 雨夜便利店'}
          </div>
          <h1 className="mt-1 text-h3 font-semibold text-nomi-ink">{t.title}</h1>
          <p className="mt-1 text-body-sm text-nomi-ink-60">{t.subtitle}</p>
        </div>
        <DesignSegmentedControl
          size="xs"
          value={locale}
          onChange={(value) => onLocale(value as ListViewLocale)}
          data={[
            { label: '中', value: 'zh' },
            { label: 'EN', value: 'en' },
          ]}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <DesignSegmentedControl
          size="xs"
          value={view}
          data={[
            { label: t.canvas, value: 'canvas' },
            { label: t.list, value: 'list' },
          ]}
          onChange={(value) => onView(value as 'canvas' | 'list')}
        />
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <span>
            {locale === 'en' ? 'Canvas nodes' : '画布节点'} ·{' '}
            {state === 'long' ? '50' : state === 'empty' && view === 'canvas' ? '0' : '12'}
          </span>
          <WorkbenchIconButton
            icon={<IconDots size={16} />}
            label={locale === 'en' ? 'More view actions' : '更多视图操作'}
            size="sm"
          />
        </div>
      </div>
    </header>
  )
}

export function StoryboardListViewApp(): JSX.Element {
  const params = new URL(window.location.href).searchParams
  const state = (params.get('state') as ListViewState | null) ?? 'default'
  const initialLocale: ListViewLocale = params.get('locale') === 'en' ? 'en' : 'zh'
  const [locale, setLocale] = React.useState<ListViewLocale>(initialLocale)
  const [view, setView] = React.useState<'canvas' | 'list'>(state === 'canvas' || state === 'empty' ? 'canvas' : 'list')
  const narrow = params.get('narrow') === '1'
  return (
    <div className="min-h-screen bg-nomi-bg text-nomi-ink">
      <AppChrome locale={locale} state={state} view={view} onLocale={setLocale} onView={setView} />
      {view === 'canvas' ? (
        <CanvasSurface locale={locale} empty={state === 'empty'} />
      ) : (
        <ListSurface state={state === 'empty' ? 'default' : state} locale={locale} narrow={narrow} />
      )}
    </div>
  )
}
