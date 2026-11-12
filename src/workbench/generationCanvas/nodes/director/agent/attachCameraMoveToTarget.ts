/**
 * [INPUT]: 依赖 ../../../model/generationCanvasTypes 的 GenerationCanvasNode、../../../agent/referenceEdgeCapability（archetypeForNode / findVideoRefMode）、
 *          ../../controls/archetypeMeta（sendArchetypeMode / readArchetypeArray / orderedSentMediaReferenceUrls：现算方式与实际发送的参考顺序）、
 *          ../../../model/generationNodeKinds 的 isVideoLikeGenerationNodeKind、electron/shared/storyboard/promptMentions 的 encodeMention、
 *          ./cameraMoveVocab（CAMERA_MOVE_LABEL / CAMERA_MOVE_DESC）、../../../../../i18n
 * [OUTPUT]: 对外提供 CAMERA_MOVE_ATTACHED_URL_KEY、lastAttachedCameraMoveUrl（网址标记的只读口，只给删参考判断）、AttachCameraMoveOutcome、AttachCameraMoveContext、AttachPreviewDirective、computeAttachCameraMove
 * [POS]: director/agent 的「运镜小片 / 3D-BOX 预演 mp4 → 目标镜头视频节点」纯核：吃目标节点的 meta / prompt / kind + 新 mp4 + 画布连线上的视频，
 *        算出要 patch 什么 + 给用户什么提示，不碰 store。**生产代码只经 attachCameraMoveForNode 调它**（attachDoors.guard.test.ts 守）。
 *        「已经挂好」按当前现状判（当前模型实际有哪些参考槽、实际发送的参考列表、网址、提示词里的引用）：完全一致 → noop，否则重算；
 *        网址标记 cameraMoveAttachedUrl 只用来认出上一次挂的是哪一条（换片时摘旧的），不当「已挂好」的凭据。
 *        有 video_ref 槽 → 切模式填参考视频 + 一句参考句，句里用 @[asset:url] 引用标记，发送时按实际发送顺序投影成 @videoN（编号永远对得上，不写死）；
 *        槽被用户的片占满或没有槽 → 不删用户的参考，预演逐镜运镜写成文字兜底（运镜小片补 prompt 地板）并明说精度低。
 *        3D-BOX 整段预演也走这一个核：第三个参数传 AttachPreviewDirective——有槽时另把动作库缺的细节动作写进提示词；预演的提示词块带标记，换修订时整块替换。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import i18n from '../../../../../i18n'
import { encodeMention } from '../../../../../../electron/shared/storyboard/promptMentions'
import { archetypeForNode, findVideoRefMode } from '../../../agent/referenceEdgeCapability'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { isVideoLikeGenerationNodeKind } from '../../../model/generationNodeKinds'
import { orderedSentMediaReferenceUrls, readArchetypeArray, sendArchetypeMode } from '../../controls/archetypeMeta'
import { CAMERA_MOVE_DESC, CAMERA_MOVE_LABEL } from './cameraMoveVocab'
import type { CameraMove } from '../../../../../../electron/shared/director/vocab'
import { clearDirectorPreviewDismissed } from './directorPreviewReferenceLifecycle'
export { DIRECTOR_PREVIEW_DISMISSED_URL_KEY } from './directorPreviewReferenceLifecycle'

/** 目标节点里记「当前已附的运镜 mp4」的 meta 键（替换判据） */
export const CAMERA_MOVE_ATTACHED_URL_KEY = 'cameraMoveAttachedUrl'

export type AttachCameraMoveOutcome =
  | { kind: 'noop'; toast?: { message: string; level: 'warning' } }
  | { kind: 'patch'; patch: { meta: Record<string, unknown>; prompt?: string }; toast?: { message: string; level: 'warning' }; mode: 'video_ref' | 'prompt_only' }

