import type { ChangeEvent, JSX } from 'react'
import { ActionIcon, Anchor, Collapse, Group, Stack, Text } from '@mantine/core'
import { IconCheck, IconChevronDown, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { ProviderKind } from '../../desktop/providerKind'
import { DesignButton, DesignSegmentedControl, DesignTextInput } from '../../design'
import { cn } from '../../utils/cn'
import { PROVIDER_KIND_LABEL } from './onboardingProviderKindLabels'
import { ProviderProxyField } from './ProviderProxyField'
import { Field } from './onboardingWizardSupport'
import { PROVIDER_PRESETS } from './providerPresets'

export function ProviderPresetGroups({
  presetId,
  onPickPreset,
}: {
  presetId: string
  onPickPreset: (id: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      {(
        [
          { key: 'relay', label: t('modelSetup.relayGroup') },
          { key: 'official', label: t('modelSetup.officialGroup') },
        ] as const
      ).map((group) => {
        const items = PROVIDER_PRESETS.filter((preset) => (preset.group ?? 'official') === group.key)
        if (items.length === 0) return null
        return (
          <Field
            key={group.key}
            label={group.label}
            hint={group.key === 'relay' ? t('modelSetup.relayHint') : undefined}
          >
            <div className="flex flex-wrap gap-1.5">
              {items.map((preset) => {
                const active = presetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onPickPreset(preset.id)}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-1 rounded-full text-body-sm border',
                      'transition-[background,color,border-color] duration-150',
                      active
                        ? 'bg-nomi-accent-soft text-nomi-accent border-transparent'
                        : 'bg-nomi-paper text-nomi-ink-80 border-nomi-line hover:bg-nomi-ink-05',
                    )}
                  >
                    {preset.label}
                    {active && <IconCheck size={13} stroke={2} />}
                  </button>
                )
              })}
            </div>
          </Field>
        )
      })}
    </>
  )
}

type HeaderRow = { key: string; value: string }

export function OnboardingWizardAdvancedFields({
  providerKind,
  kindForced,
  showAdvanced,
  showKindOverride,
  headerRows,
  onToggleAdvanced,
  onShowKindOverride,
  onProviderKindChange,
  onRestoreAutoDetect,
  onUpdateHeader,
  onRemoveHeaderRow,
  onAddHeaderRow,
  proxyUrl,
  proxyUrlValid,
  onProxyUrlChange,
}: {
  providerKind: ProviderKind
  kindForced: boolean
  showAdvanced: boolean
  showKindOverride: boolean
  headerRows: HeaderRow[]
  onToggleAdvanced: () => void
  onShowKindOverride: () => void
  onProviderKindChange: (providerKind: ProviderKind) => void
  onRestoreAutoDetect: () => void
  onUpdateHeader: (index: number, patch: Partial<HeaderRow>) => void
  onRemoveHeaderRow: (index: number) => void
  onAddHeaderRow: () => void
  /** 低频高级字段：这个连接单独走的代理（可选）。 */
  proxyUrl: string
  proxyUrlValid: boolean
  onProxyUrlChange: (event: ChangeEvent<HTMLInputElement>) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <Stack gap={6}>
      <Anchor
        component="button"
        type="button"
        size="xs"
        c="var(--nomi-ink-60)"
        onClick={onToggleAdvanced}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        {showAdvanced ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        {t('modelSetup.advanced')}
      </Anchor>

      <Collapse in={showAdvanced}>
        <Stack gap={12}>
          <ProviderProxyField value={proxyUrl} valid={proxyUrlValid} onChange={onProxyUrlChange} />
          {!showKindOverride ? (
            <Text size="xs" c="var(--nomi-ink-60)">
              {t('modelSetup.protocolSummary', {
                protocol: kindForced ? PROVIDER_KIND_LABEL[providerKind] : t('modelSetup.autoDetectOnSave'),
              })}{' '}
              <Anchor
                component="button"
                type="button"
                onClick={onShowKindOverride}
                c="var(--nomi-accent)"
                inherit
              >
                {t('modelSetup.manualProtocol')}
              </Anchor>
            </Text>
          ) : (
            <Field label={t('modelSetup.protocol')} hint={t('modelSetup.protocolHint')}>
              <DesignSegmentedControl
                value={providerKind}
                onChange={(value: string) => onProviderKindChange(value as ProviderKind)}
                data={[
                  { label: 'Chat Completions', value: 'openai-compatible' },
                  { label: 'Responses', value: 'openai-responses' },
                  { label: 'Anthropic', value: 'anthropic' },
                  { label: 'Gemini native', value: 'google-generative-ai' },
                ]}
                fullWidth
              />
              {kindForced && (
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  c="var(--nomi-ink-60)"
                  onClick={onRestoreAutoDetect}
                >
                  {t('modelSetup.restoreAutoDetect')}
                </Anchor>
              )}
            </Field>
          )}

          <Stack gap={4}>
            {headerRows.length > 0 && (
              <Text size="sm" c="var(--nomi-ink)">
                {t('modelSetup.customHeaders')}
              </Text>
            )}
            {headerRows.length > 0 && (
              <Stack gap={6}>
                {headerRows.map((header, index) => (
                  <Group key={index} gap={6} wrap="nowrap" align="flex-start">
                    <DesignTextInput
                      value={header.key}
                      onChange={(event) => onUpdateHeader(index, { key: event.currentTarget.value })}
                      placeholder={t('modelSetup.headerNamePlaceholder')}
                      style={{ flex: 1 }}
                    />
                    <DesignTextInput
                      value={header.value}
                      onChange={(event) => onUpdateHeader(index, { value: event.currentTarget.value })}
                      placeholder={t('modelSetup.headerValuePlaceholder')}
                      style={{ flex: 1 }}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => onRemoveHeaderRow(index)}
                      aria-label={t('modelSetup.deleteHeader')}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
            <Group justify="flex-start">
              <DesignButton variant="subtle" leftSection={<IconPlus size={14} />} onClick={onAddHeaderRow}>
                {t('modelSetup.addHeader')}
              </DesignButton>
            </Group>
          </Stack>
        </Stack>
      </Collapse>
    </Stack>
  )
}
