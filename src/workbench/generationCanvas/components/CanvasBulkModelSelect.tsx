import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelOption } from '../../../config/models'
import BulkModelPicker from '../../common/BulkModelPicker'
import { MODEL_PICKER_CATALOG_SCOPE } from '../../../config/useModelOptions'
import { useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import { resolveCanvasBulkModelLabelKey } from './canvasBatchModelLabel'
import type { CanvasGenerationExecutionGroup } from './canvasProductionScope'

export type CanvasApplyModelInput = {
  executionKind: string
  requiredMode: CanvasGenerationExecutionGroup['requiredMode']
  value: string
  vendor?: string
  modelOptions: readonly ModelOption[]
}

function modelGroupLabel(
  group: CanvasGenerationExecutionGroup,
  peerGroups: readonly CanvasGenerationExecutionGroup[],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  return t(resolveCanvasBulkModelLabelKey(group, peerGroups), {
    count: group.nodeIds.length,
  })
}

/**
 * 批量「统一模型」下拉——**画布框选工具条**与**底部「生成全部」坞**共用同一份（P1，两入口不再漂移）。
 * 选项**厂商明确**（一家一行）：用户 2026-08-18 报「框选没办法选择不同供应商的模型导致一直生成失败」，
 * 过去折叠成一条标「N 家」、供应商由 pickHealthiestProvider 定死，那家在他账号上不通就永远失败且无路可换。
 * 故实现住 BulkModelPicker（与分镜「全部镜头」批量条同一份）；无可选模型时返回 null，不给空下拉。
 */
export function CanvasBulkModelSelect({
  group,
  peerGroups,
  onApplyModel,
}: {
  group: CanvasGenerationExecutionGroup
  peerGroups: readonly CanvasGenerationExecutionGroup[]
  onApplyModel: (input: CanvasApplyModelInput) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const state = useGenerationModelOptionsState(group.representativeKind, group.requiredMode, MODEL_PICKER_CATALOG_SCOPE)
  const handlePick = React.useCallback(
    (value: string, vendor?: string) => {
      onApplyModel({ executionKind: group.executionKind, requiredMode: group.requiredMode, value, vendor, modelOptions: state.options })
    },
    [group.executionKind, group.requiredMode, onApplyModel, state.options],
  )
  const label = modelGroupLabel(group, peerGroups, t)
  return (
    <BulkModelPicker
      modelOptions={state.options}
      onPick={handlePick}
      ariaLabel={label}
      leadingLabel={label}
      placeholder={t('generationCommon.production.unifyModel')}
      size="sm"
      triggerMaxWidth={140}
    />
  )
}