/** 运镜 prompt 地板（通用，全供应商可用）：人话点出该镜的运镜，作为不吃视频参考时的降级 */
function cameraMoveDirective(move: CameraMove | undefined): string {
  if (!move) return ''
  return `\n镜头运动：${CAMERA_MOVE_LABEL[move]}（${CAMERA_MOVE_DESC[move]}）`
}

function readAttachedUrl(meta: Record<string, unknown>): string {
  const value = meta[CAMERA_MOVE_ATTACHED_URL_KEY]
  return typeof value === 'string' ? value : ''
}

/** 网址标记的唯一对外读口：本核上一次挂上去的是哪条。只给删参考认「删的是不是挂着的那份预演」，不当「已挂好」的凭据（attachDoors.guard.test.ts 守调用方）。 */
export function lastAttachedCameraMoveUrl(target: Pick<GenerationCanvasNode, 'meta'>): string {
  return readAttachedUrl(target.meta || {})
}

/** 3D-BOX 整段预演：逐镜实测（文字兜底用）+ 动作库缺的细节动作（交给视频模型）。 */
export type AttachPreviewDirective = Readonly<{
  kind: 'preview'
  cuts: readonly Readonly<{ start: number; end: number; shotSize: string | null; move: string }>[]
  notes: readonly string[]
}>

/** 预演写进提示词的两行都带标记：换修订时整块替换，不叠旧文字。 */
const PREVIEW_CAMERA_MARK = '3D-BOX 预演运镜：'
const PREVIEW_ACTION_MARK = '3D-BOX 动作细节：'

export function withoutPreviewLines(prompt: string): string {
  return prompt.split('\n').filter((line) => !line.startsWith(PREVIEW_CAMERA_MARK) && !line.startsWith(PREVIEW_ACTION_MARK)).join('\n')
}

function previewCameraLine(directive: AttachPreviewDirective): string {
  const parts = directive.cuts.map((cut, index) =>
    `镜头${index + 1}（${cut.start.toFixed(1)}–${cut.end.toFixed(1)} 秒）${cut.shotSize ? `${cut.shotSize}，` : ''}${CAMERA_MOVE_LABEL[cut.move] ?? cut.move}`)
  return parts.length ? `\n${PREVIEW_CAMERA_MARK}${parts.join('；')}` : ''
}

function previewActionLine(directive: AttachPreviewDirective): string {
  return directive.notes.length ? `\n${PREVIEW_ACTION_MARK}${directive.notes.join('；')}` : ''
}

/** 核之外的上下文：画布上此刻连到目标镜头的视频边（连线排在上传之前，决定预演在实际发送列表里排第几）。 */
export type AttachCameraMoveContext = Readonly<{ edgeVideoUrls?: readonly string[] }>

/** 运镜参考句：用 @[asset:url] 引用标记，发送时按**实际发送顺序**投影成 @videoN（promptMentions，编号规则唯一 owner）。 */
const VIDEO_DIRECTIVE_TAIL = '跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。'
const VIDEO_DIRECTIVE_MARK = '跟随这段参考视频的运镜（只参考镜头运动'

function videoDirectiveLine(url: string): string {
  return `\n${encodeMention(url)} ${VIDEO_DIRECTIVE_TAIL}`
}

/** 去掉本核写过的参考句（含旧版写死 @Video1 的那一句）：换片 / 换槽后整句重写，不叠加、不留指向空气的引用。 */
export function withoutVideoDirective(prompt: string): string {
  return prompt.split('\n').filter((line) => !line.includes(VIDEO_DIRECTIVE_MARK)).join('\n')
}

/** 两份 meta 逐键比较（值按 JSON 比）：只用来判「这一挂和现状完全一样」，一样就不写。 */
function sameMeta(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
  return true
}

/**
 * 花钱闸用：预演在这个镜头上的**挂接是不是当前的**——只看模式与参考列表（meta），不看提示词：
 * 用户自己改提示词不该挡花钱。核算出来「什么都不用写」或「只差提示词」= 当前；还要改模式 / 参考 = 不是当前（要再点出成片）。
 */
