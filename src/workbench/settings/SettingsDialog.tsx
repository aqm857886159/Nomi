import React from 'react'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import { IconAdjustmentsHorizontal, IconBrain, IconFolder, IconInfoCircle, IconLock, IconPlugConnected, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { confirmDialog, DesignSwitch, NOMI_OVERLAY_Z_INDEX } from '../../design'
import {
  getSettingsEscapeOwnership,
  settingsEscapeTargetWasRemoved,
  shouldYieldSettingsEscape,
} from '../../design/overlayLayers'
import { getDesktopBridge } from '../../desktop/bridge'
import { useNomiColorScheme } from '../../theme/colorScheme'
import { getAppLocale, setAppLocale, SUPPORTED_LOCALES, type AppLocale } from '../../i18n'
import { ThemeToggleButton } from '../../ui/theme/ThemeToggleButton'
import { ScreenshotHotkeySection } from './ScreenshotHotkeySection'
import { CanvasGestureSection } from './CanvasGestureSection'
import { AboutSection } from './AboutSection'
import { ProjectLocationSection } from './ProjectLocationSection'
import { AiModelsSection } from './AiModelsSection'
import { SystemPromptSection } from './SystemPromptSection'
import { TikhubConnectorCard } from './TikhubConnectorCard'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import { AutomationPermissionsSection } from './AutomationPermissionsSection'
import { defaultAutomationPolicySettings } from './settingsAutomationView'
import type { AutomationPolicySettings } from '../../../electron/settings/automationPolicyContract'
import type { ProductionPolicyRequirement } from '../production/productionPolicyRecovery'
import { hasSettingsUnsavedChanges } from './settingsUnsavedChanges'

// ⚠️ 必须懒加载：SettingsDialog 本身是 NomiStudioApp 里**同步 import** 的，而接入面整棵树
// （OnboardingWizard / 各家 VendorCard / ComfyUI 那套）是个 160KB+ 的独立 chunk。直接 import
// 会把它整个拽进首屏主包——实测首帧慢到走查 60s 启动超时。走 chunkBoundary 保住边界，
// 顺带 chunk 挂了只降级这一个 tab、不拖死设置页。
const OnboardingDrawer = lazyWithChunkBoundary('模型', () =>
  import('../../ui/onboarding/OnboardingDrawer').then((module) => ({ default: module.OnboardingDrawer })),
)
// 纯类型（`import type` 会被编译期抹掉），不会把上面那个 160KB chunk 拽进首屏。
import type { ModelPageRequest } from '../../ui/onboarding/useModelPageRequest'

// 语言用「母语名」直读，不随界面语言翻译——换语言时两个名字都稳定可认（沿用 PR#50 的判断）。
const LOCALE_LABEL_KEY: Record<AppLocale, string> = { 'zh-CN': 'common.chinese', en: 'common.english' }

// 集中设置页（2026-08-01 用户拍板样张）：左 tab 右内容。首批「文件与保存」做实——自动另存开关+目录；
// 其余 tab 占位。外壳交互为 Portal + Esc + 点遮罩关，布局是居中大 modal。
// 2026-08-12 用户拍板：五 tab 变六 tab，「模型」独立成一档。
// 为什么原拍板不再成立：定五 tab 那会儿「模型」= 几个 API key，塞进「AI 与模型」够用；
// 现在多实例 ComfyUI + 自定义工作流已长成一个要整页的子系统。而那个 tab 里的东西
// （默认模型策略 / 上传边界）其实服务的是 **MCP 代跑护栏**（trustedHosts=nomi/claude/codex/cursor），
// 不是「我的模型」——名不副实正是「改 api url 翻半天找不到」的根因，故一并改名「AI 策略」。
// 手法按 §1.5.3 取代价最低的那档：**分组**（代价 0），不是把东西收进 ▾。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
export type SettingsTab = 'file' | 'models' | 'ai' | 'automation' | 'general' | 'about'
export type SettingsInitialSection = 'automation' | 'cursor-host' | 'ai-models' | 'production-policy' | 'tikhub-connector' | null

const TABS: { id: SettingsTab; icon: typeof IconFolder; labelKey: string }[] = [
  { id: 'file', icon: IconFolder, labelKey: 'settings.tab.file' },
  { id: 'models', icon: IconPlugConnected, labelKey: 'settings.tab.models' },
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
  productionPolicyRequirement = null,
}: {
  initialTab?: SettingsTab
  initialSection?: SettingsInitialSection
  onClose: () => void
  onReplaySplash?: () => void
  productionPolicyRequirement?: ProductionPolicyRequirement | null
}): JSX.Element {
  const { t } = useTranslation()
  const { isDark } = useNomiColorScheme()
  const [tab, setTab] = React.useState<SettingsTab>(initialTab)
  const [modelsMounted, setModelsMounted] = React.useState(initialTab === 'models')
  // 「去配置 KIE」这类请求：切到模型 tab 还不够，得让模型工作区直接落到那家的 Key 输入页。
  const [modelPageRequest, setModelPageRequest] = React.useState<ModelPageRequest>(null)
  // t 随语言变化重渲，渲染时读 getAppLocale() 即拿最新值（沿用 LanguageMenuButton 的做法）。
  const locale = getAppLocale()
  const [enabled, setEnabled] = React.useState(false)
  const [dir, setDir] = React.useState('')
  const [automationPolicy, setAutomationPolicy] = React.useState<AutomationPolicySettings>(defaultAutomationPolicySettings)
  const [automationPolicyLoaded, setAutomationPolicyLoaded] = React.useState(false)
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLElement>(null)
  const navRef = React.useRef<HTMLElement>(null)
  const closePromptOpenRef = React.useRef(false)

  const requestClose = React.useCallback(async (): Promise<void> => {
    if (!hasSettingsUnsavedChanges(dialogRef.current)) {
      onClose()
      return
    }
    if (closePromptOpenRef.current) return
    closePromptOpenRef.current = true
    try {
      const discard = await confirmDialog({
        title: t('settings.unsaved.title'),
        message: t('settings.unsaved.message'),
        confirmLabel: t('settings.unsaved.discard'),
        danger: true,
      })
      if (discard) onClose()
    } finally {
      closePromptOpenRef.current = false
    }
  }, [onClose, t])

  const selectTab = React.useCallback((nextTab: SettingsTab): void => {
    if (nextTab === 'models') setModelsMounted(true)
    setTab(nextTab)
  }, [])

  React.useEffect(() => selectTab(initialTab), [initialTab, selectTab])

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nav = navRef.current
      const active = nav?.querySelector<HTMLElement>(`[data-settings-tab-id="${tab}"]`)
      if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
      nav.scrollTo({
        left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2,
        behavior: 'auto',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [tab])

  React.useEffect(() => {
    if (!initialSection) return
    const frame = window.requestAnimationFrame(() => {
      const section = contentRef.current?.querySelector<HTMLElement>(`[data-settings-section="${initialSection}"]`)
      section?.scrollIntoView({ block: 'center' })
      if (automationPolicyLoaded && initialSection !== 'production-policy') {
        const focusTarget = section?.querySelector<HTMLElement>('button, input, [tabindex]')
        focusTarget?.focus({ preventScroll: true })
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

  // 目标控件先处理 Esc；document 冒泡仍早于画布的 window 快捷键，所以不会误触画布。
  React.useEffect(() => {
    const delegatedEscapes = new WeakSet<KeyboardEvent>()
    const externalEscapes = new WeakSet<KeyboardEvent>()

    const markDelegatedEscape = (event: KeyboardEvent): void => {
      const dialog = dialogRef.current
      if (event.key !== 'Escape' || !dialog) return
      if (event.isComposing) {
        delegatedEscapes.add(event)
        return
      }
      const ownership = getSettingsEscapeOwnership(dialog, event.target)
      // A later dialog owns the complete event path, including its own document/window handler.
      if (ownership.dialogAbove) {
        externalEscapes.add(event)
        return
      }
      if (shouldYieldSettingsEscape(ownership)) delegatedEscapes.add(event)
    }

    const onKeyBubble = (event: KeyboardEvent): void => {
      const dialog = dialogRef.current
      if (event.key !== 'Escape' || !dialog) return
      if (externalEscapes.has(event)) return
      if (getSettingsEscapeOwnership(dialog, event.target).dialogAbove) return

      const ownership = {
        dialogAbove: false,
        openPopup: delegatedEscapes.has(event),
        targetOwnsEscape: event.defaultPrevented,
        targetWasRemoved: settingsEscapeTargetWasRemoved(event.target),
      }
      if (shouldYieldSettingsEscape(ownership)) {
        event.stopPropagation()
        return
      }

      event.stopPropagation()
      if (tab === 'models' && dialog.querySelector('[data-model-settings-page]')) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('nomi-model-settings-back'))
        return
      }
      void requestClose()
    }

    window.addEventListener('keydown', markDelegatedEscape, true)
    document.addEventListener('keydown', onKeyBubble)
    return () => {
      window.removeEventListener('keydown', markDelegatedEscape, true)
      document.removeEventListener('keydown', onKeyBubble)
    }
  }, [requestClose, tab])

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
        ref={dialogRef}
        data-settings-overlay
        className="fixed inset-0 flex items-center justify-center bg-black/45 p-2 sm:p-6"
        style={{ zIndex: NOMI_OVERLAY_Z_INDEX.applicationModal }}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) void requestClose()
        }}
      >
        <div
          data-settings-dialog
          data-settings-tab={tab}
          data-settings-frame="fixed"
          className="relative flex h-[calc(100svh-16px)] w-full max-w-[760px] flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg sm:h-[min(560px,calc(100svh-48px))] sm:flex-row"
        >
          <aside
            ref={navRef}
            data-settings-nav
            className="flex w-full flex-none flex-row gap-0.5 overflow-x-auto border-b border-nomi-line bg-nomi-ink-05 p-2 sm:w-[196px] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3.5"
          >
            <div className="hidden px-3 pb-3 pt-1 text-body-sm font-medium text-nomi-ink sm:block">{t('settings.title')}</div>
            {TABS.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                type="button"
                data-settings-tab-id={id}
                className={cn(
                  'flex w-auto shrink-0 items-center gap-2.5 rounded-nomi-sm border-0 px-3 py-2 text-left text-body-sm cursor-pointer sm:w-full',
                  tab === id ? 'bg-nomi-ink text-nomi-paper' : 'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                )}
                onClick={() => selectTab(id)}
              >
                <Icon size={16} stroke={1.7} aria-hidden="true" /> {t(labelKey)}
              </button>
            ))}
          </aside>

          <section
            ref={contentRef}
            data-settings-content
            className={cn(
              'relative min-h-0 min-w-0 flex-1',
              tab === 'models' ? 'overflow-hidden p-0' : 'overflow-y-auto p-4 sm:p-6',
            )}
          >
            <button
              type="button"
              data-settings-close
              className="absolute right-3 top-3 z-30 grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent cursor-pointer text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
              aria-label={t('settings.close')}
              onClick={() => { void requestClose() }}
            >
              <IconX size={16} stroke={1.8} aria-hidden="true" />
            </button>

            {modelsMounted ? (
              // 模型管理是独立工作区，首次访问后保持挂载。切走再回来时，向导步骤和脚本草稿不会重置。
              <div
                hidden={tab !== 'models'}
                style={{ display: tab !== 'models' ? 'none' : undefined }}
                data-settings-page="models"
                data-settings-model-workspace
                data-settings-section="models"
                className="flex h-full min-h-0 flex-col overflow-hidden [&_[data-model-settings-page]>header]:pr-14 [&>div:not([data-model-settings-page])>:first-child]:pr-14"
              >
                {/* 本地 Suspense 保住懒加载边界；没有访问模型页时仍不会下载接入模块。 */}
                <React.Suspense fallback={<div className="px-4 py-3 pr-14 text-caption text-nomi-ink-40 sm:px-5 sm:pr-14">{t('settings.automation.loading')}</div>}>
                  <OnboardingDrawer pageRequest={modelPageRequest} />
                </React.Suspense>
              </div>
            ) : null}

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
                <AiModelsSection
                  settings={automationPolicy}
                  onChange={updateAutomationPolicy}
                  productionPolicyRequirement={productionPolicyRequirement}
                  focusEnabled={automationPolicyLoaded}
                  onOpenModelCatalog={(vendorKey) => {
                    selectTab('models')
                    // token 用递增计数而非 vendorKey 本身：模型工作区常驻挂载，返回首页后再点一次
                    // 得能重新打开（值没变 = effect 不跑 = 按钮第二次点了没反应）。
                    if (vendorKey) setModelPageRequest((current) => ({ vendorKey, token: (current?.token ?? 0) + 1 }))
                  }}
                />
                {/* 系统提示词的家（用户 2026-08-17 拍板）：过去只能在创作面板 popover 的 64px 只读小框里看。
                    它是「AI 怎么干活」的设置，和本 tab 的模型策略同源，故归位到这里而不是新开 tab（§1.5 归位）。 */}
                <SystemPromptSection />
                {/* TikHub 数据源（分享链接直拆）：BYO-key 数据 connector，与本 tab 的上传通道/模型策略同为
                    「模型数据管路」，故归位到这里而不是新开入口（§1.5 归位）。见 2026-09-01-tikhub-connector-v1.md。 */}
                <TikhubConnectorCard />
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
            ) : tab === 'about' ? (
              <AboutSection onClose={() => { void requestClose() }} onReplaySplash={onReplaySplash} />
            ) : null}
          </section>
        </div>
      </div>
    </Portal>
  )
}
