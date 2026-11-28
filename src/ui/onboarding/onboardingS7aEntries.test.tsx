import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { nomiTheme } from '../../theme/nomiTheme'
import { enRuntime, zhRuntime } from '../../i18n/locales/runtime'
import { NoTextModelRecoveryCard } from '../../workbench/ai/NoTextModelRecoveryCard'
import { pickRecoverableAssistantBrain } from '../../workbench/ai/assistantModelIdentity'
import { V4ModelPopover } from '../../workbench/ai/v4/AgentPanelV4Composer'
import { AgentPanelV4Panel } from '../../workbench/ai/v4/AgentPanelV4Panel'
import {
  CONNECT_VENDOR_OPTION_VALUE,
  buildModelMenu,
  openModelCatalog,
} from '../../workbench/common/useDedupedModelSelect'
import StoryboardPlanStrategyPanel from '../../workbench/creation/storyboard/StoryboardPlanStrategyPanel'
import InlineParameterBar from '../../workbench/generationCanvas/nodes/InlineParameterBar'
import { OnboardingChecklistSection } from '../../workbench/onboarding/OnboardingChecklist'
import { handbookContentForLocale } from '../../workbench/onboarding/handbookContent'
import { adapterFailureAdvice } from './adapterFailureAdvice'
import { NOMI_OPEN_APIMART_CONNECT_EVENT, openApimartConnect } from './apimartConnectRoute'
import { noGenericContractFailure } from '../../../electron/capabilityCore/modelOnboarding/envelope'

vi.mock('../../workbench/onboarding/onboardingProgress', () => ({
  useOnboardingProgress: () => ({
    active: true,
    doneCount: 0,
    total: 4,
    nextKey: 'model',
    effective: { model: false, storyboard: false, generated: false, exported: false },
    dismiss: vi.fn(),
  }),
}))

function renderWithTheme(node: React.ReactElement): string {
  return renderToStaticMarkup(<MantineProvider theme={nomiTheme}>{node}</MantineProvider>)
}

const stripTags = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()

function installMockWindow(nomiDesktop?: unknown): {
  events: string[]
  restore: () => void
} {
  const prevWindow = (globalThis as Record<string, unknown>).window
  const prevCustomEvent = (globalThis as Record<string, unknown>).CustomEvent
  const target = new EventTarget()
  const events: string[] = []
  target.addEventListener(NOMI_OPEN_APIMART_CONNECT_EVENT, () => {
    events.push(NOMI_OPEN_APIMART_CONNECT_EVENT)
  })
  if (typeof CustomEvent === 'undefined') {
    ;(globalThis as Record<string, unknown>).CustomEvent = class MockCustomEvent extends Event {
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        super(type)
        this.detail = init?.detail
      }
    }
  }
  ;(globalThis as Record<string, unknown>).window = Object.assign(target, {
    nomiDesktop,
  })
  return {
    events,
    restore: () => {
      if (prevWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window
      } else {
        ;(globalThis as Record<string, unknown>).window = prevWindow
      }
      if (prevCustomEvent === undefined) {
        delete (globalThis as Record<string, unknown>).CustomEvent
      } else {
        ;(globalThis as Record<string, unknown>).CustomEvent = prevCustomEvent
      }
    },
  }
}

