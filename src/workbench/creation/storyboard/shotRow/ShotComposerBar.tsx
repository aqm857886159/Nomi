import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconDots } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { DesignSwitch, NomiSelect } from '../../../../design'
import type { ModelOption } from '../../../../config/models'
import { useDedupedModelSelect } from '../../../common/useDedupedModelSelect'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes/types'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { DURATION_OPTIONS_SEC, shotTypeOf } from '../../../generationCanvas/agent/storyboardPlanEdits'
import { composerBarPlan, composerModeOptions } from './composerBarModel'

/**
 * 提示词框下方的**底栏**（合同 v6 §2.3）——「和画布里的图片节点一样」那句话的落点。
 *
 * v5 把模型/模式/画幅/时长摊在**行上沿**，和"这镜做完没有"抢同一条视觉带宽；一屏十几行就成了
 * 一条控件河。v6 把它们整体搬进提示词块内部：批量观察继续靠表格骨架（行、场分组、画面格、状态色），
 * 精细调参数的控件全部收在这一条里。
 *
 * **2026-09-06 返工三（用户逐字）**：「参数框为啥那么多？我们画布上的图片节点本身参数没那么多。
 * 能不能变成一行、再简洁些，最右边就是生成。现在很乱。」于是这一版把三件事定死：
 *
 *   ① **永远一行**。上一轮的"装不下就整表换两行"整套（`composerGridLayout` + `ComposerGridScope`
 *      + 两个测量 hook）删除——两行版把一枚胶囊的溢出变成了全表行高的抖动，而真正的问题是
 *      **胶囊本来就太多**。少摆几枚，一行就够了。
 *   ② **窄了只缩文字，不换行、不截断重叠**，而且**缩谁是有优先级的**（`SHRINK`）。
 *      默认的等比收缩会把「16:9」缩成「1.」、「720p」缩成「7…」——每枚都缩一点，等于每枚都废
 *      （2026-09-06 混排那张实拍就是这样）。所以只有**模型名**大幅让位：它最长、且前几个字就认得出
 *      （「Seedance 2.5」→「Seedanc…」，`title` 里仍读得到全名），供应商次之；模式 / 画幅 / 时长 /
 *      清晰度都是短枚举（「首帧」「16:9」「5 秒」「720p」），少一个字就没意义，**一律不缩**；
 *      ⋯ 与「生成」是动作，更不缩。用户拍板的降级方式就是这一条：缩模型名、挂 tooltip。
 *   ③ **「生成」钉在最右**（`ml-auto`），和所有胶囊同一条基线。
 *
 * 摆几枚由 `composerBarPlan` derive（select 摆出来、boolean 收进行尾 ⋯），画幅胶囊只在这一行
 * 覆盖了整片默认时出现（§2.4.1）——于是"胶囊出现"本身就是信息。已生成/已锁定的行，
 * 「生成」位置换成一枚状态标签，不额外加行。
 */

type Props = {
  shot: PlanShot
  archetype: ModelArchetype | null
  mode: ArchetypeMode | null
  modelOptions?: ModelOption[] | undefined
  /** 这一行**生效**的画幅；`aspectOverridden=false` 时不渲染画幅胶囊（§2.4.1 规则 3）。 */
  aspect: string
  aspectOverridden: boolean
  aspectOptions: readonly string[]
  onChangeAspect: (aspect: string | null) => void
  onUpdate: (patch: Partial<PlanShot>) => void
  /** 行内「生成 / 重试」；缺省 = 不渲染主按钮（如已生成态）。 */
  onGenerate?: (() => void) | undefined
  /** 已生成/已锁定时替代主按钮的那枚状态标签文案。 */
  statusTag?: string | null
}

/**
 * 收缩优先级（`flex-shrink` 因子）。装不下时按这里让位，不等比收缩——等比 = 每枚都缩一点 = 每枚都废。
 * 数字大 = 先缩：模型名最长又最容易认（前几个字母就够）；画幅/时长/清晰度是短枚举，缩一个字就没意义。
 */
const SHRINK = { model: 8, provider: 4, mode: 0, aspect: 0, duration: 0, param: 0 } as const

/** 一枚胶囊的收缩壳：把优先级放在 flex item 上（`NomiSelect` 自身只负责值的 truncate）。 */
function Chip({ shrink, children }: { shrink: number; children: React.ReactNode }): JSX.Element {
  return <span className="flex min-w-0 items-center" style={{ flexShrink: shrink }}>{children}</span>
}

