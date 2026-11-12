import { constrainParameterControls } from '../../../../electron/shared/videoCapabilities/crossFieldConstraints'
// NodeParameterControls 的模型/档案派生纯函数。
// 从 NodeParameterControls.tsx 抽出，供组件、InlineParameterBar、useNodeModelAutoSelect 共用（单一来源）。
import type { ModelOption } from '../../../config/models'
import { parseModelParameterControls } from '../../../config/modelCatalogMeta'
import {
  type DynamicModelControl,
  buildDynamicControls,
  buildEffectiveImageCatalogConfig,
  buildEffectiveVideoCatalogConfig,
} from './controls/parameterControlModel'
import { specializeArchetypeForVariant } from '../../../../electron/shared/modelArchetypes'
import {
  archetypeModeById,
  archetypeModeParams,
  currentArchetypeVariant,
  effectiveArchetypeMode,
  resolveArchetypeForModel,
  type ModeGraph,
} from './controls/archetypeMeta'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { isModelRecentlyAiling } from '../runner/modelHealthMemory'
import { usesExplicitParameterReferenceDeclarations } from '../model/parameterReferenceSlots'

export function chooseDefaultModelOption(
  options: readonly ModelOption[],
  isImageLike: boolean,
  isVideoLike: boolean,
): ModelOption | undefined {
  void isImageLike
  void isVideoLike
  // 优先选「认得的模型」（有内置档案 = 带真实模板参数，徽标「模板」）作默认，
  // 而不是盲取 options[0]。否则目录里排第一的可能是用户自接入、未识别的「通用」模型
  // （如 gemini-omni-video），图片节点一打开默认就是它、看不到 Seedream/nano-banana 等
  //真正的图片模型，给人「选不到图片模型」的错觉（修①，根因：默认选择没挑「好」的）。
  // 同时跳过「图生图/编辑」类（空节点默认它 = 没参考图就不能生成，生成钮一直灰）——
  // 新建空节点该默认到「文生图/文生视频」这类无需参考就能直接生成的模型。
  const needsReference = (option: ModelOption): boolean =>
    /image-to-image|img2img|i2i|image2video|edit|inpaint/i.test(
      `${option.value} ${option.modelKey || ''} ${option.modelAlias || ''}`,
    )
  const recognized = options.filter((option) => Boolean(resolveArchetypeForOption(option)))
  const runnable = recognized.filter((option) => !needsReference(option))
  // 健康避让（modelHealthMemory）：近 24h 连败 ≥2 的模型让出「自动默认」位——上游挂掉的模型
  // 不再霸占默认让新节点必死（2026-07-29 批量体检根治）。只影响自动默认（手动选择不拦）；
  // 全部候选都在避让期 → 回退原序，绝不空选。
  return (
    runnable.find((option) => !isModelRecentlyAiling({ modelKey: option.modelKey || option.value, vendor: option.vendor })) ||
    runnable[0] ||
    recognized[0] ||
    options[0]
  )
}

export function resolveArchetypeForOption(option: ModelOption | null) {
  return resolveArchetypeForModel({
    modelKey: option?.modelKey,
    modelAlias: option?.modelAlias,
    vendorKey: option?.vendor,
    meta: option?.meta,
    ...(option?.modelNameSource ? { modelNameSource: option.modelNameSource } : {}),
  })
}

/**
 * 算参数要按哪种方式：节点在画布上（连线也是输入）就给出节点和画布；不给只按 meta 里节点自己的上传算。
 * 分镜行 / 参考卡还没落到画布、没有输入可算，参数按方案里写明的方式（`plannedModeId`）；落地后由画布按输入现算。
 */
export type RenderedControlsContext =
  | { node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>; graph: ModeGraph }
  | { plannedModeId: string | undefined }

/**
 * 底部参数行要渲染的控件 —— 认得档案的模型用**这次按输入现算出的方式**的标量参数（随模式变，如 HappyHorse
 * i2v 无比例）；认不出的走现有 flat catalog 解析。hook 与组件共用此函数，保证「算宽度」与「实际渲染」
 * 一致（单一来源）。
 */
export function resolveRenderedControls(
  option: ModelOption | null,
  meta: Record<string, unknown>,
  isImageLike: boolean,
  isVideoLike: boolean,
  context?: RenderedControlsContext,
): DynamicModelControl[] {
  const archetype = resolveArchetypeForOption(option)
  if (archetype) {
    // 变体特化：选中变体可能收窄某 mode 的参数（如 Seedance fast 的 resolution 仅 480/720）。
    // 收窄发生在 params 这层，故先按 variantId 特化档案再取当前模式的 params。
    const specialized = specializeArchetypeForVariant(archetype, currentArchetypeVariant(archetype, meta)?.id)
    const mode = context && 'plannedModeId' in context
      ? archetypeModeById(specialized, context.plannedModeId)
      : effectiveArchetypeMode(specialized, context?.node ?? { id: '', meta, kind: isVideoLike ? 'video' : 'image' }, context?.graph ?? { nodes: [], edges: [] }).mode
    return localizeDynamicControls(
      buildDynamicControls({
        parameterControls: constrainParameterControls(archetypeModeParams(mode), meta),
        imageCatalogConfig: null,
        videoCatalogConfig: null,
        isImageLike,
        isVideoLike,
      }),
    )
  }
  return localizeDynamicControls(
    buildDynamicControls({
      parameterControls: parseModelParameterControls(option?.meta),
      imageCatalogConfig: buildEffectiveImageCatalogConfig(option?.meta),
      videoCatalogConfig: buildEffectiveVideoCatalogConfig(option?.meta),
      isImageLike,
      isVideoLike,
      explicitMediaParametersOnly: usesExplicitParameterReferenceDeclarations(option?.meta, option?.vendor),
    }),
  )
}

function localizeDynamicControls(controls: DynamicModelControl[]): DynamicModelControl[] {
  return controls.map((control): DynamicModelControl => {
    if ('type' in control) {
      return {
        ...control,
        label: translateModelDisplayText(control.label),
        ...(control.placeholder ? { placeholder: translateModelDisplayText(control.placeholder) } : {}),
        options: control.options.map((option) => ({
          ...option,
          label: translateModelDisplayText(option.label),
        })),
      }
    }
    return {
      ...control,
      label: translateModelDisplayText(control.label),
      options: control.options.map((option) =>
        typeof option === 'string'
          ? translateModelDisplayText(option)
          : { ...option, label: translateModelDisplayText(option.label) },
      ),
    }
  })
}
