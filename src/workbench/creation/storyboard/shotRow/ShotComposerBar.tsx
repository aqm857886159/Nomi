import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconDots, IconLoader2 } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { AnchoredPopover, DesignSwitch, NomiSelect } from '../../../../design'
import type { ModelOption } from '../../../../config/models'
import { modelVisibilityFooterAction, useDedupedModelSelect } from '../../../common/useDedupedModelSelect'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { ArchetypeMode, ModelArchetype } from '../../../../../electron/shared/modelArchetypes/types'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { DURATION_OPTIONS_SEC, planModelSelection, shotTypeOf, type PlanShotPatch } from '../../../generationCanvas/agent/storyboardPlanEdits'
import { composerBarPlan, composerModeOptions, shotAspectChoices, shotDurationChoices } from './composerBarModel'
import {
  COMPOSER_CHIP_YIELD,
  composerModelChipMinWidth,
  composerDemotedChipKeys,
  type ComposerChipDemand,
  type ComposerChipKind,
} from './composerBarGeometry'
import { useElementWidth } from './useElementWidth'

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
 *   ② **窄了只缩文字，不换行、不截断重叠**，而且**缩谁是有优先级的**。
 *      默认的等比收缩会把「16:9」缩成「1.」、「720p」缩成「7…」——每枚都缩一点，等于每枚都废
 *      （2026-09-06 混排那张实拍就是这样）。所以只有**模型名**大幅让位：它最长、且前几个字就认得出
 *      （「Seedance 2.5」→「Seedanc…」，`title` 里仍读得到全名），供应商次之；模式 / 画幅 / 时长 /
 *      清晰度都是短枚举（「首帧」「16:9」「5 秒」「720p」），少一个字就没意义，**一律不缩**。
 *   ③ **「生成」钉在最右**（`ml-auto`），和所有胶囊同一条基线。
 *
 * **2026-09-17 补上机制的后两步（用户拍板：方案 D + 让位下限）。** ② 只写了让位优先级、
 * 没写下限，于是「最高优先级那枚一个人扛下全部亏空」——英文下模型胶囊被压到 0–23px，
 * 只剩一颗齿轮图标，型号名一个字不剩（§1.5.4「模型是一等决策，不许埋」），压到 0 还不够
 * 就开始顶「生成」出右缘。补的是：
 *
 *   ④ **每枚声明下限**，按优先级让到下限为止（政策表在 `composerBarGeometry.ts`，
 *      优先级和下限写在同一处——分开写必然漂）。模型那枚的下限落到 CSS 上是
 *      `MODEL_CHIP_MIN_WIDTH_CSS`（`ch` 单位，让浏览器按真实字体算）。
 *   ⑤ **都到底了还装不下 → 把可降级的枚举整枚挪进行尾 ⋯**（`demotable`：尺寸这类档案参数可以，
 *      模型 / 模式 / 时长不可以）。判据是这一行自己那条 bar 的**实测宽度** + 这一行真要渲染的
 *      那几个标签——同一个容器宽度下中文装得下而英文装不下，一个全局断点表达不了。
 *      注意这与 ① 删掉的那套测量 hook 不是一回事：那套量内容、改行高（抖）；
 *      这条量外框、改内容，而外框宽度不取决于内容（见 `useElementWidth`）。
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
  onUpdate: (patch: PlanShotPatch) => void
  /** 行内「生成 / 重试」；缺省 = 不渲染主按钮（如已生成态）。 */
  onGenerate?: (() => void) | undefined
  /**
   * 这一镜正在跑（`exec.status === 'generating'`）。
   * 2026-09-11 用户实测：点「生成」之后这颗钮纹丝不动——没有按下态、没有忙态，
   * 和"没点着"长得一样，于是用户接着点第二下、第三下（每一下都是一次真实的排队）。
   * 忙态不是装饰，它同时是**闸**：`disabled` 让第二下点不进去。
   */
  generating?: boolean
  /** 已生成/已锁定时替代主按钮的那枚状态标签文案。 */
  statusTag?: string | null
}

/**
 * 一枚胶囊的收缩壳：把**优先级和下限**一起放在 flex item 上
 *（`NomiSelect` 自身只负责值的 truncate）。
 *
 * 两件必须同时给：只给 `flex-shrink` 不给 `min-width`，壳会缩得比触发还窄、压到隔壁那枚身上；
 * 只给 `min-width` 不给 `flex-shrink`，这枚就根本不让位。政策表在 `composerBarGeometry.ts`。
 */
