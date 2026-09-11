// 设计实验室 · 供应商偏好屏的取景台。
//
// 这一屏要看的东西**是浮层里的内容**：模型下拉展开后那几行长什么样（模型名有没有被挤没、
// 供应商 chip 排第几个、未配置那一组沉在哪里）。所以取景台做两件事：
//   1. 把 `NomiSelect` 的浮层 portal 目标钉在舞台里（`portalTarget`），浮层就不会飞到 body 上、
//      截图也不用改成截整屏；
//   2. 挂载后**真的点一下触发钮**把浮层打开——不是自己另画一份下拉。另画一份就等于第二个实现，
//      改了生产代码这里照样绿，正是实验室要消灭的那种假证据。
//
// 选项由现役的那条链现算：`dedupeModelOptions` → `buildModelSelectOptions`。两个都是真机下拉跑的
// 同一份函数，「几家折成一行、chip 排序、一家都没有时的空态」全在它们里面。
// 「这个模型能不能用」不在这一层——它由主进程算好随行下发、在 `modelCatalogCache` 进入渲染层的
// 第一处就把不可用的行滤掉了（证据 `modelCatalogCache.test.ts`）。所以本取景台收到的
// `models` 永远是「目录层已放行的选项」，夹具用 `onlyFromVendors` 喂成那个样子。
import React from 'react'

import { NomiSelect } from '../../../design'
import { dedupeModelOptions } from '../../../config/modelIdentity'
import { seedModelCatalogForTests } from '../../../config/modelCatalogCache'
import { ModelBoxOrderSection } from '../../../workbench/settings/ModelBoxOrderSection'
import { seedModelBoxPreferenceForLab } from '../../../workbench/common/useModelBoxPreference'
import { buildModelSelectOptions, modelBoxHiddenNote } from '../../../workbench/common/useDedupedModelSelect'
import { partitionByModelBoxPreference } from '../../../config/modelBoxPreference'
import type { ModelOption } from '../../../config/models'
import type { ModelBoxPreferenceSettings } from '../../../../electron/shared/contracts/modelBoxPreference'

/** 舞台宽度：比画布节点的参数条宽一点，让下拉自然展开的宽度看得完整。 */
export const STAGE_WIDTH = 460
/**
 * 舞台高度：要装得下展开后的浮层，否则按元素截图会把下拉**悄悄截掉半截**。
 * 现在最高的一格（3 行 + chip）约 200px；留到 320 有余量，
 * 又不至于让接触表里每一格都是大半空白。真被撑破了走查会红——它逐格量过浮层是否落在舞台里。
 */
export const STAGE_HEIGHT = 320

const NEVER_AILING = (): false => false

/**
 * 展开态的模型下拉。
 *
 * @param models              这一格的**整份**目录（含没接入的家；筛不筛由生产代码说了算）
 * @param preferredVendorKeys 用户在「设置 → AI 策略 → 优先供应商」排出来的顺序；空数组 = 没设过
 * @param modelBoxPreference  「显示哪些 / 排在哪 / 记住哪家」那张表；缺省 = 没排过没藏过没记过
 */
export function ModelPickerStage({
  models,
  preferredVendorKeys = [],
  modelBoxPreference = null,
  selected = '',
}: {
  models: readonly ModelOption[]
  preferredVendorKeys?: readonly string[]
  modelBoxPreference?: ModelBoxPreferenceSettings | null
  selected?: string
}): JSX.Element {
  const stageRef = React.useRef<HTMLDivElement>(null)
  // 选中值是**真状态**：实验室里点一行就真的选中，和真机一个行为。
  // 挂个空 handler 会让这个下拉点下去静默无效（`check:controls` 拦的正是这一族），
  // 而且取景台自己变成「看着能点、其实是张图」——那就又是一份骗人的证据。
  const [picked, setPicked] = React.useState(selected)
  React.useEffect(() => { setPicked(selected) }, [selected])
  const options = React.useMemo(
    () => buildModelSelectOptions(
      dedupeModelOptions([...models]),
      NEVER_AILING,
      preferredVendorKeys,
      modelBoxPreference,
    ),
    [models, preferredVendorKeys, modelBoxPreference],
  )
  // 脚注的条数也由**生产那份**判据算（同一个 partition 函数），不是夹具里写死一个「2」。
  const hiddenNote = React.useMemo(
    () => modelBoxHiddenNote(partitionByModelBoxPreference(
      dedupeModelOptions([...models]),
      modelBoxPreference,
    ).hidden.length),
    [models, modelBoxPreference],
  )
  // 浮层的 portal 目标必须在首帧就拿得到，所以先渲染一帧再点——`useLayoutEffect` 里
  // ref 已经指向真实节点，点击同一帧内完成，`markReady` 的两帧 rAF 之后浮层早就定好位了。
  React.useLayoutEffect(() => {
    stageRef.current?.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
  }, [])
  return (
    <div
      ref={stageRef}
      data-design-lab-stage="picker"
      className="relative rounded-nomi border border-nomi-line bg-nomi-bg p-3"
      style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
    >
      <NomiSelect
        ariaLabel="模型"
        placeholder="选择模型"
        triggerMaxWidth={150}
        value={picked}
        options={options}
        onChange={setPicked}
        // 点 chip = 换这一行走哪家。真机把 (modelKey, vendor) 一起写进节点；实验室没有节点可写，
        // 但仍要**真的**改选中值，否则这个 chip 就是个点不动的装饰。
        onChipChange={(optionValue) => setPicked(optionValue)}
        hiddenNote={hiddenNote}
        portalTarget={stageRef}
      />
    </div>
  )
}

const LAB_CATALOG_HEALTH = {
  ok: true,
  counts: { vendors: 2, enabledVendors: 2, models: 8, enabledModels: 8, mappings: 8, enabledMappings: 8, enabledApiKeys: 2 },
  byKind: [{ kind: 'image' as const, enabledModels: 8, executableModels: 8 }],
  issues: [],
}

/**
 * 「模型框里显示哪些、排在哪」设置区的取景台。
 *
 * 两处种子都只替掉**最外面那一次取数**（目录 / 偏好），从那往下是现役代码：
 * `useModelOptionsState` → `dedupeModelOptions` → `buildModelBoxRows` →
 * 真的 `ModelBoxOrderSection`。屏上任何一行的位置、哪个标签是蓝的、哪两个落进「已隐藏」，
 * 都是生产代码算出来的，不是这里摆出来的。
 */
export function ModelBoxSettingsStage({
  preference,
  models,
}: {
  preference: ModelBoxPreferenceSettings
  models: readonly ModelOption[]
}): JSX.Element {
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    seedModelCatalogForTests(LAB_CATALOG_HEALTH, [{ kind: 'image', requiredMode: 'text_to_image', options: models }])
    seedModelBoxPreferenceForLab(preference)
    setReady(true)
  }, [models, preference])
  return (
    <SettingsStage>{ready ? <ModelBoxOrderSection /> : null}</SettingsStage>
  )
}

/** 设置区的取景框：与设置弹窗内容区同宽，高度随内容——排序控件不该被拉到满屏高。 */
export function SettingsStage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      data-design-lab-stage="settings"
      className="rounded-nomi border border-nomi-line bg-nomi-paper p-4 text-nomi-ink"
      style={{ width: STAGE_WIDTH }}
    >
      {children}
    </div>
  )
}
