/**
 * 自定义 / 中转站供应商卡（「其他模型」按家拆开后的每一张）。
 *
 * 胶囊只说本机事实，和设置列表那一行同取一个投影（connectionHomeStatus → ModelStatusMark）。
 * 这里曾经探网络、把「连不上」红字压在任务状态上，又按任务状态写「N 个待设置」——
 * 同一条连接在列表和详情说两句话。健康检查按 D-1117-delete-verification 删了，错地址等第一次真生成报错。
 */
import React, { type JSX } from 'react'
import { MODEL_ACCESS_ENTRY } from '../../../electron/shared/contracts/modelAccessCapabilities'
import { useTranslation } from 'react-i18next'
import { IconStack2 } from '@tabler/icons-react'
import { FoldableModelCard } from './FoldableModelCard'
import { ModelEnableEditor } from './ModelEnableEditor'
import { CustomVendorManage } from './CustomVendorManage'
import { connectionHomeStatus } from './modelSettingsHomeState'
import { type ChipModel } from './ModelChipGroups'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'
import type { ModelSettingsConnectionFocus } from './modelSettingsNavigation'

type ModelEditorProps = React.ComponentProps<typeof ModelEnableEditor>

type CustomVendorCardProps = {
  vendorKey: string
  /**
   * 这家连接的目录投影（地址 / 有没有 key / 「声明可能丢了」的标记 / meta 原样）。
   * 收成一个 prop 而不是散成四个：它们同出一源（useOnboardingDrawerCatalog 的 vendorMeta），
   * 散着传只会让每加一项就动一次宿主。
   */
  vendorMeta?: OnboardingVendorMeta
  /** 用户接入时填的「来源名称」（vendorMeta.name）。 */
  name: string
  models: ChipModel[]
  onToggle: ModelEditorProps['onToggle']
  onDelete: ModelEditorProps['onDelete']
  onCustomCall: ModelEditorProps['onCustomCall']
  /** 改类型（接入时按模型名猜的，猜错在这里改）。 */
  onRetype: ModelEditorProps['onRetype']
  onChanged: () => void
  onOpenDetails?: () => void
  detailMode?: boolean
  onOpenModel?: (model: ChipModel) => void
  focus?: ModelSettingsConnectionFocus
}

export function CustomVendorCard({
  vendorKey,
  name,
  models,
  vendorMeta,
  onToggle,
  onDelete,
  onCustomCall,
  onRetype,
  onChanged,
  onOpenDetails,
  detailMode = false,
  onOpenModel,
  focus,
}: CustomVendorCardProps): JSX.Element {
  const { t } = useTranslation()
  // 目录投影里拆出这张卡要用的几格（缺投影 = 还没读到目录，按「地址空、有 key」的既有保守缺省走）。
  const baseUrl = vendorMeta?.baseUrl ?? ''
  const hasApiKey = vendorMeta?.hasApiKey ?? true
  const enabledN = models.filter((m) => m.enabled).length
  // 与可用性主人同一条：要 key（authType 不是 none）而没有，才算「待接入」。
  const status = connectionHomeStatus({
    keyMissing: vendorMeta ? !vendorMeta.hasApiKey && vendorMeta.authType !== 'none' : false,
    models,
  })

  return (
    <FoldableModelCard
      dataAccessEntry={`${MODEL_ACCESS_ENTRY.customCallScript} ${MODEL_ACCESS_ENTRY.manualModelRetype}`}
      glyph={<IconStack2 size={16} stroke={1.6} />}
      glyphTone="soft"
      name={name}
      subtitle={t('onboardingProviders.drawer.modelsEnabled', { enabled: enabledN, total: models.length })}
      modelStatus={status}
      defaultExpanded={false}
      onOpenDetails={onOpenDetails}
      detailMode={detailMode}
    >
      {/* 「连接」在「模型」之前——这一页的主语是连接，模型列表是它的附属。
          此前反着排：24 行模型把地址/凭证挤到弹窗 overflow 之外，落地首屏根本看不见改地址的入口
          （实测铅笔 y=817 / 弹窗底边 y=706），这就是群里「翻了半天没找到」的根因。
          见 docs/plan/2026-08-18-vendor-connection-discoverability.md。 */}
      <CustomVendorManage
        vendorKey={vendorKey}
        vendorName={name}
        baseUrl={baseUrl}
        hasApiKey={hasApiKey}
        modelCount={models.length}
        fieldLossNoticeAt={vendorMeta?.fieldLossNoticeAt ?? null}
        vendorMetaRaw={vendorMeta?.raw}
        onChanged={onChanged}
        focus={focus}
      />
      <div className="flex flex-col gap-2 border-t border-nomi-line-soft pt-3">
        <h3 className="text-caption font-semibold text-nomi-ink-60">
          {t('onboardingProviders.customVendor.modelsSection')}
        </h3>
        <ModelEnableEditor
          models={models}
          onToggle={onToggle}
          onDelete={onDelete}
          onCustomCall={onCustomCall}
          onRetype={onRetype}
          onOpenModel={onOpenModel}
        />
      </div>
    </FoldableModelCard>
  )
}
