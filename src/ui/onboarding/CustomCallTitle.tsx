/** 自定义调用编辑器的标题：固定名 + 当前模型名（弹窗 / 整页共用）。 */
import React from 'react'
import { useTranslation } from 'react-i18next'

/** 固定名「自定义调用」那一句的样子（整页里是这里的 span；弹窗里是外壳的 Modal.Title，用 classNames.title 给同一串）。 */
export const CUSTOM_CALL_NAME_CLASS = 'shrink-0 whitespace-nowrap text-body font-semibold text-nomi-ink'

/** `name`：弹窗里外壳给的名字元素（对话框的名字只是固定名，模型名摆在它旁边、不进名字）；不传 = 整页，自己写固定名。 */
export function CustomCallTitle({ label, name }: { label?: string; name?: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      {name ?? <span className={CUSTOM_CALL_NAME_CLASS}>{t('onboardingProviders.customCall.title')}</span>}
      <span className="min-w-0 truncate text-caption text-nomi-ink-60">{label}</span>
    </span>
  )
}
