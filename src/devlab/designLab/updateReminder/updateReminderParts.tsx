// 应用内更新提醒 · 改造后的界面件（D-update 样张，2026-10-08；只在设计实验室里用，生产未接）。
//
// 四件，都只拼现役原语，不新造原语：
//   · UpdateBadge     —— 顶栏胶囊。替换 UpdaterDialog 里那颗 `fixed z-140` 浮在内容上的「待更新」；
//                        长成宿主顶栏自己那一族按钮（项目库窗口栏的 h-7 胶囊 / 项目顶栏的 nomi-appbar__ghost），
//                        只多一个强调色。
//   · UpdateDialogCard —— UpdaterDialog 的弹窗身体改造版：只显示当前语言段的摘要（releaseNotesDigest），
//                        底栏走 DecisionBar（取消在左、主动作在右）。外层遮罩 / Esc / 焦点沿用现役 UpdaterDialog。
//   · HotfixBanner    —— 项目库顶部一次性横幅（热修版才出），表面与项目库「缺文本模型」状态条同一套 token。
//   · UpdatedCard     —— 更新后第一次打开的一次性卡片，同一表面。
// 设计系统里没有「提示条 / 卡片」表面原语（nomi-design-system.md §3.1：这一族是空的），
// 所以表面用项目库现有状态条的同一组 token 类拼，不另起一套。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconShieldCheck,
  IconDownload,
  IconExternalLink,
  IconPackage,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'
