/**
 * 「用 AI 帮我接入」——设置 →「模型」页顶部那张卡。
 *
 * 治的摩擦（设计定稿 docs/design/2026-09-11-ai-assisted-onboarding-entry.md §Before）：
 * 用户想接一个新模型时人在「模型」这一屏，而这屏上**没有任何地方**告诉他「可以让你已经在用的
 * AI 助手替你接」——能接的那条路（MCP）住在另一个 tab 的二级页，文案还只说「建项目、出图」。
 *
 * 本卡**不干接入 MCP 那件事**（那是「自动化与权限 → AI 助手连接」的家，一功能一个家 §1.5.2），
 * 它只补上现在完全缺失的另一半：**跟助手说什么**——任务提示词 + 一份任何宿主都能装的 SKILL.md。
 * 所以卡上没有、也不许有「一键接入 / 撤销接入」按钮；要连的时候给一行状态 + 一个跳转。
 *
 * 一屏一个主动作：主动作是「复制指引」。分段控件是它的参数、折叠行是证据、末行是出口。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCheck, IconChevronDown, IconCopy, IconExternalLink, IconInfoCircle, IconRobot,
} from '@tabler/icons-react'

import { DesignSegmentedControl } from '../../design'
import { cn } from '../../utils/cn'
import type { McpInfo } from '../../desktop/mcpBridgeTypes'
import { ASSISTANT_CLIENT_LABEL } from './assistantActivationState'
import {
  ASSISTED_ONBOARDING_CLIENT_KEYS,
  ASSISTED_ONBOARDING_HOSTS,
  ASSISTED_ONBOARDING_SKILL_MARKDOWN,
  ASSISTED_ONBOARDING_SKILL_PATH,
  OTHER_ONE_CLICK_CLIENTS,
  assistedOnboardingMcpSnippet,
  buildAssistedOnboardingClipboard,
  type AssistedOnboardingHost,
} from './aiAssistedOnboardingContent'
import { AssistedIntegrationProgress } from './AssistedIntegrationProgress'
import type { AssistedProgressView } from './assistedProgressProjection'

export type AiAssistedOnboardingCardProps = {
  /** MCP 快照；null = 桥还没就绪（卡照常可用，只是不显示「连上没」那一行）。 */
  info: McpInfo | null
  /** 有外部 Agent 正在接的时候，卡的下半换成进度；没有就给 null。 */
  progress: { view: AssistedProgressView; name: string; hostLabel: string | null; reasonCode?: string | null } | null
  /** 「去连接」→ 打开自动化与权限的 AI 助手连接页（唯一的一键接入之家）。 */
  onOpenAssistantConnections: () => void
  /** 「或：手动接入 →」→ 滚到本页已有的「自定义 API / 中转站」那一行并高亮，不另开向导。 */
  onManualConnect: () => void
  /** 首次出现时给一次 accent 描边（看过即消，不做常驻高亮）。 */
  firstSeen?: boolean
}

