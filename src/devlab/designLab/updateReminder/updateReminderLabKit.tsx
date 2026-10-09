// 设计实验室 · 屏「应用内更新提醒」的取景台与夹具（D-update 样张，2026-10-08）。
//
// 真组件 vs 夹具：
//   · 项目库整页是现役 `ProjectLibraryPage`（Windows 自绘窗口栏 + 窗口控制，平台由 labPlatform.ts 钉成 win32），
//     项目列表从假桥 `projects.list()` 喂几条带封面的项目。
//   · 项目内顶栏是现役 `NomiAppBar`（Windows 版：品牌 / 上手 / 浏览器在它上面那条自绘窗口栏里，这里没渲染那一条）。
//   · 胶囊 / 横幅 / 更新后卡片 / 弹窗身体是**生产组件**（src/ui/app-shell/UpdatePill、HotfixBanner、UpdatedCard、
//     UpdateDialog 的 View 件），这里只喂夹具数据。它们在生产里的位置由外壳线（I-shell）摆；
//     实验室为了让它们**落在真页面的真排版里**，在真组件渲染完后往它的 DOM 里挂一个 `display:contents`
//     的插槽、再 portal 进去：项目库窗口栏右侧那组按钮的最前面 / 项目库标题行下面 / 项目顶栏右簇的最前面。
// 发版说明是仓库里的真文件（docs/release-notes/v0.23.0.md、v0.23.1.md），经生产的摘要解析器（electron/shared/releaseNotesDigest）摘出。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import i18n from '../../../i18n'
import ProjectLibraryPage from '../../../workbench/library/ProjectLibraryPage'
import NomiAppBar from '../../../ui/app-shell/NomiAppBar'
import { holdDesignLabReady } from '../labReadyHold'
import notes0230 from '../../../../docs/release-notes/v0.23.0.md?raw'
import notes0231 from '../../../../docs/release-notes/v0.23.1.md?raw'
import { digestReleaseNotesHtml } from '../../../../electron/shared/releaseNotesDigest'
import { UPDATER_INITIAL_STATE, buildReleaseNotesUrl, dialogDigest, deriveUpdatedCard, type UpdateLocale, type UpdaterErrorReason, type UpdaterErrorStage, type VersionNotes } from '../../../../electron/shared/updateReminder'
import { UpdatePillView, type UpdatePillPhase } from '../../../ui/app-shell/UpdatePill'
import { UpdateDialogCard, type UpdateDialogView } from '../../../ui/app-shell/UpdateDialog'
import { HotfixBannerView } from '../../../ui/app-shell/HotfixBanner'
import { UpdatedCardView } from '../../../ui/app-shell/UpdatedCard'

/** 主窗口默认尺寸（electron/main.ts createWindow：1440×960）。 */
export const UPDATE_REMINDER_WINDOW = { width: 1440, height: 960 } as const

export type LabLocale = 'zh-CN' | 'en'

const NOTES: Record<'0.23.0' | '0.23.1', VersionNotes> = {
  '0.23.0': digestReleaseNotesHtml(marked.parse(notes0230, { async: false }), '0.23.0'),
  '0.23.1': digestReleaseNotesHtml(marked.parse(notes0231, { async: false }), '0.23.1'),
}
export const RELEASE_URL = buildReleaseNotesUrl
/** 0.23.0 Windows 安装包大小：发版说明「安装包变小」表里的 272.4 MB（生产取 latest.yml 的 files[].size）。 */
export const WIN_INSTALLER_SIZE_0230 = '272 MB'

const updateLocale = (locale: LabLocale): UpdateLocale => (locale === 'zh-CN' ? 'zh' : 'en')
export const digestFor = (version: keyof typeof NOTES, locale: LabLocale) => dialogDigest([NOTES[version]], updateLocale(locale))

