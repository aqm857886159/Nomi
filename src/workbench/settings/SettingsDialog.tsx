import React from 'react'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import { IconAdjustmentsHorizontal, IconBrain, IconFolder, IconInfoCircle, IconLock, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignSwitch } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { useNomiColorScheme } from '../../theme/colorScheme'
import { getAppLocale, setAppLocale, SUPPORTED_LOCALES, type AppLocale } from '../../i18n'
import { ThemeToggleButton } from '../../ui/theme/ThemeToggleButton'
import { ScreenshotHotkeySection } from './ScreenshotHotkeySection'
import { CanvasGestureSection } from './CanvasGestureSection'
import { AboutSection } from './AboutSection'
import { ProjectLocationSection } from './ProjectLocationSection'
import { AiModelsSection } from './AiModelsSection'
import { AutomationPermissionsSection } from './AutomationPermissionsSection'
import { defaultAutomationPolicySettings } from './settingsAutomationView'
import type { AutomationPolicySettings } from '../../../electron/settings/automationPolicyContract'

// 语言用「母语名」直读，不随界面语言翻译——换语言时两个名字都稳定可认（沿用 PR#50 的判断）。
const LOCALE_LABEL_KEY: Record<AppLocale, string> = { 'zh-CN': 'common.chinese', en: 'common.english' }

// 集中设置页（2026-08-01 用户拍板样张）：左 tab 右内容。首批「文件与保存」做实——自动另存开关+目录；
// 其余 tab 占位。复用 OnboardingFloatingPanel 的外壳交互（Portal + Esc + 点遮罩关），布局是居中大 modal。
type SettingsTab = 'file' | 'ai' | 'automation' | 'general' | 'about'
export type SettingsInitialSection = 'automation' | 'cursor-host' | null

const TABS: { id: SettingsTab; icon: typeof IconFolder; labelKey: string }[] = [
  { id: 'file', icon: IconFolder, labelKey: 'settings.tab.file' },
  { id: 'ai', icon: IconBrain, labelKey: 'settings.tab.ai' },
  { id: 'automation', icon: IconLock, labelKey: 'settings.tab.automation' },
  { id: 'general', icon: IconAdjustmentsHorizontal, labelKey: 'settings.tab.general' },
  { id: 'about', icon: IconInfoCircle, labelKey: 'settings.tab.about' },
]

