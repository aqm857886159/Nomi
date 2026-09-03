// 「就地加工这张图」这类本地操作（抠图 / 切图 / 裁剪）的进度相位——单一真相源。
//
// 谁写：useNodeImageEditing 把 progress.phase 设成这里的值。
// 谁读：节点壳据此决定待机长相——**图保留 + 模糊呼吸**，不套「生成中」那层转圈遮罩
//       （那层是给真·生成用的：没图、要等模型、可取消；本地加工只是这张图在被处理）。
// 为什么抽出来：两边各写各的字符串，加一种本地操作就会漏掉一边，于是切图时节点要么没反馈、
// 要么被当成「正在生成」——这类不一致只能靠共用一个常量根治。
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import i18n from '../../../i18n'

export const REMOVE_BACKGROUND_PHASE = 'remove-background'
/** 切图 / 裁剪共用一相：对用户是同一件事——「这张图正在被裁开」。 */
export const IMAGE_EDIT_PHASE = 'image-edit'

const LOCAL_IMAGE_OP_PHASES: readonly string[] = [REMOVE_BACKGROUND_PHASE, IMAGE_EDIT_PHASE]

export function isLocalImageOpPending(node: GenerationCanvasNode): boolean {
  if (node.status !== 'queued' && node.status !== 'running') return false
  return LOCAL_IMAGE_OP_PHASES.includes(node.progress?.phase || '')
}

/** 浮条上「抠图中」那颗按钮只认抠图这一相：切图时它不该转圈说自己在抠图。 */
export function isRemoveBackgroundPending(node: GenerationCanvasNode): boolean {
  return isLocalImageOpPending(node) && node.progress?.phase === REMOVE_BACKGROUND_PHASE
}

const matte = (step: string): string =>
  i18n.t(`generationCommon.imageToolbar.matteProgress.${step}` as 'generationCommon.imageToolbar.matteProgress.decode')

/**
 * 抠图阶段 key → 给用户看的一句话。节点画布与白板共用这一份（P1：不留两套映射）。
 *
 * @imgly 只发两族 key：下载资源发 `fetch:<资源路径>`，推理各步发 `compute:<步骤>`。
 * `fetch:` 必须先判——`fetch:/models/isnet_quint8` 同时含 "model"，落到 model 分支就把
 * 「正在下载 50MB」说成「加载抠图模型」；而 wasm 那条 `fetch:/onnxruntime-web/...`
 * 一个分支都不匹配，只会掉进 fallback「抠图中」。启动预热删掉后，这 ~50MB 改由用户
 * 在首次点抠图时当场等，这两句话就是他判断「到底卡住没有」的唯一依据，不能含糊。
 */
export function removeBackgroundProgressMessage(key: string): string {
  if (key.startsWith('fetch:')) return matte('download')
  if (key.includes('decode')) return matte('decode')
  if (key.includes('inference')) return matte('inference')
  if (key.includes('mask')) return matte('mask')
  if (key.includes('encode')) return matte('encode')
  if (key.includes('model')) return matte('model')
  return matte('fallback')
}
