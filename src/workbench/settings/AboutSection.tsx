import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconChevronRight, IconCircleCheck, IconMap, IconMessage, IconPlayerPlay } from '@tabler/icons-react'
import { NomiLoadingMark, NomiLogoMark, NomiWordmark, WorkbenchButton } from '../../design'
import { useUpdater } from '../../ui/app-shell/useUpdater'
import { FeedbackShareContent } from '../../ui/community/FeedbackShareContent'

// 设置「关于」分区（2026-08-02 控件分层法 §1.5「归位」）。
// 这一整块原先住在品牌钮的 AboutNomiPopover 里——那个弹窗一钮四用（品牌 + 手册 + 明暗 + 更新），
// 品牌钮回归纯品牌后，版本/手册/更新搬来这儿，「外观」归到「通用」分区（同属偏好）。
// P1 加新必删旧：AboutNomiPopover 已在同 commit 删除，不留并行版。
//
// 「重看开屏动画」也归位到这里：它重放的是 SplashIntro 品牌开场（≠ 项目库主卡的「重看一遍引导」，
// 后者会建 demo 项目回放整条流水线）。两者过去名字撞车（「看看 Nomi」vs「看 Nomi 怎么出片」），
// 用户分不出是两件事；开屏重播 10 次里用不到 1 次（L4），和版本/更新同属「关于这个软件」。

function platformLabel(info: { platform: string; arch: string } | null): string {
  if (!info) return ''
  const os = info.platform === 'win32' ? 'Windows' : info.platform === 'darwin' ? 'macOS' : info.platform
  return `${os} · ${info.arch}`
}

type AboutSectionProps = {
  /** 关掉设置弹窗——手册/开屏都是「离开设置去看别的东西」，不关会被盖住。 */
  onClose: () => void
  /** 重放开屏动画；宿主没提供（理论上不会）时整行不渲染，不留死按钮。 */
  onReplaySplash?: () => void
}

/** 设置里的一行「图标 + 标题/副标题 + 右箭头」按钮，和手册/开屏两行共用。 */
function AboutActionRow({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full min-h-9 items-center gap-2.5 rounded-nomi-sm border-0 bg-nomi-ink-05 px-3 py-2 cursor-pointer text-left transition-colors hover:bg-nomi-ink-10"
      onClick={onClick}
    >
      <span className="shrink-0 text-nomi-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm text-nomi-ink">{title}</span>
        <span className="block text-micro text-nomi-ink-40">{description}</span>
      </span>
      <IconChevronRight size={16} stroke={1.8} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
    </button>
  )
}

