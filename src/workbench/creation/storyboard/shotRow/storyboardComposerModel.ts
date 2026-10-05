import type { ModelOption } from '../../../../config/models'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import { buildAgentModelEntries } from '../../../generationCanvas/agent/availableModels'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../../../generationCanvas/agent/plannedNodeMeta'
import { resolveRenderedControls } from '../../../generationCanvas/nodes/nodeModelArchetype'
import { isParameterControl, parseControlInput, type DynamicModelControl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import { aspectRatioControlKey, aspectRatioControlsOf } from '../../../../../electron/shared/aspectRatioValue'

/**
 * 分镜行（镜头 / 参考卡）复用画布节点底栏（`InlineParameterBar`）时的**数据适配层**——只做两件事：
 *
 * ① 「这一行现在是什么参数」→ 画布节点那份 `meta`。不自己拼：走落画布同一个构造器
 *    `buildPlannedNodeMeta`（`projectShotNode` 建节点 / 写回节点也用它），模型清单也按落地那条路
 *    用这一行自己的 (modelKey, vendor) 建。于是面板上显示的 = 这一镜落到画布上发出去的（比例按模式翻成真实键、
 *    没写的参数是档案默认），不会出现「表上一个值、请求里另一个值」。
 * ② 「面板里改了一个控件」→ 写回分镜的哪一个字段。比例有自己的家（行级覆盖 / 锚参数里的语义槽），
 *    视频时长的家是 `durationSec`，其余写进 `params`。
 *
 * 控件长什么样、有几个、怎么摆，一律是 `InlineParameterBar` 的事（与画布节点同一套），这里不管。
 */

export type ComposerTarget = Readonly<{
  modelKey?: string
  modelVendor?: string
  modeId?: string
  /** 这一行**发出去时**携带的参数（镜头 = `resolveShotParams` 合过整片默认的那份；锚 = `anchor.params`）。 */
  params?: Readonly<Record<string, unknown>>
}>

/** 画布节点 meta（与落画布同一个构造器）。没选模型 → 空：不知道是哪个模型就不假装知道它有什么参数。 */
export function storyboardComposerMeta(target: ComposerTarget, kind: 'image' | 'video'): Record<string, unknown> {
  if (!target.modelKey) return {}
  const entries = buildModelEntryIndex(buildAgentModelEntries([
    { value: target.modelKey, label: target.modelKey, ...(target.modelVendor ? { vendor: target.modelVendor } : {}), kind },
  ]))
  return buildPlannedNodeMeta({
    modelKey: target.modelKey,
    ...(target.modelVendor ? { modelVendor: target.modelVendor } : {}),
    ...(target.modeId ? { modeId: target.modeId } : {}),
    params: { ...(target.params ?? {}) },
  }, entries) ?? {}
}

/** 底栏要渲染的控件：画布节点同一个函数（`resolveRenderedControls`）。 */
export function storyboardComposerControls(
  option: ModelOption | null,
  meta: Record<string, unknown>,
  kind: 'image' | 'video',
): DynamicModelControl[] {
  if (!option) return []
  return resolveRenderedControls(option, meta, kind === 'image', kind === 'video')
}

/** 面板里改了一个控件之后，分镜要写的那一处。 */
export type ComposerChange =
  | Readonly<{ kind: 'aspect'; value: string }>
  | Readonly<{ kind: 'duration'; value: number }>
  | Readonly<{ kind: 'param'; key: string; value: string | number | boolean | null }>

/**
 * 控件 → 分镜字段。比例控件按「这个模式唯一的比例控件」判（`aspectRatioControlKey`，落地那一层同一把尺），
 * 不按键名猜：Z-Image 的比例叫 `size`，Agnes 叫 `ratio`。
 */
export function storyboardComposerChange(
  control: Pick<ModelParameterControl, 'key' | 'type' | 'options'>,
  raw: string,
  controls: readonly DynamicModelControl[],
): ComposerChange {
  const ratioKey = aspectRatioControlKey(aspectRatioControlsOf(controls.filter(isParameterControl)))
  if (control.key === ratioKey) return { kind: 'aspect', value: raw }
  const value = control.type ? parseControlInput(control as ModelParameterControl, raw) : raw
  if (control.key === 'duration' && typeof value === 'number') return { kind: 'duration', value }
  return { kind: 'param', key: control.key, value }
}
