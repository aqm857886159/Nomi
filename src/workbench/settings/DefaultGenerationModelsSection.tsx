// 「新建节点默认用哪个模型」设置区（2026-11-27 AutoModel 板 SG-1 / SG-3 定稿：图片、视频 2 行 + 实际模型名）。
//
// 硬约束：
// - auto.name-is-what-runs：「自动 · X」的 X 由 `resolveCatalogAutoGenerationModel`（与画布节点同源的
//   `resolveAutoGenerationModel`）算出，禁止 UI 另写一套名字推导。
// - auto.no-name-for-unusable：首选推荐模型本机不可用时印本机实际会用的模型（edge.vendor-fallback）；
//   一个可用模型都没有时印「自动 · 暂无可用模型」并给「去接入供应商」（edge.none-available）。
// - edge.single-capability-pick：手选仅支持单一子能力的模型（如 Z-Image Turbo 只能文字出图）时，
//   胶囊印手选名，行副标诚实写出另一子能力用自动（实际模型名）。
import { IconPlugConnected } from '@tabler/icons-react'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'

import {
  GENERATION_DEFAULT_MEDIA_KINDS,
  type GenerationDefaultMediaKind,
  type GenerationDefaultTaskKind,
} from '../../../electron/shared/contracts/generationModelDefaultsContract'
import {
  inspectSingleCapabilityPick,
  resolveCatalogAutoGenerationModel,
  type AutoModelAilingProbe,
} from '../../config/autoGenerationModel'
import { NomiSelect, type NomiSelectOption } from '../../design'
import { openModelSettingsHome } from '../../ui/onboarding/apimartConnectRoute'
import { QuotedUiNames } from '../../ui/onboarding/QuotedUiNames'
import { cn } from '../../utils/cn'
import type { ModelCatalogModelDto } from '../api/modelCatalogApi'
import type { GenerationModelDefaultMap } from '../generationCanvas/model/generationModelDefaults'
import { isModelRecentlyAiling } from '../generationCanvas/runner/modelHealthMemory'
import { buildDefaultModelOptions } from './defaultGenerationModelOptions'

type Props = {
  models: readonly ModelCatalogModelDto[]
  vendorNameOf: (vendorKey: string) => string
  orderedVendorKeys?: readonly string[]
  isAiling?: AutoModelAilingProbe
  defaults: GenerationModelDefaultMap
  onChange: (next: GenerationModelDefaultMap) => void
}

const ROW_BOARD_ANCHOR: Record<GenerationDefaultMediaKind, string> = {
  image: 'policy.default-image-row',
  video: 'policy.default-video-row',
}

const ROW_TITLE_KEY: Record<GenerationDefaultMediaKind, string> = {
  image: 'settings.ai.defaultModels.image',
  video: 'settings.ai.defaultModels.video',
}

const ROW_SUBTITLE_KEY: Record<GenerationDefaultMediaKind, string> = {
  image: 'settings.ai.defaultModels.imageSubtitle',
  video: 'settings.ai.defaultModels.videoSubtitle',
}

const SINGLE_CAPABILITY_KEYS: Record<GenerationDefaultTaskKind, { withAuto: string; noAuto: string }> = {
  text_to_image: {
    withAuto: 'settings.ai.defaultModels.singleCapability.text_to_image',
    noAuto: 'settings.ai.defaultModels.singleCapability.text_to_image_no_auto',
  },
  image_edit: {
    withAuto: 'settings.ai.defaultModels.singleCapability.image_edit',
    noAuto: 'settings.ai.defaultModels.singleCapability.image_edit_no_auto',
  },
  text_to_video: {
    withAuto: 'settings.ai.defaultModels.singleCapability.text_to_video',
    noAuto: 'settings.ai.defaultModels.singleCapability.text_to_video_no_auto',
  },
  image_to_video: {
    withAuto: 'settings.ai.defaultModels.singleCapability.image_to_video',
    noAuto: 'settings.ai.defaultModels.singleCapability.image_to_video_no_auto',
  },
}

