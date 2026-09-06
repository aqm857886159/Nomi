// 设计实验室 · 供应商偏好屏的取景台。
//
// 这一屏要看的东西**是浮层里的内容**：模型下拉展开后那几行长什么样（模型名有没有被挤没、
// 供应商 chip 排第几个、未配置那一组沉在哪里）。所以取景台做两件事：
//   1. 把 `NomiSelect` 的浮层 portal 目标钉在舞台里（`portalTarget`），浮层就不会飞到 body 上、
//      截图也不用改成截整屏；
//   2. 挂载后**真的点一下触发钮**把浮层打开——不是自己另画一份下拉。另画一份就等于第二个实现，
//      改了生产代码这里照样绿，正是实验室要消灭的那种假证据。
//
// 选项由现役的那条链现算：`keepRunnableVendorOptions`（catalog 层唯一那道「这家能不能跑」的闸）
// → `dedupeModelOptions` → `buildModelSelectOptions`。三个都是真机下拉跑的同一份函数，
// 「没接入的不出现、几家折成一行、chip 排序、一家都没有时的空态」全在它们里面。夹具只决定目录内容。
import React from 'react'

import { NomiSelect } from '../../../design'
import { dedupeModelOptions } from '../../../config/modelIdentity'
import { keepRunnableVendorOptions } from '../../../config/modelCatalogCache'
import { buildModelSelectOptions } from '../../../workbench/common/useDedupedModelSelect'
import type { ModelOption } from '../../../config/models'

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
 * @param runnableVendorKeys  已接入的供应商 key（真机上由 catalog 的 getRunnableVendorKeys 算出）
 * @param preferredVendorKeys 用户在「设置 → AI 策略 → 优先供应商」排出来的顺序；空数组 = 没设过
 */
export function ModelPickerStage({
  models,
  runnableVendorKeys,
  preferredVendorKeys = [],
  selected = '',
}: {
  models: readonly ModelOption[]
  runnableVendorKeys: ReadonlySet<string>
  preferredVendorKeys?: readonly string[]
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
      dedupeModelOptions(keepRunnableVendorOptions(models, runnableVendorKeys)),
      NEVER_AILING,
      preferredVendorKeys,
    ),
    [models, runnableVendorKeys, preferredVendorKeys],
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
        portalTarget={stageRef}
      />
    </div>
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
