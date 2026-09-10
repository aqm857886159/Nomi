/** Asset folder ancestry owns cycle prevention and search visibility for all tree gestures. */
import type { DirectorAssetFolder, DirectorAssetItem } from './directorTypes'

export function canMoveAssetFolder(folders: DirectorAssetFolder[], id: string, parentId: string | null): boolean {
  if (!folders.some((folder) => folder.id === id)) return false
  const seen = new Set([id])
  let current = parentId
  while (current !== null) {
    if (seen.has(current)) return false
    seen.add(current)
    const parent = folders.find((folder) => folder.id === current)
    if (!parent) return false
    current = parent.parentId
  }
  return true
}

export function matchingAssetFolders(folders: DirectorAssetFolder[], items: DirectorAssetItem[], query: string): Set<string> {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return new Set(folders.map((folder) => folder.id))
  const visible = new Set<string>()
  const reveal = (id: string | null) => {
    while (id && !visible.has(id)) {
      visible.add(id)
      id = folders.find((folder) => folder.id === id)?.parentId ?? null
    }
  }
  for (const folder of folders) if (folder.name.toLocaleLowerCase().includes(q)) reveal(folder.id)
  for (const item of items) if (item.name.toLocaleLowerCase().includes(q)) reveal(item.folderId)
  return visible
}
