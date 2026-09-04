// 被收窄的模式那一行「指路」提示。
//
// 视觉沿用本组件已有的「诚实说一句」惯用法（NodeParameterControls 的 showNoPromptNote：
// `text-ink-40 text-micro leading-tight`），**不发明新的视觉层级**——它不是控件，是一行说明。
// 换家动作是行内文字按钮（accent 色 + 下划线），另有低调的 IconX 允许整行关闭；都不弹确认。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { NarrowedModeGuidance } from './narrowedModeGuidance'

export default function NarrowedModeGuidanceNote({
  guidance,
  currentVendorName,
  onSwitch,
  onDismiss,
}: {
  guidance: NarrowedModeGuidance
  /** 当前供应商显示名（提示里的「Runway 上没有…」那个 Runway）。 */
  currentVendorName: string
  onSwitch: (value: string, vendor: string) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  // 模式名用模型自己的真名（vendorTerm），翻译交给 translateModelDisplayText——与模式栏同一个口径。
  // 引号与分隔符都住在译文里（narrowedModeName / narrowedModeSeparator），代码不拼标点。
  const modes = guidance.hiddenModeTerms
    .map((term) => t('generationCommon.parameters.narrowedModeName', { mode: translateModelDisplayText(term) }))
    .join(t('generationCommon.parameters.narrowedModeSeparator'))

  return (
    <div className={cn('flex items-baseline gap-1 text-ink-40 text-micro leading-tight')} data-testid="narrowed-mode-guidance">
      <span className={cn('min-w-0')}>
        {guidance.kind === 'switch' ? (
          <>
            {t('generationCommon.parameters.narrowedModeSwitch', {
              vendor: currentVendorName,
              modes,
              targetVendor: guidance.target.vendorName,
            })}{' '}
            <button
              type="button"
              className={cn('text-workbench-accent underline underline-offset-2')}
              onClick={() => onSwitch(guidance.target.value, guidance.target.vendor)}
            >
              {t('generationCommon.parameters.narrowedModeSwitchAction', {
                targetVendor: guidance.target.vendorName,
              })}
            </button>
          </>
        ) : (
          t('generationCommon.parameters.narrowedModeNone', { modes })
        )}
      </span>
      <button
        type="button"
        className={cn('inline-flex size-4 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-ink-30 hover:text-ink-60')}
        aria-label={t('generationCommon.parameters.narrowedModeGuidanceDismiss')}
        onClick={onDismiss}
      >
        <IconX size={12} stroke={1.8} aria-hidden="true" />
      </button>
    </div>
  )
}