export function SettingsDialog({
  initialTab = 'file',
  initialSection = null,
  onClose,
  onReplaySplash,
}: {
  initialTab?: SettingsTab
  initialSection?: SettingsInitialSection
  onClose: () => void
  onReplaySplash?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { isDark } = useNomiColorScheme()
  const [tab, setTab] = React.useState<SettingsTab>(initialTab)
  // t 随语言变化重渲，渲染时读 getAppLocale() 即拿最新值（沿用 LanguageMenuButton 的做法）。
  const locale = getAppLocale()
  const [enabled, setEnabled] = React.useState(false)
  const [dir, setDir] = React.useState('')
  const [automationPolicy, setAutomationPolicy] = React.useState<AutomationPolicySettings>(defaultAutomationPolicySettings)
  const [automationPolicyLoaded, setAutomationPolicyLoaded] = React.useState(false)
  const contentRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => setTab(initialTab), [initialTab])

  React.useEffect(() => {
    if (tab !== 'automation' || !initialSection) return
    const frame = window.requestAnimationFrame(() => {
      const section = contentRef.current
        ?.querySelector<HTMLElement>(`[data-settings-section="${initialSection}"]`)
      section?.scrollIntoView({ block: 'center' })
      if (initialSection === 'cursor-host' && automationPolicyLoaded) {
        section?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus({ preventScroll: true })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [automationPolicyLoaded, initialSection, tab])

  // 打开时读当前偏好（主进程 download-prefs.json）。
  React.useEffect(() => {
    void getDesktopBridge()
      ?.assets?.getAutoSavePrefs?.()
      .then((prefs) => {
        if (!prefs) return
        setEnabled(Boolean(prefs.enabled))
        setDir(String(prefs.dir || ''))
      })
      .catch(() => undefined)
  }, [])

  React.useEffect(() => {
    let active = true
    const policy = getDesktopBridge()?.settings?.automationPolicy
    if (!policy?.get) {
      setAutomationPolicyLoaded(true)
      return
    }
    void policy.get()
      .then((value) => {
        if (active && value) setAutomationPolicy(value)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setAutomationPolicyLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  // capture 阶段拦 Esc：先于画布/素材库的 window keydown 关自己（不误触删节点等）。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const persist = React.useCallback((nextEnabled: boolean, nextDir: string): void => {
    void getDesktopBridge()?.assets?.setAutoSavePrefs?.({ enabled: nextEnabled, dir: nextDir }).catch(() => undefined)
  }, [])

  const onToggle = (next: boolean): void => {
    setEnabled(next)
    persist(next, dir)
  }
  const onPickDir = async (): Promise<void> => {
    const res = await getDesktopBridge()?.assets?.pickSaveDir?.()
    if (res?.dir) {
      setDir(res.dir)
      persist(enabled, res.dir)
    }
  }

  const updateAutomationPolicy = React.useCallback((patch: Partial<AutomationPolicySettings>): void => {
    if (!automationPolicyLoaded) return
    setAutomationPolicy((current) => {
      const next = { ...current, ...patch }
      void getDesktopBridge()
        ?.settings?.automationPolicy?.set(next)
        .then((stored) => {
          if (stored) {
            setAutomationPolicy(stored)
            window.dispatchEvent(new CustomEvent('nomi-automation-policy-changed'))
          }
        })
        .catch(() => undefined)
      return next
    })
  }, [automationPolicyLoaded])

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/45 p-2 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          className="flex h-[calc(100svh-16px)] w-full max-w-[760px] flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg sm:h-[min(560px,calc(100svh-48px))] sm:flex-row"
        >
          <aside className="flex w-full flex-none flex-row gap-0.5 overflow-x-auto border-b border-nomi-line bg-nomi-ink-05 p-2 sm:w-[196px] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3.5">
            <div className="hidden px-3 pb-3 pt-1 text-body-sm font-medium text-nomi-ink sm:block">{t('settings.title')}</div>
            {TABS.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                type="button"
                className={cn(
                  'flex w-auto shrink-0 items-center gap-2.5 rounded-nomi-sm border-0 px-3 py-2 text-left text-body-sm cursor-pointer sm:w-full',
                  tab === id ? 'bg-nomi-ink text-nomi-paper' : 'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                )}
                onClick={() => setTab(id)}
              >
                <Icon size={16} stroke={1.7} aria-hidden="true" /> {t(labelKey)}
              </button>
            ))}
          </aside>

          <section ref={contentRef} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <button
              type="button"
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent cursor-pointer text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
              aria-label={t('settings.close')}
              onClick={onClose}
            >
              <IconX size={16} stroke={1.8} aria-hidden="true" />
            </button>

            {tab === 'file' ? (
              <div>
                <div className="mb-4 text-body font-medium text-nomi-ink">{t('settings.file.title')}</div>

                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-body-sm text-nomi-ink">{t('settings.file.autoSave')}</span>
                  <DesignSwitch
                    checked={enabled}
                    onChange={(event) => onToggle(event.currentTarget.checked)}
                    aria-label={t('settings.file.autoSave')}
                  />
                </div>
                <div className="mb-4 text-caption leading-relaxed text-nomi-ink-40">{t('settings.file.autoSaveHint')}</div>

                <div className={cn('mb-5', !enabled && 'pointer-events-none opacity-45')}>
                  <div className="mb-1.5 text-caption text-nomi-ink-60">{t('settings.file.saveTo')}</div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2 font-mono text-caption text-nomi-ink-60">
                      {dir || t('settings.file.noDir')}
                    </div>
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => void onPickDir()}
                      className="inline-flex flex-none items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2 text-caption text-nomi-ink cursor-pointer hover:bg-nomi-ink-05 disabled:cursor-not-allowed"
                    >
                      <IconFolder size={14} stroke={1.7} aria-hidden="true" /> {t('settings.file.pick')}
                    </button>
                  </div>
                </div>

                <ProjectLocationSection />
              </div>
            ) : tab === 'ai' ? (
              <fieldset
                disabled={!automationPolicyLoaded}
                aria-busy={!automationPolicyLoaded}
                title={!automationPolicyLoaded ? t('settings.automation.loading') : undefined}
                className="m-0 min-w-0 border-0 p-0"
              >
                <AiModelsSection settings={automationPolicy} onChange={updateAutomationPolicy} />
              </fieldset>
            ) : tab === 'automation' ? (
              <fieldset
                disabled={!automationPolicyLoaded}
                aria-busy={!automationPolicyLoaded}
                title={!automationPolicyLoaded ? t('settings.automation.loading') : undefined}
                className="m-0 min-w-0 border-0 p-0"
              >
                <AutomationPermissionsSection settings={automationPolicy} onChange={updateAutomationPolicy} />
              </fieldset>
            ) : tab === 'general' ? (
              <div>
                <div className="mb-4 text-body font-medium text-nomi-ink">{t('settings.general.title')}</div>
                <ScreenshotHotkeySection />
                <CanvasGestureSection />
                {/* 语言 / 外观归位到这里（§1.5「归位」）：它们过去挤在 studio 顶栏右簇 + 项目库顶栏，
                    外观还另有一份藏在品牌钮弹窗里——纯偏好项本来就该住设置，且这里是唯一一份（P1）。
                    ⚠️ 这一步等于改写 PR#50 的判断（当时把语言从「关于」弹窗第三层提到顶栏常驻图标，
                    理由是「换个语言要三步、藏得太深」）。改判的依据：① 首启已按系统语言探测（i18n/index.ts），
                    切换只是「探测错了纠正一次」，10 次里用不到 1 次 = §1.5 的 L4；② PR#50 治的是
                    「弹窗第三层里的一行下拉」不可发现，这里给的是设置「通用」里两个选项平铺可见的分段控件，
                    不是同一个毛病。所以是归位，不是倒退。 */}
                <div className="mt-5 border-t border-nomi-line pt-4">
                  <div className="mb-1.5 text-body-sm text-nomi-ink">{t('common.language')}</div>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {SUPPORTED_LOCALES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        data-settings-locale={option}
                        aria-pressed={option === locale}
                        onClick={() => setAppLocale(option)}
                        className={cn(
                          'rounded-nomi-sm border px-2.5 py-1.5 text-caption cursor-pointer',
                          'transition-colors duration-[var(--nomi-transition-fast)]',
                          option === locale
                            ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
                            : 'border-nomi-line bg-nomi-paper text-nomi-ink-60 hover:bg-nomi-ink-05',
                        )}
                      >
                        {t(LOCALE_LABEL_KEY[option])}
                      </button>
                    ))}
                  </div>

                  <div className="flex min-h-9 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-body-sm text-nomi-ink">{t('theme.appearance')}</div>
                      <div className="mt-0.5 text-micro text-nomi-ink-40">{isDark ? t('theme.dark') : t('theme.light')}</div>
                    </div>
                    <ThemeToggleButton className="shrink-0 border-nomi-line bg-nomi-paper" />
                  </div>
                </div>
              </div>
            ) : (
              <AboutSection onClose={onClose} onReplaySplash={onReplaySplash} />
            )}
          </section>
        </div>
      </div>
    </Portal>
  )
}
