// 「为什么更新」弹窗：点胶囊 / 横幅 / 设置→关于才开，从不主动弹。
// 只显示当前界面语言那一段发版说明（主进程已摘好）；底栏走 DecisionBar（取消在左、主动作在右）。
// Windows：点「下载更新」= 同意更新，下好后下次退出 Nomi 时自动装；有任务在跑时只说明、不给「重启」。
// Mac（未签名不能就地装）：去官网下载，弹窗停在三步引导。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconExternalLink,
  IconPackage,
  IconRefresh,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react'
import { DecisionBar, DesignProgress, useOverlayEscape, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { dialogDigest, type LocaleDigest, type UpdaterErrorReason, type UpdaterErrorStage } from '../../../electron/shared/updateReminder'
import { getDesktopBridge } from '../../desktop/bridge'
import { useUpdateStore } from './updateStore'
import { useRunningTaskCount } from './useRunningTaskCount'
import { deriveDialogView } from './updateDialogView'
import { formatInstallerSize } from './formatInstallerSize'
import { useUpdateLocale } from './useUpdateLocale'
import { useUpdater } from './useUpdater'

export type UpdateDialogView = 'available' | 'downloading' | 'ready' | 'failed' | 'mac-steps'

export function FullNotesLink({ href }: { href: string }): JSX.Element {
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

function DigestGroups({ digest }: { digest: LocaleDigest }): JSX.Element | null {
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

/** 失败话术：先说原因，再说下一步（不承诺「会接着下」）。 */
function failureKey(stage: UpdaterErrorStage | null | undefined, reason: UpdaterErrorReason | null | undefined): string {
  if (stage === 'install') return 'updateReminder.dialog.failedInstall'
  if (reason === 'offline') return 'updateReminder.dialog.failedOffline'
  if (reason === 'interrupted') return 'updateReminder.dialog.failedInterrupted'
  return 'updateReminder.dialog.failedOther'
}

export type UpdateDialogCardProps = {
  view: UpdateDialogView
  version: string
  digest: LocaleDigest
  releaseUrl: string | null
  /** 来自更新信息里安装包的文件大小；拿不到就不写这一行。 */
  sizeLabel?: string | null
  /** false = 未签名 Mac：主动作是「去下载新版」。 */
  canAutoInstall: boolean
  percent?: number
  runningTasks?: number
  /** 主进程拒绝了立即重启安装（有任务在跑，数量未知）：显示「有任务在跑」说明，不给重启按钮。 */
  installBlocked?: boolean
  errorMessage?: string
  errorStage?: UpdaterErrorStage | null
  errorReason?: UpdaterErrorReason | null
  onClose?: () => void
  onDownload?: () => void
  onOpenDownload?: () => void
  onInstall?: () => void
  onRetry?: () => void
  /** 生产里给 Esc 关闭原语定位用；夹具不需要。 */
  dialogRef?: React.Ref<HTMLElement>
}

/** 弹窗身体（`role=dialog` 的那块 section）。纯展示：设计实验室用夹具直接渲染它，生产由 UpdateDialog 接状态。 */
export function UpdateDialogCard({
  view,
  version,
  digest,
  releaseUrl,
  sizeLabel,
  canAutoInstall,
  percent = 0,
  runningTasks = 0,
  installBlocked = false,
  errorMessage,
  errorStage,
  errorReason,
  onClose,
  onDownload,
  onOpenDownload,
  onInstall,
  onRetry,
  dialogRef,
}: UpdateDialogCardProps): JSX.Element {
  const { t } = useTranslation()
  const noop = (): void => undefined
  const blocked = runningTasks > 0 || installBlocked
  const [showRaw, setShowRaw] = React.useState(false)
  const shown = version
  const title = view === 'ready'
    ? t('updateReminder.dialog.readyTitle', { version: shown })
    : view === 'downloading'
      ? t('updateReminder.dialog.downloadingTitle', { version: shown })
      : view === 'failed'
        ? t(errorStage === 'install' ? 'updateReminder.dialog.installFailedTitle' : 'updateReminder.dialog.failedTitle')
        : view === 'mac-steps'
          ? t('updateReminder.dialog.macTitle', { version: shown })
          : t('updateReminder.dialog.availableTitle', { version: shown })
  const subtitle = view === 'failed' || view === 'downloading' ? null : digest.title
  const HeaderIcon = view === 'failed' ? IconAlertTriangle : view === 'ready' ? IconRefresh : IconDownload
  const macSteps = [
    t('updateReminder.dialog.macSteps.open'),
    t('updateReminder.dialog.macSteps.replace'),
    t('updateReminder.dialog.macSteps.relaunch'),
  ]

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      data-update-dialog={view}
      className="w-[30rem] max-w-full rounded-nomi-lg border border-nomi-line bg-nomi-paper p-5 text-nomi-ink shadow-nomi-lg"
    >
      <header className="flex items-start gap-3">
        <span
          className={view === 'failed'
            ? 'grid size-9 shrink-0 place-items-center rounded-full bg-workbench-danger-soft text-workbench-danger'
            : 'grid size-9 shrink-0 place-items-center rounded-full bg-nomi-accent-soft text-nomi-accent'}
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

      {view === 'downloading' ? (
        <div className="mt-5" data-update-progress={percent}>
          <DesignProgress value={percent} size="sm" />
          <p className="m-0 mt-2 text-caption text-nomi-ink-60 tabular-nums">{t('updateReminder.dialog.progress', { percent })}</p>
        </div>
      ) : null}

      {(view === 'ready' && blocked) || (view === 'failed' && installBlocked) ? (
        <p className="m-0 mt-4 rounded-nomi-sm bg-nomi-ink-05 p-3 text-body-sm text-nomi-ink-80" data-update-running={runningTasks || 'unknown'}>
          {runningTasks > 0 ? t('updateReminder.dialog.running', { count: runningTasks }) : t('updateReminder.dialog.runningUnknown')}
        </p>
      ) : null}

      {view === 'ready' && !blocked ? (
        <p className="m-0 mt-4 text-body-sm text-nomi-ink-80">{t('updateReminder.dialog.installOnQuit')}</p>
      ) : null}

      {view === 'failed' && !installBlocked ? (
        <div className="mt-4 rounded-nomi-sm bg-workbench-danger-soft p-3 text-body-sm text-workbench-danger">
          <p className="m-0 flex items-start gap-2">
            <IconAlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0" data-update-failure={errorReason ?? 'other'}>{t(failureKey(errorStage, errorReason))}</span>
          </p>
          {/* 原文是英文技术串，不当正文：折叠在「技术详情」里，和节点错误卡同一个做法。 */}
          {errorMessage ? (
            <div className="mt-2 pl-6">
              <button
                type="button"
                onClick={() => setShowRaw((value) => !value)}
                aria-expanded={showRaw}
                className="inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-micro text-nomi-ink-40 hover:text-nomi-ink-60"
              >
                {t('generationCommon.error.technicalDetails')}
                {showRaw ? <IconChevronDown size={13} stroke={1.6} /> : <IconChevronRight size={13} stroke={1.6} />}
              </button>
              {showRaw ? (
                <pre className="mb-0 mt-1.5 max-h-[88px] select-text overflow-auto whitespace-pre-wrap break-all rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-60">{errorMessage}</pre>
              ) : null}
            </div>
          ) : null}
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
            leading={releaseUrl ? <FullNotesLink href={releaseUrl} /> : undefined}
            cancelLabel={t('common.later')}
            onCancel={onClose}
            primaryLabel={canAutoInstall ? t('updateReminder.dialog.download') : t('updateReminder.dialog.goDownload')}
            onPrimary={(canAutoInstall ? onDownload : onOpenDownload) ?? noop}
          />
        ) : view === 'downloading' ? (
          <DecisionBar primaryLabel={t('runtime.design.gotIt')} onPrimary={onClose ?? noop} />
        ) : view === 'ready' ? (
          blocked
            ? <DecisionBar primaryLabel={t('runtime.design.gotIt')} onPrimary={onClose ?? noop} />
            : <DecisionBar cancelLabel={t('common.later')} onCancel={onClose} primaryLabel={t('updateReminder.dialog.restart')} onPrimary={onInstall ?? noop} />
        ) : view === 'failed' ? (
          installBlocked
            ? <DecisionBar primaryLabel={t('runtime.design.gotIt')} onPrimary={onClose ?? noop} />
            : <DecisionBar cancelLabel={t('common.later')} onCancel={onClose} primaryLabel={t('common.retry')} onPrimary={onRetry ?? noop} />
        ) : (
          <DecisionBar
            leading={(
              <WorkbenchButton size="sm" className="border-0 bg-transparent px-0 text-nomi-ink-60 hover:bg-transparent hover:text-nomi-ink" onClick={onOpenDownload}>
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

/** 挂在应用根：自己决定显示什么，没被请求时什么都不渲染。 */
export function UpdateDialog(): JSX.Element | null {
  const updater = useUpdater()
  const macStepsShown = useUpdateStore((state) => state.macStepsShown)
  const locale = useUpdateLocale()
  const runningTasks = useRunningTaskCount()
  // 把「画布这边还有几个排队 / 生成中的任务」报给主进程；能不能立刻重启安装由主进程判（这里只负责提示）。
  const reportBusy = getDesktopBridge()?.update?.reportBusy
  React.useEffect(() => { void reportBusy?.(runningTasks)?.catch(() => undefined) }, [reportBusy, runningTasks])
  const dialogRef = React.useRef<HTMLElement | null>(null)
  const view = deriveDialogView({ dialogOpen: updater.dialogOpen, phase: updater.phase, errorStage: updater.errorStage, canAutoInstall: updater.canAutoInstall, macStepsShown })
  const visible = view !== null
  // Esc = 右上角「关闭」（更新提示是可推迟的，不是不可逆动作），让位规则走共用原语。
  useOverlayEscape(dialogRef, visible, updater.closeDialog)
  if (!view || !updater.latestVersion) return null

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-nomi-ink/20 p-4" role="presentation" data-updater-dialog="true">
      <UpdateDialogCard
        dialogRef={dialogRef}
        view={view}
        version={updater.latestVersion}
        digest={dialogDigest(updater.notes, locale)}
        releaseUrl={updater.releaseUrl}
        sizeLabel={formatInstallerSize(updater.sizeBytes)}
        canAutoInstall={updater.canAutoInstall}
        percent={updater.percent}
        runningTasks={runningTasks}
        installBlocked={updater.installBlocked}
        errorMessage={updater.errorMessage}
        errorStage={updater.errorStage}
        errorReason={updater.errorReason}
        onClose={updater.closeDialog}
        onDownload={updater.download}
        onOpenDownload={updater.openDownload}
        onInstall={updater.install}
        onRetry={updater.retry}
      />
    </div>
  )
}
