import React from 'react'
import { DesignTextInput } from '../../design'
import { Field } from './onboardingWizardSupport'
import { useTranslation } from 'react-i18next'

export function ProviderProxyField({
  value,
  valid,
  onChange,
}: {
  value: string
  valid: boolean
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}): JSX.Element {
  const { t } = useTranslation()
  const trimmed = value.trim()
  return (
    <Field label={t('modelSetup.proxyUrl')} hint={t('modelSetup.proxyUrlHint')}>
      <DesignTextInput
        value={value}
        onChange={onChange}
        placeholder={t('modelSetup.proxyUrlPlaceholder')}
        error={trimmed.length > 0 && !valid ? t('modelSetup.invalidProxyUrl') : undefined}
      />
    </Field>
  )
}
