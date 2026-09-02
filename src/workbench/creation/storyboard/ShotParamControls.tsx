import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect } from '../../../design'
import type { ModelOption } from '../../../config/models'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { resolveShotArchetypeMode } from './shotRow/shotRowModel'

/**
 * 镜行展开态的模型参数控件。参数**全 derive 自模型档案**（archetype），不为某模型写专属 UI（P4）。
 * v5 表形态：行内不再有 inline 参数位——模型/画幅/时长住提示词块上沿的一等胶囊，
 * 其余参数 + 模式切换全住展开态（▾）这一个抽屉；duration 与 aspect_ratio 在这里被排除，
 * 避免与行内胶囊成双份真相源（P1）。
 */

type ParamIO = {
  modelOption: ModelOption | null
  modeId?: string
  params: Record<string, unknown>
  onUpdate: (patch: { params?: Record<string, unknown>; modeId?: string }) => void
}

/** 抽屉参数 = 档案参数去掉行内已有一等胶囊的两项（时长/画幅）。纯函数便于单测。 */
export function drawerShotParams(params: readonly ModelParameterControl[]): ModelParameterControl[] {
  return params.filter((p) => p.key !== 'duration' && p.key !== 'aspect_ratio')
}

function makeParamIO(params: ParamIO['params'], onUpdate: ParamIO['onUpdate']) {
  const valueOf = (c: ModelParameterControl): string => {
    const v = params[c.key]
    if (v !== undefined && v !== null) return String(v)
    return c.defaultValue !== undefined ? String(c.defaultValue) : ''
  }
  const setParam = (c: ModelParameterControl, raw: string | boolean): void => {
    const value = c.type === 'number' ? Number(raw) : c.type === 'boolean' ? Boolean(raw) : raw
    onUpdate({ params: { ...params, [c.key]: value } })
  }
  return { valueOf, setParam }
}

function ParamSelect({
  control,
  params,
  onUpdate,
}: { control: ModelParameterControl } & Pick<ParamIO, 'params' | 'onUpdate'>): JSX.Element {
  const { valueOf, setParam } = makeParamIO(params, onUpdate)
  return (
    <NomiSelect
      ariaLabel={translateModelDisplayText(control.label)}
      leadingLabel={translateModelDisplayText(control.label)}
      size="xs"
      value={valueOf(control)}
      options={control.options.map((o) => ({ value: String(o.value), label: translateModelDisplayText(o.label) }))}
      onChange={(value) => setParam(control, value)}
    />
  )
}

/**
 * 参数抽屉（镜行展开态内嵌）：模式切换 + 其余参数 + 套用到全部。
 * 无档案 / 无可调项 → null（展开态照常显示台词/转场，只是没有参数段）。
 */
export function ShotParamsDrawer({
  modelOption,
  modeId,
  params,
  onUpdate,
  onApplyToAll,
}: ParamIO & { onApplyToAll?: () => void }): JSX.Element | null {
  const { t } = useTranslation()
  const { valueOf, setParam } = makeParamIO(params, onUpdate)
  const resolved = resolveShotArchetypeMode(modelOption, modeId)
  if (!resolved) return null
  const modes = resolved.archetype.modes
  const drawer = drawerShotParams(resolved.mode.params)
  if (drawer.length === 0 && modes.length <= 1) return null
  return (
    <div className="flex flex-col gap-2">
      {modes.length > 1 ? (
        <NomiSelect
          ariaLabel={t('storyboardEditor.shotParams.mode')}
          leadingLabel={t('storyboardEditor.shotParams.mode')}
          size="xs"
          value={resolved.mode.id}
          options={modes.map((m) => ({ value: m.id, label: translateModelDisplayText(m.vendorTerm || m.id) }))}
          onChange={(value) => onUpdate({ modeId: value })}
        />
      ) : null}
      {drawer.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          {drawer.map((c) => {
            if (c.type === 'select') return <ParamSelect key={c.key} control={c} params={params} onUpdate={onUpdate} />
            if (c.type === 'boolean') {
              return (
                <label key={c.key} className="inline-flex items-center gap-1.5 text-caption text-nomi-ink-60">
                  <input
                    type="checkbox"
                    checked={valueOf(c) === 'true'}
                    onChange={(event) => setParam(c, event.target.checked)}
                  />
                  {translateModelDisplayText(c.label)}
                </label>
              )
            }
            // 文本型参数（如负面提示词）可能很长——给整行多行框，别用单行 input 横向裁切看不全。
            return (
              <textarea
                key={c.key}
                aria-label={translateModelDisplayText(c.label)}
                placeholder={translateModelDisplayText(c.placeholder || c.label)}
                value={valueOf(c)}
                onChange={(event) => setParam(c, event.target.value)}
                rows={2}
                className="basis-full w-full resize-y px-2 py-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink-80 focus:border-nomi-accent"
              />
            )
          })}
        </div>
      ) : null}
      {onApplyToAll ? (
        <button
          type="button"
          onClick={onApplyToAll}
          className="self-start text-caption text-nomi-accent hover:underline"
        >
          {t('storyboardEditor.shotParams.applyAll')}
        </button>
      ) : null}
    </div>
  )
}