export function DefaultGenerationModelsSection({
  models,
  vendorNameOf,
  orderedVendorKeys = [],
  isAiling = isModelRecentlyAiling,
  defaults,
  onChange,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation()

  const { optionsByMediaKind, decode, encode } = React.useMemo(
    () => buildDefaultModelOptions(models, vendorNameOf, t('settings.ai.defaultModels.auto')),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.language 驱动模型名与能力描述双语重算
    [models, vendorNameOf, t, i18n.language],
  )

  const autoByKind = React.useMemo(
    () => ({
      image: resolveCatalogAutoGenerationModel({
        models,
        vendorNameOf,
        mediaKind: 'image',
        orderedVendorKeys,
        isAiling,
      }),
      video: resolveCatalogAutoGenerationModel({
        models,
        vendorNameOf,
        mediaKind: 'video',
        orderedVendorKeys,
        isAiling,
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.language 驱动自动模型显示名重算
    [models, vendorNameOf, orderedVendorKeys, isAiling, i18n.language],
  )

  const noneAvailable = autoByKind.image === null && autoByKind.video === null

  const handlePick = (mediaKind: GenerationDefaultMediaKind, value: string): void => {
    if (value === 'unavailable') return
    const next = { ...defaults }
    const identity = value ? decode(value) : null
    if (identity) next[mediaKind] = identity
    else delete next[mediaKind]
    onChange(next)
  }

  return (
    <section
      data-settings-section="default-generation-models"
      className="mb-3"
      aria-labelledby="settings-default-models-title"
    >
      <h3 id="settings-default-models-title" className="mb-1.5 text-caption font-semibold text-nomi-ink">
        {t('settings.ai.defaultModels.title')}
      </h3>
      <div className="divide-y divide-nomi-line-soft rounded-nomi border border-nomi-line bg-nomi-paper">
        {GENERATION_DEFAULT_MEDIA_KINDS.map((mediaKind) => {
          const current = defaults[mediaKind]
          const encoded = current ? encode(current) : null
          const manualOptions = optionsByMediaKind[mediaKind]
          const missing = Boolean(current) && (!encoded || !manualOptions.some((option) => option.value === encoded))
          const autoResolved = autoByKind[mediaKind]
          const autoLabel = autoResolved
            ? t('settings.ai.defaultModels.autoWithModel', { model: autoResolved.displayName })
            : t('settings.ai.defaultModels.autoNone')

          const autoOption: NomiSelectOption = {
            value: '',
            label: autoLabel,
            ...(autoResolved ? { description: t('settings.ai.defaultModels.autoStrongest') } : {}),
            dividerAfter: manualOptions.length > 0,
            boardAnchor: 'policy.picker-auto-option',
          }
          const selectOptions: NomiSelectOption[] = missing
            ? [
                {
                  value: 'unavailable',
                  label: autoResolved
                    ? t('settings.ai.defaultModels.unavailable', { model: autoResolved.displayName })
                    : t('settings.ai.defaultModels.unavailableNoAuto'),
                },
                autoOption,
                ...manualOptions,
              ]
            : [autoOption, ...manualOptions]

          const singleCap = !missing && current
            ? inspectSingleCapabilityPick({
                models,
                vendorNameOf,
                mediaKind,
                picked: current,
                orderedVendorKeys,
                isAiling,
              })
            : null

          const rowTitle = t(ROW_TITLE_KEY[mediaKind])
          const isDimmedEmpty = !current && !autoResolved

          return (
            <div
              key={mediaKind}
              data-board={ROW_BOARD_ANCHOR[mediaKind]}
              data-default-model-kind={mediaKind}
              className="flex min-w-0 items-center gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-body-sm text-nomi-ink">{rowTitle}</span>
                {singleCap ? (
                  <span
                    data-board="edge.single-capability-pick"
                    className="whitespace-normal break-words text-caption leading-4 text-nomi-ink-60"
                  >
                    {singleCap.fallbackModelName
                      ? t(SINGLE_CAPABILITY_KEYS[singleCap.supportedTask].withAuto, {
                          model: singleCap.fallbackModelName,
                        })
                      : t(SINGLE_CAPABILITY_KEYS[singleCap.supportedTask].noAuto)}
                  </span>
                ) : (
                  <span className="whitespace-normal break-words text-caption leading-4 text-nomi-ink-60">
                    {t(ROW_SUBTITLE_KEY[mediaKind])}
                  </span>
                )}
              </div>
              <div
                className="shrink-0"
                data-board={!current && autoResolved?.isVendorFallback ? 'edge.vendor-fallback' : undefined}
              >
                <NomiSelect
                  ariaLabel={t('settings.ai.defaultModels.pickerLabel', { task: rowTitle })}
                  placeholder={autoLabel}
                  value={missing ? 'unavailable' : encoded ?? ''}
                  options={selectOptions}
                  onChange={(next) => handlePick(mediaKind, next)}
                  searchable={manualOptions.length > 0}
                  searchPlaceholder={t('settings.ai.defaultModels.searchModels')}
                  dropdownAlign="end"
                  className={cn('shrink-0', isDimmedEmpty && '[&>span]:text-nomi-ink-60')}
                />
              </div>
            </div>
          )
        })}
      </div>
      {noneAvailable ? (
        <div className="mt-2 flex items-center gap-2" data-board="edge.none-available">
          <button
            type="button"
            onClick={() => openModelSettingsHome()}
            className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-body-sm font-medium text-nomi-accent hover:underline"
          >
            <IconPlugConnected size={14} stroke={1.8} aria-hidden="true" />
            <span>{t('settings.ai.defaultModels.connectProvider')}</span>
          </button>
        </div>
      ) : null}
      <p data-board="policy.auto-caption" className="mt-2 text-caption text-nomi-ink-60">
        <QuotedUiNames text={t('settings.ai.defaultModels.hint')} />
      </p>
    </section>
  )
}
