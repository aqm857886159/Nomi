import React, { type JSX } from 'react'
import {
  IconChevronUp,
  IconClipboard,
  IconExternalLink,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useApimartVerification } from './useApimartVerification'
import { ApimartTopUpNotice } from './ApimartTopUpNotice'
import { ApimartCheckCard } from './ApimartCheckCard'
import {
  ICON_TIER_CLASSES,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchButton,
  WorkbenchIconButton,
} from '../../design'
import { modalInputLayerCovers } from '../../design/modalInputLayer'
import { isMacPlatform, platformModifier } from '../../design/platformShortcut'
import { cn } from '../../utils/cn'
import { ShellFrame } from '../app-shell/shell/ShellFrame'
import { ShellTopBar } from '../app-shell/shell/ShellTopBar'
import { ApimartFineprintPopover } from './ApimartFineprintPopover'
import { ApimartWorksCollage } from './ApimartWorksCollage'
import {
  APIMART_MIRROR_DOMAINS,
  APIMART_REGISTER_URL,
  buildApimartMirrorUrl,
  openExternalUrlWithDebounce,
  openModelSettingsHome,
  persistApimartOpenedAt,
  readApimartOpenedAt,
} from './apimartConnectRoute'
import {
  useOnboardingModelAvailability,
} from './onboardingModelAvailability'

import { ApimartWaitingBanner } from './ApimartWaitingBanner'
import { ApimartStatusNotice } from './ApimartStatusNotice'

const CONNECT_PAGE_TWO_COLUMN_MIN_WIDTH = 1180

function useIsNarrowConnectContainer(containerRef: React.RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = React.useState(false)

  React.useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const update = (width: number): void => {
      if (width <= 0) return
      setNarrow(width < CONNECT_PAGE_TWO_COLUMN_MIN_WIDTH)
    }
    update(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [containerRef])

  return narrow
}

