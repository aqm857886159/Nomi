// 底栏「高级设置」——一颗图标 + 底栏下面原地展开的一段（画板 T / T2 / T3 / T4，2026-11-14 用户定稿）。
//
// 进这里的项只由 `parameterPlacement` 决定（parameterControlModel.ts，一处定义）；这个文件只回答「长什么样」：
//   · 图标：滑杆那颗（软件里「精修」「通用设置」已在用，和 LibTV 同一颗），里面有值不是默认时右上角一个小点；
//   · 展开段：小标题 + 一行一项（名字在左、控件在右）：开关 / 选项分段 / 输入框。种子永远是输入框（不给滑杆）；
//   · 名字旁 ⓘ：只给光看名字不知道干什么的那几类，移上去、点一下、键盘选到都出，说明在名字下面。
// 开着还是收着不记（便签「没放上去的」）：状态由宿主组件自己的 useState 持有，节点一收起就没了。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAdjustmentsHorizontal, IconInfoCircle } from '@tabler/icons-react'
import { DesignSwitch, NomiSegmented, Tooltip, TooltipContent, TooltipTrigger } from '../../../../design'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import { NodePromptToolIconButton } from '../NodePromptToolCluster'
import {
  type AdvancedParameterClass,
  type DynamicModelControl,
  advancedParameterClass,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
} from './parameterControlModel'
import { ParameterTextInput, type ParameterControlWiring } from './ParameterControlBody'

/** 名字旁带说明的几类（便签「名字旁的说明」：这一批三条；一看就懂的水印、格式不加）。 */
const HELP_KEY_BY_CLASS: Partial<Record<AdvancedParameterClass, string>> = {
  seed: 'generationCommon.parameters.help.seed',
  returnLastFrame: 'generationCommon.parameters.help.returnLastFrame',
  moderation: 'generationCommon.parameters.help.moderation',
}

function parameterHelpKey(control: DynamicModelControl): string | null {
  const cls = advancedParameterClass(control)
  return cls ? HELP_KEY_BY_CLASS[cls] ?? null : null
}

/** 底栏右边那排图标里的一颗。 */
export function AdvancedSettingsIconButton({ open, changed, onToggle }: { open: boolean; changed: boolean; onToggle: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <NodePromptToolIconButton
      toolId="advanced"
      icon={<IconAdjustmentsHorizontal />}
      label={t('generationCommon.parameters.advanced')}
      aria-expanded={open}
      data-advanced-settings-toggle="true"
      data-advanced-settings-changed={changed ? 'true' : undefined}
      className={open ? 'bg-nomi-ink-05' : undefined}
      active={changed}
      onClick={onToggle}
    />
  )
}

/**
 * 名字旁的 ⓘ。用软件里选项上已在用的那一个（12 / stroke 2），不新造问号。
 * 三种触发都要：移上去、点一下（钉住，再点收起）、键盘选到。说明是贴在名字下面的一小块字，不是对话框。
 */
export function ParameterHelpMark({ name, text }: { name: string; text: string }): JSX.Element {
  const [hovered, setHovered] = React.useState(false)
  const [pinned, setPinned] = React.useState(false)
  return (
    <Tooltip open={hovered || pinned} onOpenChange={setHovered} delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={name}
          aria-expanded={hovered || pinned}
          data-parameter-help="true"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink-60 focus:outline-none focus-visible:bg-nomi-ink-05"
          onClick={(event) => { event.stopPropagation(); setPinned((value) => !value) }}
        >
          <IconInfoCircle size={12} stroke={2} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        data-parameter-help-text="true"
        onEscapeKeyDown={() => setPinned(false)}
        onPointerDownOutside={() => setPinned(false)}
        className="max-w-[280px] whitespace-normal select-text border-nomi-line bg-nomi-paper p-2 leading-normal text-nomi-ink-80"
        style={{ zIndex: 700 }}
      >
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** 一项：名字（+ ⓘ）在左，控件在右。 */
function AdvancedSettingRow({ control, meta, onParameterControlChange }: ParameterControlWiring & { control: DynamicModelControl }): JSX.Element | null {
  const { t } = useTranslation()
  if (!isParameterControl(control)) return null
  const label = translateModelDisplayText(control.label)
  const helpKey = parameterHelpKey(control)
  let body: React.ReactNode
  if (control.type === 'boolean') {
    const on = (controlInitialValue(control, meta) || 'false') === 'true'
    body = (
      <DesignSwitch
        size="sm"
        color="var(--nomi-accent)"
        aria-label={label}
        checked={on}
        onChange={(event) => onParameterControlChange(control, event.currentTarget.checked ? 'true' : 'false')}
      />
    )
  } else if (control.options.length > 0) {
    body = (
      <NomiSegmented
        ariaLabel={label}
        value={controlInitialValue(control, meta)}
        options={control.options.map((option) => ({ value: controlValueToString(option.value), label: translateModelDisplayText(option.label) }))}
        density="compact"
        fit="content"
        onChange={(value) => onParameterControlChange(control, value)}
      />
    )
  } else {
    // 种子这类自由数值：一律输入框（2147483647 的区间给滑杆等于没法用）。
    body = (
      <div className="w-[140px]">
        <ParameterTextInput
          control={{ ...control, placeholder: translateModelDisplayText(control.placeholder || '随机') }}
          value={controlInitialValue(control, meta)}
          onCommit={(value) => onParameterControlChange(control, value)}
        />
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3" style={{ minHeight: 28 }} data-advanced-setting={control.key}>
      <div className="flex min-w-0 items-center gap-1 text-caption text-nomi-ink-80">
        <span className="min-w-0">{label}</span>
        {helpKey ? <ParameterHelpMark name={label} text={t(helpKey)} /> : null}
      </div>
      <div className="shrink-0">{body}</div>
    </div>
  )
}

/** 底栏下面原地展开的那一段。 */
export const AdvancedSettingsSection = React.forwardRef<HTMLDivElement, ParameterControlWiring & { controls: readonly DynamicModelControl[] }>(
  function AdvancedSettingsSection({ controls, ...wiring }, ref): JSX.Element {
    const { t } = useTranslation()
    return (
      <div
        ref={ref}
        role="group"
        aria-label={t('generationCommon.parameters.advanced')}
        data-advanced-settings="true"
        className="mt-1.5 flex flex-col gap-1 border-t border-nomi-line-soft pt-2"
      >
        <div className="text-micro font-semibold leading-none text-nomi-ink-40">{t('generationCommon.parameters.advanced')}</div>
        {controls.map((control) => <AdvancedSettingRow key={control.key} control={control} {...wiring} />)}
      </div>
    )
  },
)
