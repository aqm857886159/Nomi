import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAdjustmentsHorizontal, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { NomiSelect } from '../../../design'
import { cn } from '../../../utils/cn'
import type { ModelOption } from '../../../config/models'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'

/**
 * 镜卡的模型参数控件（#1）。参数**全 derive 自模型档案**（archetype），不为某模型写专属 UI（P4）。
 * 渐进展开（用户拍板）：
 *   - 常用参数（紧凑 select、非时长、前 2 个 → 视频露「清晰度+比例」、图片露「尺寸」）**直接露**。
 *   - 其余参数 + 模式切换收进「参数」抽屉，点开才显。
 * duration 不在这里（卡有独立「时长」选择器，避免双份真相源）。
 *
 * 拆成 inline / drawer 两块（用户反馈「参数换行好多、应该一行」）：inline 选择器由镜卡并进
 * header 同一行、不再另起一行；drawer（展开面板）full-width 落在 header 下方。open 态提升到镜卡。
 */

type ParamIO = {
  modelOption: ModelOption | null
  modeId?: string
  params: Record<string, unknown>
  onUpdate: (patch: { params?: Record<string, unknown>; modeId?: string }) => void
}

/** 拆分：inline=紧凑 select 前 2 个（去 duration）；drawer=其余。纯函数便于单测。 */
export function splitShotParams(params: readonly ModelParameterControl[]): {
  inline: ModelParameterControl[]
  drawer: ModelParameterControl[]
} {
  const usable = params.filter((p) => p.key !== 'duration')
  const inline = usable.filter((p) => p.type === 'select').slice(0, 2)
  const inlineKeys = new Set(inline.map((p) => p.key))
  const drawer = usable.filter((p) => !inlineKeys.has(p.key))
  return { inline, drawer }
}

/** 解析选中模型的 archetype → 当前 mode + inline/drawer 参数分组。null = 无模型/无档案/无 mode。 */
function resolveShotParams(modelOption: ModelOption | null, modeId?: string) {
  if (!modelOption) return null
  const archetype = resolveArchetypeForModel({
    modelKey: modelOption.modelKey || modelOption.value,
    modelAlias: modelOption.modelAlias,
    vendorKey: modelOption.vendor,
    meta: modelOption.meta,
  })
  if (!archetype) return null
  const modes = archetype.modes
  const mode = modes.find((m) => m.id === modeId) ?? modes.find((m) => m.id === archetype.defaultModeId) ?? modes[0]
  if (!mode) return null
  const { inline, drawer } = splitShotParams(mode.params)
  const hasDrawer = drawer.length > 0 || modes.length > 1
  return { modes, mode, inline, drawer, hasDrawer }
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
      ariaLabel={control.label}
      leadingLabel={control.label}
      size="xs"
      value={valueOf(control)}
      options={control.options.map((o) => ({ value: String(o.value), label: o.label }))}
      onChange={(value) => setParam(control, value)}
    />
  )
}

/**
 * inline 参数区（并进镜卡 header 同一行）：前 2 个紧凑 select + 「参数」抽屉开关。
 * 无档案/无 inline 且无抽屉 → 不渲染任何东西（返回 null，父行不多占位）。
 */
export function ShotParamsInline({
  modelOption,
  modeId,
  params,
  onUpdate,
  open,
  onToggleOpen,
}: ParamIO & { open: boolean; onToggleOpen: () => void }): JSX.Element | null {
  const { t } = useTranslation()
  const resolved = resolveShotParams(modelOption, modeId)
  if (!resolved) return null
  const { inline, hasDrawer } = resolved
  if (inline.length === 0 && !hasDrawer) return null
  return (
    <>
      {inline.map((c) => (
        <ParamSelect key={c.key} control={c} params={params} onUpdate={onUpdate} />
      ))}
      {hasDrawer ? (
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className={cn(
            'h-6 px-2.5 rounded-full border text-caption inline-flex items-center gap-1',
            open
              ? 'border-nomi-accent text-nomi-ink-80 bg-nomi-ink-05'
              : 'border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80',
          )}
        >
          <IconAdjustmentsHorizontal size={12} stroke={1.8} aria-hidden />
          {t('storyboardEditor.shotParams.parameters')}
          {open ? (
            <IconChevronUp size={12} stroke={1.8} aria-hidden />
          ) : (
            <IconChevronDown size={12} stroke={1.8} aria-hidden />
          )}
        </button>
      ) : null}
    </>
  )
}

/**
 * 参数抽屉（open 时 full-width 落在 header 下方）：模式切换 + 其余参数 + 套用到全部。
 * open 态由镜卡持有；此组件只在 open 时被渲染。无抽屉内容 → null。
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
  const resolved = resolveShotParams(modelOption, modeId)
  if (!resolved) return null
  const { modes, mode, drawer, hasDrawer } = resolved
  if (!hasDrawer) return null
  return (
    <div className="w-full mt-2 p-2.5 rounded-nomi-sm bg-nomi-ink-05 flex flex-col gap-2">
      {modes.length > 1 ? (
        <NomiSelect
          ariaLabel={t('storyboardEditor.shotParams.mode')}
          leadingLabel={t('storyboardEditor.shotParams.mode')}
          size="xs"
          value={mode.id}
          options={modes.map((m) => ({ value: m.id, label: m.vendorTerm || m.id }))}
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
                  {c.label}
                </label>
              )
            }
            // 文本型参数（如负面提示词）可能很长——给整行多行框，别用单行 input 横向裁切看不全。
            return (
              <textarea
                key={c.key}
                aria-label={c.label}
                placeholder={c.placeholder || c.label}
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