import { DecisionBar, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { shortVersion, type ReleaseNotesDigest } from './releaseNotesDigest'

export type UpdateBadgePhase = 'available' | 'downloading' | 'downloaded' | 'error'

/**
 * 宿主顶栏两种：项目库窗口栏（libraryTopActions：h-7 胶囊、text-caption）与项目顶栏右簇
 * （NomiAppBar 的 nomi-appbar__ghost：h-30 方角、text-body-sm）。胶囊照抄宿主那一族的骨架，
 * 不在两个顶栏里长成两种陌生控件。
 */
export type UpdateBadgeHost = 'library' | 'appbar'

const BADGE_HOST_CLASS: Record<UpdateBadgeHost, string> = {
  library: cn(
    'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
    'text-caption font-medium transition-colors',
  ),
  appbar: cn(
    'inline-flex items-center gap-1.5 h-[30px] px-2.5',
    'border border-transparent rounded-[var(--nomi-radius-sm)]',
    'bg-transparent font-inherit text-body-sm font-medium',
    'transition-[background,color] duration-nomi-fast ease-nomi-fast',
    'hover:bg-[var(--nomi-ink-05)]',
  ),
}

export function UpdateBadge({ phase, version, percent = 0, host, onClick }: {
  phase: UpdateBadgePhase
  version: string
  percent?: number
  host: UpdateBadgeHost
  onClick?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const iconSize = host === 'library' ? 14 : 15
  const label = phase === 'downloading'
    ? t('updateReminder.badge.downloading', { percent })
    : phase === 'downloaded'
      ? t('updateReminder.badge.ready')
      : phase === 'error'
        ? t('updateReminder.badge.failed')
        : t('updateReminder.badge.available', { version: shortVersion(version) })
  const Icon = phase === 'error' ? IconAlertTriangle : phase === 'downloaded' ? IconRefresh : IconDownload
  return (
    <button
      type="button"
      data-update-badge={phase}
      className={cn(
        BADGE_HOST_CLASS[host],
        phase === 'error' ? 'text-nomi-danger' : 'text-nomi-accent',
        'hover:text-nomi-ink',
      )}
      onClick={onClick}
    >
      <Icon size={iconSize} stroke={1.8} aria-hidden="true" />
      <span className="tabular-nums">{label}</span>
    </button>
  )
}

function FullNotesLink({ href }: { href: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-caption text-nomi-ink-60 no-underline hover:text-nomi-ink"
    >
      {t('updateReminder.dialog.fullNotes')}
      <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
    </a>
  )
}

function DigestGroups({ digest }: { digest: ReleaseNotesDigest }): JSX.Element | null {
  const { t } = useTranslation()
  if (!digest.groups.length) return null
  return (
    <div className="mt-4 flex flex-col gap-3" data-update-digest="true">
      {digest.groups.map((group, index) => (
        <section key={`${group.heading ?? 'untitled'}-${index}`}>
          {group.heading ? <h3 className="m-0 text-caption font-medium text-nomi-ink-60">{group.heading}</h3> : null}
          {group.items.length ? (
            <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
              {group.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-body-sm text-nomi-ink">
                  <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-nomi-ink-40" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      {digest.hiddenGroups > 0 ? (
        <p className="m-0 text-caption text-nomi-ink-40">{t('updateReminder.dialog.moreGroups', { count: digest.hiddenGroups })}</p>
      ) : null}
    </div>
  )
}

function MetaRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <p className="m-0 flex items-start gap-2 text-caption text-nomi-ink-60">
      <span className="mt-px shrink-0 text-nomi-ink-40" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </p>
  )
}

export type UpdateDialogView = 'available' | 'ready' | 'failed' | 'mac-steps'

export type UpdateDialogCardProps = {
  view: UpdateDialogView
  version: string
  digest: ReleaseNotesDigest
  releaseUrl: string
  /** 来自更新信息里安装包的文件大小；拿不到就不写这一行。 */
  sizeLabel?: string | null
  /** false = 未签名 Mac：主动作是「去下载新版」，点了进 mac-steps。 */
  canAutoInstall: boolean
  runningTasks?: number
  errorMessage?: string
  onClose?: () => void
}

/** UpdaterDialog 改造版的弹窗身体（`role=dialog` 的那块 section）。 */
export function UpdateDialogCard({
  view,
  version,
  digest,
  releaseUrl,
  sizeLabel,
  canAutoInstall,
  runningTasks = 0,
  errorMessage,
  onClose,
}: UpdateDialogCardProps): JSX.Element {
  const { t } = useTranslation()
  const noop = (): void => undefined
  const title = view === 'ready'
    ? t('updateReminder.dialog.readyTitle', { version })
    : view === 'failed'
      ? t('updateReminder.dialog.failedTitle')
      : view === 'mac-steps'
        ? t('updateReminder.dialog.macTitle', { version })
        : t('updateReminder.dialog.availableTitle', { version })
  const subtitle = view === 'failed' ? null : digest.title
  const HeaderIcon = view === 'failed' ? IconAlertTriangle : view === 'ready' ? IconRefresh : IconDownload
  const macSteps = [
    t('updateReminder.dialog.macSteps.open'),
    t('updateReminder.dialog.macSteps.replace'),
    t('updateReminder.dialog.macSteps.relaunch'),
  ]

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      data-update-dialog={view}
      className="w-[30rem] max-w-full rounded-nomi-lg border border-nomi-line bg-nomi-paper p-5 text-nomi-ink shadow-nomi-lg"
    >
      <header className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full',
            view === 'failed' ? 'bg-workbench-danger-soft text-workbench-danger' : 'bg-nomi-accent-soft text-nomi-accent',
          )}
          aria-hidden="true"
        >
          <HeaderIcon size={18} stroke={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="update-dialog-title" className="m-0 text-title font-semibold text-nomi-ink">{title}</h2>
          {subtitle ? <p className="m-0 mt-1 text-body-sm text-nomi-ink-60">{subtitle}</p> : null}
        </div>
        <WorkbenchIconButton size="sm" label={t('common.close')} icon={<IconX size={16} stroke={1.8} />} onClick={onClose} className="border-0 bg-transparent" />
      </header>

      {view === 'available' ? (
        <>
          <DigestGroups digest={digest} />
          <div className="mt-4 flex flex-col gap-1.5 border-t border-nomi-line pt-3">
            {sizeLabel ? <MetaRow icon={<IconPackage size={14} stroke={1.8} />}>{t('updateReminder.dialog.size', { size: sizeLabel })}</MetaRow> : null}
            <MetaRow icon={<IconShieldCheck size={14} stroke={1.8} />}>{t('updateReminder.dialog.localData')}</MetaRow>
          </div>
        </>
      ) : null}

      {view === 'ready' ? (
        runningTasks > 0 ? (
          <p className="m-0 mt-4 rounded-nomi-sm bg-nomi-ink-05 p-3 text-body-sm text-nomi-ink-80" data-update-running={runningTasks}>
            {t('updateReminder.dialog.running', { count: runningTasks })}
          </p>
        ) : (
          <p className="m-0 mt-4 text-body-sm text-nomi-ink-80">{t('updateReminder.dialog.installOnQuit')}</p>
        )
      ) : null}

      {view === 'failed' ? (
        <div className="mt-4 flex items-start gap-2 rounded-nomi-sm bg-workbench-danger-soft p-3 text-body-sm text-workbench-danger">
          <IconAlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {/* 主进程的错误原文（describeError）是英文技术串，不当正文：正文给人话，原文退成一行小字供反馈时引用。 */}
          <span className="min-w-0">
            <span className="block">{t('updaterDialog.errorBody')}</span>
            {errorMessage ? <span className="mt-1 block break-all font-nomi-mono text-caption opacity-80">{errorMessage}</span> : null}
          </span>
        </div>
      ) : null}

      {view === 'mac-steps' ? (
        <ol className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0" data-update-mac-steps="true">
          {macSteps.map((step, index) => (
            <li key={step} className="flex items-center gap-3 text-body-sm text-nomi-ink">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-nomi-ink-05 text-caption font-semibold text-nomi-ink-80 tabular-nums" aria-hidden="true">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <footer className="mt-5">
        {view === 'available' ? (
          <DecisionBar
            leading={<FullNotesLink href={releaseUrl} />}
            cancelLabel={t('common.later')}
            onCancel={onClose}
            primaryLabel={canAutoInstall ? t('updateReminder.dialog.download') : t('updateReminder.dialog.goDownload')}
            onPrimary={noop}
          />
        ) : view === 'ready' ? (
          runningTasks > 0
            ? <DecisionBar primaryLabel={t('runtime.design.gotIt')} onPrimary={onClose ?? noop} />
            : <DecisionBar cancelLabel={t('common.later')} onCancel={onClose} primaryLabel={t('updateReminder.dialog.restart')} onPrimary={noop} />
        ) : view === 'failed' ? (
          <DecisionBar cancelLabel={t('common.later')} onCancel={onClose} primaryLabel={t('common.retry')} onPrimary={noop} />
        ) : (
          <DecisionBar
            leading={(
              <WorkbenchButton size="sm" className="border-0 bg-transparent px-0 text-nomi-ink-60 hover:bg-transparent hover:text-nomi-ink">
                {t('updateReminder.dialog.reopenDownload')}
              </WorkbenchButton>
            )}
            primaryLabel={t('runtime.design.gotIt')}
            onPrimary={onClose ?? noop}
          />
        )}
      </footer>
    </section>
  )
}

/** 表面 = 项目库「缺文本模型」状态条那一组 token（ProjectLibraryPage 的 data-model-banner）。 */
const LIBRARY_STRIP_SURFACE = 'border border-nomi-line rounded-nomi bg-nomi-paper shadow-nomi-sm'

export function HotfixBanner({ version, headline, onView, onDismiss }: {
  version: string
  headline: string
  onView?: () => void
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      className={cn('shrink-0 flex items-center gap-3 px-4 py-2.5', LIBRARY_STRIP_SURFACE)}
      aria-label={t('updateReminder.hotfix.label', { version })}
      data-update-hotfix-banner={version}
    >
      <span className="inline-flex h-5 shrink-0 items-center rounded-pill bg-nomi-accent-soft px-2 text-micro font-medium text-nomi-accent tabular-nums">
        {t('updateReminder.hotfix.label', { version })}
      </span>
      <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-nomi-ink">{headline}</span>
      <WorkbenchButton size="sm" className="shrink-0" onClick={onView}>{t('updateReminder.hotfix.view')}</WorkbenchButton>
      <WorkbenchIconButton size="sm" label={t('common.close')} icon={<IconX size={14} stroke={1.8} />} onClick={onDismiss} className="shrink-0 border-0 bg-transparent" />
    </section>
  )
}

export function UpdatedCard({ fromVersion, toVersion, headline, items, releaseUrl, onDismiss }: {
  /** 跳了几版才给：标题写「从 A 更新到 B」。 */
  fromVersion?: string
  toVersion: string
  headline: string | null
  items: readonly string[]
  releaseUrl: string
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const title = fromVersion
    ? t('updateReminder.updated.titleRange', { from: fromVersion, to: toVersion })
    : t('updateReminder.updated.title', { version: toVersion })
  return (
    <section className={cn('shrink-0 flex items-start gap-3 px-4 py-3', LIBRARY_STRIP_SURFACE)} data-update-updated-card={toVersion}>
      <IconCircleCheck size={18} stroke={1.8} className="mt-0.5 shrink-0 text-nomi-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body-sm font-semibold text-nomi-ink">{title}</span>
          {headline ? <span className="text-body-sm text-nomi-ink-60">{headline}</span> : null}
        </div>
        {items.length ? (
          <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
            {items.map((item) => (
              <li key={item} className="flex items-center gap-2 text-caption text-nomi-ink-80">
                <span className="size-1 shrink-0 rounded-full bg-nomi-ink-40" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1.5"><FullNotesLink href={releaseUrl} /></div>
      </div>
      <WorkbenchIconButton size="sm" label={t('common.close')} icon={<IconX size={14} stroke={1.8} />} onClick={onDismiss} className="shrink-0 border-0 bg-transparent" />
    </section>
  )
}