/** 开关当前值：`shot.params` 没写过就读档案默认。 */
function switchValue(shot: PlanShot, control: ModelParameterControl): boolean {
  const current = shot.params?.[control.key]
  return current === undefined ? control.defaultValue === true : current === true
}

export default function ShotComposerBar({
  shot,
  archetype,
  mode,
  modelOptions,
  aspect,
  aspectOverridden,
  aspectOptions,
  onChangeAspect,
  onUpdate,
  onGenerate,
  statusTag,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const isImageShot = shotTypeOf(shot) === 'image'
  const [switchesOpen, setSwitchesOpen] = React.useState(false)

  const onShotModelChange = React.useCallback(
    (value: string) => onUpdate({ modelKey: value || undefined, modeId: undefined, params: undefined }),
    [onUpdate],
  )
  const modelSelect = useDedupedModelSelect(modelOptions ?? [], shot.modelKey ?? '', onShotModelChange)
  const modelSelectOptions = modelOptions && modelOptions.length > 0
    ? [{ value: '', label: t('storyboardEditor.defaultModel') }, ...modelSelect.modelOptions]
    : null

  const modeOptions = composerModeOptions(archetype)
  const { inline: inlineParams, overflow: switchParams } = composerBarPlan(mode)
  const activeSwitches = switchParams.filter((control) => switchValue(shot, control))

  // 时长：视频镜=生成时长；图片镜=停留时长（进时间轴/顺播时这张图停几秒）。
  const effectiveDuration = effectiveShotDurationSec(shot)
  const durationOptions = [...new Set([...DURATION_OPTIONS_SEC, ...(isImageShot ? [3] : []), effectiveDuration])]
    .filter((sec) => Number.isFinite(sec) && sec > 0)
    .sort((a, b) => a - b)
    .map((sec) => ({ value: String(sec), label: t('storyboardEditor.second', { count: sec }) }))

  // 画幅可选项 = 项目预设 ∪ 该模型档案声明的档 ∪ 当前值（档案声明了 adaptive 这类专有档时别丢）。
  const aspectSelectOptions = [...new Set([
    ...aspectOptions,
    ...(mode?.params.find((control) => control.key === 'aspect_ratio')?.options ?? []).map((option) => String(option.value)),
    ...(aspect ? [aspect] : []),
  ])].map((value) => ({ value, label: value }))

  return (
    <div
      className="relative flex min-w-0 flex-nowrap items-center gap-1 border-t border-nomi-line-soft px-2 py-1.5"
      data-storyboard-composer-bar="true"
    >
      {modelSelectOptions ? (
        <Chip shrink={SHRINK.model}>
          <NomiSelect
            ariaLabel={isImageShot ? t('storyboardEditor.imageModel') : t('storyboardEditor.videoModel')}
            size="xs"
            triggerMaxWidth={150}
            value={shot.modelKey ? modelSelect.modelValue : ''}
            options={modelSelectOptions}
            onChange={(id) => (id ? modelSelect.onModelPick(id) : onShotModelChange(''))}
            onChipChange={modelSelect.onModelProviderPick}
          />
        </Chip>
      ) : null}
      {modelSelect.providerOptions.length > 1 ? (
        <Chip shrink={SHRINK.provider}>
          <NomiSelect
            ariaLabel={t('storyboardEditor.provider')}
            size="xs"
            triggerMaxWidth={110}
            value={modelSelect.providerValue}
            options={modelSelect.providerOptions}
            onChange={modelSelect.onProviderPick}
          />
        </Chip>
      ) : null}

      {modeOptions.length > 0 ? (
        <Chip shrink={SHRINK.mode}>
          <NomiSelect
            ariaLabel={t('storyboardEditor.shotParams.mode')}
            size="xs"
            triggerMaxWidth={120}
            value={mode?.id ?? ''}
            options={modeOptions.map((option) => ({ value: option.value, label: translateModelDisplayText(option.label) }))}
            onChange={(value) => onUpdate({ modeId: value || undefined, params: undefined })}
          />
        </Chip>
      ) : null}

      {/* 画幅：**只有覆盖了整片默认的行才有这枚胶囊**（§2.4.1 规则 3）。
          蓝色「· 覆盖」标记让它在一列继承行里一眼可辨；选「跟随整片默认」即收回覆盖、胶囊消失。 */}
      {aspectOverridden ? (
        <Chip shrink={SHRINK.aspect}>
          <span className="flex min-w-0 items-center" data-storyboard-aspect-override={aspect}>
            <NomiSelect
              ariaLabel={t('storyboardEditor.row.aspectAria')}
              size="xs"
              value={aspect}
              // 「覆盖」用胶囊自带的 accent 徽标，不再在旁边挂一枚独立文字 span——
              // 独立 span 多占 ~38px，而底栏最缺的就是这几十像素（2026-09-06 混排实拍全线截断）。
              triggerBadge={{ text: t('storyboardEditor.aspectScope.overrideMark'), tone: 'accent' }}
              options={[{ value: '', label: t('storyboardEditor.aspectScope.followDefault') }, ...aspectSelectOptions]}
              onChange={(value) => onChangeAspect(value || null)}
            />
          </span>
        </Chip>
      ) : null}

      <Chip shrink={SHRINK.duration}>
        <NomiSelect
          ariaLabel={isImageShot ? t('storyboardEditor.row.stayHint') : t('storyboardEditor.duration')}
          size="xs"
          value={String(effectiveDuration)}
          options={durationOptions}
          onChange={(value) => onUpdate({ durationSec: Number(value) })}
        />
      </Chip>

      {inlineParams.map((control) => (
        <Chip key={control.key} shrink={SHRINK.param}>
          <NomiSelect
            ariaLabel={translateModelDisplayText(control.label)}
            size="xs"
            triggerMaxWidth={110}
            value={
              shot.params?.[control.key] === undefined
                ? String(control.defaultValue ?? '')
                : String(shot.params?.[control.key])
            }
            options={control.options.map((option) => ({ value: String(option.value), label: translateModelDisplayText(option.label) }))}
            onChange={(value) => onUpdate({ params: { ...(shot.params ?? {}), [control.key]: value } })}
          />
        </Chip>
      ))}

      {/* 行尾 ⋯：开关的家（生成音频 / 返回尾帧…）。开着的用一颗小圆点报信，
          具体开了哪几个进弹层——一排同形同色的开关摆在扫视行上读不出差别，只剩噪音。 */}
      {switchParams.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setSwitchesOpen((open) => !open)}
            aria-expanded={switchesOpen}
            aria-label={t('storyboardEditor.composerBar.switchesAria')}
            title={
              activeSwitches.length > 0
                ? activeSwitches.map((control) => translateModelDisplayText(control.label)).join(' · ')
                : t('storyboardEditor.composerBar.switchesAria')
            }
            data-storyboard-composer-switches={shot.index}
            className={cn(
              'relative grid size-6 shrink-0 place-items-center rounded-pill border border-nomi-line text-nomi-ink-60',
              'hover:border-nomi-ink-20 hover:text-nomi-ink-80 focus:outline-none focus-visible:border-nomi-accent',
            )}
          >
            <IconDots size={13} stroke={1.8} aria-hidden />
            {activeSwitches.length > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-nomi-accent"
                data-storyboard-composer-switches-on={activeSwitches.length}
                aria-hidden
              />
            ) : null}
          </button>
          {switchesOpen ? (
            <div
              className="absolute bottom-9 right-2 z-30 flex min-w-44 flex-col gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-2 shadow-nomi-md"
              data-storyboard-composer-switch-panel={shot.index}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {switchParams.map((control) => (
                <DesignSwitch
                  key={control.key}
                  size="xs"
                  labelPosition="left"
                  label={translateModelDisplayText(control.label)}
                  checked={switchValue(shot, control)}
                  onChange={(event) =>
                    onUpdate({ params: { ...(shot.params ?? {}), [control.key]: event.currentTarget.checked } })}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {/* 「生成」永远钉在最右，和胶囊同一基线（用户反馈三第三句）。 */}
      <div className="ml-auto shrink-0">
        {statusTag ? (
          <span className="rounded-pill bg-nomi-ink-05 px-2 py-0.5 text-micro text-nomi-ink-60">{statusTag}</span>
        ) : onGenerate ? (
          <button
            type="button"
            onClick={onGenerate}
            className="h-6 rounded-nomi-sm bg-nomi-ink px-2.5 text-micro font-medium text-nomi-paper hover:opacity-90 active:opacity-80"
            aria-label={t('storyboardEditor.frame.generateAria', { index: shot.index })}
          >
            {t('storyboardEditor.frame.generate')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
