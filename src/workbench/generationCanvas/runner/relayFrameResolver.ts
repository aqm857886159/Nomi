import type { ResolvedGenerationReferences } from './generationReferenceResolver'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'

/**
 * **接力帧解析器（唯一真相源）**：把「first_frame 边的源是视频」这件事，统一收口成
 * 「这条边的接力帧（图片 URL）是什么」一个问题，再回填 references.firstFrameUrl。
 *
 * 策略链（通用，不认识任何 vendor）：
 *   ① references 已带现成尾帧 URL（如某模型 return_last_frame 已落 lastFrameUrl）→ 直接用，省一次抽帧；
 *   ② 否则 → 调通用抽帧 IPC，取源视频尾帧；
 *   ③ 都拿不到 → 抛错（上游标人话错误）。**绝不拿视频/封面冒充首帧**
 *      —— resolver 的「不冒充」不变量（generationReferenceResolver.ts:102）靠这里兜住。
 *
 * 接力语义：用**源视频的尾帧**当本镜首帧（前一镜结束画面 → 后一镜开始画面，视觉连贯）。
 */
export async function applyRelayFirstFrame(references: ResolvedGenerationReferences): Promise<void> {
  if (!references.relayFromVideoUrl || references.firstFrameUrl) return
  const relayVideoUrl = references.relayFromVideoUrl

  // ① 已有现成尾帧 URL（return_last_frame 链）→ 直接复用，零抽帧成本。
  if (references.lastFrameUrl) {
    references.firstFrameUrl = references.lastFrameUrl
    delete references.relayFromVideoUrl
    return
  }

  // ② 抽帧。projectId 是写素材落项目目录所需，runner 作用域拿不到 → 从活动会话取（单源）。
  const projectId = getActiveWorkbenchProjectId()
  if (!projectId) throw new Error('视频接力失败：找不到当前项目（请先保存项目后重试）')
  const extractFrame = getDesktopBridge()?.video?.extractFrame
  if (!extractFrame) throw new Error('视频接力失败：当前环境不支持抽帧（需桌面端）')

  let url = ''
  try {
    const result = await extractFrame({ videoUrl: relayVideoUrl, which: 'last', projectId })
    url = result?.url || ''
  } catch (error) {
    throw new Error(`视频接力抽帧失败：${error instanceof Error ? error.message : String(error)}`)
  }
  // ③ 拿不到 → 抛错，不冒充。
  if (!url) throw new Error('视频接力失败：未能从源视频取到尾帧')

  references.firstFrameUrl = url
  delete references.relayFromVideoUrl
}