export function AboutSection({ onClose, onReplaySplash }: AboutSectionProps): JSX.Element {
  const { t } = useTranslation()
  const updater = useUpdater()
  // 反馈与分享**内嵌**在「关于」区块里（获批样张：docs/design/mockups/2026-09-01-feedback-share-center*.png
  // 画的是它长在设置弹窗右栏、左侧 tab 始终在）。此前它 dispatch 全局事件 + 关掉设置，
  // 结果冒成一个脱离设置的独立浮层——那正是「反馈与分享点开变成独立框」这个反馈的根因。
  // 改法：在 About 区块内切视图（about ↔ feedback），复用 FeedbackShareContent，**不**再关设置。
  // 全局 FeedbackShareHost 保留，只服务四个失败面那条无设置外壳的情境入口（它直接呈现反馈卡）。
  const [view, setView] = React.useState<'about' | 'feedback'>('about')

  if (view === 'feedback') {
    return (
      <FeedbackShareContent onBackToAbout={() => setView('about')} />
    )
  }

  return (
    <div>
      {/* 品牌头：真实 Nomi logo（圆角方块 mark）+ 文字标志 No·m·i + 版本号 */}
      <div className="mb-4 flex items-center gap-3">
        <NomiLogoMark size={40} />
        <div className="min-w-0">
          <NomiWordmark fontSize={17} className="text-nomi-ink" />
          <p className="mt-0.5 text-micro text-nomi-ink-60">
            {t('about.currentVersion', { version: updater.appInfo?.version ?? '…' })}
            {updater.appInfo ? ` · ${platformLabel(updater.appInfo)}` : ''}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2">
        <AboutActionRow
          icon={<IconMessage size={18} stroke={1.6} aria-hidden="true" />}
          title={t('about.feedbackShare')}
          description={t('about.feedbackShareDescription')}
          // 内嵌切视图，不 dispatch 全局事件、不关设置——反馈就长在设置弹窗里（样张形态）。
          onClick={() => setView('feedback')}
        />
        <AboutActionRow
          icon={<IconMap size={18} stroke={1.6} aria-hidden="true" />}
          title={t('about.handbook')}
          description={t('about.handbookDescription')}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('nomi-open-handbook'))
            onClose()
          }}
        />
        {onReplaySplash ? (
          <AboutActionRow
            icon={<IconPlayerPlay size={18} stroke={1.6} aria-hidden="true" />}
            title={t('about.replaySplash')}
            description={t('about.replaySplashDescription')}
            onClick={() => {
              onClose()
              onReplaySplash()
            }}
          />
        ) : null}
      </div>

      <div className="border-t border-nomi-line-soft pt-4">
        {!updater.supported ? (
          <p className="text-body-sm text-nomi-ink-60">{t('about.desktopUpdateUnsupported')}</p>
        ) : (
          <UpdateBody updater={updater} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

function UpdateBody({ updater, onClose }: { updater: ReturnType<typeof useUpdater>; onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { phase } = updater

  if (!updater.canCheckUpdates) {
    return <p className="text-body-sm text-nomi-ink-60">{t('about.previewUpdatesDisabled')}</p>
  }

  if (phase === 'checking') {
    return (
      <div className="flex min-h-8 items-center gap-2 text-body-sm text-nomi-ink-80">
        <NomiLoadingMark size={16} label={t('about.checking')} />
        {t('about.checkingEllipsis')}
      </div>
    )
  }

  if (phase === 'up-to-date') {
    return (
      <div className="flex min-h-8 items-center gap-1.5 text-body-sm text-nomi-ink">
        <IconCircleCheck size={16} className="text-workbench-success" />
        {t('about.upToDate')}
      </div>
    )
  }

  // 检查本身失败（断网 / 开发版）：就地说明 + 重试。下载 / 安装的失败走下面的「查看」，细节在更新弹窗里。
  if (phase === 'error' && updater.errorStage === 'check') {
    return (
      <div>
        <div className="flex items-start gap-1.5 text-body-sm text-workbench-danger">
          <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{updater.errorReason === 'network' ? t('updateReminder.dialog.failedNetwork') : updater.errorMessage || t('about.updateError')}</span>
        </div>
        <div className="mt-2.5 flex justify-end">
          <WorkbenchButton variant="default" onClick={updater.retry}>{t('common.retry')}</WorkbenchButton>
        </div>
      </div>
    )
  }

  // 有更新的所有状态共用同一个弹窗（弹窗是下载 / 重启 / 去官网 / 重试的唯一入口），这里只报一句状态 + 「查看」。
  if (phase === 'available' || phase === 'downloading' || phase === 'downloaded' || phase === 'error') {
    const status = phase === 'downloading'
      ? t('updateReminder.badge.downloading', { percent: updater.percent })
      : phase === 'downloaded'
        ? t('updateReminder.badge.ready')
        : phase === 'error'
          ? t(updater.errorStage === 'install' ? 'updateReminder.badge.installFailed' : 'updateReminder.badge.failed')
          : t('updateReminder.badge.available', { version: updater.latestVersion ?? '' })
    return (
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-body-sm text-nomi-ink">{status}</span>
        <WorkbenchButton
          variant="primary"
          onClick={() => {
            onClose()
            updater.openDialog()
          }}
        >
          {t('updateReminder.about.view')}
        </WorkbenchButton>
      </div>
    )
  }

  // idle
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="text-body-sm text-nomi-ink-60">{t('about.checkAvailable')}</span>
      <WorkbenchButton variant="primary" onClick={updater.check}>{t('about.checkUpdate')}</WorkbenchButton>
    </div>
  )
}