describe('T-5 S7a 全部剩余入口指路收口与 F-D 契约核对', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('zh-CN')
  })

  it('entry.picker-empty：无可用模型时下拉返回唯一连接项并经统一路由打开 APIMart 大页', async () => {
    const zhMenu = buildModelMenu([], () => false)
    expect(zhMenu.options).toHaveLength(1)
    expect(zhMenu.options[0]).toMatchObject({
      value: CONNECT_VENDOR_OPTION_VALUE,
      label: i18n.t('generationCommon.parameters.noVendorConnected'),
      trailing: i18n.t('generationCommon.parameters.connectVendorAction'),
      trailingTone: 'accent',
    })

    await i18n.changeLanguage('en')
    const enMenu = buildModelMenu([], () => false)
    expect(enMenu.options[0]).toMatchObject({
      value: CONNECT_VENDOR_OPTION_VALUE,
      label: i18n.t('generationCommon.parameters.noVendorConnected'),
      trailing: i18n.t('generationCommon.parameters.connectVendorAction'),
    })

    const mockWin = installMockWindow()
    try {
      openModelCatalog()
      openApimartConnect()
      expect(mockWin.events).toHaveLength(2)
    } finally {
      mockWin.restore()
    }
  })

  it('entry.composer-connect：加载中显示脉冲胶囊，确认无模型后左显示未连模型、右发送位切换为连接模型主按钮', () => {
    const loadingHtml = renderWithTheme(
      <InlineParameterBar
        modelOptions={[]}
        modelCatalogStatus={{ status: 'loading', message: '' }}
        renderedControls={[]}
        selectedModelOption={null}
        archetype={null}
        meta={{}}
        onModelChange={vi.fn()}
        onCatalogControlChange={vi.fn()}
        onParameterControlChange={vi.fn()}
        footer={{
          send: { ariaLabel: 'gen', disabled: true, onClick: vi.fn() },
          connectTooltip: i18n.t('onboardingProviders.entries.composerTooltipImage'),
        }}
      />,
    )
    expect(loadingHtml).toContain('data-model-chip-loading="true"')
    expect(loadingHtml).not.toContain('data-composer-connect="true"')

    const emptyHtml = renderWithTheme(
      <InlineParameterBar
        modelOptions={[]}
        modelCatalogStatus={{ status: 'empty', message: '' }}
        renderedControls={[]}
        selectedModelOption={null}
        archetype={null}
        meta={{}}
        onModelChange={vi.fn()}
        onCatalogControlChange={vi.fn()}
        onParameterControlChange={vi.fn()}
        footer={{
          send: { ariaLabel: 'gen', disabled: true, onClick: vi.fn() },
          connectTooltip: i18n.t('onboardingProviders.entries.composerTooltipImage'),
        }}
      />,
    )
    const emptyText = stripTags(emptyHtml)
    expect(emptyHtml).toContain('data-composer-connect="true"')
    expect(emptyHtml).toContain('data-board="entry.composer-connect"')
    expect(emptyText).toContain(i18n.t('onboardingProviders.entries.modelChipEmpty'))
    expect(emptyText).toContain(i18n.t('onboardingProviders.entries.connectModel'))
  })

  it('entry.agent-pointer：全新未连模型时只渲染指路说明与连接卡（零内嵌输入框、零重复 Nomi 身份头），弹层页脚双出口对齐', () => {
    const pointerHtml = renderWithTheme(<NoTextModelRecoveryCard initialRecoverable={null} />)
    const pointerText = stripTags(pointerHtml)
    expect(pointerHtml).toContain('data-agent-pointer="apimart"')
    expect(pointerHtml).toContain('data-agent-pointer-action="apimart"')
    expect(pointerHtml).not.toContain('data-assistant-identity')
    expect(pointerHtml).not.toMatch(/<(input|textarea)\b/i)
    expect(pointerText).toContain(i18n.t('onboardingProviders.entries.agentPointerBody'))
    expect(pointerText).toContain(i18n.t('onboardingProviders.entries.agentPointerTitle'))
    expect(pointerText).toContain(i18n.t('onboardingProviders.entries.agentPointerSubtitle'))

    // 整块常驻面板装配后：顶栏已有唯一 NomiBrand，面板内绝不能上下出现两个 Nomi 字标
    const assembledPanelHtml = renderWithTheme(
      <AgentPanelV4Panel
        flow={[]}
        emptyOverride={<NoTextModelRecoveryCard initialRecoverable={null} />}
        context={{ usedTokens: 0, maxTokens: 128000 }}
        slotHandlers={{ onPlanToggle: vi.fn(), onCollapsePlan: vi.fn() }}
      />,
    )
    expect([...assembledPanelHtml.matchAll(/class="[^"]*nomi-wordmark\b/g)]).toHaveLength(1)
    expect(assembledPanelHtml).toContain('data-agent-pointer-action="apimart"')

    const popoverHtml = renderWithTheme(
      <V4ModelPopover rows={[]} onOpenLibrary={vi.fn()} onOpenAssisted={vi.fn()} />,
    )
    const popoverText = stripTags(popoverHtml)
    expect(popoverHtml).toContain('data-v4-model-connect="true"')
    expect(popoverHtml).toContain('data-v4-model-assisted="true"')
    expect(popoverText).toContain(i18n.t('agentPanelV4.modelLibrary'))
    expect(popoverText).toContain(i18n.t('agentPanelV4.modelAssisted'))
  })

  it('entry.kept-recovery：存在已配 Key 但被停用的文本模型时原样保留一键启用自愈按钮且不重复渲染面板身份头', () => {
    const testVendorKey = ['custom', 'relay'].join('-')
    const recoverable = pickRecoverableAssistantBrain(
      [
        {
          vendorKey: testVendorKey,
          modelKey: 'prompt-refiner-only',
          labelZh: 'Prompt Refiner',
          kind: 'text',
          meta: { promptRefineOnly: true },
        },
        {
          vendorKey: testVendorKey,
          modelKey: 'gpt-5-chat',
          labelZh: 'GPT-5 Chat',
          kind: 'text',
        },
      ],
      [{ key: testVendorKey, hasApiKey: true }],
    )
    expect(recoverable).toEqual({
      vendorKey: testVendorKey,
      modelKey: 'gpt-5-chat',
      labelZh: 'GPT-5 Chat',
    })
    const recoveryHtml = renderWithTheme(
      <NoTextModelRecoveryCard initialRecoverable={recoverable} />,
    )
    expect(recoveryHtml).toContain('data-recovery="no-text-model"')
    expect(recoveryHtml).toContain('data-recovery-enable="gpt-5-chat"')
    expect(recoveryHtml).not.toContain('data-assistant-identity')
    expect(stripTags(recoveryHtml)).toContain(
      i18n.t('creationAi.noTextModel.enable', { model: 'GPT-5 Chat' }),
    )
  })

  it('entry.copy-unify：上手清单第 1 步、分镜策略无视频模型卡、新手手册中英四处与运行时术语全部统一且零旧词残留', () => {
    const checklistHtml = renderWithTheme(<OnboardingChecklistSection />)
    expect(checklistHtml).toContain('data-onboarding-step-connect="true"')
    expect(stripTags(checklistHtml)).toContain(i18n.t('onboarding.steps.model.label'))

    const strategyHtml = renderWithTheme(
      <StoryboardPlanStrategyPanel
        plan={{ shots: [] } as never}
        state={{
          status: 'ready',
          view: {
            blockers: [{ code: 'no.candidates', shotId: 's1', params: {} }],
            requiredMerges: [],
            mergeSuggestions: [],
            splits: [],
          },
          warnings: new Map(),
        }}
        onChange={vi.fn()}
      />,
    )
    const strategyText = stripTags(strategyHtml)
    expect(strategyHtml).toContain('data-storyboard-strategy-settings="true"')
    expect(strategyText).toContain(i18n.t('storyboardEditor.strategy.noVideoModelTitle'))
    expect(strategyText).toContain(i18n.t('storyboardEditor.strategy.goToSettings'))

    const legacyAgnesPattern = /agnes/i
    for (const locale of ['zh-CN', 'en'] as const) {
      const handbookJson = JSON.stringify(handbookContentForLocale(locale))
      expect(handbookJson).toContain('APIMart')
      expect(handbookJson).not.toMatch(legacyAgnesPattern)
    }

    const zhCatalogRuntime = JSON.stringify(zhRuntime.modelCatalog)
    const enCatalogRuntime = JSON.stringify(enRuntime.modelCatalog)
    expect(zhCatalogRuntime).not.toContain(['系统', '模型', '管理'].join(''))
    expect(enCatalogRuntime.toLowerCase()).not.toContain(['system', 'model', 'settings'].join(' '))
  })

  it('F-D 核对：no_generic_contract 与 no_channel 稳定分流至 selfConnect（调用脚本 / ComfyUI），不诱导内置模板', () => {
    expect(adapterFailureAdvice({ compileFailureReason: 'no_generic_contract' })).toEqual({
      reasonKey: 'noGenericContract',
      action: 'selfConnect',
    })
    expect(adapterFailureAdvice({ selfCheckReason: 'no_channel' })).toEqual({
      reasonKey: 'noGenericContract',
      action: 'selfConnect',
    })

    const failure = noGenericContractFailure('tripo-3d-v2')
    expect(failure.code).toBe('no_generic_contract')
    expect(failure.nextAction).toContain('Settings')
    expect(failure.nextAction).toContain('Call script')
    expect(`${failure.message} ${failure.nextAction}`.toLowerCase()).not.toContain('openai-compatible')
  })
})
