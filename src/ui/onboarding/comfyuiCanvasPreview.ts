// 「画布节点预览 · 实时」的视图模型：**这条工作流在生成画布上会长成什么样**（纯函数，可单测）。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 为什么要这块：用户配完绑定，直到回画布点开节点才知道自己配出了什么。中间隔着「保存 → 关设置 →
// 建节点 → 选模型」四步，配错要走完全程才发现（D1：effect-first，先给效果再谈配置）。
// 把画布控件当场画在旁边，改一下就看见一下，配错在原地就看得出来。
//
// 口径必须跟画布一致，否则这块预览就是在骗人：
//  - 首帧/尾帧槽 ⟵ src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts
//    的 buildComfyWorkflowImageUrlSlots（同样只看 binding 的 firstFrame*/lastFrame* 一对是否齐）。
//  - 可调字段 ⟵ 导入时 binding.params 逐条烤成 model.meta.parameters（electron/catalog/
//    comfyuiWorkflowImport.ts buildImportedWorkflow），画布节点底栏按 parameters 渲染控件。
//  - 提示词 ⟵ 绑了提示词节点才有输入框；没绑就是「这条工作流不吃提示词」，画布上也确实没有。
// 改画布那边的口径，这里要同步（两处都指向对方，别只改一处）。
import type { WorkflowBinding, WorkflowParamType } from './comfyuiWorkflowBinding'

/** 画布上一个可填控件的类型。media 槽 = 拖图/拖视频的方框，不是输入框。 */
export type PreviewFieldKind = 'prompt' | 'image' | 'video' | WorkflowParamType

export type PreviewField = {
  /** 稳定 key（React key + 走查定位）。角色槽用角色名，可调字段用 paramKey。 */
  key: string
  kind: PreviewFieldKind
  /** 角色槽的文案由渲染层按 kind 取 i18n；可调字段用用户自己起的 label（已是他的语言）。 */
  labelKey?: string
  label?: string
  defaultValue?: string | number | boolean
  /** 这个控件由哪个节点的哪个输入来的——预览里标出来，改绑时能一眼对上图上哪张卡。 */
  nodeId: string
  inputKey?: string
  /** combo 参数在画布是真实文件下拉（enumOptions 随导入烤进控件）；这里同样给下拉，别假装是自由输入框。 */
  options?: string[]
}

export type EnumOption = { classType: string; inputKey: string; options: string[] }

export type CanvasPreview = {
  fields: PreviewField[]
  /** 没有任何控件 = 画布上这个节点只有一个「生成」钮。空态要说清，不是留白。 */
  isEmpty: boolean
}

/** 参数 → 本机 combo 可选值（按 classType+inputKey 对齐，和导入时烤进控件的口径一致）。 */
function optionsFor(
  enumOptions: readonly EnumOption[] | undefined,
  classTypeByNodeId: ReadonlyMap<string, string>,
  nodeId: string,
  inputKey: string,
): string[] | undefined {
  if (!enumOptions?.length) return undefined
  const classType = classTypeByNodeId.get(nodeId)
  if (!classType) return undefined
  const matched = enumOptions.find((e) => e.classType === classType && e.inputKey === inputKey)
  return matched?.options.length ? matched.options : undefined
}

/**
 * binding（+ 本机 combo 可选值）→ 画布上会出现的控件清单。
 * 顺序固定：提示词 → 源视频 → 首帧 → 尾帧 → 可调字段（按用户添加顺序）。
 * 固定顺序是为了让「改一处」只让那一处动，别整列重排——重排会让人以为改坏了别的东西。
 */
export function buildCanvasPreview(
  binding: WorkflowBinding | null,
  input: {
    classTypeByNodeId?: ReadonlyMap<string, string>
    enumOptions?: readonly EnumOption[]
  } = {},
): CanvasPreview {
  const fields: PreviewField[] = []
  if (!binding) return { fields, isEmpty: true }
  const classTypeByNodeId = input.classTypeByNodeId ?? new Map<string, string>()

  if (binding.promptNodeId && binding.promptInputKey) {
    fields.push({
      key: 'prompt',
      kind: 'prompt',
      labelKey: 'prompt',
      nodeId: binding.promptNodeId,
      inputKey: binding.promptInputKey,
    })
  }
  if (binding.sourceVideoNodeId && binding.sourceVideoInputKey) {
    fields.push({
      key: 'sourceVideo',
      kind: 'video',
      labelKey: 'sourceVideo',
      nodeId: binding.sourceVideoNodeId,
      inputKey: binding.sourceVideoInputKey,
    })
  }
  // 首帧/尾帧：**节点 + 输入键成对齐了**才算绑上（与画布 buildComfyWorkflowImageUrlSlots 同判据）。
  if (binding.firstFrameNodeId && binding.firstFrameInputKey) {
    fields.push({
      key: 'firstFrame',
      kind: 'image',
      labelKey: 'firstFrame',
      nodeId: binding.firstFrameNodeId,
      inputKey: binding.firstFrameInputKey,
    })
  }
  if (binding.lastFrameNodeId && binding.lastFrameInputKey) {
    fields.push({
      key: 'lastFrame',
      kind: 'image',
      labelKey: 'lastFrame',
      nodeId: binding.lastFrameNodeId,
      inputKey: binding.lastFrameInputKey,
    })
  }
  for (const param of binding.params ?? []) {
    fields.push({
      key: param.paramKey,
      kind: param.type,
      label: param.label,
      defaultValue: param.default,
      nodeId: param.nodeId,
      inputKey: param.inputKey,
      options: optionsFor(input.enumOptions, classTypeByNodeId, param.nodeId, param.inputKey),
    })
  }

  return { fields, isEmpty: fields.length === 0 }
}

/** 预览里填的值 → 试跑请求的 extras（paramKey 直接当 key，与 {{request.params.X}} 的解析口径一致）。 */
export function previewValuesToExtras(
  fields: readonly PreviewField[],
  values: Readonly<Record<string, string>>,
): Record<string, string | number | boolean> {
  const extras: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    if (field.kind === 'prompt' || field.kind === 'image' || field.kind === 'video') continue
    const raw = values[field.key]
    const value = typeof raw === 'string' ? raw : undefined
    if (value === undefined || value === '') {
      if (typeof field.defaultValue !== 'undefined') extras[field.key] = field.defaultValue
      continue
    }
    if (field.kind === 'number') {
      const parsed = Number(value)
      // 数字框里打了非数字：退回默认值而不是把 NaN 发出去（NaN 进 JSON 会变 null，ComfyUI 直接 400）。
      extras[field.key] = Number.isFinite(parsed) ? parsed : (field.defaultValue ?? 0)
      continue
    }
    if (field.kind === 'boolean') {
      extras[field.key] = value === 'true'
      continue
    }
    extras[field.key] = value
  }
  return extras
}
