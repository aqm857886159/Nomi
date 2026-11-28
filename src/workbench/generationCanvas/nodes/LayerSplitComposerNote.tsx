import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconInfoCircle } from '@tabler/icons-react'
import { ICON_TIERS } from '../../../design'
import type { LayerSplitComposerState } from './layerSplitComposerState'

/**
 * 图层分离时效果小胶囊那一行换成的一句有后果的说明（板 2026-11-26-layer-split · layers.two-images-hint / pro-fixed）：
 * 放多了只拆第 1 张；层数写死的模型说清给几层。两件都不是就不出这一行。
 */
export function LayerSplitComposerNote({ state, modelLabel }: { state: LayerSplitComposerState; modelLabel: string }): JSX.Element | null {
  const { t } = useTranslation()
  if (state.inputCount <= 1 && !state.fixed) return null
  const text = state.inputCount > 1
    ? state.inputCount === 2
      ? t('generationCommon.layerSplitComposer.onlyFirstOne')
      : t('generationCommon.layerSplitComposer.onlyFirstRest', { rest: state.inputCount - 1 })
    : t('generationCommon.layerSplitComposer.fixedModel', { model: modelLabel, layers: state.maxLayers - 1 })
  return (
    <p data-layer-split-note={state.inputCount > 1 ? 'only-first' : 'fixed-model'} className="m-0 flex min-w-0 items-start gap-1 text-micro leading-snug text-nomi-ink-60">
      <IconInfoCircle size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} className="mt-px shrink-0" aria-hidden />
      <span className="min-w-0">{text}</span>
    </p>
  )
}
