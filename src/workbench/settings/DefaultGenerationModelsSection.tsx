// 「新建卡片默认模型」设置区（用户 2026-08-18 看样张后拍板）。
//
// 解决的摩擦：新建一张卡时是「从池子里挑第一个健康的模型」，不分任务类型。
// 偏好用某个模型做视频的人，每开一张新卡都要重选一次。
//
// 命名注意：本页下方已有一块叫「默认模型策略」，那块管的是**允许用哪些**（权限）。
// 这块管的是**新建时默认选哪个**（偏好）。两者同屏，名字必须区分得开，否则没人分得清。
//
// 默认值是「自动选择」= 今天的行为，没设过的人完全无感（D4：可选的加速器，不是必须学的配置）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'

import { NomiSelect } from '../../design'
import type { ModelCatalogModelDto } from '../api/modelCatalogApi'
import {
  GENERATION_DEFAULT_TASK_KINDS,
  type GenerationDefaultTaskKind,
} from '../../../electron/settings/generationModelDefaultsContract'
import type { GenerationModelDefaultMap } from '../generationCanvas/model/generationModelDefaults'
import { buildDefaultModelOptions } from './defaultGenerationModelOptions'

type Props = {
  models: readonly ModelCatalogModelDto[]
  vendorNameOf: (vendorKey: string) => string
  defaults: GenerationModelDefaultMap
  onChange: (next: GenerationModelDefaultMap) => void
}

const TASK_LABEL_KEY: Record<GenerationDefaultTaskKind, string> = {
  text_to_image: 'settings.ai.defaultModels.textToImage',
  image_edit: 'settings.ai.defaultModels.imageEdit',
  text_to_video: 'settings.ai.defaultModels.textToVideo',
  image_to_video: 'settings.ai.defaultModels.imageToVideo',
}

export function DefaultGenerationModelsSection({
  models,
  vendorNameOf,
  defaults,
  onChange,
}: Props): JSX.Element {
  const { t } = useTranslation()

  const { optionsByKind, decode, encode } = React.useMemo(
    () => buildDefaultModelOptions(models, vendorNameOf, t('settings.ai.defaultModels.auto')),
    [models, vendorNameOf, t],
  )

  const handlePick = (taskKind: GenerationDefaultTaskKind, value: string): void => {
    const next = { ...defaults }
    // 空串 = 「自动选择」：删掉这一条而不是存一个空身份。缺席才是「没设过」的正确表达。
    const identity = value ? decode(value, taskKind) : null
    if (identity) next[taskKind] = identity
    else delete next[taskKind]
    onChange(next)
  }

  return (
    <section
      data-settings-section="default-generation-models"
      className="mb-6"
      aria-labelledby="settings-default-models-title"
    >
      <h3 id="settings-default-models-title" className="mb-1 text-caption font-medium text-nomi-ink-60">
        {t('settings.ai.defaultModels.title')}
      </h3>
      <div className="mb-3 text-micro leading-relaxed text-nomi-ink-40">
        {t('settings.ai.defaultModels.hint')}
      </div>
      <div className="grid gap-2">
        {GENERATION_DEFAULT_TASK_KINDS.map((taskKind) => {
          const current = defaults[taskKind]
          // 设过、但那个模型此刻不在目录里（供应商删了 / 模型禁用了 / 换了台机器）——
          // 明着标出来，别让用户以为还生效着。生成时会自动回退到健康挑选。
          const encoded = current ? encode(current, taskKind) : null
          const missing = Boolean(current) && !encoded
          return (
            <div key={taskKind} className="flex min-w-0 items-center gap-3">
              <span className="w-20 shrink-0 text-caption text-nomi-ink-80">
                {t(TASK_LABEL_KEY[taskKind])}
              </span>
              <NomiSelect
                ariaLabel={t('settings.ai.defaultModels.pickerLabel', { task: t(TASK_LABEL_KEY[taskKind]) })}
                placeholder={t('settings.ai.defaultModels.auto')}
                value={encoded ?? ''}
                options={optionsByKind[taskKind]}
                onChange={(next) => handlePick(taskKind, next)}
                triggerMaxWidth={280}
              />
              {missing ? (
                <span className="shrink-0 text-micro text-nomi-warning">
                  {t('settings.ai.defaultModels.unavailable')}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
