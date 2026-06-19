import React from 'react'
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
 */

type Props = {
  /** 选中的视频模型 option（带 modelKey/meta/vendor 供解析档案）；null = 默认模型（无 archetype，不显参数）。 */
  modelOption: ModelOption | null
  modeId?: string
  params: Record<string, unknown>
  onUpdate: (patch: { params?: Record<string, unknown>; modeId?: string }) => void
  /** 把这镜参数+模式套用到全部镜头。 */
  onApplyToAll?: () => void
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

export default function ShotParamControls({ modelOption, modeId, params, onUpdate, onApplyToAll }: Props): JSX.Element | null {
  const [open, setOpen] = React.useState(false)
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
  if (inline.length === 0 && !hasDrawer) return null

  const valueOf = (c: ModelParameterControl): string => {
    const v = params[c.key]
    if (v !== undefined && v !== null) return String(v)
    return c.defaultValue !== undefined ? String(c.defaultValue) : ''
  }
  const setParam = (c: ModelParameterControl, raw: string | boolean): void => {
    const value = c.type === 'number' ? Number(raw) : c.type === 'boolean' ? Boolean(raw) : raw
    onUpdate({ params: { ...params, [c.key]: value } })
  }

  const renderSelect = (c: ModelParameterControl): JSX.Element => (
    <NomiSelect
      key={c.key}
      ariaLabel={c.label}
      leadingLabel={c.label}
      size="xs"
      value={valueOf(c)}
      options={c.options.map((o) => ({ value: String(o.value), label: o.label }))}
      onChange={(value) => setParam(c, value)}
    />
  )

  return (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      {inline.map(renderSelect)}
      {hasDrawer ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            'h-6 px-2.5 rounded-full border text-caption inline-flex items-center gap-1',
            open ? 'border-nomi-accent text-nomi-ink-80 bg-[var(--nomi-ink-05)]' : 'border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80',
          )}
        >
          <IconAdjustmentsHorizontal size={12} stroke={1.8} aria-hidden />
          参数
          {open ? <IconChevronUp size={12} stroke={1.8} aria-hidden /> : <IconChevronDown size={12} stroke={1.8} aria-hidden />}
        </button>
      ) : null}

      {open && hasDrawer ? (
        <div className="w-full mt-1.5 p-2.5 rounded-nomi-sm bg-[var(--nomi-ink-05)] flex flex-col gap-2">
          {modes.length > 1 ? (
            <NomiSelect
              ariaLabel="模式"
              leadingLabel="模式"
              size="xs"
              value={mode.id}
              options={modes.map((m) => ({ value: m.id, label: m.vendorTerm || m.id }))}
              onChange={(value) => onUpdate({ modeId: value })}
            />
          ) : null}
          {drawer.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              {drawer.map((c) => {
                if (c.type === 'select') return renderSelect(c)
                if (c.type === 'boolean') {
                  return (
                    <label key={c.key} className="inline-flex items-center gap-1.5 text-caption text-nomi-ink-60">
                      <input type="checkbox" checked={valueOf(c) === 'true'} onChange={(event) => setParam(c, event.target.checked)} />
                      {c.label}
                    </label>
                  )
                }
                return (
                  <input
                    key={c.key}
                    aria-label={c.label}
                    placeholder={c.placeholder || c.label}
                    value={valueOf(c)}
                    onChange={(event) => setParam(c, event.target.value)}
                    className="h-7 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink-80 focus:border-nomi-accent min-w-[140px]"
                  />
                )
              })}
            </div>
          ) : null}
          {onApplyToAll ? (
            <button type="button" onClick={onApplyToAll} className="self-start text-caption text-nomi-accent hover:underline">
              套用到全部镜头
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
