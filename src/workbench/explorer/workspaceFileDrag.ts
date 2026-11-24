// 项目文件树 → 画布的拖拽契约。
// 文件已经在项目文件夹里，拖到画布只需用 nomi-local 协议引用它，无需重新导入。

export const WORKSPACE_FILE_DRAG_MIME = 'application/x-nomi-workspace-file'

type WorkspaceFileDragPayload = {
  projectId: string
  relativePath: string
  name: string
  kind: string
}

/** electron 注册的 nomi-local 协议：`nomi-local://asset/{projectId}/{relativePath}`，逐段编码。 */
export function buildWorkspaceFileUrl(projectId: string, relativePath: string): string {
  const segments = [projectId, ...relativePath.split('/')].map((segment) => encodeURIComponent(segment))
  return `nomi-local://asset/${segments.join('/')}`
}

export function parseWorkspaceFileDrag(raw: string | null | undefined): WorkspaceFileDragPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<WorkspaceFileDragPayload>
    if (typeof value.projectId === 'string' && typeof value.relativePath === 'string' && value.projectId && value.relativePath) {
      return {
        projectId: value.projectId,
        relativePath: value.relativePath,
        name: typeof value.name === 'string' ? value.name : value.relativePath,
        kind: typeof value.kind === 'string' ? value.kind : 'file',
      }
    }
  } catch {
    // ignore malformed payloads
  }
  return null
}
