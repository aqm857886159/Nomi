import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { assetUrl } from './parameterControlModel'

/**
 * 参数槽「本地文件 → 素材 url」上传的唯一骨架（2026-09-11 抽出）。
 *
 * `NodeParameterControls` 里三处上传（数组参考槽 / D3 源视频单槽 / 单帧媒体槽）本来各抄一遍
 * 同一段：置忙 → 清错 → import → 取 url → 取不到就抛 → 落地 → catch 写错 → finally 清忙。
 * 抄三遍的代价不在行数，在「改一处忘两处」：2026-09-11 给音频槽补文案时只有单帧槽那份认得
 * `mediaKind='audio'`，另外两份仍按图片说话。骨架收成一份之后，留给调用方的正好是它们真正
 * 不同的四件事——忙标记写哪儿、导入选项、取不到 url 时说哪句话、拿到 url 之后写到哪儿。
 */
export async function runSlotUpload(input: {
  file: File
  /** 素材显示名的兜底（文件自带名字时用文件名）。 */
  label: string
  ownerNodeId: string
  /** 图片走 image_edit 任务；视频/音频不带（后端按原样存）。 */
  taskKind?: 'image_edit'
  /** url 取不到时抛给用户看的那句话——每种媒体各说各的。 */
  missingUrlMessage: string
  setBusy: (busy: boolean) => void
  setError: (message: string) => void
  apply: (url: string) => void
}): Promise<void> {
  const { file, label, ownerNodeId, taskKind, missingUrlMessage, setBusy, setError, apply } = input
  setBusy(true)
  setError('')
  try {
    const uploaded = await importWorkbenchLocalAssetFile(file, file.name || label, {
      ownerNodeId,
      ...(taskKind ? { taskKind } : {}),
    })
    const url = assetUrl(uploaded)
    if (!url) throw new Error(missingUrlMessage)
    apply(url)
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error))
  } finally {
    setBusy(false)
  }
}
