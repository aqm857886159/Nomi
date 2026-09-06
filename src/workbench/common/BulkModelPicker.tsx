// 批量「统一模型」选择器 —— 全仓唯一实现（画布框选工具条 + 分镜「全部镜头」批量条共用）。
//
// 为什么它必须独立于 useDedupedModelSelect（用户 2026-08-18 报「框选没办法选择不同供应商的模型
// 导致一直生成失败」）：
//   那个 hook 是**有状态**选择器——两段式（先选模型、多家时再出第二段锁供应商），第二段能不能出来
//   取决于「当前值」能解析出哪个模型。批量下拉根本没有当前值（它是一次性命令，永远显占位「统一模型」），
//   于是 selectedModel 恒为 null → providerOptions 恒为空 → 第二段**结构上不可能出现**，
//   供应商只能由 pickHealthiestProvider 替用户定死一家。那家在用户账号上不通 = 每次生成都失败、无路可换。
//
// 方案 B「下拉里摊开」（用户 2026-08-18 拍板）：既然没有第二段可用，就让第一段直接给出**厂商明确**的选项——
//   一家一行，右侧 trailing 标那一家的短名（trailing 是既有的厂商附注槽，不给设计系统加分组头/缩进）。
//   选中即同时定死 (modelKey, vendor)，写路径 buildNodeModelChangePatch 早已接受并持久化 vendor。
//
// 为什么不做成第二个并排下拉：画布框选工具条实测已 713px、上限 760px，每个执行组再加一个 select
// 会把主钮「生成选中 N 个」挤出视野（样张实测，R8）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelOption } from '../../config/models'
import { NomiSelect } from '../../design'
import { dedupeModelOptions } from '../../config/modelIdentity'
import { isModelRecentlyAiling } from '../generationCanvas/runner/modelHealthMemory'
import { buildVendorExplicitModelOptions, resolveProviderByAddress, openModelCatalog, CONNECT_VENDOR_OPTION_VALUE } from './useDedupedModelSelect'
import { useVendorPreferenceOrder } from './useVendorPreference'

import i18n from '../../i18n'

export type BulkModelPickerProps = {
  /** 该 kind 下全部已接入模型（平铺）；组件内部自己去重 + 按供应商摊平。 */
  modelOptions: readonly ModelOption[]
  /** 选定某一家：value = 该家的 option.value，vendor = 该家 key（两者同时定死，不留给下游猜）。 */
  onPick: (value: string, vendor?: string) => void
  ariaLabel: string
  /** pill 内左侧小灰标签（如「图片 · 3」「模型」）。 */
  leadingLabel?: string
  /** 触发上的占位——批量下拉无常驻值，这里永远显它（如「统一模型」）。 */
  placeholder?: string
  size?: 'sm' | 'xs'
  triggerMaxWidth?: number
  /** 摊平项之前要插的固定项（如分镜条的「混合」「默认模型」）；value 不与寻址串撞。 */
  leadingOptions?: readonly { value: string; label: string }[]
  /** 触发上显示的值——仅用于 leadingOptions 里的固定项（如「混合」）；缺省=显占位。 */
  value?: string
  /** 选中 leadingOptions 里的固定项时回调（摊平项永远走 onPick）。 */
  onPickLeadingOption?: (value: string) => void
}

/**
 * 一次性命令式的批量模型选择：列表里每一行都是「模型 + 具体哪一家」，选中即定死 (value, vendor)。
 * 无可选模型时返回 null（不给一个点开是空的下拉）。
 */
export default function BulkModelPicker({
  modelOptions,
  onPick,
  ariaLabel,
  leadingLabel,
  placeholder,
  size = 'xs',
  triggerMaxWidth,
  leadingOptions,
  value,
  onPickLeadingOption,
}: BulkModelPickerProps): JSX.Element | null {
  const { t } = useTranslation()
  const deduped = React.useMemo(() => dedupeModelOptions([...modelOptions]), [modelOptions])
  const orderedVendorKeys = useVendorPreferenceOrder()
  const vendorRows = React.useMemo(
    () => buildVendorExplicitModelOptions(deduped, isModelRecentlyAiling, orderedVendorKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.language：切语言要重算 trailing 文案
    [deduped, i18n.language, orderedVendorKeys],
  )

  const handleChange = React.useCallback(
    (picked: string) => {
      const fixed = leadingOptions?.find((option) => option.value === picked)
      if (fixed) {
        onPickLeadingOption?.(fixed.value)
        return
      }
      // 一家都没接入时下拉里只有「还没接入供应商」那一行——点它是去接入，不是选模型。
      if (picked === CONNECT_VENDOR_OPTION_VALUE) { openModelCatalog(); return }
      const provider = resolveProviderByAddress(deduped, picked)
      if (!provider) return
      onPick(provider.option.value, provider.vendor)
    },
    [deduped, leadingOptions, onPick, onPickLeadingOption],
  )

  if (vendorRows.length === 0) return null

  return (
    <NomiSelect
      ariaLabel={ariaLabel}
      leadingLabel={leadingLabel}
      placeholder={placeholder ?? t('generationCommon.production.unifyModel')}
      value={value ?? ''}
      options={[...(leadingOptions ?? []), ...vendorRows]}
      onChange={handleChange}
      size={size}
      triggerMaxWidth={triggerMaxWidth}
    />
  )
}