function useLabLocale(locale: LabLocale): boolean {
  const [ready, setReady] = React.useState(i18n.language === locale)
  React.useLayoutEffect(() => {
    if (i18n.language === locale) { setReady(true); return undefined }
    const release = holdDesignLabReady(`update-reminder:${locale}`)
    void i18n.changeLanguage(locale).then(() => { setReady(true); release() })
    return release
  }, [locale])
  return ready
}

// ── 项目库的假桥：只给项目列表（ProjectLibraryPage → useLocalProjects → listLocalProjects）──────────
function cover(hue: number): string {
  const body = `
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 40% 34%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 35% 16%)"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <rect x="60" y="110" width="110" height="190" fill="hsl(${hue} 20% 12%)"/>
    <rect x="460" y="80" width="130" height="220" fill="hsl(${hue} 18% 10%)"/>
    <circle cx="330" cy="120" r="36" fill="hsl(${(hue + 180) % 360} 70% 78%)" opacity=".85"/>
    <rect y="296" width="640" height="64" fill="hsl(${hue} 25% 9%)"/>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">${body}</svg>`)
}

const PROJECT_NAMES: Record<LabLocale, readonly string[]> = {
  'zh-CN': ['雨夜入场 · 第二版', '城市夜跑广告', '猫咖开业短片', '毕业季回忆', '新品耳机 15 秒', '旅行 vlog 剪辑'],
  en: ['Night entrance · v2', 'City night-run ad', 'Cat café opening', 'Graduation memories', 'Earbuds 15s spot', 'Travel vlog cut'],
}
const HOURS_AGO = [0.4, 3, 26, 50, 120, 300]
const HUES = [210, 28, 160, 330, 260, 95]

function installLibraryBridge(locale: LabLocale, badge?: BadgeSpec, scenario?: NoticeScenario): void {
  const now = Date.now()
  const projects = PROJECT_NAMES[locale].map((name, index) => {
    const url = cover(HUES[index])
    const at = now - HOURS_AGO[index] * 3_600_000
    return { id: `lab-update-${index}`, name, createdAt: at - 86_400_000, updatedAt: at, revision: 3, savedAt: at, thumbnail: url, thumbnailUrls: [url], source: 'native' }
  })
  const host = window as unknown as { nomiDesktop?: Record<string, unknown> }
  host.nomiDesktop = {
    ...(host.nomiDesktop ?? {}),
    platform: 'win32',
    projects: { ...((host.nomiDesktop?.projects as object) ?? {}), list: () => projects },
  }
  installUpdateBridge(badge, scenario)
}

/**
 * 胶囊走**生产的连接件**（UpdatePill 读 useUpdater，useUpdater 读主进程快照）：这里只装一个假的更新桥，
 * 把夹具状态当作「主进程快照」喂进去，胶囊由真顶栏 / 真项目库窗口栏自己渲染在它们现役的位置上。
 * 窄屏图标态靠 CSS 视口断点，实验室视口固定 1440，那一格走插槽强制 compact（下面 InjectedSlot）。
 */
function installUpdateBridge(badge?: BadgeSpec, scenario?: NoticeScenario): void {
  const host = window as unknown as { nomiDesktop?: Record<string, unknown> }
  const live = badge && !badge.compact ? badge : null
  const state = live
    ? {
        ...UPDATER_INITIAL_STATE,
        phase: live.phase,
        latestVersion: live.version,
        percent: live.percent ?? 0,
        notes: [NOTES['0.23.1']],
        errorMessage: live.phase === 'error' ? 'net::ERR_CONNECTION_RESET' : '',
        errorStage: live.phase === 'error' ? (live.failedStage ?? 'download') : null,
        errorReason: live.phase === 'error' ? ('interrupted' as const) : null,
      }
    : UPDATER_INITIAL_STATE
  const card = scenario?.updatedCard
    ? { fromVersion: scenario.updatedCard.from ?? '0.23.0', toVersion: scenario.updatedCard.to, notes: scenario.updatedCard.chain.map((version) => NOTES[version]) }
    : null
  const noopAsync = async (): Promise<{ ok: boolean }> => ({ ok: true })
  host.nomiDesktop = {
    ...(host.nomiDesktop ?? {}),
    update: {
      appInfo: async () => ({ version: '0.23.0', platform: scenario?.platform ?? 'win32', arch: 'x64', canAutoInstall: true, canCheckUpdates: true }),
      snapshot: async () => ({ state, memory: { dismissedBanners: scenario?.dismissed ?? [], updatedCard: card } }),
      onEvent: () => () => undefined,
      check: noopAsync,
      download: noopAsync,
      install: noopAsync,
      openDownload: noopAsync,
      dismiss: async () => null,
      reportBusy: noopAsync,
    },
  }
}

