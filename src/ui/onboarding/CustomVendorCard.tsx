/**
 * 自定义 / 中转站供应商卡（「其他模型」按家拆开后的每一张）。
 *
 * 从 OnboardingDrawer 的 map 回调里抽出来成组件，因为它要调 useVendorHealth——
 * hook 不能在回调里调。顺带把这段 40 行从已经 550+ 行的 Drawer 里挪走（R9）。
 *
 * 胶囊语义：**连不上压倒一切**。参数适配验证（adapterProviderState）得再漂亮，
 * 地址/key 通不了也生成不出东西，所以 unreachable 时红字覆盖 adapter 状态。
 */
import React from 'react'
import { MODEL_ACCESS_ENTRY } from '../../../electron/shared/modelAccessCapabilities'
import { useTranslation } from 'react-i18next'
import { IconStack2, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { FoldableModelCard } from './FoldableModelCard'
import { ModelEnableEditor } from './ModelEnableEditor'
import { CustomVendorManage } from './CustomVendorManage'
import { adapterProviderState } from './adapterVerificationViewModel'
import { useVendorHealth } from './useVendorHealth'
import { vendorConnectionPill } from './vendorConnectionView'
import { type ChipModel } from './ModelChipGroups'

type ModelEditorProps = React.ComponentProps<typeof ModelEnableEditor>

type CustomVendorCardProps = {
  vendorKey: string
  /** 用户接入时填的「来源名称」（vendorMeta.name）。 */
  name: string
  models: ChipModel[]
  baseUrl: string
  hasApiKey: boolean
  onToggle: ModelEditorProps['onToggle']
  onDelete: ModelEditorProps['onDelete']
  onCustomCall: ModelEditorProps['onCustomCall']
  /** 改类型（接入时按模型名猜的，猜错在这里改）。 */
  onRetype: ModelEditorProps['onRetype']
  onDeleteVendor: () => void
  onChanged: () => void
}

export function CustomVendorCard({
  vendorKey,
  name,
  models,
  baseUrl,
  hasApiKey,
  onToggle,
  onDelete,
  onCustomCall,
  onRetype,
  onDeleteVendor,
  onChanged,
}: CustomVendorCardProps): JSX.Element {
  const { t } = useTranslation()
  const { connection, recheck } = useVendorHealth(vendorKey, { hasApiKey, baseUrl })
  const enabledN = models.filter((m) => m.enabled).length
  const adapterCard = adapterProviderState(models)
  const adapterLabel =
    adapterCard.state === 'configured'
      ? t('onboardingProviders.drawer.configured')
      : t(`onboardingProviders.adapterVerification.cardStatus.${adapterCard.state}`)
  const health = connection ? vendorConnectionPill(connection) : null
  const unreachable = health?.status === 'error'

  return (
    <FoldableModelCard
      dataAccessEntry={`${MODEL_ACCESS_ENTRY.customCallScript} ${MODEL_ACCESS_ENTRY.manualModelRetype}`}
      glyph={<IconStack2 size={16} stroke={1.6} />}
      glyphTone="soft"
      name={name}
      subtitle={t('onboardingProviders.drawer.modelsEnabled', { enabled: enabledN, total: models.length })}
      status={
        unreachable ? 'error' : adapterCard.state === 'configured' || adapterCard.state === 'verified' ? 'ok' : 'todo'
      }
      statusLabel={unreachable && health ? t(health.labelKey) : adapterLabel}
      defaultExpanded={false}
      headerAction={
        <button
          type="button"
          aria-label={t('onboardingProviders.drawer.deleteVendorAria', { name })}
          title={t('onboardingProviders.drawer.deleteVendorTitle')}
          onClick={onDeleteVendor}
          className={cn(
            'grid place-items-center size-7 rounded-nomi-sm text-nomi-ink-40 transition-colors',
            'hover:bg-[var(--workbench-danger-soft)] hover:text-workbench-danger',
          )}
        >
          <IconTrash size={15} stroke={1.7} />
        </button>
      }
    >
      <ModelEnableEditor models={models} onToggle={onToggle} onDelete={onDelete} onCustomCall={onCustomCall} onRetype={onRetype} />
      <CustomVendorManage
        vendorKey={vendorKey}
        vendorName={name}
        baseUrl={baseUrl}
        hasApiKey={hasApiKey}
        modelCount={models.length}
        connection={connection}
        onRecheck={recheck}
        onChanged={onChanged}
      />
    </FoldableModelCard>
  )
}