export function previewAttachIsCurrent(target: GenerationCanvasNode | undefined, mp4Url: string, directive: AttachPreviewDirective, context: AttachCameraMoveContext = {}): boolean {
  const outcome = computeAttachCameraMove(target, mp4Url, directive, context)
  return outcome.kind === 'noop' || sameMeta(outcome.patch.meta, { ...(target?.meta || {}) } as Record<string, unknown>)
}

const REFERENCE_VIDEOS_KEY = 'referenceVideoUrls'

/**
 * 挂不上参考视频（模型没有槽 / 槽被用户的片占满）时的兜底：预演 → 逐镜运镜写成文字；运镜小片 → 运镜 prompt 地板。
 * 本核上一次挂的那条旧预演从参考列表里摘掉（它是我们的，不是用户的）；用户自己的参考一条不动。
 */
function promptOnlyOutcome(
  target: GenerationCanvasNode,
  meta: Record<string, unknown>,
  url: string,
  prevAttached: string,
  preview: AttachPreviewDirective | null,
  move: CameraMove | undefined,
  toastMessage: string | null,
): AttachCameraMoveOutcome {
  const rawPrompt = typeof target.prompt === 'string' ? target.prompt : ''
  const basePrompt = withoutVideoDirective(preview ? withoutPreviewLines(rawPrompt) : rawPrompt)
  let prompt: string
  if (preview) {
    prompt = `${basePrompt}${previewCameraLine(preview)}${previewActionLine(preview)}`
  } else {
    const floor = cameraMoveDirective(move)
    if (!floor) return { kind: 'noop' }
    prompt = basePrompt.includes('镜头运动：') ? basePrompt : `${basePrompt}${floor}`
  }
  const nextMeta: Record<string, unknown> = clearDirectorPreviewDismissed({ ...meta, [CAMERA_MOVE_ATTACHED_URL_KEY]: url })
  const existing = readArchetypeArray(meta, REFERENCE_VIDEOS_KEY)
  if (prevAttached && prevAttached !== url && existing.includes(prevAttached)) nextMeta[REFERENCE_VIDEOS_KEY] = existing.filter((item) => item !== prevAttached)
  const toast = toastMessage ? { message: toastMessage, level: 'warning' as const } : undefined
  // 和现状一模一样 = 已经是这个样子，不再写（连点不漂移）；限制仍然成立，提示照给
  if (prompt === rawPrompt && sameMeta(nextMeta, meta)) return { kind: 'noop', ...(toast ? { toast } : {}) }
  return { kind: 'patch', mode: 'prompt_only', patch: { meta: nextMeta, prompt }, ...(toast ? { toast } : {}) }
}

/**
 * 判断「这段预演 / 运镜小片此刻在目标镜头上是不是已经正确挂着」——判据是当前模型**实际**有哪些参考槽、当前参考列表（画布连线 + 上传，
 * 与发送同一个有序合并）、网址、提示词里的引用，**不是**「上次记过这个网址」。网址标记 cameraMoveAttachedUrl 只用来认出
 * 「上一次挂的是哪一条」（换片时摘掉旧的），不再充当「已经挂好」的凭据：换模型、手动删参考、切走模式之后标记都还在。
 * 已经正确 → noop；否则算出要写什么。上层调用方不许自己看标记早退，也不许绕开本核直接写参考（attachDoors.guard.test.ts 守）。
 */