// ── 插槽：在真组件的 DOM 里挂一个 display:contents 的点位，再 portal 进去 ───────────────────────
type SlotPlacement = Readonly<{ selector: string; where: 'prepend' | 'after' }>

function InjectedSlot({ root, placement, children }: { root: React.RefObject<HTMLElement | null>; placement: SlotPlacement; children: React.ReactNode }): JSX.Element | null {
  const [host, setHost] = React.useState<HTMLElement | null>(null)
  React.useLayoutEffect(() => {
    const release = holdDesignLabReady(`update-reminder:slot:${placement.selector}`)
    let frame = 0
    let slot: HTMLElement | null = null
    const attach = (): void => {
      const anchor = root.current?.querySelector<HTMLElement>(placement.selector)
      // 项目卡片也要等出来：项目列表走 SWR，首帧是空列表。
      const listed = root.current?.querySelector('.nomi-library-page') ? Boolean(root.current?.querySelector('[data-project-card], .aspect-video')) : true
      if (!anchor || !listed) { frame = requestAnimationFrame(attach); return }
      slot = document.createElement('div')
      slot.style.display = 'contents'
      slot.dataset.updateReminderSlot = placement.selector
      if (placement.where === 'prepend') anchor.prepend(slot)
      else anchor.after(slot)
      setHost(slot)
      release()
    }
    attach()
    return () => {
      cancelAnimationFrame(frame)
      slot?.remove()
      release()
    }
  }, [placement.selector, placement.where, root])
  return host ? createPortal(children, host) : null
}

/** 项目库窗口栏右侧那组按钮（libraryTopActions）。 */
const LIBRARY_TOP_ACTIONS: SlotPlacement = { selector: '.nomi-library-page__windowbar .app-no-drag.flex', where: 'prepend' }
/** 项目顶栏右簇的最前面（任务组之前）。 */
const APPBAR_RIGHT: SlotPlacement = { selector: '.nomi-appbar__right', where: 'prepend' }

/** 项目库通知位的场景：真 HotfixBanner / UpdatedCard 由真项目库页自己渲染，这里只决定主进程「快照」里有什么。 */
export type NoticeScenario = Readonly<{
  /** 平台过滤：Mac-only 的 0.23.1 说明在 win32 上不出。默认 win32（实验室窗口平台）。 */
  platform?: string
  dismissed?: readonly string[]
  updatedCard?: { from?: string; to: '0.23.1'; chain: readonly ('0.23.0' | '0.23.1')[] }
}>

export type BadgeSpec = Readonly<{ phase: UpdatePillPhase; version: string; percent?: number; compact?: boolean; failedStage?: Exclude<UpdaterErrorStage, 'check'> }>

const noop = (): void => undefined

