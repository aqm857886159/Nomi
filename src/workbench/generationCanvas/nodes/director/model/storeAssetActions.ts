/**
 * [INPUT]: 依赖 ./directorStore 的 CommitProject / StoreGet / StoreSet 类型、./directorIds 的 createDirectorId、./directorTypes、
 *          ./directorProject 的 normalizeScene / remapSceneIds
 * [OUTPUT]: 对外提供 DirectorAssetActions、createAssetActions：资产库条目与文件夹增删改移、导入 AI/工程场景 JSON 为新图层
 * [POS]: director/model 的资产库动作集（清单 §3.2 S2/S3）：只存资产句柄不存文件；删文件夹时子文件夹与条目回到上级而不是连坐删除；
 *        目录移动共用祖先链校验；上传目标被删则归根。导入先辨 AI groups 或工程场景结构，再物化/归一换 id，永远加为新图层不覆盖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createDirectorId } from './directorIds'
import { aiSceneSchema, normalizeAiScene } from './aiScene'
import { canMoveAssetFolder } from './assetFolders'
import { normalizeScene, remapSceneIds } from './directorProject'
import type { CommitProject, StoreGet, StoreSet } from './directorStore'
import type { DirectorAssetFolder, DirectorAssetItem } from './directorTypes'

export type DirectorAssetActions = {
  addAssetItem: (item: Omit<DirectorAssetItem, 'id' | 'createdAt'>) => DirectorAssetItem
  removeAssetItem: (id: string) => void
  moveAssetItem: (id: string, folderId: string | null) => void
  renameAssetItem: (id: string, name: string) => void
  addAssetFolder: (name: string, parentId?: string | null) => DirectorAssetFolder
  renameAssetFolder: (id: string, name: string) => void
  moveAssetFolder: (id: string, parentId: string | null) => boolean
  deleteAssetFolder: (id: string) => void
  // 资产库里的场景 JSON → 新图层（容错归一 + 换 id），返回新图层 id；不是合法场景返回 null
  importScene: (raw: unknown, fallbackName: string) => string | null
}

export const createAssetId = (): string => createDirectorId('dasset')
export const createAssetFolderId = (): string => createDirectorId('dfolder')

export function createAssetActions(_set: StoreSet, get: StoreGet, commitProject: CommitProject): DirectorAssetActions {
  const save = () => get().saveState()
  return {
    addAssetItem: (input) => {
      const item: DirectorAssetItem = { ...input, id: createAssetId(), createdAt: Date.now() }
      if (item.folderId && !get().project.assets.folders.some((folder) => folder.id === item.folderId)) item.folderId = null
      save()
      commitProject((project) => {
        project.assets.items.push(item)
      })
      return item
    },
    removeAssetItem: (id) => {
      save()
      commitProject((project) => {
        project.assets.items = project.assets.items.filter((item) => item.id !== id)
      })
    },
    moveAssetItem: (id, folderId) => {
      save()
      commitProject((project) => {
        const item = project.assets.items.find((candidate) => candidate.id === id)
        if (!item) return
        item.folderId = folderId && project.assets.folders.some((folder) => folder.id === folderId) ? folderId : null
      })
    },
    renameAssetItem: (id, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      save()
      commitProject((project) => {
        const item = project.assets.items.find((candidate) => candidate.id === id)
        if (item) item.name = trimmed
      })
    },
    addAssetFolder: (name, parentId = null) => {
      const folder: DirectorAssetFolder = { id: createAssetFolderId(), name: name.trim() || name, parentId }
      save()
      commitProject((project) => {
        if (folder.parentId && !project.assets.folders.some((candidate) => candidate.id === folder.parentId)) folder.parentId = null
        project.assets.folders.push(folder)
      })
      return folder
    },
    renameAssetFolder: (id, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      save()
      commitProject((project) => {
        const folder = project.assets.folders.find((candidate) => candidate.id === id)
        if (folder) folder.name = trimmed
      })
    },
    moveAssetFolder: (id, parentId) => {
      if (!canMoveAssetFolder(get().project.assets.folders, id, parentId)) return false
      if (get().project.assets.folders.find((folder) => folder.id === id)?.parentId === parentId) return true
      save()
      commitProject((project) => {
        project.assets.folders.find((folder) => folder.id === id)!.parentId = parentId
      })
      return true
    },
    deleteAssetFolder: (id) => {
      save()
      commitProject((project) => {
        const folder = project.assets.folders.find((candidate) => candidate.id === id)
        if (!folder) return
        const parentId = folder.parentId
        project.assets.folders = project.assets.folders.filter((candidate) => candidate.id !== id)
        for (const child of project.assets.folders) if (child.parentId === id) child.parentId = parentId
        for (const item of project.assets.items) if (item.folderId === id) item.folderId = parentId
      })
    },
    importScene: (raw, fallbackName) => {
      const ai = aiSceneSchema.safeParse(raw)
      if (ai.success) return get().materializeAiScene(normalizeAiScene(ai.data, fallbackName), 'new_layer').sceneId
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const record = raw as Record<string, unknown>
      if (!['objects', 'cameras', 'lights'].some((key) => Array.isArray(record[key]))) return null
      const normalized = normalizeScene(raw, fallbackName)
      if (!normalized) return null
      const scene = remapSceneIds(normalized, 'import')
      save()
      commitProject((project) => {
        project.scenes.push(scene)
        project.activeSceneId = scene.id
      })
      return scene.id
    },
  }
}