export function AiAssistedOnboardingCard({
  info,
  progress,
  onOpenAssistantConnections,
  onManualConnect,
  firstSeen = false,
}: AiAssistedOnboardingCardProps): JSX.Element {
  const { t } = useTranslation()
  const [host, setHost] = React.useState<AssistedOnboardingHost>('claude')
  const [copied, setCopied] = React.useState(false)
  const [copyError, setCopyError] = React.useState('')
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const clientKey = host === 'other' ? null : ASSISTED_ONBOARDING_CLIENT_KEYS[host]
  const hostLabel = clientKey ? ASSISTANT_CLIENT_LABEL[clientKey] : t('onboardingProviders.assistedOnboarding.otherHost')
  const mcpSnippet = host === 'other' && info ? assistedOnboardingMcpSnippet(info.server) : null
  const prompt = t('onboardingProviders.assistedOnboarding.promptBody')
  const headings = {
    prompt: t('onboardingProviders.assistedOnboarding.sections.prompt'),
    skill: t('onboardingProviders.assistedOnboarding.sections.skill'),
    mcp: t('onboardingProviders.assistedOnboarding.sections.mcp'),
  }
  const clipboardText = buildAssistedOnboardingClipboard({ host, prompt, headings, mcpSnippet })

  // 切宿主 = 换了要复制的东西，「已复制 ✓」立刻失效（否则那颗勾在说谎）。
  React.useEffect(() => {
    setCopied(false)
    setCopyError('')
  }, [host])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(clipboardText).then(
      () => {
        setCopied(true)
        setCopyError('')
      },
      (error: unknown) => {
        setCopied(false)
        setCopyError(t('onboardingProviders.assistedOnboarding.copyFailed', {
          message: error instanceof Error ? error.message : String(error),
        }))
      },
    )
  }

  // 这一行只说得起「配置里有没有这条」——**不是**「还连不连得上」。真握手要 spawn 一次，
  // 那件事的家在 ConnectAssistantCard（实连验证），本卡不许再起一份（P1）。
  // 所以文案也只敢说到这个份上：写「已连上」就是在替一次没做过的握手打包票。
  const configured = clientKey && info ? info.clients[clientKey]?.installed === true : null

  return (
    <section
      data-model-home-assisted-onboarding={host}
      className={cn(
        'flex flex-col gap-3 rounded-nomi-sm border bg-nomi-ink-05 px-3 py-3',
        firstSeen ? 'border-nomi-accent' : 'border-nomi-line-soft',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-paper text-nomi-accent">
          <IconRobot size={16} stroke={1.7} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-caption font-semibold text-nomi-ink">
            {t('onboardingProviders.assistedOnboarding.title')}
          </div>
          <div className="mt-0.5 text-micro leading-relaxed text-nomi-ink-40">
            {t('onboardingProviders.assistedOnboarding.subtitle')}
          </div>
          {/* 动手前先知道要付出什么（卡点表 ②）：不额外花钱，但手边得有一个能装 MCP 的助手。 */}
          <div className="mt-1 inline-flex items-center gap-1 text-micro text-nomi-ink-40">
            <IconInfoCircle size={12} stroke={1.7} aria-hidden="true" />
            {t('onboardingProviders.assistedOnboarding.requirement')}
          </div>
        </div>
      </div>

      {progress ? (
        <AssistedIntegrationProgress
          view={progress.view}
          name={progress.name}
          hostLabel={progress.hostLabel}
          reasonCode={progress.reasonCode}
        />
      ) : (
        <>
          <DesignSegmentedControl
            size="xs"
            fullWidth
            value={host}
            onChange={(value) => setHost(value as AssistedOnboardingHost)}
            data={ASSISTED_ONBOARDING_HOSTS.map((key) => ({
              value: key,
              label: key === 'other'
                ? t('onboardingProviders.assistedOnboarding.otherHost')
                : ASSISTANT_CLIENT_LABEL[ASSISTED_ONBOARDING_CLIENT_KEYS[key]],
            }))}
          />

          {/* 「一键接入 MCP」已经有家（自动化与权限），这里只报状态 + 指路，不放第二颗按钮。 */}
          {configured === false ? (
            /* 那句「还没接入」是**状态**不是标签：能点的只有「去接入」三个字（§1.8 规则 1，
               整行可点会把一句话当成按钮文案，也让这一屏出现第二颗看起来像主动作的东西）。
               动作词紧跟在状态后面，不推到右缘（2026-09-09 用户拍板的通用行规则）。 */
            <div className="inline-flex max-w-full items-center gap-2 text-caption text-nomi-ink-60">
              <span className="min-w-0 truncate">
                {t('onboardingProviders.assistedOnboarding.connection.missing', { host: hostLabel })}
              </span>
              <button
                type="button"
                data-assisted-onboarding-connect
                onClick={onOpenAssistantConnections}
                className="inline-flex shrink-0 items-center gap-1 text-nomi-accent hover:underline"
              >
                {t('onboardingProviders.assistedOnboarding.connection.action')}
                <IconExternalLink size={13} stroke={1.6} aria-hidden="true" />
              </button>
            </div>
          ) : configured === true ? (
            <div className="inline-flex items-center gap-1.5 text-micro text-nomi-ink-60">
              <IconCheck size={13} stroke={1.8} className="text-workbench-success-ink" aria-hidden="true" />
              {t('onboardingProviders.assistedOnboarding.connection.connected', { host: hostLabel })}
            </div>
          ) : null}

          <button
            type="button"
            data-assisted-onboarding-copy={copied ? 'copied' : 'idle'}
            onClick={handleCopy}
            className={cn(
              'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-nomi-sm text-body-sm font-semibold',
              copied
                ? 'border border-nomi-line bg-nomi-paper text-nomi-ink-60'
                : 'bg-nomi-ink text-nomi-paper hover:bg-nomi-accent',
            )}
          >
            {copied ? <IconCheck size={15} stroke={1.8} aria-hidden="true" /> : <IconCopy size={15} stroke={1.7} aria-hidden="true" />}
            {t(copied ? 'onboardingProviders.assistedOnboarding.copied' : 'onboardingProviders.assistedOnboarding.copy')}
          </button>

          {/* 三步图**只在复制之后出现**——不复制的人不用先读一段教程（D1 effect-first）。 */}
          {copied ? (
            <ol data-assisted-onboarding-next-steps className="flex flex-col gap-1.5">
              {(['paste', 'ask', 'key'] as const).map((step, index) => (
                <li key={step} className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-nomi-ink-20 text-micro font-semibold leading-none text-nomi-ink">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-caption font-semibold text-nomi-ink">
                      {t(`onboardingProviders.assistedOnboarding.steps.${step}.title`)}
                    </span>
                    <span className="mt-0.5 block text-micro leading-relaxed text-nomi-ink-40">
                      {/* 「其它」段没有宿主名可念——「在 其它 的对话框里」是句病句，换成不点名的说法。 */}
                      {step === 'paste' && host === 'other'
                        ? t('onboardingProviders.assistedOnboarding.steps.pasteAnyHost')
                        : t(`onboardingProviders.assistedOnboarding.steps.${step}.body`, { host: hostLabel })}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {copied ? (
            <div className="text-micro leading-relaxed text-nomi-ink-40">
              {t('onboardingProviders.assistedOnboarding.keyNotice')}
            </div>
          ) : null}

          {copyError ? <div className="text-caption text-workbench-danger">{copyError}</div> : null}

          <button
            type="button"
            data-assisted-onboarding-preview={previewOpen ? 'open' : 'closed'}
            aria-expanded={previewOpen}
            onClick={() => setPreviewOpen((value) => !value)}
            className="flex w-full items-center gap-2 text-left text-micro text-nomi-ink-40 hover:text-nomi-ink-60"
          >
            <IconChevronDown
              size={13}
              stroke={1.7}
              className={cn('shrink-0 transition-transform', previewOpen && 'rotate-180')}
              aria-hidden="true"
            />
            <span className="min-w-0 shrink truncate">{t('onboardingProviders.assistedOnboarding.preview')}</span>
            <span className="min-w-0 flex-1 truncate text-nomi-ink-30">
              {t(mcpSnippet
                ? 'onboardingProviders.assistedOnboarding.previewSummaryWithMcp'
                : 'onboardingProviders.assistedOnboarding.previewSummary')}
            </span>
          </button>

          {previewOpen ? (
            <div className="flex flex-col gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
              <div>
                <div className="text-micro font-semibold text-nomi-ink-60">{headings.prompt}</div>
                <p className="mt-1 whitespace-pre-wrap text-caption leading-relaxed text-nomi-ink-80">{prompt}</p>
              </div>
              <div className="border-t border-nomi-line-soft pt-2">
                <div className="flex flex-wrap items-baseline gap-2 text-micro font-semibold text-nomi-ink-60">
                  <span>{headings.skill}</span>
                  <code className="font-mono font-normal text-nomi-ink-40">{ASSISTED_ONBOARDING_SKILL_PATH}</code>
                </div>
                <pre
                  data-assisted-onboarding-skill-preview
                  className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-micro leading-relaxed text-nomi-ink-80"
                >{ASSISTED_ONBOARDING_SKILL_MARKDOWN}</pre>
              </div>
              {mcpSnippet ? (
                <div className="border-t border-nomi-line-soft pt-2">
                  <div className="text-micro font-semibold text-nomi-ink-60">{headings.mcp}</div>
                  <div className="mt-0.5 text-micro leading-relaxed text-nomi-ink-40">
                    {t('onboardingProviders.assistedOnboarding.mcpNote')}
                  </div>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-micro leading-relaxed text-nomi-ink-80">{mcpSnippet}</pre>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Cursor / Pi 同样能一键接入——从真实客户端表 derive，别在这里手列宿主名。 */}
          {host === 'other' && OTHER_ONE_CLICK_CLIENTS.length > 0 ? (
            <button
              type="button"
              data-assisted-onboarding-other-one-click
              onClick={onOpenAssistantConnections}
              className="self-start text-micro text-nomi-ink-40 hover:text-nomi-accent"
            >
              {t('onboardingProviders.assistedOnboarding.otherOneClickHint', {
                clients: OTHER_ONE_CLICK_CLIENTS.map((key) => ASSISTANT_CLIENT_LABEL[key]).join(' / '),
              })}
            </button>
          ) : null}

          <button
            type="button"
            data-assisted-onboarding-manual
            onClick={onManualConnect}
            className="self-start text-micro text-nomi-ink-40 hover:text-nomi-accent"
          >
            {t('onboardingProviders.assistedOnboarding.manual')}
          </button>
        </>
      )}
    </section>
  )
}
