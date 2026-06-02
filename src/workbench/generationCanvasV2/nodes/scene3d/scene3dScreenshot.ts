import { getDesktopActiveProjectId } from '../../../../desktop/activeProject'
import { getDesktopBridge } from '../../../../desktop/bridge'

export type PersistedScene3DScreenshot = {
  url: string
  assetId?: string
  raw?: unknown
  localOnly: boolean
}

function fileSafePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'scene3d'
}

export async function persistScene3DScreenshot(
  dataUrl: string,
  ownerNodeId: string,
  title: string,
): Promise<PersistedScene3DScreenshot> {
  const desktop = getDesktopBridge()
  const projectId = getDesktopActiveProjectId()
  if (!desktop || !projectId) {
    return { url: dataUrl, localOnly: true }
  }

  const createdAt = Date.now()
  const fileName = `${fileSafePart(title)}-${fileSafePart(ownerNodeId)}-${createdAt}.png`
  const asset = await desktop.assets.importRemoteUrl({
    projectId,
    url: dataUrl,
    kind: 'generated',
    fileName,
    ownerNodeId,
  })
  const url = typeof asset.data?.url === 'string' && asset.data.url ? asset.data.url : dataUrl
  return {
    url,
    assetId: asset.id,
    raw: { asset },
    localOnly: false,
  }
}