export function LibraryStage({ locale = 'zh-CN', badge, scenario, clipHeight }: {
  locale?: LabLocale
  badge?: BadgeSpec
  /** 项目库通知位的场景（热修横幅 / 更新后卡片）。 */
  scenario?: NoticeScenario
  /** 只看窗口栏那一截（胶囊状态）时裁掉下面。 */
  clipHeight?: number
}): JSX.Element {
  React.useMemo(() => installLibraryBridge(locale, badge, scenario), [locale, badge, scenario])
  const localeReady = useLabLocale(locale)
  const root = React.useRef<HTMLDivElement | null>(null)
  return (
    <div
      ref={root}
      data-design-lab-stage="update-library"
      className="relative overflow-hidden"
      style={{ width: UPDATE_REMINDER_WINDOW.width, height: clipHeight ?? UPDATE_REMINDER_WINDOW.height }}
    >
      {localeReady ? (
        <div style={{ height: UPDATE_REMINDER_WINDOW.height }}>
          <ProjectLibraryPage
            onOpenProject={noop}
            onDeleteProject={noop}
            onNewProject={noop}
            onOpenFolder={noop}
            onOpenModelCatalog={noop}
            onOpenSettings={noop}
            onPlayJourneyTour={noop}
            journeyTourSeen
            hasTextModel
          />
          {badge?.compact ? (
            <InjectedSlot root={root} placement={LIBRARY_TOP_ACTIONS}>
              <UpdatePillView host="library" phase={badge.phase} version={badge.version} percent={badge.percent} compact={badge.compact} failedStage={badge.failedStage} />
            </InjectedSlot>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function AppBarStage({ locale = 'zh-CN', badge }: { locale?: LabLocale; badge: BadgeSpec }): JSX.Element {
  React.useMemo(() => installUpdateBridge(badge), [badge])
  const localeReady = useLabLocale(locale)
  const root = React.useRef<HTMLDivElement | null>(null)
  return (
    <div
      ref={root}
      data-design-lab-stage="update-appbar"
      className="relative overflow-hidden bg-workbench-bg"
      style={{ width: UPDATE_REMINDER_WINDOW.width, height: 120 }}
    >
      {localeReady ? (
        <>
          <NomiAppBar
            workspaceMode="generation"
            onWorkspaceModeChange={noop}
            projectName={locale === 'zh-CN' ? '雨夜入场 · 第二版' : 'Night entrance · v2'}
            projectId="lab-update-0"
            onBackToLibrary={noop}
            onOpenModelCatalog={noop}
            onOpenSettings={noop}
          />
          {badge.compact ? (
            <InjectedSlot root={root} placement={APPBAR_RIGHT}>
            <span className="inline-flex items-center gap-2.5">
              <UpdatePillView host="appbar" phase={badge.phase} version={badge.version} percent={badge.percent} compact={badge.compact} failedStage={badge.failedStage} />
              <span className="w-px h-[18px] bg-workbench-border" aria-hidden="true" />
            </span>
            </InjectedSlot>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function DialogStage({ locale = 'zh-CN', view, version, canAutoInstall = true, runningTasks, installBlocked, errorMessage, percent, errorStage, errorReason }: {
  locale?: LabLocale
  view: UpdateDialogView
  version: '0.23.0' | '0.23.1'
  canAutoInstall?: boolean
  runningTasks?: number
  installBlocked?: boolean
  errorMessage?: string
  percent?: number
  errorStage?: UpdaterErrorStage
  errorReason?: UpdaterErrorReason
}): JSX.Element {
  const localeReady = useLabLocale(locale)
  return (
    // 底色 = 现役 UpdaterDialog 遮罩（bg-nomi-ink/20）压在页面底色上的样子；取景只到弹窗外沿 24px。
    <div data-design-lab-stage="update-dialog" className="inline-block bg-nomi-bg">
      <div className="bg-nomi-ink/20 p-6">
        {localeReady ? (
          <UpdateDialogCard
            view={view}
            version={version}
            digest={digestFor(version, locale)}
            releaseUrl={RELEASE_URL(version)}
            sizeLabel={canAutoInstall && version === '0.23.0' ? WIN_INSTALLER_SIZE_0230 : null}
            canAutoInstall={canAutoInstall}
            runningTasks={runningTasks}
            installBlocked={installBlocked}
            errorMessage={errorMessage}
            percent={percent}
            errorStage={errorStage}
            errorReason={errorReason}
          />
        ) : null}
      </div>
    </div>
  )
}
