import { hostedAssetUrl, importWorkbenchLocalAssetFile } from '../../api/assetUploadApi'

/**
 * 节点图片落盘统一入口。
 *
 * 根因：卡片上传 / 全景上传 / 音频上传 / 裁切·旋转·网格切分 这些路径过去把
 * canvas.toDataURL / FileReader 的 base64 直接写进 store 且【从不替换】，于是每张图
 * 的完整 base64 永久挂在 Zustand 节点上、随每次保存全量序列化落盘 —— 图多即卡。
 *
 * 这里复用「拖拽导入」已经走通的那条干净管线（importWorkbenchLocalAssetFile →
 * 落盘 → nomi-local:// URL），让所有「图进节点」的路径都收敛到本地文件 URL，store
 * 只存门牌号。绝不造并行版（P1）。
 *
 * 持久化约束（见 projectMediaMigration.assertWorkbenchProjectMediaUrlsPersistable）：
 * result.url 只能是 nomi-local:// 或 base64，不能是 blob:（保存会抛错）。因此这里
 * 直接 await 落盘换 nomi-local；只有落盘失败才退回 base64 兜底（可持久化、不丢图）。
 */

/** File → 本地资产文件，返回可持久化 nomi-local:// URL；失败返回 null（调用方退回 base64 兜底）。 */
export async function persistNodeImageFile(file: File, ownerNodeId: string): Promise<string | null> {
  try {
    const asset = await importWorkbenchLocalAssetFile(file, file.name || 'asset', { ownerNodeId })
    return hostedAssetUrl(asset) || null
  } catch {
    return null
  }
}

/**
 * dataURL → File。给 canvas.toDataURL 的产物（裁切 / 旋转 / 网格切分 / 全景截图）用，
 * 这样它们也能走 persistNodeImageFile 落盘，而不是把 PNG base64 永久塞进 store。
 */
export function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  const match = /^data:([^;,]*?)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return null
  const contentType = match[1] || 'image/png'
  const isBase64 = Boolean(match[2])
  const data = match[3]
  try {
    let arr: Uint8Array
    if (isBase64) {
      const binary = atob(data)
      arr = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) arr[i] = binary.charCodeAt(i)
    } else {
      const decoded = decodeURIComponent(data)
      arr = new Uint8Array(decoded.length)
      for (let i = 0; i < decoded.length; i += 1) arr[i] = decoded.charCodeAt(i)
    }
    return new File([arr as BlobPart], fileName, { type: contentType })
  } catch {
    return null
  }
}