function useStepAutoCycle(paused: boolean): number {
  const [stepIndex, setStepIndex] = React.useState(0)

  React.useEffect(() => {
    if (paused || typeof window === 'undefined') return undefined
    const reduced =
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return undefined
    const timer = window.setInterval(() => {
      setStepIndex((prev) => (prev + 1) % 3)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [paused])

  return stepIndex
}

export function ApimartConnectPage({
  originLabel,
  focusNonce = 0,
  onBack,
  onSaved,
  onOpenSettings,
}: {
  originLabel: string
  focusNonce?: number
  onBack: () => void
  onSaved: () => void
  onOpenSettings?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { apimartCounts } = useOnboardingModelAvailability()
  const pageRef = React.useRef<HTMLElement | null>(null)
  const isNarrow = useIsNarrowConnectContainer(pageRef)
  const [fineprintOpen, setFineprintOpen] = React.useState(false)
  const [cantOpenExpanded, setCantOpenExpanded] = React.useState(false)
  const [hoveredStep, setHoveredStep] = React.useState<number | null>(null)
  const [openedAt, setOpenedAt] = React.useState(readApimartOpenedAt)
  const verification = useApimartVerification(onSaved)
  const { stage, check: saveKey } = verification
  const busy = stage === 'checking' || stage === 'passed'
  const notice = stage === 'format' || stage === 'invalid' || stage === 'keychain' || stage === 'offline' ? stage : null
  const checking = verification.suffix !== '' && stage !== 'idle'
  const [showSteps, setShowSteps] = React.useState(false)
  const departing = !openedAt && !checking
  const [error, setError] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const lastOpenedSiteAtRef = React.useRef(0)

  const openSite = (url: string): void => {
    if (openExternalUrlWithDebounce(url, lastOpenedSiteAtRef)) {
      setOpenedAt(lastOpenedSiteAtRef.current)
      persistApimartOpenedAt(lastOpenedSiteAtRef.current)
    }
  }
  const errorId = React.useId()

  const autoStep = useStepAutoCycle(hoveredStep !== null || (checking && !showSteps))

  React.useEffect(() => {
    if (focusNonce > 0) {
      inputRef.current?.focus()
    }
  }, [focusNonce])

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (pageRef.current && modalInputLayerCovers(pageRef.current)) return
      event.preventDefault()
      if (fineprintOpen) {
        setFineprintOpen(false)
        return
      }
      onBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fineprintOpen, onBack])

  const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
  const mod = platformModifier(platform)
  const pasteShortcut = isMacPlatform(platform) ? `${mod}V` : `${mod}+V`
  const pasteTooltip = t('onboardingProviders.apimartConnect.keyInput.pasteTooltip', {
    shortcut: pasteShortcut,
  })

  const handlePasteButtonClick = React.useCallback(async (): Promise<void> => {
    if (busy) return
    try {
      const clipboardText =
        typeof navigator !== 'undefined' && navigator.clipboard?.readText
          ? await navigator.clipboard.readText()
          : ''
      const trimmed = clipboardText.trim()
      if (!trimmed) {
        setError(t('onboardingProviders.apimartConnect.keyInput.pasteEmpty', { shortcut: pasteShortcut }))
        inputRef.current?.focus()
        return
      }
      setError('')
      if (inputRef.current) inputRef.current.value = ''
      await saveKey(trimmed)
    } catch {
      setError(t('onboardingProviders.apimartConnect.keyInput.pasteEmpty', { shortcut: pasteShortcut }))
      inputRef.current?.focus()
    }
  }, [busy, pasteShortcut, saveKey, t])

  const steps = [
    {
      id: 'signup',
      number: 1,
      label: t('onboardingProviders.apimartConnect.steps.signup.label'),
      hint: t('onboardingProviders.apimartConnect.steps.signup.hint'),
      pathStart: t('onboardingProviders.apimartConnect.steps.signup.pathStart'),
      pathEnd: t('onboardingProviders.apimartConnect.steps.signup.pathEnd'),
    },
    {
      id: 'topup',
      number: 2,
      label: t('onboardingProviders.apimartConnect.steps.topup.label'),
      hint: t('onboardingProviders.apimartConnect.steps.topup.hint'),
      pathStart: t('onboardingProviders.apimartConnect.steps.topup.pathStart'),
      pathEnd: t('onboardingProviders.apimartConnect.steps.topup.pathEnd'),
    },
    {
      id: 'createKey',
      number: 3,
      label: t('onboardingProviders.apimartConnect.steps.createKey.label'),
      hint: t('onboardingProviders.apimartConnect.steps.createKey.hint'),
      pathStart: t('onboardingProviders.apimartConnect.steps.createKey.pathStart'),
      pathEnd: t('onboardingProviders.apimartConnect.steps.createKey.pathEnd'),
    },
  ] as const

  const rightColumn = (
    <div className="flex w-full max-w-[624px] flex-col font-normal" data-apimart-right>
      <div className="flex flex-col gap-2">
        <h1
          className="m-0 text-display font-semibold leading-[36px] tracking-[-0.02em] text-nomi-ink"
          data-apimart-claim
        >
          {t('onboardingProviders.apimartConnect.claimTitle')}
        </h1>
        {departing && <p className="m-0 text-body font-normal text-nomi-ink-60" data-apimart-subtitle>
          {t('onboardingProviders.apimartConnect.claimSubtitle')}
        </p>}
      </div>

      {departing && <>
      <div
        className={cn('grid grid-cols-3 gap-6', isNarrow ? 'mt-6' : 'mt-8')}
        data-apimart-reasons
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span
            className="text-display font-semibold leading-[36px] tabular-nums text-nomi-ink"
            data-apimart-model-total
          >
            {apimartCounts.total}
          </span>
          <span className="text-caption font-normal text-nomi-ink-60">
            {t('onboardingProviders.apimartConnect.reasons.modelsLabel')}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-display font-semibold leading-[36px] tabular-nums text-nomi-ink">
            {t('onboardingProviders.apimartConnect.reasons.latestValue')}
          </span>
          <span className="text-caption font-normal text-nomi-ink-60">
            {t('onboardingProviders.apimartConnect.reasons.latestLabel')}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-display font-semibold leading-[36px] tabular-nums text-nomi-ink">
            {t('onboardingProviders.apimartConnect.reasons.savingsValue')}
          </span>
          <span className="text-caption font-normal text-nomi-ink-60">
            {t('onboardingProviders.apimartConnect.reasons.savingsLabel')}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-caption font-normal text-nomi-ink-60" data-apimart-cost>
        <span className="min-w-0 flex-1">{t('onboardingProviders.apimartConnect.costLine')}</span>
        <ApimartFineprintPopover
          counts={apimartCounts}
          open={fineprintOpen}
          onOpenChange={setFineprintOpen}
        />
      </div>

      </>}
      {openedAt > 0 && !checking && <ApimartWaitingBanner at={openedAt} reopen={() => openSite(APIMART_REGISTER_URL)}
        toggle={() => setCantOpenExpanded((value) => !value)} expanded={cantOpenExpanded} />}
      {checking && <button type="button" aria-expanded={showSteps} className="mt-4 self-start text-caption text-nomi-ink-60"
        onClick={() => setShowSteps((open) => !open)}>
        {showSteps ? '⌄ ' : '› '}{t(showSteps ? 'modelSetup.apimartVerification.expanded' : 'modelSetup.apimartVerification.collapsed')}
      </button>}
      {(!checking || showSteps) && <div className={cn('flex flex-col gap-2', openedAt ? 'mt-3' : isNarrow ? 'mt-6' : 'mt-10')} data-apimart-steps>
        <span className="text-caption font-normal text-nomi-ink-60">
          {t('onboardingProviders.apimartConnect.stepsHeading')}
        </span>
        <div className="flex flex-col gap-2" onMouseLeave={() => setHoveredStep(null)}>
          {steps.map((step, index) => {
            const isHovered = hoveredStep === index
            const isHighlighted = isHovered || (hoveredStep === null && autoStep === index)
            return (
              <div
                key={step.id}
                tabIndex={0}
                onMouseEnter={() => setHoveredStep(index)}
                onFocus={() => setHoveredStep(index)}
                onBlur={() => setHoveredStep((current) => (current === index ? null : current))}
                data-apimart-step={step.id}
                data-step-active={isHighlighted ? 'true' : 'false'}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-field pl-2 pr-3 transition-[background-color,box-shadow] duration-nomi-fast ease-nomi-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
                  isHighlighted && 'bg-nomi-ink-05 ring-1 ring-inset ring-nomi-ink-30',
                )}
              >
                <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-pill bg-nomi-accent text-caption font-semibold tabular-nums text-nomi-media-ink">
                  {step.number}
                </span>
                <span className="min-w-0 flex-1 whitespace-nowrap text-body-sm font-semibold text-nomi-ink">
                  {step.label}
                </span>
                {isHovered ? (
                  <span
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption font-normal text-nomi-ink-60"
                    data-apimart-step-hint={step.id}
                  >
                    <span>{step.hint}</span>
                    <span className="text-nomi-ink-40">·</span>
                    <span className="text-nomi-ink-80">{step.pathStart}</span>
                    <span className="text-nomi-ink-40">→</span>
                    <span className="text-nomi-ink-80">{step.pathEnd}</span>
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>}

      {(departing || (cantOpenExpanded && !checking)) && <div className={cn('flex flex-col', isNarrow ? 'mt-4' : 'mt-5')}>
        {departing && <div className="flex flex-wrap items-center gap-3" data-apimart-cta-row>
          <WorkbenchButton
            variant="primary"
            iconTier="corner"
            className="rounded-pill px-4 font-semibold"
            onClick={() => {
              openSite(APIMART_REGISTER_URL)
            }}
            data-apimart-open-site
          >
            {t('onboardingProviders.apimartConnect.openSite')}
            <IconExternalLink aria-hidden="true" />
          </WorkbenchButton>
          <span className="inline-flex items-center whitespace-nowrap text-caption font-normal text-nomi-ink-60">
            <button
              type="button"
              aria-expanded={cantOpenExpanded}
              onClick={() => setCantOpenExpanded((prev) => !prev)}
              data-apimart-cant-open-toggle
              className={cn(
                'inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 font-inherit text-caption font-normal text-nomi-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-ink',
                ICON_TIER_CLASSES.corner,
              )}
            >
              {t('onboardingProviders.apimartConnect.cantOpenTrigger')}
              {cantOpenExpanded ? <IconChevronUp aria-hidden="true" /> : null}
            </button>
            <span className="ml-1">{t('onboardingProviders.apimartConnect.inviteNote')}</span>
          </span>
        </div>}

        {cantOpenExpanded && !checking ? (
          <div
            className="mt-2.5 flex flex-col gap-1.5 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2.5"
            data-apimart-cant-open-panel
          >
            <span className="text-body-sm font-semibold text-nomi-ink">
              {t('onboardingProviders.apimartConnect.cantOpen.heading')}
            </span>
            <span className="text-caption font-normal text-nomi-ink-60">
              {t('onboardingProviders.apimartConnect.cantOpen.lead')}
            </span>
            {APIMART_MIRROR_DOMAINS.map((domain) => (
              <div key={domain} className="flex items-center gap-2 text-body-sm">
                <span className="font-nomi-mono font-normal text-nomi-ink">{domain}</span>
                <button
                  type="button"
                  onClick={() => {
                    openSite(buildApimartMirrorUrl(domain))
                  }}
                  data-apimart-mirror={domain}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-inherit text-caption font-normal text-nomi-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-ink',
                    ICON_TIER_CLASSES.corner,
                  )}
                >
                  {t('onboardingProviders.apimartConnect.cantOpen.openMirror')}
                  <IconExternalLink aria-hidden="true" />
                </button>
              </div>
            ))}
            <p className="m-0 text-caption font-normal leading-relaxed text-nomi-ink-60">
              {t('onboardingProviders.apimartConnect.cantOpen.deviceNote')}{' '}
              <button
                type="button"
                onClick={() => openModelSettingsHome({ scrollToNetwork: true })}
                data-apimart-proxy-settings
                className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-inherit text-caption font-normal text-nomi-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-ink"
              >
                {t('onboardingProviders.apimartConnect.cantOpen.proxyAction')}
              </button>
            </p>
          </div>
        ) : null}
      </div>}

      {departing && <p className="m-0 mt-2 text-caption font-normal text-nomi-ink-60" data-apimart-worries>
        {t('onboardingProviders.apimartConnect.worries')}
      </p>}

      <div className={cn('flex flex-col gap-2', checking ? 'mt-2' : isNarrow ? 'mt-6' : 'mt-8')} data-apimart-key-section>
        <label hidden={checking} htmlFor="apimart-connect-key-input" className="text-caption font-normal text-nomi-ink-60">
          {t('onboardingProviders.apimartConnect.keyInput.label')}
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            id="apimart-connect-key-input"
            type="password"
            defaultValue=""
            autoComplete="off"
            disabled={busy}
            aria-invalid={error || (notice && notice !== 'offline') ? true : undefined}
            aria-describedby={error || (notice && notice !== 'offline') ? errorId : undefined}
            placeholder={checking ? `sk-••••••••••••••••${verification.suffix}` : t('onboardingProviders.apimartConnect.keyInput.placeholder')}
            onChange={() => {
              if (stage !== 'idle') verification.reset()
              if (error) setError('')
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text')
              if (pasted.trim()) {
                event.preventDefault()
                event.currentTarget.value = ''
                setError('')
                void saveKey(pasted)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (checking && !event.currentTarget.value) {
                  if (stage === 'offline' || stage === 'keychain') void verification.retry()
                  return
                }
                const value = event.currentTarget.value
                event.currentTarget.value = ''
                setError('')
                void saveKey(value)
              }
            }}
            className={cn(
              'h-9 min-w-0 flex-1 rounded-field border bg-nomi-paper px-3 font-nomi-sans text-body-sm font-normal text-nomi-ink outline-none placeholder:text-nomi-ink-40 focus:border-nomi-ink-40 disabled:cursor-not-allowed disabled:opacity-60',
              error || (notice && notice !== 'offline') ? 'border-workbench-danger' : 'border-nomi-line',
            )}
          />
          <TooltipProvider delayDuration={200} disableHoverableContent>
            <Tooltip>
              <TooltipTrigger asChild>
                <WorkbenchIconButton
                  icon={<IconClipboard aria-hidden="true" />}
                  label={pasteTooltip}
                  disabled={busy}
                  onClick={() => {
                    void handlePasteButtonClick()
                  }}
                  data-apimart-paste-button
                  className="size-9 shrink-0 rounded-field bg-nomi-ink-05 text-nomi-ink hover:bg-nomi-ink-10"
                />
              </TooltipTrigger>
              <TooltipContent side="top">{pasteTooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {(busy || stage === 'topup') && <ApimartCheckCard complete={stage !== 'checking'} account={verification.received?.accountBalance} token={verification.received?.keyQuota ?? null} counts={apimartCounts} />}
        {stage === 'unavailable' && <p role="alert" className="text-caption text-workbench-danger">{t('onboardingProviders.apimartConnect.keyInput.unavailable')}</p>}
        {stage === 'topup' && <ApimartTopUpNotice recheck={() => void verification.retry()} />}
        {notice && <ApimartStatusNotice id={errorId} kind={notice} onAction={() => {
          if (notice === 'format' || notice === 'invalid') window.open('https://apimart.ai/keys', '_blank', 'noopener')
          else void verification.retry()
        }} />}
        {error ? (
          <p id={errorId} role="alert" className="m-0 text-caption font-normal text-workbench-danger" data-apimart-key-error>
            {error}
          </p>
        ) : null}
        <p data-apimart-return-line className="m-0 break-words text-caption text-nomi-ink-60">
          {t('modelSetup.apimartVerification.returnLine', { origin: originLabel })}
        </p>
      </div>
    </div>
  )

  return (
    <div className="h-screen w-full min-h-0 bg-nomi-chrome">
      <ShellFrame
        topBar={
          <ShellTopBar
            workspaceMode={null}
            peerBreadcrumb={{
              originLabel,
              currentLabel: t('onboardingProviders.apimartConnect.pageTitle'),
              onBack,
            }}
            onOpenSettings={onOpenSettings}
          />
        }
      >
        <main
          ref={pageRef}
          className="nomi-apimart-connect-page flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto rounded-panel bg-nomi-paper font-nomi-sans text-body-sm leading-normal text-nomi-ink antialiased ring-1 ring-nomi-line-soft"
          data-apimart-connect-page
          data-apimart-layout={isNarrow ? 'narrow' : 'wide'}
        >
          {isNarrow ? (
            <div className="mx-auto flex w-full max-w-[624px] flex-col gap-5 px-6 py-6">
              <ApimartWorksCollage compact />
              {rightColumn}
            </div>
          ) : (
            <div className="mx-auto my-auto flex w-full max-w-[1400px] items-center justify-center gap-8 px-6 py-8 xl:gap-12">
              <div className="min-w-0 flex-1 max-w-[680px]">
                <ApimartWorksCollage compact={false} />
              </div>
              <div className="w-[624px] shrink-0">{rightColumn}</div>
            </div>
          )}
        </main>
      </ShellFrame>
    </div>
  )
}
