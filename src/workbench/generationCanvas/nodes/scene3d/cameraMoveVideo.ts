// 运镜小片持久化：N 帧 PNG dataURL → 走 nomi:scene3d:frames-to-video IPC → 项目素材 mp4 url。
// persistScene3DScreenshot 的视频镜像（图片走 importRemoteUrl，视频走 ffmpeg 拼片 IPC）。
// 无桥/无项目（如测试/纯网页）时返回 localOnly=true，不炸。见 docs/plan/2026-06-22 S2。
import { getDesktopActiveProjectId } from '../../../../desktop/activeProject'
import { getDesktopBridge } from '../../../../desktop/bridge'

export type PersistedCameraMoveVideo = {
  url: string | null
  assetId?: string
  localOnly: boolean
}

function fileSafePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'camera-move'
}

/** 把沿轨迹采的 N 帧拼成 mp4 并落成项目素材。frames 为 PNG dataURL，按播放顺序。 */
export async function persistCameraMoveVideo(
  frames: string[],
  ownerNodeId: string,
  title: string,
  fps: number,
): Promise<PersistedCameraMoveVideo> {
  const desktop = getDesktopBridge()
  const projectId = getDesktopActiveProjectId()
  if (!desktop?.scene3d || !projectId) {
    return { url: null, localOnly: true }
  }

  const createdAt = Date.now()
  const fileName = `${fileSafePart(title)}-${fileSafePart(ownerNodeId)}-${createdAt}.mp4`
  const result = await desktop.scene3d.framesToVideo({
    projectId,
    ownerNodeId,
    fileName,
    fps,
    frames,
  })
  return {
    url: result.url || null,
    assetId: result.assetId,
    localOnly: false,
  }
}