function Chip({ kind, minWidth, children }: { kind: ComposerChipKind; minWidth?: string; children: React.ReactNode }): JSX.Element {
  return (
    <span
      className="flex min-w-0 items-center"
      style={{ flexShrink: COMPOSER_CHIP_YIELD[kind].shrink, ...(minWidth ? { minWidth } : null) }}
    >
      {children}
    </span>
  )
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
  generating = false,
  statusTag,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const isImageShot = shotTypeOf(shot) === 'image'
  const [switchesOpen, setSwitchesOpen] = React.useState(false)

  // 与画布节点同一个选择 owner（useDedupedModelSelect）：读用 (modelKey, modelVendor)，写也成对写。
  // 以前这里既不传 vendor 也只回写 modelKey——镜头留着旧供应商，界面选 APIMart、钱花在自定义那家（2026-09-21）。
  const onShotModelChange = React.useCallback(
    (value: string, vendor?: string) => onUpdate(planModelSelection(value, vendor)),
    [onUpdate],
  )
  const modelSelect = useDedupedModelSelect(modelOptions ?? [], shot.modelKey ?? '', onShotModelChange, shot.modelVendor)
  const modelSelectOptions = modelOptions && modelOptions.length > 0
    ? [{ value: '', label: t('storyboardEditor.defaultModel') }, ...modelSelect.modelOptions]
    : null

  const modeOptions = composerModeOptions(archetype)
  const { inline: inlineParams, overflow: switchParams } = composerBarPlan(mode)
  const activeSwitches = switchParams.filter((control) => switchValue(shot, control))

  // 时长：视频镜=生成时长；图片镜=停留时长（进时间轴/顺播时这张图停几秒）。
  const effectiveDuration = effectiveShotDurationSec(shot)
  const durationOptions = shotDurationChoices(isImageShot, effectiveDuration, DURATION_OPTIONS_SEC)
    .map((sec) => ({ value: String(sec), label: t('storyboardEditor.second', { count: sec }) }))

  // 画幅可选项 = 项目预设 ∪ 该模型档案声明的档 ∪ 当前值（判据在 shotAspectChoices）。
  const aspectSelectOptions = shotAspectChoices(aspectOptions, mode, aspect).map((value) => ({ value, label: value }))

  // ── 让位第三步：都到下限了还装不下，就把可降级的枚举整枚挪进行尾 ⋯（2026-09-17 用户拍板方案 D）──
  // 判据是这一行自己那条 bar 的实测宽度 + 这一行真要渲染的那几个标签（见 composerBarGeometry）。
  const paramValueLabel = React.useCallback((control: ModelParameterControl): string => {
    const current = shot.params?.[control.key] === undefined ? String(control.defaultValue ?? '') : String(shot.params?.[control.key])
    const option = control.options.find((candidate) => String(candidate.value) === current)
    return translateModelDisplayText(option?.label ?? current)
  }, [shot.params])

  const selectedModelOption = shot.modelKey ? modelSelect.modelOptions.find((option) => option.value === modelSelect.modelValue) : undefined
  const modelChipLabel = selectedModelOption?.label ?? t('storyboardEditor.defaultModel')
  // 「默认模型」那一项没有身份图标，固定开销少 20px——下限和估算都得跟着变，否则会把它撑胖。
  const modelChipHasIcon = Boolean(selectedModelOption?.icon)
  const barRef = React.useRef<HTMLDivElement>(null)
  const barWidth = useElementWidth(barRef)
  const chipDemands: (ComposerChipDemand & { key?: string })[] = [
    ...(modelSelectOptions ? [{ kind: 'model' as const, label: modelChipLabel, hasIcon: modelChipHasIcon }] : []),
    ...(modelSelect.providerOptions.length > 1 ? [{ kind: 'provider' as const, label: modelSelect.providerOptions.find((option) => option.value === modelSelect.providerValue)?.label ?? '' }] : []),
    ...(modeOptions.length > 0 ? [{ kind: 'mode' as const, label: translateModelDisplayText(modeOptions.find((option) => option.value === (mode?.id ?? ''))?.label ?? '') }] : []),
    ...(aspectOverridden ? [{ kind: 'aspect' as const, label: `${aspect}${t('storyboardEditor.aspectScope.overrideMark')}` }] : []),
    { kind: 'duration' as const, label: t('storyboardEditor.second', { count: effectiveDuration }) },
    ...inlineParams.map((control) => ({ kind: 'param' as const, label: paramValueLabel(control), key: control.key })),
  ]
  const demotedKeys = new Set(composerDemotedChipKeys(chipDemands, barWidth, {
    dots: switchParams.length > 0,
    generate: Boolean(statusTag) || Boolean(onGenerate),
  }))
  const shownParams = inlineParams.filter((control) => !demotedKeys.has(control.key))
  const demotedParams = inlineParams.filter((control) => demotedKeys.has(control.key))
  // ⋯ 是「装不下的东西的家」：开关本来就住这儿，被挪下来的枚举也住这儿。两者都没有 = 不出这枚钮。
  const hasOverflowHome = switchParams.length > 0 || demotedParams.length > 0
  const dotsRef = React.useRef<HTMLButtonElement>(null)
  const overflowPanelRef = React.useRef<HTMLDivElement>(null)
  // 弹层里有东西被改过 / 被挪下来 → 小圆点。开着的开关和被挪下来的枚举都算「⋯ 里有内容」。
  const overflowDotCount = activeSwitches.length + demotedParams.length
  // 无障碍名要说清「这里面现在是什么」，不能永远一句「更多」——被挪下来的枚举是决定，
  // 用户得能在不打开的情况下知道 `1024x1024` 去哪儿了。
  const overflowSummary = [
    ...demotedParams.map((control) => `${translateModelDisplayText(control.label)} ${paramValueLabel(control)}`),
    ...activeSwitches.map((control) => translateModelDisplayText(control.label)),
  ]
  const overflowAria = overflowSummary.length > 0
    ? t('storyboardEditor.composerBar.overflowAria', { items: overflowSummary.join(' · ') })
    : t('storyboardEditor.composerBar.switchesAria')
  const overflowTitle = overflowSummary.length > 0 ? overflowSummary.join(' · ') : t('storyboardEditor.composerBar.switchesAria')

  // 关弹层（Esc / 点外面）由 `AnchoredPopover` 一处管——这里不再挂第二个 Esc 监听（P1：不留并行版），
  // 只负责关掉之后把焦点还给 ⋯，否则键盘用户会被丢在 body 上。
  const closeOverflow = React.useCallback(() => {
    setSwitchesOpen(false)
    dotsRef.current?.focus()
  }, [])

  return (
    <div
      // ⚠️ 这一条**永远一行**（2026-09-06 用户逐字拍板，见 StoryboardShotRow.structure.test.ts）：
      // 「装不下就整表换两行」试过并被否掉——它把一枚胶囊的溢出换成了全表行高抖动。
      // 2026-09-17 的 W-03（1280 视口下这条带被右缘切掉）分两半：列宽那一半由分镜编辑器的
      // grid 列模板修在根因（见 StoryboardPlanEditor.overflow.test.ts）；剩下「两枚胶囊时
      // 底栏自然宽仍超出」那一半按 09-17 拍板走方案 D——让位有下限、装不下就进 ⋯，
      // 所以这里需要 barRef 量真实可用宽度。
      ref={barRef}
      className="relative flex min-w-0 flex-nowrap items-center gap-1 border-t border-nomi-line-soft px-2 py-1.5"
      data-storyboard-composer-bar="true"
      data-storyboard-composer-demoted={demotedParams.length > 0 ? demotedParams.map((control) => control.key).join(',') : undefined}
    >
      {modelSelectOptions ? (
        <Chip kind="model" minWidth={`${composerModelChipMinWidth(modelChipLabel, modelChipHasIcon)}px`}>
          <NomiSelect
            dropdownAlign="end"
            ariaLabel={isImageShot ? t('storyboardEditor.imageModel') : t('storyboardEditor.videoModel')}
            size="xs"
            triggerMaxWidth={150}
            triggerMinWidth={composerModelChipMinWidth(modelChipLabel, modelChipHasIcon)}
            value={shot.modelKey ? modelSelect.modelValue : ''}
            options={modelSelectOptions}
            onChange={(id) => (id ? modelSelect.onModelPick(id) : onShotModelChange(''))}
            onChipChange={modelSelect.onModelProviderPick}
            footerAction={modelVisibilityFooterAction()}
            hiddenNote={modelSelect.hiddenNote}
          />
        </Chip>
      ) : null}
      {modelSelect.providerOptions.length > 1 ? (
        <Chip kind="provider">
          <NomiSelect
            dropdownAlign="end"
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
        <Chip kind="mode">
          <NomiSelect
            dropdownAlign="end"
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
        <Chip kind="aspect">
          <span className="flex min-w-0 items-center" data-storyboard-aspect-override={aspect}>
            <NomiSelect
              dropdownAlign="end"
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

      <Chip kind="duration">
        <NomiSelect
          dropdownAlign="end"
          ariaLabel={isImageShot ? t('storyboardEditor.row.stayHint') : t('storyboardEditor.duration')}
          size="xs"
          value={String(effectiveDuration)}
          options={durationOptions}
          onChange={(value) => onUpdate({ durationSec: Number(value) })}
        />
      </Chip>

      {shownParams.map((control) => (
        <Chip key={control.key} kind="param">
          <NomiSelect
            dropdownAlign="end"
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

      {/* 行尾 ⋯ = **装不下的东西的家**。原本只住开关（一排同形同色的开关摆在扫视行上读不出差别，
          只剩噪音）；2026-09-17 起，装不下时被挪下来的枚举参数也住这儿——所以弹层里必须是
          **能改值的控件**，不是一张只读清单：挪进来的是决定，不是说明文字。
          开着的开关 / 被挪下来的枚举各用一颗小圆点报信，不然「⋯ 里有东西」这件事没人知道。 */}
      {hasOverflowHome ? (
        <>
          <button
            ref={dotsRef}
            type="button"
            onClick={() => setSwitchesOpen((open) => !open)}
            aria-expanded={switchesOpen}
            aria-haspopup="dialog"
            aria-label={overflowAria}
            title={overflowTitle}
            data-storyboard-composer-switches={shot.index}
            className={cn(
              'relative grid size-6 shrink-0 place-items-center rounded-pill border border-nomi-line text-nomi-ink-60',
              'hover:border-nomi-ink-20 hover:text-nomi-ink-80 focus:outline-none focus-visible:border-nomi-accent',
            )}
          >
            <IconDots size={13} stroke={1.8} aria-hidden />
            {overflowDotCount > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-nomi-accent"
                data-storyboard-composer-switches-on={overflowDotCount}
                aria-hidden
              />
            ) : null}
          </button>
          {switchesOpen ? (
            // Portal 贴锚点，不是原地 absolute：这枚弹层的祖先里有 `overflow-hidden`
            //（行块、编辑器外框），原地 absolute 会被裁成一条边，而 rect / count / toBeVisible
            // 三样证据全都看不出来（见 AnchoredPopover 抬头那段）。里面有下拉和开关 =
            // 多焦点富内容，按那张表该走 AnchoredPopover 而不是 WorkbenchMenu。
            <AnchoredPopover anchorRef={dotsRef} align="end" gap={6} onClose={closeOverflow}>
              <div
                ref={overflowPanelRef}
                role="dialog"
                aria-label={overflowAria}
                data-storyboard-composer-switch-panel={shot.index}
                className="flex min-w-44 flex-col gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-2 shadow-nomi-md"
                onPointerDown={(event) => event.stopPropagation()}
              >
                {demotedParams.map((control) => (
                  // 名字和值**紧挨着**，不把值两端对齐甩到右缘：
                  // 甩到右缘之后，名字和它管的那个值之间隔着一条空白，眼睛要来回扫才配得上对
                  //（2026-09-09 用户拍板的通用规则，`check:tokens` 的「行尾贴边」棘轮盯着它）。
                  <label key={control.key} className="flex items-center gap-2 text-caption text-nomi-ink-60">
                    <span className="min-w-0 truncate">{translateModelDisplayText(control.label)}</span>
                    <NomiSelect
                      ariaLabel={translateModelDisplayText(control.label)}
                      size="xs"
                      value={
                        shot.params?.[control.key] === undefined
                          ? String(control.defaultValue ?? '')
                          : String(shot.params?.[control.key])
                      }
                      options={control.options.map((option) => ({ value: String(option.value), label: translateModelDisplayText(option.label) }))}
                      onChange={(value) => onUpdate({ params: { ...(shot.params ?? {}), [control.key]: value } })}
                    />
                  </label>
                ))}
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
            </AnchoredPopover>
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
            disabled={generating}
            data-storyboard-generate-state={generating ? 'busy' : 'idle'}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-nomi-sm bg-nomi-ink px-2.5 text-micro font-medium text-nomi-paper',
              generating ? 'cursor-default opacity-60' : 'hover:opacity-90 active:opacity-80',
            )}
            aria-label={t('storyboardEditor.frame.generateAria', { index: shot.index })}
            aria-busy={generating}
          >
            {generating ? <IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden /> : null}
            {generating ? t('storyboardEditor.frame.generating') : t('storyboardEditor.frame.generate')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
