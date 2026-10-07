import React, { type JSX } from 'react'
import {
  IconAdjustmentsHorizontal,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconDots,
  IconGripVertical,
  IconLayoutGrid,
  IconList,
  IconLock,
  IconMaximize,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconStack2,
  IconTag,
  IconWand,
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
import {
  copy,
  createShots,
  dataImage,
  kindLabel,
  statusLabel,
  statusTone,
  type Direction,
  type Locale,
  type Shot,
} from './storyboardLayoutExploreData'

function ShotMedia({
  shot,
  compact = false,
  bounded = false,
  locale,
  selected = shot.selected,
}: {
  shot: Shot
  compact?: boolean
  bounded?: boolean
  locale: Locale
  selected?: boolean
}): JSX.Element {
  const t = copy[locale]
  const ratio = shot.ratio.replace(':', '/')
  const imageLabel =
    locale === 'en'
      ? shot.ratio === '9:16'
        ? 'portrait'
        : shot.ratio === '1:1'
          ? 'square'
          : 'landscape'
      : shot.ratio === '9:16'
        ? '竖屏'
        : shot.ratio === '1:1'
          ? '方形'
          : '横屏'
  return (
    <div
      className={`relative overflow-hidden rounded-nomi-sm bg-nomi-ink-05 ${compact ? 'shrink-0' : ''} ${bounded ? 'h-full w-auto max-w-full' : ''}`}
      style={bounded ? { height: '100%', aspectRatio: ratio } : { aspectRatio: ratio }}
    >
      <img
        className="absolute inset-0 size-full object-cover"
        src={dataImage(Number(shot.id.replace('shot-', '')), shot.ratio, shot.tone, imageLabel)}
        alt=""
      />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-1 p-1.5">
        <DesignBadge size="xs" variant="filled" tone={statusTone(shot.status)} className="bg-nomi-paper/90 text-micro">
          {statusLabel(shot.status, t)}
        </DesignBadge>
        <span className="rounded-nomi-sm bg-nomi-ink/55 px-1.5 py-0.5 text-micro font-medium text-nomi-paper">
          {shot.ratio}
        </span>
      </div>
      {shot.status === 'generating' ? (
        <div className="absolute inset-x-2 bottom-2 rounded-nomi-sm bg-nomi-ink/65 px-2 py-1.5 text-micro text-nomi-paper">
          <div className="mb-1 flex items-center justify-between">
            <span>{t.generating}</span>
            <span>37%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-nomi-paper/25">
            <div className="h-full w-[37%] rounded-full bg-nomi-accent" />
          </div>
        </div>
      ) : null}
      {shot.status === 'failed' ? (
        <div className="absolute inset-x-2 bottom-2 rounded-nomi-sm bg-nomi-ink/72 px-2 py-1.5 text-micro text-nomi-paper">
          {t.failed} · {locale === 'en' ? 'retry available' : '可重试'}
        </div>
      ) : null}
      {shot.status === 'skipped' ? (
        <div className="absolute inset-0 grid place-items-center bg-nomi-ink/35 text-caption font-semibold text-nomi-paper">
          {t.skipped}
        </div>
      ) : null}
      {selected ? (
        <span
          className="absolute bottom-2 left-2 grid size-6 place-items-center rounded-full bg-nomi-accent text-nomi-paper shadow-nomi-sm"
          aria-label={t.selected}
        >
          <IconCheck size={15} stroke={2.2} aria-hidden="true" />
        </span>
      ) : null}
      {!compact ? (
        <button
          type="button"
          className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full bg-nomi-paper/90 text-nomi-ink shadow-nomi-sm"
          aria-label={locale === 'en' ? 'Open preview' : '查看大图'}
        >
          <IconMaximize size={14} stroke={1.8} />
        </button>
      ) : null}
    </div>
  )
}

function TopShell({
  direction,
  locale,
  count,
  narrow,
  onLocale,
}: {
  direction: Direction
  locale: Locale
  count: number
  narrow: boolean
  onLocale: (locale: Locale) => void
}): JSX.Element {
  const t = copy[locale]
  const labels: Record<Direction, string> = { a: t.grid, b: t.inspector, c: t.rows }
  return (
    <header className="border-b border-nomi-line bg-nomi-paper px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
            <IconStack2 size={15} stroke={1.7} />{' '}
            <span>{locale === 'en' ? 'Design lab · storyboard' : '设计实验室 · 分镜方案'}</span>
            <span>•</span>
            <span>{labels[direction]}</span>
          </div>
          <h1 className="mt-1 font-display text-h3 font-semibold text-nomi-ink">{t.title}</h1>
          <p className="mt-1 max-w-[760px] text-body-sm text-nomi-ink-60">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <DesignSegmentedControl
            size="xs"
            value={locale}
            onChange={(value) => onLocale(value as Locale)}
            data={[
              { label: '中', value: 'zh' },
              { label: 'EN', value: 'en' },
            ]}
          />
          <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-caption text-nomi-ink-60">
            {count} {locale === 'en' ? 'shots' : '镜'}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-nomi-sm bg-nomi-ink-05 p-1">
          {(['a', 'b', 'c'] as Direction[]).map((key) => (
            <a
              key={key}
              href={`?direction=${key}&count=${count}&locale=${locale}${narrow ? '&narrow=1' : ''}`}
              className={`rounded-nomi-sm px-2.5 py-1 text-caption font-medium ${direction === key ? 'bg-nomi-paper text-nomi-ink shadow-nomi-sm' : 'text-nomi-ink-60'}`}
            >
              {labels[key]}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <IconAdjustmentsHorizontal size={15} stroke={1.7} /> {t.density}: {count === 6 ? t.six : t.thirty}
        </div>
      </div>
    </header>
  )
}

function SceneToolbar({ locale, count }: { locale: Locale; count: number }): JSX.Element {
  const t = copy[locale]
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-nomi-line px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink text-nomi-paper">
          <span className="text-caption font-semibold">01</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-nomi-ink">{t.scene}</div>
          <div className="text-caption text-nomi-ink-60">
            {count} {locale === 'en' ? 'shots' : '镜头'} · {locale === 'en' ? 'mixed aspect ratios' : '混合画幅'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WorkbenchButton size="sm" variant="primary">
          <IconPlayerPlay size={14} /> {t.play}
        </WorkbenchButton>
        <WorkbenchButton size="sm" variant="default">
          <IconPlus size={14} /> {locale === 'en' ? 'Add shot' : '新增镜头'}
        </WorkbenchButton>
        <WorkbenchIconButton icon={<IconDots size={17} stroke={1.7} />} label={t.more} size="sm" />
      </div>
    </div>
  )
}

function BatchBar({ locale }: { locale: Locale }): JSX.Element {
  const t = copy[locale]
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-nomi-line bg-nomi-ink-05 px-4 py-2">
      <DesignCheckbox checked readOnly label={t.selected} />
      <span className="text-caption text-nomi-ink-60">
        {locale === 'en' ? 'Selection keeps batch actions together.' : '选择后批量操作集中在这里。'}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <WorkbenchButton size="sm" variant="primary">
          <IconWand size={14} /> {t.generate}
        </WorkbenchButton>
        <WorkbenchButton size="sm" variant="default">
          {locale === 'en' ? 'Use one model' : '统一模型与参数'}
        </WorkbenchButton>
        <WorkbenchButton size="sm" variant="default">
          {t.skip}
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

function MetaLine({ shot, locale }: { shot: Shot; locale: Locale }): JSX.Element {
  const t = copy[locale]
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-nomi-ink-60">
      <span className="font-medium text-nomi-ink-80">{kindLabel(shot.kind, t)}</span>
      <span>·</span>
      <span>{shot.model}</span>
      <span>·</span>
      <span>{shot.duration}</span>
      <span>·</span>
      <span>{shot.ratio}</span>
    </div>
  )
}

function GridCard({ shot, locale }: { shot: Shot; locale: Locale }): JSX.Element {
  const t = copy[locale]
  const prompt = locale === 'en' ? shot.promptEn : shot.prompt
  return (
    <article
      className={`group rounded-nomi border bg-nomi-paper p-2.5 shadow-nomi-sm transition-[border-color,box-shadow] ${shot.selected ? 'border-nomi-accent ring-1 ring-inset ring-nomi-accent/30' : 'border-nomi-line hover:border-nomi-ink-30'}`}
    >
      <ShotMedia shot={shot} locale={locale} selected={shot.selected} />
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-caption font-semibold text-nomi-ink">
            {locale === 'en' ? 'Shot' : '镜'} {shot.id.replace('shot-', '').padStart(2, '0')}
          </span>
          {shot.selected ? (
            <span className="rounded-nomi-sm bg-nomi-accent/10 px-1.5 py-0.5 text-micro font-medium text-nomi-accent">
              {locale === 'en' ? 'selected' : '选中'}
            </span>
          ) : null}
        </div>
        <WorkbenchIconButton icon={<IconDots size={16} stroke={1.7} />} label={t.more} size="sm" />
      </div>
      <p className="mt-1.5 line-clamp-2 min-h-[2.65rem] text-body-sm leading-relaxed text-nomi-ink">{prompt}</p>
      <div className="mt-2">
        <MetaLine shot={shot} locale={locale} />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-nomi-line pt-2">
        <span className="flex items-center gap-1 text-micro text-nomi-ink-60">
          <IconTag size={13} stroke={1.7} /> {t.anchor}
        </span>
        <span className="text-micro text-nomi-ink-40">@{shot.id.replace('shot-', '')}</span>
      </div>
    </article>
  )
}

function GridDirection({ shots, locale, count }: { shots: Shot[]; locale: Locale; count: number }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm">
      <SceneToolbar locale={locale} count={count} />
      <BatchBar locale={locale} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-1 rounded-nomi-sm bg-nomi-ink-05 p-1">
          <span className="rounded-nomi-sm bg-nomi-paper px-2 py-1 text-caption font-medium text-nomi-ink shadow-nomi-sm">
            {copy[locale].all}
          </span>
          <span className="px-2 py-1 text-caption text-nomi-ink-60">{copy[locale].filter}</span>
        </div>
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <IconLayoutGrid size={15} stroke={1.7} /> {locale === 'en' ? 'Visual scan' : '画面扫读'} <span>·</span>{' '}
          {locale === 'en' ? 'prompt collapsed' : '提示词收起'}
        </div>
      </div>
      <div className={`grid items-start gap-3 px-4 pb-4 ${count === 6 ? 'grid-cols-4' : 'grid-cols-5'}`}>
        {shots.map((shot) => (
          <GridCard key={shot.id} shot={shot} locale={locale} />
        ))}
      </div>
      <Footer locale={locale} count={count} />
    </div>
  )
}

function InspectorPanel({ shot, locale }: { shot: Shot; locale: Locale }): JSX.Element {
  const t = copy[locale]
  const prompt = locale === 'en' ? shot.promptEn : shot.prompt
  return (
    <aside className="flex min-w-0 flex-col border-l border-nomi-line bg-nomi-paper">
      <div className="flex items-center justify-between gap-2 border-b border-nomi-line px-4 py-3">
        <div>
          <div className="text-body-sm font-semibold text-nomi-ink">{t.inspectorTitle}</div>
          <div className="mt-0.5 text-caption text-nomi-ink-60">
            {kindLabel(shot.kind, t)} · {shot.ratio} · {shot.duration}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <WorkbenchIconButton
            icon={<IconArrowUp size={15} stroke={1.7} />}
            label={locale === 'en' ? 'Previous shot' : '上一镜'}
            size="sm"
          />
          <WorkbenchIconButton
            icon={<IconArrowDown size={15} stroke={1.7} />}
            label={locale === 'en' ? 'Next shot' : '下一镜'}
            size="sm"
          />
        </div>
      </div>
      <div className="overflow-auto p-4">
        <div className="flex h-[260px] items-center justify-center overflow-hidden rounded-nomi border border-nomi-line bg-nomi-ink-05">
          <ShotMedia shot={shot} bounded locale={locale} />
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-caption font-semibold uppercase tracking-[0.08em] text-nomi-ink-60">{t.prompt}</span>
          <WorkbenchIconButton
            icon={<IconMaximize size={15} stroke={1.7} />}
            label={locale === 'en' ? 'Expand prompt' : '展开提示词'}
            size="sm"
          />
        </div>
        <DesignTextarea
          aria-label={t.prompt}
          value={prompt}
          readOnly
          autosize
          minRows={3}
          maxRows={5}
          className="mt-2"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-nomi-sm bg-nomi-accent/10 px-2 py-1 text-caption font-medium text-nomi-accent">
            {t.anchor}
          </span>
          <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-caption text-nomi-ink-60">
            {t.referenceSlot}
          </span>
          <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-caption text-nomi-ink-60">{t.firstFrame}</span>
        </div>
        <InspectorSection title={t.parameters}>
          <div className="grid grid-cols-2 gap-2">
            <NomiSelect
              ariaLabel={locale === 'en' ? 'Model' : '模型'}
              value={shot.model}
              options={[{ value: shot.model, label: shot.model }]}
              onChange={() => undefined}
            />
            <NomiSelect
              ariaLabel={locale === 'en' ? 'Aspect ratio' : '画幅'}
              value={shot.ratio}
              options={[{ value: shot.ratio, label: shot.ratio }]}
              onChange={() => undefined}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Param label={locale === 'en' ? 'Steps' : '步数'} value="28" />
            <Param label={locale === 'en' ? 'Motion' : '运动'} value="0.42" />
            <Param label={locale === 'en' ? 'Seed' : '种子'} value="Auto" />
          </div>
        </InspectorSection>
        <InspectorSection title={t.references}>
          <div className="grid grid-cols-3 gap-2">
            <div
              className="relative overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05"
              style={{ aspectRatio: '1 / 1' }}
            >
              <img
                className="size-full object-cover"
                src={dataImage(2, '1:1', shot.tone, locale === 'en' ? 'ref' : '参考')}
                alt=""
              />
              <span className="absolute bottom-1 left-1 rounded-nomi-sm bg-nomi-ink/60 px-1.5 py-0.5 text-micro text-nomi-paper">
                @{locale === 'en' ? 'Lin Wei' : '林薇'}
              </span>
            </div>
            <div className="grid place-items-center rounded-nomi-sm border border-dashed border-nomi-ink-30 text-nomi-ink-40">
              <IconPlus size={18} stroke={1.6} />
              <span className="mt-1 text-micro">{locale === 'en' ? 'add' : '添加'}</span>
            </div>
            <div className="grid place-items-center rounded-nomi-sm border border-dashed border-nomi-ink-30 text-nomi-ink-40">
              <IconArrowDown size={18} stroke={1.6} />
              <span className="mt-1 text-micro">{locale === 'en' ? 'first' : '首帧'}</span>
            </div>
          </div>
        </InspectorSection>
        <InspectorSection title={t.status}>
          <div className="flex items-center justify-between rounded-nomi-sm bg-nomi-ink-05 px-3 py-2">
            <div className="flex items-center gap-2">
              <DesignBadge size="xs" tone={statusTone(shot.status)}>
                {statusLabel(shot.status, t)}
              </DesignBadge>
              <span className="text-caption text-nomi-ink-60">
                {shot.status === 'failed'
                  ? t.failure
                  : shot.status === 'generating'
                    ? '37% · 00:18'
                    : shot.status === 'skipped'
                      ? t.skipped
                      : t.versions}
              </span>
            </div>
            <WorkbenchIconButton icon={<IconRefresh size={15} stroke={1.7} />} label={t.regenerate} size="sm" />
          </div>
        </InspectorSection>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <WorkbenchButton size="sm" variant="default">
            <IconRefresh size={14} /> {t.regenerate}
          </WorkbenchButton>
          <WorkbenchButton size="sm" variant="accent">
            <IconWand size={14} /> {t.handoff}
          </WorkbenchButton>
        </div>
      </div>
    </aside>
  )
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mt-4 border-t border-nomi-line pt-3">
      <div className="mb-2 text-caption font-semibold uppercase tracking-[0.08em] text-nomi-ink-60">{title}</div>
      {children}
    </section>
  )
}

function Param({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 px-2 py-1.5">
      <div className="text-micro text-nomi-ink-60">{label}</div>
      <div className="mt-0.5 text-caption font-medium text-nomi-ink">{value}</div>
    </div>
  )
}

function ListRow({
  shot,
  locale,
  selected,
  compact = false,
}: {
  shot: Shot
  locale: Locale
  selected: boolean
  compact?: boolean
}): JSX.Element {
  const t = copy[locale]
  const mediaHeight = compact ? 28 : 52
  return (
    <div
      className={`grid items-center gap-2 border-b border-nomi-line ${compact ? 'px-2 py-0.5' : 'px-3 py-1.5'} ${selected ? 'bg-nomi-accent/8' : 'bg-nomi-paper'}`}
      style={{ gridTemplateColumns: compact ? '18px 30px minmax(0, 1fr) auto' : '20px 52px minmax(0, 1fr) auto' }}
    >
      <WorkbenchIconButton
        icon={<IconGripVertical size={14} stroke={1.6} />}
        label={locale === 'en' ? 'Drag to reorder' : '拖动排序'}
        size="sm"
        className="cursor-grab text-nomi-ink-30"
      />
      <div
        className="relative overflow-hidden rounded-nomi-sm bg-nomi-ink-05"
        style={{ height: mediaHeight, aspectRatio: shot.ratio.replace(':', '/') }}
      >
        <img
          className="absolute inset-0 size-full object-cover"
          src={dataImage(Number(shot.id.replace('shot-', '')), shot.ratio, shot.tone, '')}
          alt=""
        />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={compact ? 'text-micro font-semibold text-nomi-ink' : 'text-caption font-semibold text-nomi-ink'}
          >
            {locale === 'en' ? 'Shot' : '镜'} {shot.id.replace('shot-', '').padStart(2, '0')}
          </span>
          <DesignBadge size="xs" tone={statusTone(shot.status)}>
            {statusLabel(shot.status, t)}
          </DesignBadge>
        </div>
        <div className="truncate text-micro text-nomi-ink-60">{locale === 'en' ? shot.promptEn : shot.prompt}</div>
      </div>
      <div className="flex items-center gap-1">
        <span className="hidden text-micro text-nomi-ink-40 sm:inline">{shot.ratio}</span>
        {selected ? (
          <span className="grid size-5 place-items-center rounded-full bg-nomi-accent text-nomi-paper">
            <IconCheck size={12} stroke={2.2} />
          </span>
        ) : (
          <WorkbenchIconButton icon={<IconDots size={15} stroke={1.7} />} label={t.more} size="sm" />
        )}
      </div>
    </div>
  )
}

function InspectorDirection({ shots, locale, count }: { shots: Shot[]; locale: Locale; count: number }): JSX.Element {
  const selected = shots.find((shot) => shot.id === 'shot-2') ?? shots[0]
  return (
    <div className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm">
      <SceneToolbar locale={locale} count={count} />
      <BatchBar locale={locale} />
      <div
        className="grid min-w-0"
        style={{
          gridTemplateColumns:
            count === 6 ? 'minmax(340px, 0.82fr) minmax(360px, 1.18fr)' : 'minmax(360px, 0.95fr) minmax(360px, 1.05fr)',
        }}
      >
        <div className="min-w-0 border-r border-nomi-line">
          <div className="flex items-center justify-between border-b border-nomi-line px-3 py-2">
            <div className="flex items-center gap-1.5 text-caption font-medium text-nomi-ink">
              <IconList size={15} stroke={1.7} /> {locale === 'en' ? 'Shot list' : '镜头列表'}
            </div>
            <span className="text-micro text-nomi-ink-60">{locale === 'en' ? 'Space to peek' : '空格预览'}</span>
          </div>
          <div>
            {shots.map((shot) => (
              <ListRow
                key={shot.id}
                shot={shot}
                locale={locale}
                selected={shot.id === selected.id}
                compact={count === 30}
              />
            ))}
          </div>
        </div>
        <InspectorPanel shot={selected} locale={locale} />
      </div>
      <Footer locale={locale} count={count} />
    </div>
  )
}

function ImprovedRow({ shot, locale, count }: { shot: Shot; locale: Locale; count: number }): JSX.Element {
  const t = copy[locale]
  const prompt = locale === 'en' ? shot.promptEn : shot.prompt
  const mediaHeight = count === 30 ? 38 : 64
  return (
    <div
      className={`group grid items-center gap-3 border-b border-nomi-line px-3 ${shot.selected ? 'bg-nomi-accent/8' : ''}`}
      style={{ minHeight: count === 30 ? 48 : 82, gridTemplateColumns: '20px auto minmax(0, 1fr) auto' }}
    >
      <WorkbenchIconButton
        icon={<IconGripVertical size={15} stroke={1.6} />}
        label={locale === 'en' ? 'Drag to reorder' : '拖动排序'}
        size="sm"
        className="cursor-grab text-nomi-ink-30 opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div
        className="relative shrink-0 overflow-hidden rounded-nomi-sm bg-nomi-ink-05"
        style={{ height: mediaHeight, aspectRatio: shot.ratio.replace(':', '/') }}
      >
        <img
          className="absolute inset-0 size-full object-cover"
          src={dataImage(Number(shot.id.replace('shot-', '')), shot.ratio, shot.tone, '')}
          alt=""
        />
        {shot.status === 'generating' ? <span className="absolute inset-x-0 bottom-0 h-1 bg-nomi-accent" /> : null}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-caption font-semibold text-nomi-ink">
            {locale === 'en' ? 'Shot' : '镜'} {shot.id.replace('shot-', '').padStart(2, '0')}
          </span>
          <DesignBadge size="xs" tone={statusTone(shot.status)}>
            {statusLabel(shot.status, t)}
          </DesignBadge>
          <span className="hidden truncate text-micro text-nomi-ink-60 md:inline">
            {kindLabel(shot.kind, t)} · {shot.model}
          </span>
        </div>
        <p className={`mt-0.5 truncate text-body-sm text-nomi-ink ${count === 30 ? 'max-w-[680px]' : ''}`}>{prompt}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="hidden rounded-nomi-sm bg-nomi-ink-05 px-1.5 py-1 text-micro text-nomi-ink-60 sm:inline">
          {shot.ratio}
        </span>
        {shot.selected ? (
          <span className="grid size-6 place-items-center rounded-full bg-nomi-accent text-nomi-paper">
            <IconCheck size={14} stroke={2.2} />
          </span>
        ) : null}
        <WorkbenchIconButton icon={<IconDots size={16} stroke={1.7} />} label={t.more} size="sm" />
      </div>
    </div>
  )
}

function ImprovedRowsDirection({
  shots,
  locale,
  count,
}: {
  shots: Shot[]
  locale: Locale
  count: number
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm">
      <SceneToolbar locale={locale} count={count} />
      <BatchBar locale={locale} />
      <div className="flex items-center justify-between gap-2 border-b border-nomi-line px-4 py-2">
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <IconList size={15} stroke={1.7} />{' '}
          {locale === 'en' ? 'Rows stay scannable; controls appear on hover.' : '行保持可扫读，控件在悬停时出现。'}
        </div>
        <div className="flex items-center gap-1 text-micro text-nomi-ink-40">
          <IconLock size={13} stroke={1.7} /> {locale === 'en' ? 'status only' : '对勾只表示状态'}
        </div>
      </div>
      <div>
        {shots.map((shot) => (
          <ImprovedRow key={shot.id} shot={shot} locale={locale} count={count} />
        ))}
      </div>
      <Footer locale={locale} count={count} />
    </div>
  )
}

function Footer({ locale, count }: { locale: Locale; count: number }): JSX.Element {
  const t = copy[locale]
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-nomi-line bg-nomi-ink-05 px-4 py-2.5">
      <div className="flex items-center gap-3 text-caption text-nomi-ink-60">
        <span>{locale === 'en' ? `${count} shots` : `${count} 镜`}</span>
        <span>·</span>
        <span>{locale === 'en' ? 'Scene 01 / 03' : '场景 01 / 03'}</span>
        <span>·</span>
        <span>{t.remaining}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="text-caption font-medium text-nomi-accent hover:underline">
          {locale === 'en' ? 'Filter anchors' : '按锚点筛选'}
        </button>
        <span className="text-caption text-nomi-ink-40">{locale === 'en' ? 'Page 1 / 3' : '第 1 / 3 页'}</span>
      </div>
    </footer>
  )
}

function LayoutExploreApp(): JSX.Element {
  const params = new URL(window.location.href).searchParams
  const direction = (params.get('direction') as Direction | null) ?? 'a'
  const count = params.get('count') === '30' ? 30 : 6
  const initialLocale = params.get('locale') === 'en' ? 'en' : 'zh'
  const narrow = params.get('narrow') === '1'
  const [locale, setLocale] = React.useState<Locale>(initialLocale)
  const shots = React.useMemo(() => createShots(count, locale), [count, locale])
  return (
    <div className="min-h-screen bg-nomi-bg text-nomi-ink">
      <TopShell direction={direction} locale={locale} count={count} narrow={narrow} onLocale={setLocale} />
      <main className={`mx-auto p-4 ${narrow ? 'max-w-[760px]' : 'max-w-[1440px]'}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
            <IconSearch size={15} stroke={1.7} />{' '}
            <span>
              {locale === 'en' ? 'Fixture data · no network · no generation calls' : '固定夹具 · 无网络 · 不调用生成'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-caption text-nomi-ink-60">{locale === 'en' ? 'Review state:' : '走查状态：'}</span>
            <DesignBadge size="xs" tone="success">
              {locale === 'en' ? 'light / token-only' : '亮色 / token-only'}
            </DesignBadge>
            <WorkbenchIconButton
              icon={<IconSettings size={15} stroke={1.7} />}
              label={locale === 'en' ? 'Layout settings' : '版式设置'}
              size="sm"
            />
          </div>
        </div>
        {direction === 'a' ? (
          <GridDirection shots={shots} locale={locale} count={count} />
        ) : direction === 'b' ? (
          <InspectorDirection shots={shots} locale={locale} count={count} />
        ) : (
          <ImprovedRowsDirection shots={shots} locale={locale} count={count} />
        )}
      </main>
    </div>
  )
}

export { LayoutExploreApp }
