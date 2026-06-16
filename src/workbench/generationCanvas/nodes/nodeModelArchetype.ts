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
import { specializeArchetypeForVariant } from '../../../config/modelArchetypes'
import {
  archetypeModeParams,
  currentArchetypeMode,
  currentArchetypeVariant,
  resolveArchetypeForModel,
} from './controls/archetypeMeta'

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
    /image-to-image|img2img|i2i|image2video|edit|inpaint/i.test(`${option.value} ${option.modelKey || ''} ${option.modelAlias || ''}`)
  const recognized = options.filter((option) => Boolean(resolveArchetypeForOption(option)))
  return recognized.find((option) => !needsReference(option)) || recognized[0] || options[0]
}

export function resolveArchetypeForOption(option: ModelOption | null) {
  return resolveArchetypeForModel({ modelKey: option?.modelKey, modelAlias: option?.modelAlias, vendorKey: option?.vendor, meta: option?.meta })
}

/**
 * 底部参数行要渲染的控件 —— 认得档案的模型用**当前模式**的标量参数（随模式变，如 HappyHorse
 * i2v 无比例）；认不出的走现有 flat catalog 解析。hook 与组件共用此函数，保证「算宽度」与「实际渲染」
 * 一致（单一来源）。
 */
export function resolveRenderedControls(
  option: ModelOption | null,
  meta: Record<string, unknown>,
  isImageLike: boolean,
  isVideoLike: boolean,
): DynamicModelControl[] {
  const archetype = resolveArchetypeForOption(option)
  if (archetype) {
    // 变体特化：选中变体可能收窄某 mode 的参数（如 Seedance fast 的 resolution 仅 480/720）。
    // 收窄发生在 params 这层，故先按 variantId 特化档案再取当前模式的 params。
    const specialized = specializeArchetypeForVariant(archetype, currentArchetypeVariant(archetype, meta)?.id)
    return buildDynamicControls({
      parameterControls: archetypeModeParams(currentArchetypeMode(specialized, meta)),
      imageCatalogConfig: null,
      videoCatalogConfig: null,
      isImageLike,
      isVideoLike,
    })
  }
  return buildDynamicControls({
    parameterControls: parseModelParameterControls(option?.meta),
    imageCatalogConfig: buildEffectiveImageCatalogConfig(option?.meta),
    videoCatalogConfig: buildEffectiveVideoCatalogConfig(option?.meta),
    isImageLike,
    isVideoLike,
  })
}