export function computeAttachCameraMove(
  target: GenerationCanvasNode | undefined,
  mp4Url: string,
  directive: CameraMove | undefined | AttachPreviewDirective,
  context: AttachCameraMoveContext = {},
): AttachCameraMoveOutcome {
  const preview = typeof directive === 'object' && directive !== null ? directive : null
  const move = preview ? undefined : (directive as CameraMove | undefined)
  if (!target) return { kind: 'noop' }
  // 运镜参考只能喂视频生成节点：指到图片节点没有 video_ref 槽，诚实跳过并提示
  if (!isVideoLikeGenerationNodeKind(target.kind)) {
    return { kind: 'noop', toast: { message: i18n.t('director.agent.videoTargetRequired'), level: 'warning' } }
  }
  const meta = { ...(target.meta || {}) } as Record<string, unknown>
  const url = mp4Url.trim()
  if (!url) return { kind: 'noop' }
  const prevAttached = readAttachedUrl(meta)

  const archetype = archetypeForNode(target)
  const videoRef = findVideoRefMode(archetype)
  if (archetype && videoRef) {
    // 放进参考视频之后方式按输入现算（不再写方式进节点）；旧的首 / 尾帧在现算出的方式里没有格子 → 会在投影时被丢，要明说
    const hadFirstOrLast =
      (typeof meta.firstFrameUrl === 'string' && meta.firstFrameUrl.trim().length > 0) ||
      (typeof meta.lastFrameUrl === 'string' && meta.lastFrameUrl.trim().length > 0)
    const existing = readArchetypeArray(meta, videoRef.metaKey)
    // 替换语义：上次那条（若与这次不同）剔掉；这次的若已在就**留在原位**（重复挂不挪位置），不在就追加；用户的其它参考视频一条不删
    const kept = existing.filter((item) => item !== prevAttached || item === url)
    const referenceVideoUrls = kept.includes(url) ? kept : [...kept, url]
    const nextMeta = clearDirectorPreviewDismissed({ ...meta, [videoRef.metaKey]: referenceVideoUrls, [CAMERA_MOVE_ATTACHED_URL_KEY]: url })
    // 它在**实际发送**的参考视频列表里排第几：连线在前、上传在后、去重、按槽上限截断——和 buildArchetypeInputParams 同一个函数
    const targetMode = sendArchetypeMode(archetype, { ...target, meta: nextMeta })
    const sentVideos = orderedSentMediaReferenceUrls(nextMeta, targetMode, { video: context.edgeVideoUrls ?? [] }).filter((item) => item.kind === 'video')
    if (!sentVideos.some((item) => item.url === url)) {
      // 槽被用户的片占满：不删用户的任何参考（不靠删它们「修好」编号），预演退成文字兜底并明说
      return promptOnlyOutcome(target, meta, url, prevAttached, preview, move, i18n.t('director.agent.previewReferenceFull'))
    }
    const targetHasFrameSlot = targetMode.slots.some((slot) => slot.kind === 'first_frame' || slot.kind === 'last_frame')
    const rawPrompt = typeof target.prompt === 'string' ? target.prompt : ''
    const basePrompt = withoutVideoDirective(preview ? withoutPreviewLines(rawPrompt) : rawPrompt)
    const withVideo = `${basePrompt}${videoDirectiveLine(url)}`
    const prompt = preview ? `${withVideo}${previewActionLine(preview)}` : withVideo
    // 已经是这个样子（模式、参考列表、标记、提示词都一致）= 什么都不用写
    if (prompt === rawPrompt && sameMeta(nextMeta, meta)) return { kind: 'noop' }
    return {
      kind: 'patch',
      mode: 'video_ref',
      patch: { meta: nextMeta, prompt },
      ...(hadFirstOrLast && !targetHasFrameSlot ? { toast: { message: i18n.t('director.agent.switchedToOmni'), level: 'warning' as const } } : {}),
    }
  }
  // 降级：模型没有参考视频槽。预演 → 逐镜实测运镜 + 细节动作写成文字（替换上一版预演文字），并明说精度低；运镜小片 → 运镜 prompt 地板（同样记标记）。
  return promptOnlyOutcome(target, meta, url, prevAttached, preview, move, preview ? i18n.t('director.agent.previewPromptOnly') : null)
}
