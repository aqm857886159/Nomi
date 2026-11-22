/** 自定义调用编辑器的标题：固定名 + 当前模型名（弹窗 / 整页共用）。 */
import React from 'react'
import { useTranslation } from 'react-i18next'

export function CustomCallTitle({ label }: { label?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 whitespace-nowrap text-body font-semibold text-nomi-ink">{t('onboardingProviders.customCall.title')}</span>
      <span className="min-w-0 truncate text-caption text-nomi-ink-60">{label}</span>
    </span>
  )
}
